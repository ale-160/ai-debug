// ============================================================
// AI Debug — 蛛网项目存储（localStorage）
//
// 管理多个对话网络项目（NetworkProject）的持久化。
// 旧 key `ai-debug:workflows` 数据不做自动迁移。
// ============================================================
import type { Node, Edge } from 'reactflow';
import type { NetworkProject, TurnNodeData } from '@/components/node-flow/types';
import { generateId } from '@/lib/id';
import { reportError } from '@/lib/error-reporter';

/** localStorage 存储键 */
export const PROJECTS_KEY = 'ai-debug:network-projects';
const STORAGE_KEY = PROJECTS_KEY;

/**
 * 4.4.3：项目数量上限。超过此值时新建/导入项目会自动淘汰最旧的项目。
 * 选择 100 是基于典型使用场景：100 个项目 × 50 节点 ≈ 5000 节点，
 * 既能覆盖长期使用，又能避免 localStorage 无限增长。
 */
export const MAX_PROJECTS = 100;
/**
 * 4.4.3：单项目 nodes 数量上限。超过此值时 saveProjects 上报 warning（仍尝试保存）。
 * 5000 个节点 ≈ 25MB JSON（每节点 5KB），已远超 localStorage 5MB 上限，
 * 主要用于早期预警，让用户主动清理。
 */
export const MAX_NODES_PER_PROJECT = 5000;
/**
 * 4.4.3：localStorage 总占用预警阈值（4MB）。
 * 超过此值时 saveProjects 上报 warning（仍尝试保存），提醒用户清理。
 */
const STORAGE_WARNING_BYTES = 4 * 1024 * 1024;

/**
 * 从 localStorage 读取全部项目。
 * 非浏览器环境（SSR）或读取/解析失败时返回空数组。
 */
export function loadProjects(): NetworkProject[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as NetworkProject[];
    if (!Array.isArray(parsed)) return [];
    // 兼容旧数据：无 projectType 字段按 'normal' 处理，originalProjectId/pinnedAt 保持 undefined
    return parsed.map((p) => ({
      ...p,
      projectType: p.projectType ?? 'normal',
    }));
  } catch {
    return [];
  }
}

/**
 * 把项目列表写入 localStorage。
 * 非浏览器环境下静默跳过。
 * 写入失败（隐私模式 / 配额满）时通过 reportError 上报，便于调用方感知数据丢失风险。
 *
 * 4.4.3：写入前检测单项目 nodes 数量与 totalSize，超阈值时上报 warning 但仍尝试保存
 * （不修改数据，避免静默丢失；让用户通过 StorageManager 主动清理）。
 */
export function saveProjects(projects: NetworkProject[]): void {
  if (typeof window === 'undefined') return;
  try {
    // 4.4.3：单项目 nodes 数量上限检测
    for (const p of projects) {
      if (p.nodes && p.nodes.length > MAX_NODES_PER_PROJECT) {
        reportError(
          new Error(
            `project ${p.id} (${p.name}) has ${p.nodes.length} nodes, exceeds max ${MAX_NODES_PER_PROJECT}`,
          ),
          'saveProjects:too-many-nodes',
        );
      }
    }
    const serialized = JSON.stringify(projects);
    // 4.4.3：totalSize 预警（UTF-16 每字符 2 字节）
    const totalBytes = serialized.length * 2;
    if (totalBytes > STORAGE_WARNING_BYTES) {
      reportError(
        new Error(
          `projects total size ${(totalBytes / 1024 / 1024).toFixed(2)}MB exceeds warning threshold`,
        ),
        'saveProjects:storage-warning',
      );
    }
    window.localStorage.setItem(STORAGE_KEY, serialized);
  } catch (err) {
    // H-18：不再静默吞掉 QuotaExceededError，统一上报到 console.error
    reportError(err, 'saveProjects');
  }
}

/**
 * 4.4.3：项目数量超上限时淘汰最旧项目（按 updatedAt 升序），保留最近 MAX_PROJECTS 个。
 * 在 createProject / importProject 添加新项目前调用。
 * 返回值：可能已截断的项目列表（不修改原数组）。
 */
