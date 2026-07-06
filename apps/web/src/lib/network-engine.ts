import type { Node } from 'reactflow';
import type { TurnNodeData, Suggestion, TurnStatus } from '@/components/node-flow/types';
import { quickCallLLM, buildVisionMessage } from './llm-helpers';
import type { LLMMessage } from './llm-client';
import { describeError } from './request';
import { createTurnNodeData } from '@/components/node-flow/node-definitions';

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
}

/** 将一个节点的 data 转换为上下文路径条目 */
function toContextPathItem(node: Node<TurnNodeData>): ContextPathItem {
  return {
    userMessage: node.data.userMessage,
    assistantMessage: node.data.assistantMessage,
    images: node.data.images,
    status: node.data.status,
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
      const subSegments = collectContextPathRecursive(
        sourceId,
        nodeMap,
        new Set(visited),
      );
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
  const parentSegments = collectContextPathRecursive(
    currentNode.data.parentId,
    nodeMap,
    visited,
  );
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

/**
 * 将多段上下文路径构造为 OpenAI 兼容的消息数组。
 *
 * - 前置 system 消息（SYSTEM_PROMPT）。
 * - 多段路径时，每段之间插入一条 system 分隔标记 `--- 分支 N ---`，
 *   第一段前不插入（保持单段路径与原行为完全一致）。
 * - 每段内按顺序拼接 user / assistant 消息；assistantMessage 为空则跳过；
 *   含图片的节点用 buildVisionMessage 构造多模态消息。
 * - ignored 节点在上下文路径中会被跳过（不传 user/assistant），
 *   路径视为"断点"，子节点照常进入上下文。
 *
 * @param segments       上下文路径分段
 * @param extraContext   可选的额外 system 文本（如记忆条目），插入在 SYSTEM_PROMPT 之后
 */
export function buildLLMMessages(
  segments: ContextPathItem[][],
  extraContext?: string,
): LLMMessage[] {
  const systemContent = extraContext
    ? `${SYSTEM_PROMPT}\n\n${extraContext}`
    : SYSTEM_PROMPT;
  const messages: LLMMessage[] = [{ role: 'system', content: systemContent }];

  segments.forEach((segment, idx) => {
    // 段间分隔标记（第一段前不加，保持单段路径行为不变）
    if (idx > 0) {
      messages.push({
        role: 'system',
        content: `--- 分支 ${idx + 1} ---`,
      });
    }
    for (const item of segment) {
      // ignored 节点：跳过，路径视为断点
      if (item.status === 'ignored') continue;

      if (item.images && item.images.length > 0) {
        // buildVisionMessage 返回单元素数组，取第一条多模态 user 消息
        const visionMessages = buildVisionMessage(item.userMessage, item.images);
        messages.push(visionMessages[0]);
      } else {
        messages.push({ role: 'user', content: item.userMessage });
      }

      if (item.assistantMessage.trim().length > 0) {
        messages.push({ role: 'assistant', content: item.assistantMessage });
      }
    }
  });

  return messages;
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
 * 摘要生成失败静默跳过，不阻塞主流程。
 *
 * @param nodeId        当前节点 id
 * @param nodes         全部节点（用于收集上下文路径）
 * @param onDelta       流式回调
 * @param signal        AbortSignal
 * @param onSummary     摘要生成完成回调
 * @param extraContext  注入到 system prompt 的额外上下文（如记忆条目），可选
 */
export async function streamTurnResponse(
  nodeId: string,
  nodes: Node<TurnNodeData>[],
  onDelta?: (text: string) => void,
  signal?: AbortSignal,
  onSummary?: (summary: string) => void,
  extraContext?: string,
): Promise<{
  success: boolean;
  text?: string;
  suggestions?: Suggestion[];
  error?: string;
}> {
  try {
    const contextPath = collectContextPath(nodeId, nodes);
    const messages = buildLLMMessages(contextPath, extraContext);
    const fullText = await quickCallLLM(messages, onDelta, signal);
    const suggestions = parseSuggestions(fullText);
    // 旁路：流式结束后异步生成摘要标题（非阻塞，失败静默跳过，不影响主流程）
    void (async () => {
      try {
        const summary = await generateSummary(fullText);
        if (summary) onSummary?.(summary);
      } catch {
        // 摘要生成失败，静默跳过
      }
    })();
    return { success: true, text: fullText, suggestions };
  } catch (err) {
    // 复用 request.ts 的 describeError 归一化错误信息
    return { success: false, error: describeError(err) };
  }
}

/** 基于父节点分叉出新分支，返回新节点的 data（不直接操作 store） */
export function forkBranch(
  parentNodeId: string,
  userMessage: string,
): TurnNodeData {
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
