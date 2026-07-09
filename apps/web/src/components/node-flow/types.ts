import type { Node, Edge } from 'reactflow';

/** 对话节点状态
 * - ignored: 用户主动忽略，构建 LLM 上下文时跳过该节点（user+assistant 都不传），
 *   子节点照常运行，路径上视为"断点"。不影响节点本身的存在与展示。
 */
export type TurnStatus = 'idle' | 'running' | 'success' | 'error' | 'abandoned' | 'ignored';

/** AI 给出的建议方向 */
export interface Suggestion {
  title: string;
  description: string;
}

/** 记忆条目：全局或项目级的关键事实/规则，用于注入 LLM 上下文 */
export interface MemoryEntry {
  id: string;
  /** 条目内容 */
  content: string;
  /** 创建时间戳 */
  createdAt: number;
  /** 来源：auto = LLM 自动提取，manual = 用户手动录入 */
  source: 'auto' | 'manual';
}

/** 应用设置：记忆/冲突/规则等全局开关与频率，存 localStorage */
export interface AppSettings {
  /** 是否开启全局记忆（自动提取 + 注入） */
  enableGlobalMemory: boolean;
  /** 是否开启项目记忆（自动提取 + 注入） */
  enableProjectMemory: boolean;
  /** 记忆自动提取频率：每 N 轮 AI 回答提取一次（1=每轮） */
  memoryFrequency: number;
  /** 是否开启冲突自动检测（每次回答后） */
  enableConflictAutoCheck: boolean;
  /** 冲突自动检测频率：每 N 轮检测一次（1=每轮） */
  conflictCheckFrequency: number;
  /** 用户自定义规则文本（注入到 system prompt，相当于全局档案/补充指令） */
  globalRules: string;
  /** 是否在 hover 节点时显示路径摘要（默认关闭，用户主动开启后才显示） */
  hoverShowPathSummary: boolean;
  /** 节点操作入口样式：'toolbar'（仅浮动工具条）/ 'context'（仅右键菜单）/ 'both'（两者都开，默认） */
  nodeActionsStyle: 'toolbar' | 'context' | 'both';
  /**
   * 路径摘要（pathSummary）混合模式参数（用户可覆盖 provider 预设）。
   * - undefined：使用 provider 预设默认值（向后兼容，老数据无此字段）
   * - 显式对象：覆盖 provider 预设
   * 用户可在设置面板"上下文压缩"区调整，持久化到 localStorage。
   */
  pathSummaryConfig?: PathSummaryConfig;
}

/**
 * 路径摘要（rolling summary）混合模式参数。
 * 不同模型上下文窗口差异大，按 provider 预设默认值，用户可覆盖。
 */
export interface PathSummaryConfig {
  /** 是否启用混合模式（前段摘要 + 后段完整）。默认 true；2M 上下文模型可关闭 */
  enabled: boolean;
  /** 路径长度阈值：超过此节点数启用混合模式。8K 模型建议 4，128K 建议 10 */
  threshold: number;
  /** 混合模式下保留完整内容的最近节点数。8K 模型建议 3，128K 建议 6 */
  recentKeep: number;
  /** 路径摘要最大字数。8K 模型建议 800，128K 建议 1500 */
  maxLength: number;
}

/** 对话节点数据（存储在 node.data 中） */
export interface TurnNodeData {
  /** 父节点 ID（根节点为 null） */
  parentId: string | null;
  /** 用户消息（根节点为初始问题） */
  userMessage: string;
  /** AI 回答（流式生成中可为空字符串） */
  assistantMessage: string;
  /** AI 给出的建议方向列表 */
  suggestions: Suggestion[];
  /** 节点状态 */
  status: TurnStatus;
  /** 错误信息 */
  errorMessage?: string;
  /** 摘要标题（commit message）：流式完成后由 LLM 生成的 ≤20 字一句话摘要 */
  summary?: string;
  /**
   * 路径摘要（rolling summary）：从根到当前节点的聚合摘要（≤1000 字）。
   * 聚焦"已确立的结论/决策/事实"，子节点基于父节点 pathSummary 增量生成。
   * 既有节点无此字段时按 undefined 处理，触发首次生成时回填，向后兼容。
   */
  pathSummary?: string;
  /**
   * pathSummary 的哈希缓存键。缓存键 = hash(parentPathSummary + userMessage + assistantMessage)。
   * 节点内容未变时复用 pathSummary，跳过 LLM 调用；内容变更时失效（键变化即重新生成）。
   * 既有节点无此字段时按 undefined 处理，触发首次生成时回填。
   */
  pathSummaryCacheKey?: string;
  /** 合并来源节点 ID 列表：非空表示此节点由多个分支合并而来（合并节点 parentId 为 null） */
  mergedFromIds?: string[];
  /** 图片附件 base64 列表（用户消息可含图片） */
  images?: string[];
  /** 创建时间戳 */
  createdAt: number;
  /** 冲突标注文案：由冲突检测填充，清空则取消标注 */
  conflictNote?: string;
  /**
   * 自动推演元数据：节点由 auto-evolution-engine 产生时填充。
   * - step：该路推演的第几步（从 1 起）
   * - confidence：本节点回答方向的置信度 0-1
   * - startNodeId：该路推演的起点叶节点 id（用于批量删除本次推演）
   * - reasoning：AI 生成该问题的理由
   * 既有节点无此字段时按 undefined 处理，向后兼容。
   */
  evolutionMeta?: {
    step: number;
    confidence: number;
    startNodeId: string;
    reasoning: string;
  };
}

/** 蛛网项目（一棵对话网络树） */
export interface NetworkProject {
  id: string;
  name: string;
  nodes: Node<TurnNodeData>[];
  edges: Edge[];
  viewport: { x: number; y: number; zoom: number } | null;
  createdAt: number;
  updatedAt: number;
  /** 派生项目的来源项目 ID（仅 projectType === 'derived-pruned' 时有值） */
  originalProjectId?: string;
  /** 项目类型：normal 普通项目 / derived-pruned 由 AI 清理派生的精简项目 */
  projectType?: 'normal' | 'derived-pruned';
  /** 项目级记忆条目列表 */
  memory?: MemoryEntry[];
  /** 本项目已完成的 AI 回答轮数（用于按频率决定是否提取记忆/检测冲突），随项目持久化 */
  turnCounter?: number;
  /** 置顶时间戳：非空表示项目被置顶（侧边栏置顶分组内按此时间倒序）。undefined 表示未置顶 */
  pinnedAt?: number;
}

/** 从节点 data 中提取 TurnNodeData 的类型守卫 */
export function isTurnNodeData(data: any): data is TurnNodeData {
  return data && typeof data.userMessage === 'string' && typeof data.parentId !== 'undefined';
}

/**
 * 自动推演运行时状态：跟踪当前推演的进度与暂停态。
 * - idle：未运行
 * - running：推演进行中
 * - paused：置信度低于阈值暂停，等待用户确认
 * - done：达到最大步数或所有路已收敛
 */
export interface AutoEvolutionState {
  status: 'idle' | 'running' | 'paused' | 'done';
  currentStep: number;
  maxSteps: number;
  activeBranches: number;
}
