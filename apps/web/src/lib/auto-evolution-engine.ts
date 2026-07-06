// ============================================================
// AI Debug — 自动推演 Agent 引擎
//
// 从指定起始节点的有效叶节点出发，自动生成下一问 → 调用 LLM 回答
// → 评估置信度 → 决定继续/弹窗/停止。推演产生的节点走标准
// streamTurnResponse 流程，作为蛛网节点存入项目（普通 parentId 链，
// 不走 merge）。静默节点（abandoned）整棵子树排除，不参与推演。
//
// 硬约束：
// - 流式请求接入 AbortController（streamTurnResponse 透传 signal）
// - AbortError 保持原样抛出不包装（quickCallLLM 透传 signal）
// - 不修改 collectContextPath / buildLLMMessages（推演节点走标准流程）
// ============================================================
import type { Node } from 'reactflow';
import type { TurnNodeData } from '@/components/node-flow/types';
import { quickCallLLM } from './llm-helpers';
import { streamTurnResponse } from './network-engine';
import { useDebugStore } from './debug-store';
import type { LLMMessage } from './llm-client';

/** 推演候选问题（LLM 生成） */
export interface EvolutionCandidate {
  question: string;
  reasoning: string;
  confidence: number;
}

/** 单步推演选项 */
export interface EvolutionStepOptions {
  /** 每步分叉上限 1-3（LLM 在上限内自主决定实际分叉数） */
  maxBranches: number;
  /** 该路起点叶节点 id（写入 evolutionMeta.startNodeId，用于批量删除） */
  startNodeId: string;
  /** 当前步数（写入 evolutionMeta.step，从 1 起） */
  step: number;
  /** 注入到 system prompt 的额外上下文（如记忆条目） */
  extraContext?: string;
  /** 流式回调（按 nodeId 分发，UI 据此实时渲染多节点） */
  onDelta?: (nodeId: string, text: string) => void;
  /** 用户指定的新方向（覆盖 LLM 候选问题生成，弹窗"换一个方向"时使用） */
  userDirection?: string;
}

/** 单步推演结果 */
export interface EvolutionStepResult {
  /** 本步产生的子节点 id 列表（每个候选问题一个子节点） */
  childNodeIds: string[];
  /** 是否已收敛（LLM 输出 'CONVERGED'） */
  converged: boolean;
  /** 各子节点的置信度（与 childNodeIds 一一对应） */
  confidences: number[];
  /** 各子节点的 reasoning（与 childNodeIds 一一对应） */
  reasonings: string[];
}

/** 推演编排选项 */
export interface EvolutionOptions {
  /** 最大步数 1-10（默认 3） */
  maxSteps: number;
  /** 每步分叉上限 1-3（默认 1） */
  maxBranches: number;
  /** 置信度阈值 0-1（默认 0.6；低于阈值触发弹窗） */
  confidenceThreshold: number;
  /** 注入到 system prompt 的额外上下文（记忆条目） */
  extraContext?: string;
  /** 流式回调 */
  onDelta?: (nodeId: string, text: string) => void;
  /**
   * 置信度低于阈值时触发弹窗回调，返回用户决策：
   * - 'continue'：强制继续下一步
   * - 'stop'：停止该路
   * - { newDirection: string }：用户输入新方向，下一步基于新方向推演
   */
  onLowConfidence?: (
    nodeId: string,
    confidence: number,
    reasoning: string,
  ) => Promise<'continue' | 'stop' | { newDirection: string }>;
  /** 每步开始回调（用于 UI 更新进度） */
  onStepStart?: (step: number, startNodeId: string) => void;
  /** 每步完成回调 */
  onStepDone?: (step: number, startNodeId: string, childCount: number) => void;
}

/** 推演单路结果 */
export interface EvolutionBranchResult {
  /** 该路起点叶节点 id */
  startNodeId: string;
  /** 该路产生的所有节点 id（含各步子节点） */
  finalNodeIds: string[];
  /** 是否收敛（LLM 输出 CONVERGED） */
  converged: boolean;
  /** 是否被用户停止（含 AbortError 触发） */
  stopped: boolean;
}