function enforceProjectCountLimit(projects: NetworkProject[]): NetworkProject[] {
  if (projects.length <= MAX_PROJECTS) return projects;
  // 按 updatedAt 升序排序，丢弃最旧的 (projects.length - MAX_PROJECTS) 个
  // 注意：derived-pruned 项目也参与淘汰（与普通项目同等对待），避免长期堆积
  const sorted = projects.slice().sort((a, b) => (a.updatedAt ?? 0) - (b.updatedAt ?? 0));
  const dropCount = projects.length - MAX_PROJECTS;
  return sorted.slice(dropCount);
}

/**
 * 创建一个空项目（无节点）并存入 storage，返回新项目。
 *
 * @param name     项目名称
 * @param options  可选：originalProjectId（派生自的原项目 id）、
 *                 projectType（'normal' | 'derived-pruned'，默认 'normal'）
 */
export function createProject(
  name: string,
  options?: {
    originalProjectId?: string;
    projectType?: 'normal' | 'derived-pruned';
  },
): NetworkProject {
  const now = Date.now();
  const project: NetworkProject = {
    id: generateId('project'),
    name: name.trim() || '未命名项目',
    nodes: [],
    edges: [],
    viewport: null,
    createdAt: now,
    updatedAt: now,
    originalProjectId: options?.originalProjectId,
    projectType: options?.projectType ?? 'normal',
  };
  const projects = loadProjects();
  projects.push(project);
  // 4.4.3：项目数量超上限时淘汰最旧项目
  const trimmed = enforceProjectCountLimit(projects);
  saveProjects(trimmed);
  return project;
}

/**
 * 更新指定项目（合并传入字段），同时更新 updatedAt。
 * 若项目不存在则静默跳过。
 */
export function updateProject(id: string, data: Partial<NetworkProject>): void {
  if (typeof window === 'undefined') return;
  const projects = loadProjects();
  const idx = projects.findIndex((p) => p.id === id);
  if (idx === -1) return;
  projects[idx] = {
    ...projects[idx],
    ...data,
    id: projects[idx].id, // id 不可覆盖
    updatedAt: Date.now(),
  };
  saveProjects(projects);
}

/**
 * 删除指定项目。若不存在则静默跳过。
 */
export function deleteProject(id: string): void {
  if (typeof window === 'undefined') return;
  const projects = loadProjects().filter((p) => p.id !== id);
  saveProjects(projects);
}

/**
 * 读取指定项目。不存在则返回 null。
 */
export function getProject(id: string): NetworkProject | null {
  return loadProjects().find((p) => p.id === id) ?? null;
}

/**
 * 导入项目：根据导入的 nodes/edges/viewport 创建新项目并写入 storage。
 * 用于侧边栏底部的"从 JSON 文件导入"功能。
 *
 * @param name     项目名称
 * @param nodes    节点列表
 * @param edges    边列表
 * @param viewport 视口
 * @param memory   可选的项目级记忆条目列表
 */
export function importProject(
  name: string,
  nodes: Node<TurnNodeData>[],
  edges: Edge[],
  viewport: NetworkProject['viewport'],
  memory?: NetworkProject['memory'],
): NetworkProject {
  const now = Date.now();
  const project: NetworkProject = {
    id: generateId('project'),
    name: name.trim() || '导入的项目',
    nodes,
    edges,
    viewport,
    createdAt: now,
    updatedAt: now,
    projectType: 'normal',
    memory,
  };
  const projects = loadProjects();
  projects.push(project);
  // 4.4.3：项目数量超上限时淘汰最旧项目
  const trimmed = enforceProjectCountLimit(projects);
  saveProjects(trimmed);
  return project;
}

// ============================================================
// H-12：localStorage 序列化主线程阻塞优化
//
// 10 个项目 × 50 节点 × 5KB/节点 ≈ 2.5MB 字符串。JSON.stringify +
// localStorage.setItem 同步执行约 50-200ms，期间完全阻塞 UI。
// 改为用 requestIdleCallback 在空闲期执行实际写入（fallback 到 setTimeout）。
// 同一 key 多次调度会去重，避免重复序列化。
// 页面卸载前注册 beforeunload 监听强制 flush，避免数据丢失。
// ============================================================

