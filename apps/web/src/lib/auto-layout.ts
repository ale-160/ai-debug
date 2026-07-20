import dagre from 'dagre';
import type { Node, Edge } from 'reactflow';

/** 自动布局参数：方向、节点尺寸、层级间距、同层节点间距 */
export interface AutoLayoutOptions {
  /** 布局方向：TB = 自上而下（默认），LR = 自左而右 */
  direction?: 'TB' | 'LR';
  /** 节点宽度（dagre 需要预估尺寸用于碰撞检测） */
  nodeWidth?: number;
  /** 节点高度 */
  nodeHeight?: number;
  /** 层级间距（不同 rank 之间的距离） */
  rankSep?: number;
  /** 同层节点间距 */
  nodeSep?: number;
}

/**
 * 使用 dagre 计算层级布局，返回带新 position 的节点数组。
 * dagre 返回的 (x, y) 是节点中心点，React Flow 使用左上角坐标，需要转换。
 */
export function autoLayout(nodes: Node[], edges: Edge[], options: AutoLayoutOptions = {}): Node[] {
  const {
    direction = 'TB',
    nodeWidth = 200,
    nodeHeight = 120,
    rankSep = 80,
    nodeSep = 40,
  } = options;

  // 空画布直接返回，避免 dagre 在无节点时抛错
  if (nodes.length === 0) return nodes;

  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: direction,
    ranksep: rankSep,
    nodesep: nodeSep,
    marginx: 0,
    marginy: 0,
  });
  // 默认边标签函数，避免 dagre 在边无标签时报错
  g.setDefaultEdgeLabel(() => ({}));

  nodes.forEach((node) => {
    g.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  });
  edges.forEach((edge) => {
    // 仅在两端节点都存在时建立边，避免 dagre 抛出未知节点错误
    if (g.hasNode(edge.source) && g.hasNode(edge.target)) {
      g.setEdge(edge.source, edge.target);
    }
  });

  dagre.layout(g);

  return nodes.map((node) => {
    const positioned = g.node(node.id);
    if (!positioned) return node;
    // dagre 返回中心点，React Flow 使用左上角：减去半宽半高
    return {
      ...node,
      position: {
        x: positioned.x - nodeWidth / 2,
        y: positioned.y - nodeHeight / 2,
      },
    };
  });
}
