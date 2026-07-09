import type { Node } from 'reactflow';
import type { TurnNodeData, Suggestion, TurnStatus } from '@/components/node-flow/types';
import { quickCallLLM, buildVisionMessage } from './llm-helpers';
import { type LLMMessage, RequestPoolError } from './llm-client';
import { describeError } from './request';
import { createTurnNodeData } from '@/components/node-flow/node-definitions';
import { SUMMARY_THRESHOLD, RECENT_KEEP } from './context-config';
import { generatePathSummary } from './path-summary-engine';

/** 系统提示词，引导 AI 给出回答并在末尾附上后续探索方向 */
export const SYSTEM_PROMPT = `你是一位资深的问题排查助手，帮助用户分析各类问题（bug、技术疑问、方案决策等）。

请基于用户提供的上下文进行深入分析，给出有理有据的回答。

回答结束后，请在末尾给出 2-4 个"可能的下一步方向"，供用户选择继续排查。每个方向用以下格式：

### 方向：<标题>
<简述该方向的内容，1-2 句话>

如果当前信息不足以给出明确方向，可以只给 1 个方向或省略。方向应当是基于当前上下文最值得继续探索的分支。`;

/** 上下文路径中的单个条目（对应路径上一个节点的对话内容） */
interface ContextPathItem {
  userMessage: string;
  assistantMessage: string;
  images?: string[];
  /** 节点状态：ignored 节点在 buildLLMMessages 时跳过 */
  status: TurnStatus;
  /** 路径摘要（rolling summary）：混合模式下前段节点用此字段替代完整内容 */
  pathSummary?: string;
}

/** 将一个节点的 data 转换为上下文路径条目 */
function toContextPathItem(node: Node<TurnNodeData>): ContextPathItem {
  return {
    userMessage: node.data.userMessage,
    assistantMessage: node.data.assistantMessage,
    images: node.data.images,
    status: node.data.status,
    pathSummary: node.data.pathSummary,
  };
}

/**
 * collectContextPath 的递归实现。
 *
 * 返回多段路径（ContextPathItem[][]）：
 * - 普通节点：返回单段 [[根...当前节点]]（含当前节点），与原线性行为一致。
 * - 合并节点（mergedFromIds 非空）：对每个来源 ID 独立递归收集其完整路径
 *   （来源间不共享 visited，允许公共祖先在各分支中重复出现），
 *   最后追加合并节点自身作为单独一段（其 userMessage 即合并意图）。
 *
 * 防环：单条回溯路径内用 visited Set 记录已访问节点 id；合并节点的每个来源
 * 用 new Set(visited) 副本独立防环，既避免环引用死循环，又保证各分支路径完整。
 */
function collectContextPathRecursive(
  nodeId: string,
  nodeMap: Map<string, Node<TurnNodeData>>,
  visited: Set<string>,
): ContextPathItem[][] {
  if (visited.has(nodeId)) return []; // 防环
  const currentNode = nodeMap.get(nodeId);
  if (!currentNode) return [];
  visited.add(nodeId);

  const mergedFromIds = currentNode.data.mergedFromIds;

  // 合并节点：收集所有来源路径 + 自身作为最后一段
  if (mergedFromIds && mergedFromIds.length > 0) {
    const segments: ContextPathItem[][] = [];
    for (const sourceId of mergedFromIds) {
      // 每个来源用 visited 副本独立收集，公共祖先可重复，分支内仍防环
      const subSegments = collectContextPathRecursive(sourceId, nodeMap, new Set(visited));
      segments.push(...subSegments);
    }
    // 合并节点自身作为最后一段（userMessage 为合并意图，assistantMessage 为空）
    segments.push([toContextPathItem(currentNode)]);
    return segments;
  }

  // 根节点：单段只含自身
  if (currentNode.data.parentId === null) {
    return [[toContextPathItem(currentNode)]];
  }

  // 普通非根节点：递归收集父节点路径，把当前节点追加到最后一段末尾
  const parentSegments = collectContextPathRecursive(currentNode.data.parentId, nodeMap, visited);
  if (parentSegments.length === 0) {
    return [[toContextPathItem(currentNode)]];
  }
  parentSegments[parentSegments.length - 1].push(toContextPathItem(currentNode));
  return parentSegments;
}