/** 推演系统提示词：约束 LLM 输出 JSON 数组或 'CONVERGED' */
const EVOLUTION_SYSTEM_PROMPT = `你是一位对话探索助手。基于当前对话上下文，给出用户最可能想问的下一个问题。

约束：
- 只给出有明确探索价值的问题，不要为推演而推演
- 若当前已得出结论，输出 'CONVERGED'（大写，不产生任何问题）
- 在用户配置的上限内自主决定实际分叉数：若当前方向无需分叉（如线性深入），只产生 1 个；若判断有多路值得探索，可按上限分叉

输出格式（严格 JSON 数组，用 \`\`\`json 代码块包裹）：

\`\`\`json
[
  {
    "question": "下一个问题",
    "reasoning": "为什么这个问题值得探索（一句话）",
    "confidence": 0.8
  }
]
\`\`\`

只输出 JSON 代码块或 'CONVERGED'，不要其他内容。`;

/**
 * 找出选中节点子树中的所有有效叶节点（DFS 跳过 abandoned 子树）。
 *
 * - 选中节点本身是 abandoned：返回 []
 * - 选中节点本身是有效叶节点（无非 abandoned 子节点）：返回 [选中节点]
 * - 选中节点有非 abandoned 子节点：递归向下找所有叶节点
 * - abandoned 节点整棵子树排除（不进入递归，符合 spec"整棵子树排除"约束）
 *
 * @param nodeId  选中节点 id（推演起点子树的根）
 * @param nodes   全部节点
 * @returns       有效叶节点 id 列表（多路并行推演的起点）
 */
export function findEffectiveLeaves(
  nodeId: string,
  nodes: Node<TurnNodeData>[],
): string[] {
  const nodeMap = new Map<string, Node<TurnNodeData>>();
  for (const n of nodes) nodeMap.set(n.id, n);

  // 构建子节点映射（parentId -> childIds）
  const childrenMap = new Map<string, string[]>();
  for (const n of nodes) {
    if (n.data.parentId !== null) {
      const list = childrenMap.get(n.data.parentId) ?? [];
      list.push(n.id);
      childrenMap.set(n.data.parentId, list);
    }
  }

  const leaves: string[] = [];
  const visited = new Set<string>(); // 防环

  const dfs = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    const node = nodeMap.get(id);
    if (!node) return;
    // abandoned 节点整棵子树排除：不进入递归
    if (node.data.status === 'abandoned') return;

    const children = childrenMap.get(id) ?? [];
    // 过滤掉 abandoned 子节点（不进入递归）
    const validChildren = children.filter((cid) => {
      const child = nodeMap.get(cid);
      return child && child.data.status !== 'abandoned';
    });

    if (validChildren.length === 0) {
      // 有效叶节点：没有非 abandoned 子节点
      leaves.push(id);
      return;
    }

    // 递归向下找
    for (const cid of validChildren) {
      dfs(cid);
    }
  };

  dfs(nodeId);
  return leaves;
}

/**
 * 解析 LLM 候选问题响应。
 * 优先匹配 ```json``` 代码块，兜底直接解析整段。
 * 截断到 maxBranches 上限。
 * 返回 converged=true 表示 LLM 输出 'CONVERGED'。
 */
function parseEvolutionCandidates(
  text: string,
  maxBranches: number,
): { converged: boolean; candidates: EvolutionCandidate[] } {
  const trimmed = text.trim();
  // 检测 CONVERGED（独立词，大小写不敏感）
  if (/\bCONVERGED\b/i.test(trimmed)) {
    return { converged: true, candidates: [] };
  }

  // 提取 JSON 数组：优先 ```json``` 代码块
  const regex = /```json\s*([\s\S]*?)```/gi;
  const matches = Array.from(trimmed.matchAll(regex));
  for (const match of matches) {
    const parsed = tryParseCandidates(match[1].trim(), maxBranches);
    if (parsed.length > 0) return { converged: false, candidates: parsed };
  }
  // 兜底：直接解析整段
  const directParsed = tryParseCandidates(trimmed, maxBranches);
  if (directParsed.length > 0) return { converged: false, candidates: directParsed };

  // 解析失败且未明确 CONVERGED：返回空（让编排层决定是否停止）
  return { converged: false, candidates: [] };
}

