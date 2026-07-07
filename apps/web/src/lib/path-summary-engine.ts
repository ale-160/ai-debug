// ============================================================
// AI Debug — 路径摘要（Rolling Summary）生成引擎
//
// 为每个节点维护从根到自身的聚合摘要（≤ maxLength 字）。
// 子节点基于父节点 pathSummary + 本节点结论增量生成，体现"diff"语义。
// 合并节点基于所有来源节点 pathSummary 聚合生成。
//
// T007 改进：
// 1. 结构化提示词：输出包含"关键结论/决策/未解决问题/关键实体"四段，
//    便于增量生成时 LLM 聚焦"哪些已变/未变"，也便于用户在 Inspector 浏览。
// 2. 哈希缓存：缓存键 = hash(parentSummaryInput + userMessage + assistantMessage)，
//    命中时跳过 LLM 调用直接复用 pathSummary。失效逻辑：节点内容变更时键变化即重新生成。
// 3. 配置化：maxLength / threshold / recentKeep 从 AppSettings.pathSummaryConfig
//    读取（用户覆盖 > provider 预设 > 兜底常量）。
//
// 旁路逻辑：失败静默返回空 summary，不抛异常，不阻塞主流程。
// 复用 quickCallLLM（非流式调用），与 generateSummary 模式一致。
// ============================================================
import type { Node } from 'reactflow';
import type { TurnNodeData } from '@/components/node-flow/types';
import { quickCallLLM } from './llm-helpers';
import { PATH_SUMMARY_MAX_LENGTH, getActivePathSummaryConfig } from './context-config';

/** generatePathSummary 的返回结构：含摘要文本与缓存键 */
export interface PathSummaryResult {
  /** 路径摘要文本（≤ maxLength 字）。失败时为空字符串 */
  summary: string;
  /** 缓存键，调用方应写入 node.data.pathSummaryCacheKey 以便下次命中 */
  cacheKey: string;
}

/**
 * 结构化输出约束模板（T007 任务 3）。
 * 要求 LLM 输出四段结构化内容，便于增量生成与 Inspector 浏览。
 */
function buildOutputConstraints(maxLength: number): string {
  return `要求：
- 输出不超过 ${maxLength} 字
- 聚焦"已确立的结论/决策/事实"，不逐节点复述
- 保留关键结论链的演进（A→B→C 的因果关系）
- 按以下结构化格式输出（保留四个二级标题，每段 0-N 个要点）：

## 关键结论（已确立）
- ...

## 关键决策与理由
- ...

## 未解决问题
- ...

## 关键实体 / 变量（名称: 一句话说明）
- ...

直接输出上述结构化文本，不要前缀、不要 markdown 代码块包裹。`;
}

/**
 * 为根节点生成路径摘要（无父摘要基线）。
 * 直接基于本节点的 userMessage + assistantMessage 生成。
 */
function buildRootPrompt(node: Node<TurnNodeData>, maxLength: number): string {
  return `你是一位对话路径摘要助手。请基于以下对话内容生成路径摘要，提炼已确立的关键结论/决策/事实。

${buildOutputConstraints(maxLength)}

对话内容：
用户：${node.data.userMessage.slice(0, 2000)}
AI：${node.data.assistantMessage.slice(0, 4000)}`;
}

/**
 * 为普通子节点生成路径摘要（基于父节点 pathSummary 增量更新）。
 * 输入：父节点 pathSummary（基线）+ 本节点 userMessage + assistantMessage。
 * 结构化输出便于 LLM 聚焦"哪些已变/未变"。
 */
