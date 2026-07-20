// ============================================================
// AI Debug — 节点流编辑器内部事件总线
// 集中管理 window 自定义事件的名称与 payload 类型，避免裸
// dispatchEvent / addEventListener 在深层级难以追踪的问题。
// 仅覆盖业务自定义事件，浏览器原生事件（keydown 等）不经过本模块。
// ============================================================

/** 自定义事件名称常量 */
export const NODE_EVENTS = {
  /** 节点一轮对话完成（单节点运行/重新生成结束） */
  NodeTurnComplete: 'node-turn-complete',
  /** 节点分叉（创建子节点继续追问） */
  NodeFork: 'node-fork',
  /** 节点合并（多选节点合并为新支线根） */
  NodeMerge: 'node-merge',
  /** 上下文路径变化（选中节点变更 / 路径裁剪） */
  ContextPathChanged: 'context-path-changed',
  /** AI 清理蛛网派生新项目完成 */
  PruneDerived: 'prune-derived',
  /** 记忆更新（自动提取 / 手动增删） */
  MemoryUpdated: 'memory-updated',
  /** LLM 配置更新（替换原 'llm-config-updated' 裸字符串） */
  LlmConfigUpdated: 'llm-config-updated',
  /** 冲突检测到（自动 / 手动检测命中后由 useInspectorActions 派发，UI 监听后弹决策 Modal） */
  ConflictDetected: 'conflict-detected',
  /** 用户在 ConflictCard 主动点击「人工决策」时派发，UI 监听后弹决策 Modal */
  ConflictDecisionRequested: 'conflict-decision-requested',
} as const;

/** 冲突决策 Modal 所需冲突信息（ConflictDetected / ConflictDecisionRequested 共用） */
export interface ConflictDecisionPayload {
  /** 冲突唯一标识（使用被标注冲突的 nodeId） */
  id: string;
  /** 被标注冲突的节点 ID（与 id 一致，显式保留便于 handler 使用） */
  nodeId: string;
  /** 分支 A 名称（前序/主干） */
  branchAName: string;
  /** 分支 B 名称（当前冲突节点所属分支） */
  branchBName: string;
  /** 冲突描述（来自 ConflictMark.note） */
  description: string;
}

/** 事件名 → payload 类型映射 */
export interface NodeEventDetailMap {
  [NODE_EVENTS.NodeTurnComplete]: { nodeId: string; success: boolean };
  [NODE_EVENTS.NodeFork]: { nodeId: string; childId: string };
  [NODE_EVENTS.NodeMerge]: { nodeId: string; sourceIds: string[] };
  [NODE_EVENTS.ContextPathChanged]: { nodeId: string | null };
  [NODE_EVENTS.PruneDerived]: { projectId: string; originalProjectId: string };
  [NODE_EVENTS.MemoryUpdated]: { scope: 'global' | 'project' };
  [NODE_EVENTS.LlmConfigUpdated]: undefined;
  [NODE_EVENTS.ConflictDetected]: ConflictDecisionPayload;
  [NODE_EVENTS.ConflictDecisionRequested]: ConflictDecisionPayload;
}

export type NodeEventName = keyof NodeEventDetailMap;

/** 类型安全的派发：以事件名推导 payload 类型 */
export function emit<K extends NodeEventName>(name: K, detail?: NodeEventDetailMap[K]): void {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

/** 类型安全的监听；返回清理函数用于 useEffect 卸载 */
export function on<K extends NodeEventName>(
  name: K,
  handler: (detail: NodeEventDetailMap[K]) => void,
): () => void {
  const listener = (e: Event) => {
    const customEvent = e as CustomEvent<NodeEventDetailMap[K]>;
    handler(customEvent.detail);
  };
  window.addEventListener(name, listener);
  return () => window.removeEventListener(name, listener);
}
