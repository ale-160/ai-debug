import type { Node, Edge } from 'reactflow';

/** 对话节点状态
 * - ignored: 用户主动忽略，构建 LLM 上下文时跳过该节点（user+assistant 都不传），
 *   子节点照常运行，路径上视为"断点"。不影响节点本身的存在与展示。
 */
export type TurnStatus =
  | 'idle'
  | 'running'
  | 'success'
  | 'error'
  | 'abandoned'
  | 'ignored';

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
  /** 合并来源节点 ID 列表：非空表示此节点由多个分支合并而来（合并节点 parentId 为 null） */
  mergedFromIds?: string[];
  /** 图片附件 base64 列表（用户消息可含图片） */
  images?: string[];
  /** 创建时间戳 */
  createdAt: number;
  /** 冲突标注文案：由冲突检测填充，清空则取消标注 */
  conflictNote?: string;
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
}

/** 从节点 data 中提取 TurnNodeData 的类型守卫 */
export function isTurnNodeData(data: any): data is TurnNodeData {
  return data && typeof data.userMessage === 'string' && typeof data.parentId !== 'undefined';
}