/** 待写入 localStorage 的任务队列：key -> 已序列化的字符串值 */
const pendingWrites: Map<string, string> = new Map();
/** 当前调度的 idle 句柄（null 表示未调度） */
let scheduledIdle: number | null = null;
/** beforeunload 监听是否已注册（仅注册一次） */
let beforeunloadRegistered = false;

/** 取消 idle 调度句柄（兼容 requestIdleCallback / setTimeout 两种实现） */
function cancelIdleHandle(handle: number): void {
  if (typeof window === 'undefined') return;
  if (
    typeof window.requestIdleCallback === 'function' &&
    typeof window.cancelIdleCallback === 'function'
  ) {
    window.cancelIdleCallback(handle);
  } else {
    window.clearTimeout(handle);
  }
}

/** 实际执行所有 pending 写入（在 idle 期或 beforeunload 时调用） */
function performPendingWrites(): void {
  if (typeof window === 'undefined') return;
  if (scheduledIdle !== null) {
    cancelIdleHandle(scheduledIdle);
    scheduledIdle = null;
  }
  const entries = Array.from(pendingWrites.entries());
  pendingWrites.clear();
  for (const [k, v] of entries) {
    try {
      window.localStorage.setItem(k, v);
    } catch (err) {
      // H-18：配额满 / 隐私模式不再静默吞掉，上报到 console.error
      reportError(err, `performPendingWrites:${k}`);
    }
  }
}

/** 调度一次 idle 写入（已调度则跳过，避免重复） */
function scheduleIdleWrite(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  pendingWrites.set(key, value);
  if (scheduledIdle !== null) return;
  // 注册 beforeunload 监听（仅一次）确保关闭页面前数据落盘
  if (!beforeunloadRegistered) {
    beforeunloadRegistered = true;
    window.addEventListener('beforeunload', performPendingWrites);
  }
  if (typeof window.requestIdleCallback === 'function') {
    // timeout: 500ms 兜底，避免空闲期迟迟不触发导致数据丢失
    scheduledIdle = window.requestIdleCallback(performPendingWrites, { timeout: 500 });
  } else {
    // SSR / 旧浏览器 fallback：setTimeout(0) 让出当前同步任务
    scheduledIdle = window.setTimeout(performPendingWrites, 0);
  }
}

/**
 * 强制把所有 pending 的 localStorage 写入立即落盘。
 * 可在关键保存点（项目切换、关闭页面前）显式调用，确保数据不丢。
 */
export function flushPendingLocalStorageWrites(): void {
  performPendingWrites();
}

/**
 * H-12：用 requestIdleCallback 包裹 saveProjects（fallback 到 setTimeout）。
 * 调用方应在非关键路径上使用此函数；关键路径仍用同步 saveProjects。
 */
export function saveProjectsIdle(projects: NetworkProject[]): void {
  if (typeof window === 'undefined') return;
  try {
    const value = JSON.stringify(projects);
    scheduleIdleWrite(STORAGE_KEY, value);
  } catch {
    // 序列化失败（循环引用等），静默忽略
  }
}

/**
 * H-12：包装 localStorage 为 idle 模式的存储适配器，供 zustand persist 使用。
 * - getItem: 同步读取（无延迟，初始化用）
 * - setItem: 调度 idle 写入（不阻塞主线程）
 * - removeItem: 同步删除
 * 返回值满足 zustand persist 的 StateStorage 接口（getItem/setItem/removeItem 均为同步签名）。
 */
export function createIdleLocalStorage(): {
  getItem: (name: string) => string | null;
  setItem: (name: string, value: string) => void;
  removeItem: (name: string) => void;
} {
  return {
    getItem: (name: string) => {
      if (typeof window === 'undefined') return null;
      try {
        return window.localStorage.getItem(name);
      } catch {
        return null;
      }
    },
    setItem: (name: string, value: string) => {
      scheduleIdleWrite(name, value);
    },
    removeItem: (name: string) => {
      if (typeof window === 'undefined') return;
      try {
        window.localStorage.removeItem(name);
      } catch {
        // 静默忽略
      }
    },
  };
}