/**
 * 从指定节点收集上下文路径，返回多段路径（ContextPathItem[][]）。
 *
 * - 普通节点：返回单段 [[根...当前]]，行为与原线性实现一致。
 * - 合并节点（含 mergedFromIds）：返回多段，按 mergedFromIds 顺序排列各来源
 *   的完整路径，末尾追加合并节点自身。后续在合并节点上追问/分叉时，其子节点
 *   回溯到此合并节点会自动展开多路上下文。
 */
export function collectContextPath(
  nodeId: string,
  nodes: Node<TurnNodeData>[],
): ContextPathItem[][] {
  const nodeMap = new Map<string, Node<TurnNodeData>>();
  for (const n of nodes) {
    nodeMap.set(n.id, n);
  }
  return collectContextPathRecursive(nodeId, nodeMap, new Set());
}

/** buildLLMMessages 的混合模式选项 */
export interface BuildLLMMessagesOptions {
  /** 路径摘要（rolling summary）：当前节点的聚合摘要，混合模式下替代前段完整内容 */
  pathSummary?: string;
  /** 后段保留完整内容的节点数（默认 RECENT_KEEP） */
  recentKeep?: number;
  /** 路径总长度（用于判断是否启用混合模式，未传时按各段长度之和计算） */
  pathLength?: number;
}

/** buildLLMMessages 的返回结构：含消息数组与压缩元信息（T018） */
export interface BuildLLMMessagesResult {
  /** 构造好的 OpenAI 兼容消息数组（system + user/assistant） */
  messages: LLMMessage[];
  /**
   * 估算 token 数（粗略估算：所有消息 content 字符数之和 / 3）。
   * 中文 1 字 ≈ 1 token、英文 3 字符 ≈ 1 token，混合场景取 / 3 折中，
   * 仅供 UI 成本预估与调试观测，不作为精确计费依据。
   */
  estimatedTokens: number;
  /** 被压缩的节点数（前段被 pathSummary 替代的节点数，未触发压缩时为 0） */
  compressedCount: number;
  /** 路径总节点数（所有段长度之和，含 ignored 节点） */
  totalNodes: number;
}

/**
 * 计算 LLMMessage content 的字符数（支持 string 与多模态数组）。
 * 多模态数组的 image_url 部分按 0 字符计（图片 token 由模型按图像尺寸另算，此处只估文本）。
 */
function getMessageContentLength(content: LLMMessage['content']): number {
  if (typeof content === 'string') return content.length;
  return content.reduce((sum, part) => sum + (part.type === 'text' ? part.text.length : 0), 0);
}

/**
 * 估算 messages 的 token 数：所有 content 字符数之和 / 3。
 * 粗略估算，供 UI 显示与调试观测，不作为精确计费依据。
 */
function estimateTokens(messages: LLMMessage[]): number {
  const totalChars = messages.reduce((sum, m) => sum + getMessageContentLength(m.content), 0);
  return Math.ceil(totalChars / 3);
}

/**
 * 计算多段路径的总节点数（所有段长度之和）。
 */
function computeTotalPathLength(segments: ContextPathItem[][]): number {
  return segments.reduce((sum, seg) => sum + seg.length, 0);
}

/**
 * 将单个节点条目拼接为 LLM 消息（user + assistant）。
 * - ignored 节点跳过（返回空数组，路径视为断点）。
 * - 含图片的节点用 buildVisionMessage 构造多模态消息。
 * - assistantMessage 为空则只拼 user。
 */
function pushItemMessages(item: ContextPathItem): LLMMessage[] {
  if (item.status === 'ignored') return [];
  const result: LLMMessage[] = [];
  if (item.images && item.images.length > 0) {
    const visionMessages = buildVisionMessage(item.userMessage, item.images);
    result.push(visionMessages[0]);
  } else {
    result.push({ role: 'user', content: item.userMessage });
  }
  if (item.assistantMessage.trim().length > 0) {
    result.push({ role: 'assistant', content: item.assistantMessage });
  }
  return result;
}

/**
 * 在段的 front portion（前 segment.length - recentKeep 个节点）中，
 * 从分割点向前查找最近一个有非空 pathSummary 的节点索引。
 * 找不到返回 -1（该段不启用混合模式，回退为完整拼接）。
 *
 * 注意：ignored 节点的 pathSummary 仍可用于前段摘要（其子节点路径摘要已包含 ignored 节点信息）。
 */
function findNearestSummaryInFront(segment: ContextPathItem[], splitPoint: number): number {
  for (let i = splitPoint - 1; i >= 0; i--) {
    const s = segment[i]?.pathSummary;
    if (typeof s === 'string' && s.trim().length > 0) {
      return i;
    }
  }
  return -1;
}

