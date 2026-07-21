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
 * 5.5.3 / 5.7.3：dagre 改为 dynamic import，首次使用时异步加载。
 * - 模块级 promise 缓存：多次调用复用同一个导入 Promise，避免重复加载
 * - 5.5.3 注记：500+ 节点项目建议迁移到 Web Worker 执行（见 git-layout.ts 注释）。
 *   当前保守方案：dynamic import + 主线程执行；超过 500 节点时仍执行但可能阻塞 ~100ms。
 *   TODO：实现 dagre-worker.ts 共享 worker，autoLayout 改为 postMessage 模式。
 *
 * 4.10.3 TODO（保守方案，本次不强制迁移）：dagre ^0.8.5 多年未维护（最后发布
 * 2018 年），无 CVE 但存在长期维护风险。评估迁移目标：
 *   - @dagrejs/dagre（社区维护 fork，API 兼容，持续更新）
 *   - elkjs（Eclipse Layout Kernel，更活跃，但 API 差异较大，迁移成本高）
 * 迁移需测试布局效果一致性（节点位置 / 间距 / 性能）与包体积差异，
 * 本次保守保留 dagre ^0.8.5，待下次依赖更新周期统一评估。
 */
let dagreModulePromise: Promise<typeof import('dagre')> | null = null;
function loadDagre(): Promise<typeof import('dagre')> {
  if (!dagreModulePromise) {
    dagreModulePromise = import('dagre');
  }
  return dagreModulePromise;
}

/**
 * 使用 dagre 计算层级布局，返回带新 position 的节点数组。
 * dagre 返回的 (x, y) 是节点中心点，React Flow 使用左上角坐标，需要转换。
 *
 * 5.7.3：改为 async，内部 dynamic import('dagre')，首次调用时异步加载 dagre chunk。
 * 调用方需 await 返回值。
 */
export async function autoLayout(
  nodes: Node[],
  edges: Edge[],
  options: AutoLayoutOptions = {},
): Promise<Node[]> {
  const {
    direction = 'TB',
    nodeWidth = 200,
    nodeHeight = 120,
    rankSep = 80,
    nodeSep = 40,
  } = options;

  // 空画布直接返回，避免 dagre 在无节点时抛错
  if (nodes.length === 0) return nodes;

  const dagre = await loadDagre();

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
