import type { TurnNodeData, NodeAttachment } from './types';

/** 节点类型 key（唯一一种） */
export const TURN_NODE_TYPE = 'turn';

// ============================================================
// 类型预留：为未来扩展（备注节点 / 决策节点）声明 schema 体系
// 当前 TurnNode 不使用 inputs 字段，仅类型层面预留，不影响运行时
// ============================================================

/** 节点参数 schema 声明（未来表单渲染用，参考 spark-flow NodeParam 精简版） */
export interface NodeParam {
  /** 参数 key（对应 node data 中的字段名） */
  name: string;
  /** 显示标签 */
  label: string;
  /** 参数类型 */
  type: 'string' | 'number' | 'boolean' | 'multiline' | 'options' | 'asyncOptions';
  /** 描述文案 */
  description?: string;
  /** 默认值 */
  default?: unknown;
}

/** 节点定义基础字段（未来扩展备注节点 / 决策节点时使用） */
export interface NodeDefinition {
  type: string;
  label: string;
  description: string;
  icon?: string;
}

/** 带 schema 的节点定义（扩展 NodeDefinition，支持 inputs / loadMethods）
 *  当前 TurnNode 不使用，类型层面预留，未来备注节点 / 决策节点可直接套用 */
export type SchemaNodeDefinition = NodeDefinition & {
  /** 参数 schema 声明，前端据此后续渲染表单 */
  inputs?: NodeParam[];
  /** asyncOptions 加载方法注册表（key 对应 NodeParam.loadMethod） */
  loadMethods?: {
    [methodName: string]: (
      nodeData: unknown,
      ctx?: unknown,
    ) => Promise<{ label: string; value: string }[]>;
  };
};

/**
 * 创建对话节点的默认数据。
 *
 * @param userMessage  用户消息文本
 * @param parentId     父节点 ID（根节点为 null）
 * @param options      可选附加数据：
 *   - images: 图片 base64 列表（向后兼容字段，优先使用 attachments）
 *   - attachments: 多模态附件列表（支持 image/text/binary 三类）
 *   - source: 节点来源标记（'manual' 用户手动 / 'assistant' 助手转发）
 */
export function createTurnNodeData(
  userMessage: string,
  parentId: string | null,
  options?: {
    images?: string[];
    attachments?: NodeAttachment[];
    source?: 'manual' | 'assistant';
  },
): TurnNodeData {
  const now = Date.now();
  return {
    parentId,
    userMessage,
    assistantMessage: '',
    suggestions: [],
    status: 'idle',
    createdAt: now,
    shortHash: now.toString(36).slice(-7).padStart(7, '0'),
    images: options?.images,
    attachments: options?.attachments,
    source: options?.source ?? 'manual',
  };
}
