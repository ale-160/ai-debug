// ============================================================
// AI Debug — 蛛网项目存储（localStorage）
//
// 管理多个对话网络项目（NetworkProject）的持久化。
// 旧 key `ai-debug:workflows` 数据不做自动迁移。
// ============================================================
import type { Node, Edge } from 'reactflow';
import type { NetworkProject, TurnNodeData } from '@/components/node-flow/types';

/** localStorage 存储键 */
export const PROJECTS_KEY = 'ai-debug:network-projects';
const STORAGE_KEY = PROJECTS_KEY;

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
    // 兼容旧数据：无 projectType 字段按 'normal' 处理，originalProjectId 保持 undefined
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
 */
export function saveProjects(projects: NetworkProject[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  } catch {
    // 写入失败（隐私模式 / 配额满）时静默忽略
  }
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
    id: `project-${now}-${Math.random().toString(36).slice(2, 8)}`,
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
  saveProjects(projects);
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
    id: `project-${now}-${Math.random().toString(36).slice(2, 8)}`,
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
  saveProjects(projects);
  return project;
}
