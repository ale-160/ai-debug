import type { Node, Edge } from 'reactflow';
import type { TurnNodeData } from './types';

type LayoutableNode = Node<TurnNodeData>;
type Position = { x: number; y: number };

/** 基础半径：根的子节点所在圆周半径（节点宽约 240，留出间距） */
const BASE_RADIUS = 320;
/** 扇形最小张角（弧度）= 60 度 */
const MIN_FAN = Math.PI / 3;
/** 扇形最大张角（弧度）= 120 度 */
const MAX_FAN = (2 * Math.PI) / 3;
/** 单个子节点占用角度（弧度）≈ 30 度，用于推算扇形张角 */
const PER_CHILD_ANGLE = Math.PI / 6;

/**
 * 计算节点深度：通过 parentId 向上递归，根节点深度为 1。
 * 5.5.1 注记：本函数为 O(depth)，仅作为 incrementalLayout 等无法预计算 depth 场景的回退。
 * 全量 layoutRadial 已改为 BFS 时同步计算 depthMap（O(N)），不再调用本函数。
 */
export function getNodeDepth(nodeId: string, nodes: LayoutableNode[]): number {
  const nodeMap = new Map<string, LayoutableNode>(nodes.map((n) => [n.id, n]));
  let depth = 0;
  let currentId: string | null = nodeId;
  while (currentId) {
    const node = nodeMap.get(currentId);
    if (!node) break;
    depth += 1;
    currentId = node.data.parentId;
  }
  return depth;
}

/**
 * 计算节点相对根节点的方位角（弧度）。
 * 根节点或未布局（位置为 0,0）节点返回 0；positions 优先于 nodes 中的原始位置。
 */
function getNodeAngle(
  nodeId: string,
  nodes: LayoutableNode[],
  positions?: Map<string, Position>,
): number {
  const root = nodes.find((n) => n.data.parentId === null);
  if (!root || nodeId === root.id) return 0;
  const rootPos = positions?.get(root.id) ?? root.position;
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return 0;
  const pos = positions?.get(nodeId) ?? node.position;
  if (pos.x === 0 && pos.y === 0) return 0;
  return Math.atan2(pos.y - rootPos.y, pos.x - rootPos.x);
}

/**
 * 根据父节点方位与子节点数量，计算子节点在扇形内的角度数组（弧度）。
 * 根的子节点均匀分布在 360 度；非根父节点的子节点沿父节点外侧扇形分布。
 */
function computeChildAngles(
  parentId: string,
  children: LayoutableNode[],
  nodes: LayoutableNode[],
  positions?: Map<string, Position>,
): number[] {
  const count = children.length;
  if (count === 0) return [];
  const parent = nodes.find((n) => n.id === parentId);
  // 父节点为根：均匀分布在 360 度圆周上
  if (!parent || parent.data.parentId === null) {
    if (count === 1) return [0];
    return children.map((_, i) => (2 * Math.PI * i) / count);
  }
  // 非根父节点：扇形中心 = 父节点相对根的方位角
  const center = getNodeAngle(parentId, nodes, positions);
  if (count === 1) return [center];
  // 扇形张角随子节点数量动态调整，限制在 [60, 120] 度
  const spread = Math.min(MAX_FAN, Math.max(MIN_FAN, count * PER_CHILD_ANGLE));
  const step = spread / (count - 1);
  const start = center - spread / 2;
  return children.map((_, i) => start + step * i);
}

/**
 * 计算父节点下所有子节点的目标位置。
 * 半径 radius = BASE_RADIUS * 父节点深度（即子节点深度 - 1）。
 * 位置：x = parentX + radius * cos(angle)，y = parentY + radius * sin(angle)。
 *
 * 5.5.1 优化：新增可选 parentDepth 参数（由 BFS 预计算传入），避免每次调用
 * getNodeDepth 沿 parentId 链向上递归 O(depth)；未传则回退到 getNodeDepth
 * （incrementalLayout 等单点查询场景仍可使用）。
 */
function placeChildren(
  parentId: string,
  children: LayoutableNode[],
  nodes: LayoutableNode[],
  positions?: Map<string, Position>,
  parentDepth?: number,
): Map<string, Position> {
  const parent = nodes.find((n) => n.id === parentId);
  const result = new Map<string, Position>();
  if (!parent || children.length === 0) return result;
  const angles = computeChildAngles(parentId, children, nodes, positions);
  const depth = parentDepth ?? getNodeDepth(parentId, nodes);
  const radius = BASE_RADIUS * depth;
  const parentPos = positions?.get(parentId) ?? parent.position;
  children.forEach((child, i) => {
    const a = angles[i];
    result.set(child.id, {
      x: parentPos.x + radius * Math.cos(a),
      y: parentPos.y + radius * Math.sin(a),
    });
  });
  return result;
}

