// ============================================================
// AI Debug — 画布命名快照 Store（P1-3 轻量版）
//
// 参考 spark-flow 的 canvas-snapshots-store，适配 ai-debug：
// 1. 存储键改为 ai-debug:canvas-snapshots
// 2. workflowId 改为 projectId（与 ai-debug 项目概念对齐）
// 3. 节点类型固定为 ai-debug 的 TurnNodeData
// 4. 单项目最多保留 MAX_SNAPSHOTS_PER_PROJECT=50 个快照
//
// 快照用途：用户在关键里程碑手动保存画布状态（带名称），
// 后续可随时回滚到该状态。与 P0-1 自动 undo/redo 互补：
//   - undo/redo 是短步长的逐步回退
//   - 命名快照是长跨度的里程碑回滚
// ============================================================

import type { Node, Edge } from 'reactflow';
import type { TurnNodeData } from '@/components/node-flow/types';

export interface CanvasSnapshot {
  /** 唯一 id（crypto.randomUUID 或时间戳 + 随机串） */
  id: string;
  /** 用户起的名字，如「方案 A 探索完毕」 */
  name: string;
  /** 画布节点快照（已剥离运行时字段 status/result/errorMessage 等） */
  nodes: Node<TurnNodeData>[];
  /** 画布连线快照 */
  edges: Edge[];
  /** 视口状态（可选） */
  viewport?: { x: number; y: number; zoom: number };
  /** 关联的项目 id（草稿态为 undefined） */
  projectId?: string;
  /** 冗余字段：节点数，列表展示用 */
  nodeCount: number;
  /** 冗余字段：边数，列表展示用 */
  edgeCount: number;
  /** 创建时间戳（ms） */
  createdAt: number;
}

const STORAGE_KEY = 'ai-debug:canvas-snapshots';
const MAX_SNAPSHOTS_PER_PROJECT = 50;

// 订阅者集合
const subscribers = new Set<() => void>();

// 当前内存中的快照列表（保证引用变化以触发 useSyncExternalStore 重渲染）
let snapshot: CanvasSnapshot[] = [];

function notify(): void {
  subscribers.forEach((cb) => cb());
}

/**
 * 从 localStorage 读取快照列表。
 * - SSR（typeof window === 'undefined'）时返回空数组
 * - JSON 解析失败也返回空数组
 * - 字段兼容性过滤：只保留含 id/name/nodes/edges/createdAt 的合法快照
 */
function readFromStorage(): CanvasSnapshot[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is CanvasSnapshot =>
        s &&
        typeof s === 'object' &&
        typeof s.id === 'string' &&
        typeof s.name === 'string' &&
        Array.isArray(s.nodes) &&
        Array.isArray(s.edges) &&
        typeof s.createdAt === 'number',
    );
  } catch {
    return [];
  }
}

function writeToStorage(snapshots: CanvasSnapshot[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshots));
  } catch {
    // 容量超限或隐私模式，静默忽略
  }
}

/** 刷新内存快照（从 localStorage 读取） */
function refreshSnapshot(): void {
  snapshot = readFromStorage();
}

// 模块加载时初始化（仅浏览器环境）
if (typeof window !== 'undefined') {
  refreshSnapshot();
  // 跨标签页同步：监听 storage 事件
  window.addEventListener('storage', (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      refreshSnapshot();
      notify();
    }
  });
}

// ========== useSyncExternalStore 接口 ==========

export function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

export function getSnapshot(): CanvasSnapshot[] {
  return snapshot;
}

export function getServerSnapshot(): CanvasSnapshot[] {
  return [];
}

// ========== CRUD API ==========

/**
 * 列出快照（按创建时间倒序）。
 * 传入 projectId 时仅返回该项目的快照。
 */
export function listSnapshots(projectId?: string): CanvasSnapshot[] {
  // 确保 snapshot 是最新的（防止首屏加载时机问题）
  if (snapshot.length === 0 && typeof window !== 'undefined') {
    const fresh = readFromStorage();
    if (fresh.length > 0) {
      snapshot = fresh;
    }
  }
  const filtered =
    projectId === undefined ? snapshot : snapshot.filter((s) => s.projectId === projectId);
  return [...filtered].sort((a, b) => b.createdAt - a.createdAt);
}

/** 按 id 获取单个快照。未找到返回 undefined。 */
export function getSnapshotById(id: string): CanvasSnapshot | undefined {
  return snapshot.find((s) => s.id === id);
}

/**
 * 保存（新增）一个快照。
 * - 自动维护 id / createdAt / nodeCount / edgeCount
 * - 容量保护：单个 projectId 超过上限时按 createdAt 升序删除最旧的
 */
export function saveSnapshot(input: Omit<CanvasSnapshot, 'id' | 'createdAt'>): CanvasSnapshot {
  const now = Date.now();
  const next: CanvasSnapshot = {
    id: generateId(),
    name: input.name,
    nodes: input.nodes,
    edges: input.edges,
    viewport: input.viewport,
    projectId: input.projectId,
    nodeCount: input.nodeCount,
    edgeCount: input.edgeCount,
    createdAt: now,
  };

  let nextList = [...snapshot, next];
  if (next.projectId) {
    nextList = enforceCapacityForProject(nextList, next.projectId);
  }
  writeToStorage(nextList);
  snapshot = [...nextList];
  notify();
  return next;
}

/** 按 id 删除一个快照。不存在时静默忽略。 */
export function deleteSnapshot(id: string): void {
  const nextList = snapshot.filter((s) => s.id !== id);
  if (nextList.length === snapshot.length) return;
  writeToStorage(nextList);
  snapshot = [...nextList];
  notify();
}

/**
 * 清空快照。传入 projectId 时仅清空该项目的快照，否则清空全部。
 */
export function clearSnapshots(projectId?: string): void {
  let nextList: CanvasSnapshot[];
  if (projectId === undefined) {
    nextList = [];
  } else {
    nextList = snapshot.filter((s) => s.projectId !== projectId);
  }
  if (nextList.length === snapshot.length) return;
  writeToStorage(nextList);
  snapshot = [...nextList];
  notify();
}

// ========== 工具 ==========

/**
 * 对指定 projectId 应用容量保护：保留最新的 MAX_SNAPSHOTS_PER_PROJECT 个，
 * 超出的按 createdAt 升序删除最旧的。其他 projectId 的快照不受影响。
 */
function enforceCapacityForProject(list: CanvasSnapshot[], projectId: string): CanvasSnapshot[] {
  const ofProj = list.filter((s) => s.projectId === projectId);
  if (ofProj.length <= MAX_SNAPSHOTS_PER_PROJECT) return list;
  const sortedAsc = [...ofProj].sort((a, b) => a.createdAt - b.createdAt);
  const toRemoveCount = sortedAsc.length - MAX_SNAPSHOTS_PER_PROJECT;
  const idsToRemove = new Set(sortedAsc.slice(0, toRemoveCount).map((s) => s.id));
  return list.filter((s) => !idsToRemove.has(s.id));
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `snapshot-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