/** 尝试解析候选问题 JSON 数组，截断到 maxBranches，格式不符返回空数组 */
function tryParseCandidates(
  raw: string,
  maxBranches: number,
): EvolutionCandidate[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const result: EvolutionCandidate[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const question =
        typeof item.question === 'string' ? item.question.trim() : '';
      const reasoning =
        typeof item.reasoning === 'string' ? item.reasoning.trim() : '';
      // 置信度归一化到 [0, 1]，缺省 0.5
      const confidence =
        typeof item.confidence === 'number'
          ? Math.max(0, Math.min(1, item.confidence))
          : 0.5;
      if (question) {
        result.push({ question, reasoning, confidence });
      }
    }
    // 截断到 maxBranches 上限
    return result.slice(0, maxBranches);
  } catch {
    return [];
  }
}

/**
 * 构建候选问题生成的 user prompt（含路径摘要 + 起始节点探索意图）。
 * 路径摘要来自 branch-context-diff 的 pathSummary 字段。
 */
function buildEvolutionPrompt(
  currentNode: Node<TurnNodeData>,
  maxBranches: number,
): string {
  const pathSummary = currentNode.data.pathSummary?.trim();
  const userMessage = currentNode.data.userMessage.slice(0, 2000);
  const assistantMessage = currentNode.data.assistantMessage.slice(0, 2000);

  const summaryBlock = pathSummary
    ? `当前路径摘要（已确立的结论/决策/事实）：\n${pathSummary}`
    : '当前路径摘要：（无，节点尚未生成路径摘要）';

  return `${summaryBlock}

起始节点的探索意图（用户问题）：
${userMessage}

当前节点 AI 回答（截断）：
${assistantMessage}

请基于上述上下文，给出用户最可能想问的下一个问题。最多产生 ${maxBranches} 个候选问题，在上限内自主决定实际数量。若已得出结论，输出 'CONVERGED'。`;
}

/**
 * 单步推演：从 currentNodeId 出发，生成 1-N 个候选问题，为每个问题创建子节点
 * 并调用 streamTurnResponse 生成回答。写入 evolutionMeta（step/confidence/
 * startNodeId/reasoning）。
 *
 * - 用户指定 userDirection 时跳过候选生成，直接用新方向作为问题
 * - LLM 输出 'CONVERGED' 时返回 converged=true，不产生子节点
 * - 候选问题通过 quickCallLLM（非流式）生成，回答通过 streamTurnResponse（流式）
 * - 多候选的 streamTurnResponse 并行执行（独立子节点，互不依赖）
 * - AbortError 原样抛出（quickCallLLM 透传 signal，不包装）
 * - streamTurnResponse 内部捕获 AbortError 返回 { success: false }，
 *   调用方通过 signal.aborted 检测并抛出 AbortError 保持取消语义
 *
 * @param currentNodeId  当前节点 id（推演从此节点的子节点开始）
 * @param options        单步推演选项
 * @param signal         AbortSignal（用户停止时取消所有 LLM 调用）
 */
