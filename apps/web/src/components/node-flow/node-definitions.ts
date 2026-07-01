import type { TurnNodeData } from './types';

/** 节点类型 key（唯一一种） */
export const TURN_NODE_TYPE = 'turn';

/** 创建对话节点的默认数据 */
export function createTurnNodeData(userMessage: string, parentId: string | null): TurnNodeData {
  return {
    parentId,
    userMessage,
    assistantMessage: '',
    suggestions: [],
    status: 'idle',
    createdAt: Date.now(),
  };
}
