// ============================================================
// AI Debug — 路径摘要（Rolling Summary）生成引擎
//
// 为每个节点维护从根到自身的聚合摘要（≤ PATH_SUMMARY_MAX_LENGTH 字）。
// 子节点基于父节点 pathSummary + 本节点结论增量生成，体现"diff"语义。
// 旁路逻辑：失败静默返回空字符串，不抛异常，不阻塞主流程。
// 复用 quickCallLLM（非流式调用），与 generateSummary 模式一致。
// ============================================================
import type { Node } from 'reactflow';
import type { TurnNodeData } from '@/components/node-flow/types';
import { quickCallLLM } from './llm-helpers';
import { PATH_SUMMARY_MAX_LENGTH } from './context-config';

/** 路径摘要生成的通用约束（输出要求） */
const SUMMARY_OUTPUT_CONSTRAINTS = `要求：
- 输出不超过 ${PATH_SUMMARY_MAX_LENGTH} 字
- 聚焦"已确立的结论/决策/事实"，不逐节点复述
- 保留关键结论链的演进（A→B→C 的因果关系）
- 直接输出摘要文本，不要前缀、不要 markdown 代码块`;

/**
 * 为根节点生成路径摘要（无父摘要基线）。
 * 直接基于本节点的 userMessage + assistantMessage 生成。
 */
function buildRootPrompt(node: Node<TurnNodeData>): string {
  return `你是一位对话路径摘要助手。请基于以下对话内容生成路径摘要，提炼已确立的关键结论/决策/事实。

${SUMMARY_OUTPUT_CONSTRAINTS}

对话内容：
用户：${node.data.userMessage.slice(0, 2000)}
AI：${node.data.assistantMessage.slice(0, 4000)}`;
}

/**
 * 为普通子节点生成路径摘要（基于父节点 pathSummary 增量更新）。
 * 输入：父节点 pathSummary（基线）+ 本节点 userMessage + assistantMessage。
 */
function buildIncrementalPrompt(
  node: Node<TurnNodeData>,
  parentPathSummary: string,
): string {
  return `你是一位对话路径摘要助手。以下是此前对话路径的聚合摘要（已确立的结论/决策/事实）：

${parentPathSummary}

现在请基于上述摘要 + 以下新增对话内容，生成更新后的路径摘要。新摘要应继承前序结论并纳入本节点的新结论，体现"diff"增量语义。

${SUMMARY_OUTPUT_CONSTRAINTS}

新增对话内容：
用户：${node.data.userMessage.slice(0, 2000)}
AI：${node.data.assistantMessage.slice(0, 4000)}`;
}

/**
 * 为合并节点生成路径摘要（聚合多路分支结论）。
 * 输入：所有来源节点的 pathSummary + 合并节点的 userMessage + assistantMessage。
 * 提示词说明"以下是多路分支的结论摘要，请聚合为统一的路径摘要"。
 */
function buildMergePrompt(
  node: Node<TurnNodeData>,
  sourceSummaries: string[],
): string {
  const branchBlocks = sourceSummaries
    .map((s, i) => `分支 ${i + 1} 摘要：\n${s}`)
    .join('\n\n');

  return `你是一位对话路径摘要助手。以下是多路分支的结论摘要，请聚合为统一的路径摘要。

${branchBlocks}

现在请基于上述多路摘要 + 以下合并节点的对话内容，生成统一的路径摘要。新摘要应整合各分支的结论，体现多路聚合关系，避免简单拼接。

${SUMMARY_OUTPUT_CONSTRAINTS}

合并节点对话内容：
用户：${node.data.userMessage.slice(0, 2000)}
AI：${node.data.assistantMessage.slice(0, 4000)}`;
}

/**
 * 生成路径摘要（rolling summary）。
 *
 * - 根节点（parentId === null 且无 mergedFromIds）：直接基于本节点内容生成
 * - 合并节点（mergedFromIds 非空）：基于所有来源节点的 pathSummary + 本节点结论聚合
 * - 普通子节点：基于父节点 pathSummary + 本节点结论增量生成
 * - 旁路逻辑：失败时静默返回空字符串，不抛异常
 *
 * @param node              当前节点（需已填充 assistantMessage）
 * @param parentPathSummary 父节点的 pathSummary（普通子节点用，根/合并节点可传 undefined）
 * @param allNodes          全部节点（合并节点查找来源节点 pathSummary 用，可选）
 * @returns                 路径摘要文本（≤ PATH_SUMMARY_MAX_LENGTH 字），失败返回空字符串
 */
export async function generatePathSummary(
  node: Node<TurnNodeData>,
  parentPathSummary?: string,
  allNodes?: Node<TurnNodeData>[],
): Promise<string> {
  try {
    // 节点回答为空时无需生成摘要
    if (!node.data.assistantMessage.trim()) return '';

    const mergedFromIds = node.data.mergedFromIds;
    let prompt: string;

    if (mergedFromIds && mergedFromIds.length > 0) {
      // 合并节点：收集所有来源节点的 pathSummary
      const nodeMap = new Map<string, Node<TurnNodeData>>();
      if (allNodes) {
        for (const n of allNodes) nodeMap.set(n.id, n);
      }
      const sourceSummaries = mergedFromIds
        .map((id) => nodeMap.get(id)?.data.pathSummary)
        .filter((s): s is string => typeof s === 'string' && s.trim().length > 0);

      // 无任何来源摘要时退化为根节点模式
      if (sourceSummaries.length === 0) {
        prompt = buildRootPrompt(node);
      } else {
        prompt = buildMergePrompt(node, sourceSummaries);
      }
    } else if (node.data.parentId === null) {
      // 根节点：无父摘要基线
      prompt = buildRootPrompt(node);
    } else {
      // 普通子节点：基于父节点 pathSummary 增量生成
      if (parentPathSummary && parentPathSummary.trim()) {
        prompt = buildIncrementalPrompt(node, parentPathSummary);
      } else {
        // 父节点无 pathSummary（历史节点未生成），退化为根节点模式
        prompt = buildRootPrompt(node);
      }
    }

    // 非流式调用（不传 onDelta），与 generateSummary 模式一致
    const result = await quickCallLLM(prompt);
    // trim 后保险截断到 PATH_SUMMARY_MAX_LENGTH 字
    return result.trim().slice(0, PATH_SUMMARY_MAX_LENGTH);
  } catch {
    // 旁路逻辑：失败静默返回空字符串，不抛异常
    return '';
  }
}
