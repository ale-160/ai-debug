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
} as const;

/** 事件名 → payload 类型映射 */
export interface NodeEventDetailMap {
  [NODE_EVENTS.NodeTurnComplete]: { nodeId: string; success: boolean };
  [NODE_EVENTS.NodeFork]: { nodeId: string; childId: string };
  [NODE_EVENTS.NodeMerge]: { nodeId: string; sourceIds: string[] };
  [NODE_EVENTS.ContextPathChanged]: { nodeId: string | null };
  [NODE_EVENTS.PruneDerived]: { projectId: string; originalProjectId: string };
  [NODE_EVENTS.MemoryUpdated]: { scope: 'global' | 'project' };
  [NODE_EVENTS.LlmConfigUpdated]: undefined;
}

export type NodeEventName = keyof NodeEventDetailMap;

/** 类型安全的派发：以事件名推导 payload 类型 */
export function emit<K extends NodeEventName>(
  name: K,
  detail?: NodeEventDetailMap[K],
): void {
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