export async function runEvolutionStep(
  currentNodeId: string,
  options: EvolutionStepOptions,
  signal: AbortSignal,
): Promise<EvolutionStepResult> {
  const {
    maxBranches,
    startNodeId,
    step,
    extraContext,
    onDelta,
    userDirection,
  } = options;

  // 获取当前节点
  const nodes = useDebugStore.getState().nodes;
  const currentNode = nodes.find((n) => n.id === currentNodeId);
  if (!currentNode) {
    throw new Error(`推演起点节点不存在: ${currentNodeId}`);
  }

  let candidates: EvolutionCandidate[];
  let converged = false;

  if (userDirection && userDirection.trim()) {
    // 用户指定新方向：跳过候选生成，直接用新方向作为问题
    candidates = [
      {
        question: userDirection.trim(),
        reasoning: '用户指定的新方向',
        confidence: 0.7, // 用户指定方向默认中等置信度，触发后续自评
      },
    ];
  } else {
    // 调用 LLM 生成候选问题（非流式，signal 透传）
    const messages: LLMMessage[] = [
      { role: 'system', content: EVOLUTION_SYSTEM_PROMPT },
      { role: 'user', content: buildEvolutionPrompt(currentNode, maxBranches) },
    ];
    // AbortError 在此原样抛出（quickCallLLM 透传 signal）
    const response = await quickCallLLM(messages, undefined, signal);
    const parsed = parseEvolutionCandidates(response, maxBranches);
    candidates = parsed.candidates;
    converged = parsed.converged;
  }

  if (converged) {
    return { childNodeIds: [], converged: true, confidences: [], reasonings: [] };
  }

  if (candidates.length === 0) {
    // 解析失败且未收敛：视为收敛，避免无限循环
    return { childNodeIds: [], converged: true, confidences: [], reasonings: [] };
  }

  // 为每个候选问题创建子节点（parentId 指向当前节点）
  // 顺序创建避免 incrementalLayout 竞态
  const store = useDebugStore.getState();
  const { createTurnNode, updateTurnNode, appendAssistantChunk } = store;

  const childMeta: Array<{
    childId: string;
    candidate: EvolutionCandidate;
  }> = [];
  for (const candidate of candidates) {
    // 用户停止后不再创建新节点
    if (signal.aborted) {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      throw err;
    }

    // 创建子节点（parentId 指向当前节点，普通 parentId 链不走 merge）
    const childId = createTurnNode(candidate.question, currentNodeId);
    // 写入 evolutionMeta（先写入候选置信度，回答完成后可由自评更新）
    updateTurnNode(childId, {
      status: 'running',
      evolutionMeta: {
        step,
        confidence: candidate.confidence,
        startNodeId,
        reasoning: candidate.reasoning,
      },
    });
    childMeta.push({ childId, candidate });
  }

  // 获取最新 nodes（含刚创建的所有子节点）供 streamTurnResponse 收集上下文
  const currentNodes = useDebugStore.getState().nodes;

  // 并行为每个子节点流式生成回答（独立子节点，互不依赖）
  const streamResults = await Promise.all(
    childMeta.map(async ({ childId }) => {
      // signal 已 abort 则不再发起请求
      if (signal.aborted) {
        return { childId, success: false, error: 'Aborted' };
      }
      const result = await streamTurnResponse(
        childId,
        currentNodes,
        (delta) => {
          appendAssistantChunk(childId, delta);
          onDelta?.(childId, delta);
        },
        signal,
        // 摘要标题旁路回调
        (summary) => updateTurnNode(childId, { summary }),
        extraContext,
        // 路径摘要旁路回调（长推演路径必需）
        (pathSummary) => updateTurnNode(childId, { pathSummary }),
      );
      return { childId, ...result };
    }),
  );

  // 处理流式结果：标记 success/error，收集置信度
  const childNodeIds: string[] = [];
  const confidences: number[] = [];
  const reasonings: string[] = [];

  for (let i = 0; i < childMeta.length; i++) {
    const { childId, candidate } = childMeta[i];
    const result = streamResults[i];
    childNodeIds.push(childId);
    confidences.push(candidate.confidence);
    reasonings.push(candidate.reasoning);

    if (result.success) {
      updateTurnNode(childId, {
        status: 'success',
        suggestions: result.suggestions ?? [],
      });
    } else {
      // 单个候选失败：标记 error 但不抛出（其他候选继续）
      updateTurnNode(childId, {
        status: 'error',
        errorMessage: result.error,
      });
    }
  }

  // 用户停止：抛出 AbortError 保持取消语义（runEvolution 捕获转为 stopped）
  if (signal.aborted) {
    const err = new Error('Aborted');
    err.name = 'AbortError';
    throw err;
  }

  return { childNodeIds, converged: false, confidences, reasonings };
}