/**
 * 中心辐射状全量布局：根节点居中，子节点沿父节点外侧扇形分布，形成蛛网形态。
 * 优先用 node.data.parentId 构建父子关系；edges 仅作参考。
 *
 * 5.5.1 优化：BFS 时同步维护 depthMap（depth[child] = depth[parent] + 1），
 * 整体 O(N) 完成深度计算，避免对每个父节点调用 O(depth) 的 getNodeDepth。
 * 根节点深度为 1（与 getNodeDepth 语义一致），其子节点深度为 2，依此类推。
 */
export function layoutRadial(nodes: LayoutableNode[], _edges: Edge[]): LayoutableNode[] {
  // 找到根节点（parentId 为 null）；若无则返回原数组
  const root = nodes.find((n) => n.data.parentId === null);
  if (!root) return nodes;

  // 按 parentId 构建父子关系 map
  const childrenMap = new Map<string | null, LayoutableNode[]>();
  for (const node of nodes) {
    const list = childrenMap.get(node.data.parentId) ?? [];
    list.push(node);
    childrenMap.set(node.data.parentId, list);
  }

  // positions 保存目标位置；根节点定位 (0, 0)
  const positions = new Map<string, Position>();
  positions.set(root.id, { x: 0, y: 0 });

  // 5.5.1：depthMap 在 BFS 时同步填充，O(N) 完成深度计算
  const depthMap = new Map<string, number>();
  depthMap.set(root.id, 1);

  // BFS 逐层放置子节点（visited 防止异常环引用导致死循环）
  const visited = new Set<string>([root.id]);
  const queue: string[] = [root.id];
  while (queue.length > 0) {
    const parentId = queue.shift()!;
    const children = childrenMap.get(parentId) ?? [];
    if (children.length === 0) continue;
    const parentDepth = depthMap.get(parentId) ?? 1;
    // 子节点深度 = 父节点深度 + 1（与 getNodeDepth 语义一致）
    for (const child of children) {
      depthMap.set(child.id, parentDepth + 1);
    }
    const childPositions = placeChildren(parentId, children, nodes, positions, parentDepth);
    for (const child of children) {
      const pos = childPositions.get(child.id);
      if (pos) positions.set(child.id, pos);
      if (!visited.has(child.id)) {
        visited.add(child.id);
        queue.push(child.id);
      }
    }
  }

  // 仅更新 position，保留其余字段
  return nodes.map((n) => {
    const pos = positions.get(n.id);
    return pos ? { ...n, position: pos } : n;
  });
}

/**
 * 增量布局：仅重算新增节点及其兄弟节点位置，其他节点位置保持稳定。
 * 兄弟节点在父节点扇形内重新等角度分布；新增节点为根时定位 (0, 0)。
 */
export function incrementalLayout(
  newNodeId: string,
  nodes: LayoutableNode[],
  _edges: Edge[],
): LayoutableNode[] {
  const nodeMap = new Map<string, LayoutableNode>(nodes.map((n) => [n.id, n]));
  const newNode = nodeMap.get(newNodeId);
  if (!newNode) return nodes;

  // 新增节点为根节点：
  // - 首个根节点定位 (0, 0)
  // - 后续根节点水平偏移放置，避免堆叠遮挡（间距 = BASE_RADIUS * 2.2）
  // 偏移方向取现有根节点中心的反方向，让多根节点向右铺开
  if (newNode.data.parentId === null) {
    const existingRoots = nodes.filter((n) => n.data.parentId === null && n.id !== newNodeId);
    if (existingRoots.length === 0) {
      return nodes.map((n) => (n.id === newNodeId ? { ...n, position: { x: 0, y: 0 } } : n));
    }
    // 计算新根节点位置：现有根节点数量 * 间距，y 轴轻微扰动避免完全水平
    const offset = BASE_RADIUS * 2.2;
    const newX = offset * existingRoots.length;
    const newY = (existingRoots.length % 2 === 0 ? 0 : 1) * 80; // 交替轻微上下偏移
    return nodes.map((n) => (n.id === newNodeId ? { ...n, position: { x: newX, y: newY } } : n));
  }

  const parentId = newNode.data.parentId;
  if (!nodeMap.has(parentId)) return nodes;

  // 收集父节点下所有子节点（兄弟节点，含新增节点）并重新等角度分布
  const siblings = nodes.filter((n) => n.data.parentId === parentId);
  if (siblings.length === 0) return nodes;

  const siblingPositions = placeChildren(parentId, siblings, nodes);
  return nodes.map((n) => {
    const pos = siblingPositions.get(n.id);
    return pos ? { ...n, position: pos } : n;
  });
}
