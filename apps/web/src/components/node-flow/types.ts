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
  /** 图片附件 base64 列表（向后兼容：用户消息可含图片，新代码建议用 attachments） */
  images?: string[];
  /**
   * 节点附件列表（多模态）：支持任意格式文件。
   * - image 类型：base64 data URL，会注入到 LLM vision 消息
   * - text 类型：解析为纯文本，拼接到 userMessage 末尾
   * - binary 类型：仅记录元信息，告知 LLM 用户上传了该文件（模型无法识别时由 UI 提示用户）
   * 既有节点无此字段时按 undefined 处理，向后兼容。
   */
  attachments?: NodeAttachment[];
  /** 节点来源：'manual' 用户手动创建 / 'assistant' 由侧边栏助手转发创建 */
  source?: 'manual' | 'assistant';
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
  /**
   * git 模式：节点短哈希（取 nodeId 后 7 位）。用于 git 视图显示，形如 "a1b2c3d"。
   * 既有节点无此字段时按 undefined 处理，首次进入 git 模式时回填。
   */
  shortHash?: string;
  /**
   * git 模式：命名分支的代表节点。
   * 非空表示该节点是某个命名分支的 HEAD（最新节点）。分支名挂在代表节点上，而非每个节点。
   * 既有节点无此字段时按 undefined 处理。
   */
  branchName?: string;
  /**
   * git 模式：标签列表（如 "最终方案" / "废弃" / "v1"）。
   * 既有节点无此字段时按 undefined 处理（空数组与 undefined 等价）。
   */
  tags?: string[];
  /**
   * P2-1：节点级 LLM 配置覆盖。
   * 未设置的字段使用全局 llmConfig 默认值。
   * 设置后该节点的 LLM 调用使用覆盖值，不影响其他节点。
   * 既有节点无此字段时按 undefined 处理，向后兼容。
   */
  llmOverride?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
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

// ============================================================
// 多模态附件体系（PR-2）
// ============================================================

/** 附件分类：image 图片 / text 文本类文件 / binary 二进制文件 */
export type AttachmentKind = 'image' | 'text' | 'binary';

/**
 * 节点附件：支持任意格式文件。
 * - image: data 字段为 base64 data URL，注入 LLM vision 消息
 * - text: data 字段为解析后的纯文本，拼接到 userMessage
 * - binary: data 字段为空，仅记录元信息告知 LLM
 */
export interface NodeAttachment {
  /** 附件 ID */
  id: string;
  /** 原始文件名 */
  name: string;
  /** MIME 类型（如 image/png, text/javascript, application/pdf） */
  mimeType: string;
  /** 文件大小（字节） */
  size: number;
  /** 附件分类 */
  kind: AttachmentKind;
  /** 数据内容：image 为 data URL，text 为纯文本，binary 为 undefined */
  data?: string;
  /** 解析状态：pending 解析中 / parsed 已完成 / failed 失败 */
  parseStatus: 'pending' | 'parsed' | 'failed';
  /** 解析失败原因（parseStatus === 'failed' 时填充） */
  parseError?: string;
}

// ============================================================
// Skill 技能体系（PR-1）
// ============================================================

/**
 * Skill 技能定义：可导入的外部技能，用于助手对话上下文压缩与领域专家化。
 * 借鉴 updream 的 Skill 社区理念：技能本质上是"前人经验的封装"，
 * 助手加载技能后即获得该领域专家能力，避免在主对话中堆叠所有上下文。
 */
export interface Skill {
  /** 技能 ID */
  id: string;
  /** 技能名称 */
  name: string;
  /** 技能描述（简短一句话） */
  description: string;
  /** 技能图标（emoji 或 lucide icon name） */
  icon?: string;
  /** 技能系统提示词模板（支持 {{input}} 变量占位，运行时替换为用户输入） */
  systemPrompt: string;
  /** 输入说明：描述技能期望的输入格式 */
  inputHint?: string;
  /** 输出说明：描述技能产出格式 */
  outputHint?: string;
  /** 创建时间戳 */
  createdAt: number;
  /** 更新时间戳 */
  updatedAt: number;
  /** 来源：builtin 内置 / imported 导入 / custom 用户创建 */
  source: 'builtin' | 'imported' | 'custom';
  /** 是否启用 */
  enabled: boolean;
  /** 标签列表（用于分类检索） */
  tags?: string[];
}

// ============================================================
// 助手对话体系（PR-1）
// ============================================================

/** 助手消息角色 */
export type AssistantRole = 'user' | 'assistant' | 'system';

/** 助手消息状态 */
export type AssistantMessageStatus = 'pending' | 'streaming' | 'done' | 'error';

/**
 * 助手消息：侧边栏助手面板中的对话条目，独立于节点对话。
 * - 助手不直接修改节点，而是通过转发机制把内容异步发送到节点（避免阻塞）
 * - relatedNodeId 记录助手消息关联到的节点（转发时填充）
 * - skillId 记录该轮对话使用的技能（用于上下文压缩）
 */
export interface AssistantMessage {
  /** 消息 ID */
  id: string;
  /** 角色 */
  role: AssistantRole;
  /** 内容 */
  content: string;
  /** 时间戳 */
  timestamp: number;
  /** 关联的节点 ID（助手转发到节点时记录） */
  relatedNodeId?: string;
  /** 使用的技能 ID */
  skillId?: string;
  /** 用户消息可携带的附件 */
  attachments?: NodeAttachment[];
  /** 状态：pending 等待 / streaming 流式中 / done 完成 / error 失败 */
  status: AssistantMessageStatus;
  /** 错误信息（status === 'error' 时填充） */
  errorMessage?: string;
}
