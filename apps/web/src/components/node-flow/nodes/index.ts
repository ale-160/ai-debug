import TurnNode from './TurnNode';
import { TURN_NODE_TYPE } from '../node-definitions';
import type { NodeTypes } from 'reactflow';

export const nodeTypes: NodeTypes = {
  [TURN_NODE_TYPE]: TurnNode,
};
