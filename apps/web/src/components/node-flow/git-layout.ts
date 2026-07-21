import type { Node, Edge } from 'reactflow';
import type { TurnNodeData } from './types';

type LayoutableNode = Node<TurnNodeData>;

/** dagre 节点宽高（含间距）：实际节点渲染宽 240/180，此处留出间距 */
const NODE_WIDTH = 260;
const NODE_HEIGHT = 120;

/**
 * 5.5.3 / 5.7.3：dagre 改为 dynamic import，首次使用时异步加载。
 * - 模块级 promise 缓存：多次调用复用同一个导入 Promise，避免重复加载
 * - 5.5.3 注记：dagre 同步阻塞算法对 500+ 节点项目可能阻塞主线程 100ms+，
 *   后续可迁移到 Web Worker 执行（需序列化 nodes/edges 入参，postMessage 回结果）。
 *   当前保守方案：保留主线程执行 + 节点数阈值检测；超过 500 节点的项目建议用户
 *   手动触发"自动排列"而非每次切换布局都重算（NodeCanvas useEffect 已只在 viewMode
 *   变化时触发，不在节点增删时反复执行）。
 *   TODO：实现 dagre-worker.ts，用 OffscreenCanvas + Worker 跑布局；layoutGit 改为
 *   返回 Promise，调用方用 await。本次仅做 dynamic import 优化。
 */
let dagreModulePromise: Promise<typeof import('dagre')> | null = null;
function loadDagre(): Promise<typeof import('dagre')> {
  if (!dagreModulePromise) {
    dagreModulePromise = import('dagre');
  }
  return dagreModulePromise;
}

/**
 * git 风格布局：使用 dagre 左→右分层算法。
 * 根节点在最左，子节点逐层向右展开，形成 git graph 风格的泳道图。
 * 节点宽 240（compact 模式 180），高根据内容自适应（这里用固定 120 作为估算）。
 *
 * 5.7.3：改为 async，内部 dynamic import('dagre')，首次调用时异步加载 dagre chunk。
 * 调用方需 await 返回值。
 */
export async function layoutGit(
  nodes: LayoutableNode[],
  _edges: Edge[],
): Promise<LayoutableNode[]> {
  if (nodes.length === 0) return nodes;

  const dagre = await loadDagre();

  // 创建 dagre 有向图，左→右分层
  const g = new dagre.graphlib.Graph<Record<string, never>>();
  g.setGraph({
    rankdir: 'LR',
    nodesep: 40,
    ranksep: 80,
    marginx: 20,
    marginy: 20,
  });
  g.setDefaultEdgeLabel(() => ({}));

  // 添加节点（统一尺寸，dagre 据此计算层间间距）
  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }

  // 添加边：优先用 parentId 链构建父子关系；合并节点用 mergedFromIds 作为多入边
  for (const node of nodes) {
    if (node.data.parentId) {
      g.setEdge(node.data.parentId, node.id);
    }
    if (node.data.mergedFromIds && node.data.mergedFromIds.length > 0) {
      for (const fromId of node.data.mergedFromIds) {
        // 合并节点 parentId 通常为 null，防御性去重避免重复边
        if (fromId !== node.data.parentId) {
          g.setEdge(fromId, node.id);
        }
      }
    }
  }

  dagre.layout(g);

  // 从 dagre 结果读取 x,y（dagre 返回节点中心点，React Flow 需要左上角坐标）
  return nodes.map((node) => {
    const dagreNode = g.node(node.id);
    if (!dagreNode) return node;
    return {
      ...node,
      position: {
        x: dagreNode.x - NODE_WIDTH / 2,
        y: dagreNode.y - NODE_HEIGHT / 2,
      },
    };
  });
}