/**
 * 将多段上下文路径构造为 OpenAI 兼容的消息数组。
 *
 * - 前置 system 消息（SYSTEM_PROMPT + 可选 extraContext）。
 * - 多段路径时，每段之间插入一条 system 分隔标记 `--- 分支 N ---`，
 *   第一段前不插入（保持单段路径与原行为完全一致）。
 * - 每段内按顺序拼接 user / assistant 消息；assistantMessage 为空则跳过；
 *   含图片的节点用 buildVisionMessage 构造多模态消息。
 * - ignored 节点在完整段跳过（不传 user/assistant），路径视为"断点"，
 *   但其 pathSummary 仍可用于前段摘要。
 *
 * 混合模式（options.pathSummary 存在且路径超过 SUMMARY_THRESHOLD 时启用）：
 * - 前段（path.length - RECENT_KEEP 个节点）只传 pathSummary，合并为一条 system 消息
 *   `【前序路径摘要】\n{pathSummary}`，插入在 SYSTEM_PROMPT 之后、所有段之前。
 * - 后 RECENT_KEEP 段（最近节点）传完整 userMessage + assistantMessage。
 * - 合并节点的多段路径在混合模式下每段独立应用规则。
 *
 * 前段回退（options.pathSummary 为空但路径超阈值时）：
 * - 从分割点向前查找最近一个有 pathSummary 的前段节点作为摘要源。
 * - 该节点之后的所有节点传完整内容（split point 移动到该节点之后）。
 * - 兼容旧数据，找不到则该段保持原行为。
 *
 * @param segments       上下文路径分段
 * @param extraContext   可选的额外 system 文本（如记忆条目），插入在 SYSTEM_PROMPT 之后
 * @param options        混合模式选项（pathSummary / recentKeep / pathLength）
 */
export function buildLLMMessages(
  segments: ContextPathItem[][],
  extraContext?: string,
  options?: BuildLLMMessagesOptions,
): BuildLLMMessagesResult {
  const systemContent = extraContext ? `${SYSTEM_PROMPT}\n\n${extraContext}` : SYSTEM_PROMPT;
  const messages: LLMMessage[] = [{ role: 'system', content: systemContent }];

  // 计算路径总长度与 recentKeep（带默认值）
  const totalLength = options?.pathLength ?? computeTotalPathLength(segments);
  const recentKeep = options?.recentKeep ?? RECENT_KEEP;
  const optionsSummary = options?.pathSummary;
  const hasOptionsSummary = typeof optionsSummary === 'string' && optionsSummary.trim().length > 0;

  // 判断是否启用混合模式：路径超过阈值 且（有 options.pathSummary 或 可能存在前段节点 pathSummary）
  const enableHybrid = totalLength > SUMMARY_THRESHOLD;

  // 累计被压缩的节点数（前段被 pathSummary 替代的节点数）
  let compressedCount = 0;

  // Case A：options.pathSummary 存在 → 单条摘要插入在最前，各段只发后 recentKeep 个节点
  if (enableHybrid && hasOptionsSummary) {
    messages.push({
      role: 'system',
      content: `【前序路径摘要】\n${optionsSummary}`,
    });
    segments.forEach((segment, idx) => {
      if (idx > 0) {
        messages.push({ role: 'system', content: `--- 分支 ${idx + 1} ---` });
      }
      // 该段超过 recentKeep 时只发后 recentKeep 个节点；否则全发（每段独立应用规则）
      const startIdx = segment.length > recentKeep ? segment.length - recentKeep : 0;
      // 前段被压缩的节点数（0..startIdx-1 被摘要替代）
      compressedCount += startIdx;
      for (let i = startIdx; i < segment.length; i++) {
        messages.push(...pushItemMessages(segment[i]));
      }
    });
    return {
      messages,
      estimatedTokens: estimateTokens(messages),
      compressedCount,
      totalNodes: totalLength,
    };
  }

  // Case B / 原行为：逐段拼接。超阈值时尝试前段回退（取最近有 pathSummary 的前段节点）
  segments.forEach((segment, idx) => {
    if (idx > 0) {
      messages.push({ role: 'system', content: `--- 分支 ${idx + 1} ---` });
    }

    // 前段回退：该段超过 recentKeep 且未提供 options.pathSummary 时，
    // 从分割点向前查找最近一个有 pathSummary 的前段节点作为摘要源。
    let startIdx = 0;
    if (enableHybrid && !hasOptionsSummary && segment.length > recentKeep) {
      const splitPoint = segment.length - recentKeep;
      const summaryIdx = findNearestSummaryInFront(segment, splitPoint);
      if (summaryIdx >= 0) {
        // 找到前段摘要源：插入摘要 system 消息，该节点之后全部发完整内容
        messages.push({
          role: 'system',
          content: `【前序路径摘要】\n${segment[summaryIdx].pathSummary}`,
        });
        startIdx = summaryIdx + 1;
        // 0..summaryIdx 被摘要替代（共 summaryIdx + 1 个节点）
        compressedCount += summaryIdx + 1;
      }
    }

    for (let i = startIdx; i < segment.length; i++) {
      messages.push(...pushItemMessages(segment[i]));
    }
  });

  return {
    messages,
    estimatedTokens: estimateTokens(messages),
    compressedCount,
    totalNodes: totalLength,
  };
}