function buildIncrementalPrompt(
  node: Node<TurnNodeData>,
  parentPathSummary: string,
  maxLength: number,
): string {
  return `你是一位对话路径摘要助手。以下是此前对话路径的聚合摘要（已确立的结论/决策/事实）：

${parentPathSummary}

现在请基于上述摘要 + 以下新增对话内容，生成更新后的路径摘要。新摘要应继承前序结论并纳入本节点的新结论，体现"diff"增量语义。

${buildOutputConstraints(maxLength)}

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
  maxLength: number,
): string {
  const branchBlocks = sourceSummaries
    .map((s, i) => `分支 ${i + 1} 摘要：\n${s}`)
    .join('\n\n');

  return `你是一位对话路径摘要助手。以下是多路分支的结论摘要，请聚合为统一的路径摘要。

${branchBlocks}

现在请基于上述多路摘要 + 以下合并节点的对话内容，生成统一的路径摘要。新摘要应整合各分支的结论，体现多路聚合关系，避免简单拼接。

${buildOutputConstraints(maxLength)}

合并节点对话内容：
用户：${node.data.userMessage.slice(0, 2000)}
AI：${node.data.assistantMessage.slice(0, 4000)}`;
}

/**
 * 简单字符串哈希（djb2 算法，无外部依赖）。
 * 用于 pathSummary 缓存键，比较"父摘要 + 节点内容"是否变化。
 * - hash 碰撞概率低（32 位整数空间，对短文本足够）
 * - 输出 16 进制字符串，便于存储与比较
 */
function djb2Hash(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    // hash * 33 + charCode（等价于 (hash << 5) + hash）
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  // 转为无符号 16 进制
  return (hash >>> 0).toString(16);
}

/**
 * 计算 pathSummary 的缓存键。
 * 缓存键 = hash(parentSummaryInput + "||" + userMessage + "||" + assistantMessage)。
 * - parentSummaryInput：父路径摘要（普通子节点）/ 来源摘要拼接（合并节点）/ 空字符串（根节点）
 * - 节点内容（userMessage + assistantMessage）变更时键变化，触发重新生成
 */
function computeCacheKey(
  parentSummaryInput: string,
  userMessage: string,
  assistantMessage: string,
): string {
  return djb2Hash(`${parentSummaryInput}||${userMessage}||${assistantMessage}`);
}

/**
 * 生成路径摘要（rolling summary）。
 *
 * - 根节点（parentId === null 且无 mergedFromIds）：直接基于本节点内容生成
 * - 合并节点（mergedFromIds 非空）：基于所有来源节点的 pathSummary + 本节点结论聚合
 * - 普通子节点：基于父节点 pathSummary + 本节点结论增量生成
 * - 旁路逻辑：失败时静默返回空 summary，不抛异常
 *
 * 哈希缓存（T007 任务 2）：
 * - 缓存键 = hash(parentSummaryInput + userMessage + assistantMessage)
 * - 若 node.data.pathSummaryCacheKey 与计算出的键相同，且 node.data.pathSummary 非空，
 *   直接复用现有 pathSummary，跳过 LLM 调用
 * - 否则调用 LLM 生成新摘要，返回新缓存键供调用方写入节点
 *
 * @param node              当前节点（需已填充 assistantMessage）
 * @param parentPathSummary 父节点的 pathSummary（普通子节点用，根/合并节点可传 undefined）
 * @param allNodes          全部节点（合并节点查找来源节点 pathSummary 用，可选）
 * @returns                 { summary, cacheKey }：summary 为空字符串表示生成失败或节点无回答；
 *                           cacheKey 供调用方写入 node.data.pathSummaryCacheKey
 */
export async function generatePathSummary(
  node: Node<TurnNodeData>,
  parentPathSummary?: string,
  allNodes?: Node<TurnNodeData>[],
): Promise<PathSummaryResult> {
  try {
    // 节点回答为空时无需生成摘要
    if (!node.data.assistantMessage.trim()) {
      return { summary: '', cacheKey: '' };
    }

    const mergedFromIds = node.data.mergedFromIds;

    // 确定缓存键的"父摘要输入"与实际 prompt：
    // - 合并节点：来源摘要拼接
    // - 普通子节点：父节点 pathSummary
    // - 根节点：空字符串
    let parentSummaryInput: string;
    let sourceSummaries: string[] = [];

    if (mergedFromIds && mergedFromIds.length > 0) {
      // 合并节点：收集所有来源节点的 pathSummary
      const nodeMap = new Map<string, Node<TurnNodeData>>();
      if (allNodes) {
        for (const n of allNodes) nodeMap.set(n.id, n);
      }
      sourceSummaries = mergedFromIds
        .map((id) => nodeMap.get(id)?.data.pathSummary)
        .filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
      parentSummaryInput = sourceSummaries.join('\n---\n');
    } else if (node.data.parentId === null) {
      // 根节点：无父摘要基线
      parentSummaryInput = '';
    } else {
      // 普通子节点：基于父节点 pathSummary 增量生成
      parentSummaryInput = parentPathSummary ?? '';
    }

    // 计算缓存键并检查命中
    const cacheKey = computeCacheKey(
      parentSummaryInput,
      node.data.userMessage,
      node.data.assistantMessage,
    );
    const existingSummary = node.data.pathSummary;
    const existingCacheKey = node.data.pathSummaryCacheKey;
    if (
      existingCacheKey === cacheKey &&
      typeof existingSummary === 'string' &&
      existingSummary.trim().length > 0
    ) {
      // 缓存命中：复用现有 pathSummary，跳过 LLM 调用
      return { summary: existingSummary, cacheKey };
    }

    // 读取生效配置（maxLength 按用户覆盖 > provider 预设 > 兜底常量）
    const activeConfig = getActivePathSummaryConfig();
    const maxLength = activeConfig?.maxLength ?? PATH_SUMMARY_MAX_LENGTH;

    // 构造 prompt
    let prompt: string;
    if (mergedFromIds && mergedFromIds.length > 0) {
      // 合并节点
      if (sourceSummaries.length === 0) {
        // 无任何来源摘要时退化为根节点模式
        prompt = buildRootPrompt(node, maxLength);
      } else {
        prompt = buildMergePrompt(node, sourceSummaries, maxLength);
      }
    } else if (node.data.parentId === null) {
      // 根节点：无父摘要基线
      prompt = buildRootPrompt(node, maxLength);
    } else {
      // 普通子节点：基于父节点 pathSummary 增量生成
      if (parentPathSummary && parentPathSummary.trim()) {
        prompt = buildIncrementalPrompt(node, parentPathSummary, maxLength);
      } else {
        // 父节点无 pathSummary（历史节点未生成），退化为根节点模式
        prompt = buildRootPrompt(node, maxLength);
      }
    }

    // 非流式调用（不传 onDelta），与 generateSummary 模式一致
    const result = await quickCallLLM(prompt);
    // trim 后保险截断到 maxLength 字
    const summary = result.trim().slice(0, maxLength);
    return { summary, cacheKey };
  } catch {
    // 旁路逻辑：失败静默返回空 summary，不抛异常
    return { summary: '', cacheKey: '' };
  }
}