/**
 * 推演编排：从 startNodeIds 多路并行推演。
 *
 * - 每路独立步数计数（共享 maxSteps 上限）
 * - 共享同一个 AbortController（外部传入 signal，用户停止时全部取消）
 * - 置信度 >= 阈值：自动继续下一步（取置信度最高的子节点作为下一步起点）
 * - 置信度 < 阈值：触发 onLowConfidence 回调（弹窗询问用户）
 * - LLM 输出 'CONVERGED'：该路停止，标记 converged
 * - 达到 maxSteps：该路自动结束
 * - AbortError：该路标记 stopped，不破坏其他路（Promise.allSettled）
 * - 每路推演的 evolutionMeta.startNodeId 记录该路的起点叶节点 id（批量删除用）
 *
 * @param startNodeIds  各路起点叶节点 id 列表（多路并行）
 * @param options       推演选项
 * @param signal        AbortSignal（用户停止时取消所有进行中的 LLM 调用）
 * @returns             各路推演结果（含产生的节点 id、是否收敛、是否停止）
 */
export async function runEvolution(
  startNodeIds: string[],
  options: EvolutionOptions,
  signal: AbortSignal,
): Promise<EvolutionBranchResult[]> {
  const {
    maxSteps,
    maxBranches,
    confidenceThreshold,
    extraContext,
    onDelta,
    onLowConfidence,
    onStepStart,
    onStepDone,
  } = options;

  /**
   * 单路推演任务：从 startNodeId 出发，逐步推演直到收敛/停止/达到 maxSteps。
   * AbortError 被捕获并转为 { stopped: true }，不破坏其他路。
   */
  const branchTask = async (
    startNodeId: string,
  ): Promise<EvolutionBranchResult> => {
    const finalNodeIds: string[] = [];
    let converged = false;
    let stopped = false;
    let currentNodeId = startNodeId;
    let step = 0;
    let pendingNewDirection: string | undefined;

    try {
      while (step < maxSteps && !signal.aborted) {
        step++;
        onStepStart?.(step, startNodeId);

        // 执行单步推演（userDirection 在弹窗"换一个方向"后传入）
        const result = await runEvolutionStep(
          currentNodeId,
          {
            maxBranches,
            startNodeId,
            step,
            extraContext,
            onDelta,
            userDirection: pendingNewDirection,
          },
          signal,
        );

        pendingNewDirection = undefined; // 消费掉

        if (result.converged) {
          converged = true;
          onStepDone?.(step, startNodeId, 0);
          break;
        }

        finalNodeIds.push(...result.childNodeIds);
        onStepDone?.(step, startNodeId, result.childNodeIds.length);

        // 无子节点且未收敛：停止该路
        if (result.childNodeIds.length === 0) {
          break;
        }

        // 取置信度最高的子节点作为下一步起点（其他子节点作为侧支保留）
        let bestIdx = 0;
        let bestConf = result.confidences[0];
        for (let i = 1; i < result.childNodeIds.length; i++) {
          if (result.confidences[i] > bestConf) {
            bestConf = result.confidences[i];
            bestIdx = i;
          }
        }
        currentNodeId = result.childNodeIds[bestIdx];
        const bestReasoning = result.reasonings[bestIdx];

        // 置信度低于阈值：弹窗询问用户（阻塞该路，其他路继续）
        if (bestConf < confidenceThreshold && onLowConfidence) {
          const decision = await onLowConfidence(
            currentNodeId,
            bestConf,
            bestReasoning,
          );
          if (decision === 'stop') {
            stopped = true;
            break;
          }
          if (
            typeof decision === 'object' &&
            decision !== null &&
            'newDirection' in decision
          ) {
            pendingNewDirection = decision.newDirection;
          }
          // 'continue'：强制继续下一步
        }
      }
    } catch (err) {
      // AbortError：标记 stopped，不破坏其他路
      if (err instanceof Error && err.name === 'AbortError') {
        stopped = true;
      } else {
        // 其他错误：向上抛出（非预期错误）
        throw err;
      }
    }

    return { startNodeId, finalNodeIds, converged, stopped };
  };

  // 多路并行推演（共享同一个 signal）
  // 使用 allSettled 确保单路失败不影响其他路，最终汇总结果
  const settled = await Promise.allSettled(
    startNodeIds.map((id) => branchTask(id)),
  );

  // 收集结果：fulfilled 直接取值，rejected（非 AbortError）向上抛出
  const results: EvolutionBranchResult[] = [];
  for (const s of settled) {
    if (s.status === 'fulfilled') {
      results.push(s.value);
    } else {
      // rejected：非 AbortError 的意外错误向上抛出
      throw s.reason;
    }
  }

  return results;
}