/** 从 ```json 代码块中解析建议方向数组 */
function parseJsonSuggestions(text: string): Suggestion[] {
  const regex = /```json\s*([\s\S]*?)```/gi;
  const matches = Array.from(text.matchAll(regex));

  for (const match of matches) {
    const raw = match[1].trim();
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const result: Suggestion[] = [];
        for (const item of parsed) {
          if (
            item &&
            typeof item === 'object' &&
            typeof item.title === 'string' &&
            typeof item.description === 'string'
          ) {
            result.push({ title: item.title, description: item.description });
          }
        }
        if (result.length > 0) return result;
      }
    } catch {
      // 解析失败，继续尝试下一个代码块
    }
  }
  return [];
}

/** 从 Markdown 格式的 "### 方向：<标题>" 段落解析建议方向 */
function parseMarkdownSuggestions(text: string): Suggestion[] {
  // 标题行后紧跟描述段落，直到下一个 "### 方向：" 或文末
  const regex = /###\s*方向：[ \t]*(.+?)[ \t]*\r?\n([\s\S]*?)(?=###\s*方向：|$)/g;
  const suggestions: Suggestion[] = [];
  const matches = Array.from(text.matchAll(regex));

  for (const match of matches) {
    const title = match[1].trim();
    const description = match[2].trim();
    suggestions.push({ title, description });
  }

  return suggestions;
}

/**
 * 从 AI 回答中解析建议方向。优先尝试 JSON 代码块，其次尝试 Markdown。
 * 两种格式都失败则返回空数组，不影响主流程。
 */
export function parseSuggestions(assistantMessage: string): Suggestion[] {
  const jsonResult = parseJsonSuggestions(assistantMessage);
  if (jsonResult.length > 0) {
    return jsonResult;
  }
  return parseMarkdownSuggestions(assistantMessage);
}

/**
 * 生成节点摘要标题（commit message）：调用 LLM 用 ≤20 字概括 AI 回答的核心方向。
 * 旁路逻辑，失败时返回空字符串，不抛异常，不影响主流程。
 */
async function generateSummary(assistantMessage: string): Promise<string> {
  try {
    const prompt = `请用不超过20个字概括以下AI回答的核心方向，只输出标题文本，不要前缀：\n\n${assistantMessage.slice(0, 2000)}`;
    // 非流式调用（不传 onDelta）
    const result = await quickCallLLM(prompt);
    // trim 后保险截断到 30 字
    return result.trim().slice(0, 30);
  } catch {
    // 摘要生成失败，静默返回空字符串
    return '';
  }
}

/**
 * 流式生成当前节点的 AI 回答：收集上下文 -> 构造消息 -> 流式调用 -> 解析建议方向。
 * 出错时返回 success=false 与错误信息，不抛异常。
 * 流式结束后会旁路调用 generateSummary 生成摘要标题，通过 onSummary 回调通知调用方；
 * 同时旁路调用 generatePathSummary 生成路径摘要，通过 onPathSummary 回调通知调用方。
 * 两个旁路任务并行执行、互不阻塞，失败静默跳过，不阻塞主流程。
 *
 * @param nodeId         当前节点 id
 * @param nodes          全部节点（用于收集上下文路径）
 * @param onDelta        流式回调
 * @param signal         AbortSignal
 * @param onSummary      摘要标题生成完成回调
 * @param extraContext   注入到 system prompt 的额外上下文（如记忆条目），可选
 * @param onPathSummary  路径摘要生成完成回调，可选
 */
export async function streamTurnResponse(
  nodeId: string,
  nodes: Node<TurnNodeData>[],
  onDelta?: (text: string) => void,
  signal?: AbortSignal,
  onSummary?: (summary: string) => void,
  extraContext?: string,
  onPathSummary?: (summary: string, cacheKey?: string) => void,
): Promise<{
  success: boolean;
  text?: string;
  suggestions?: Suggestion[];
  error?: string;
  /**
   * 是否为"重试耗尽失败"。当 LLM 调用经并发池重试达到上限仍失败时为 true。
   * 调用方（如 auto-evolution-engine）可据此区分"重试耗尽" vs "用户主动取消"。
   * 其他失败（取消/不可重试错误）不设置此字段（undefined 视为 false）。
   */
  failed?: boolean;
}> {
  try {
    const contextPath = collectContextPath(nodeId, nodes);
    const { messages } = buildLLMMessages(contextPath, extraContext);
    const fullText = await quickCallLLM(messages, onDelta, signal);
    const suggestions = parseSuggestions(fullText);
    // 旁路 1：流式结束后异步生成摘要标题（非阻塞，失败静默跳过，不影响主流程）
    void (async () => {
      try {
        const summary = await generateSummary(fullText);
        if (summary) onSummary?.(summary);
      } catch {
        // 摘要生成失败，静默跳过
      }
    })();
    // 旁路 2：流式结束后异步生成路径摘要（与摘要标题并行，互不阻塞，失败静默跳过）
    // 通过 collectContextPath 已收集的路径 + parentId 链获取父节点 pathSummary 作为基线
    if (onPathSummary) {
      void (async () => {
        try {
          const currentNode = nodes.find((n) => n.id === nodeId);
          if (!currentNode) return;
          // 构造含完整 assistantMessage 的节点副本（nodes 中的 assistantMessage 尚未更新）
          const updatedNode: Node<TurnNodeData> = {
            ...currentNode,
            data: { ...currentNode.data, assistantMessage: fullText },
          };
          // 确定父节点 pathSummary 基线：
          // - 合并节点：传 undefined，generatePathSummary 通过 allNodes 查找来源节点 pathSummary
          // - 普通子节点：查找父节点 pathSummary
          // - 根节点：无基线
          const mergedFromIds = currentNode.data.mergedFromIds;
          let parentPathSummary: string | undefined;
          if (!mergedFromIds || mergedFromIds.length === 0) {
            const parentId = currentNode.data.parentId;
            if (parentId !== null) {
              const parentNode = nodes.find((n) => n.id === parentId);
              parentPathSummary = parentNode?.data.pathSummary;
            }
          }
          // generatePathSummary 返回 { summary, cacheKey }：cacheKey 用于节点字段持久化，
          // 命中缓存时跳过 LLM 调用（哈希缓存逻辑在 path-summary-engine 内部）
          const result = await generatePathSummary(updatedNode, parentPathSummary, nodes);
          if (result.summary) {
            onPathSummary(result.summary, result.cacheKey);
          }
        } catch {
          // 路径摘要生成失败，静默跳过
        }
      })();
    }
    return { success: true, text: fullText, suggestions };
  } catch (err) {
    // 复用 request.ts 的 describeError 归一化错误信息
    // 若 err 为 RequestPoolError（并发池重试耗尽），标记 failed: true 供调用方区分
    const failed = err instanceof RequestPoolError;
    return { success: false, error: describeError(err), failed };
  }
}

/** 基于父节点分叉出新分支，返回新节点的 data（不直接操作 store） */
export function forkBranch(parentNodeId: string, userMessage: string): TurnNodeData {
  return createTurnNodeData(userMessage, parentNodeId);
}

/**
 * 创建合并节点的数据（不直接调用 LLM，也不操作 store）。
 *
 * - mergedFromIds 记录所有来源节点 ID。
 * - parentId 为 null（合并节点作为新支线根）。
 * - userMessage 即用户的合并意图（如"结合 A 和 B 的结论给出下一步"）。
 * - status 为 'idle'，由调用方后续通过 streamTurnResponse 触发 LLM 生成回答。
 *
 * LLM 调用由调用方通过 streamTurnResponse 触发：collectContextPath 会自动
 * 因 mergedFromIds 展开多路上下文。
 */
export function mergeBranches(
  sourceIds: string[],
  intent: string,
  _nodes?: Node<TurnNodeData>[],
): TurnNodeData {
  return {
    parentId: null,
    userMessage: intent,
    assistantMessage: '',
    suggestions: [],
    status: 'idle',
    mergedFromIds: sourceIds,
    createdAt: Date.now(),
  };
}
