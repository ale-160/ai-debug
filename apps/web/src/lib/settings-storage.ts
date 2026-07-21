// ============================================================
// AI Debug — 应用设置 & 全局记忆存储（localStorage）
//
// 管理用户级偏好（记忆开关/频率/规则）与跨项目的全局记忆条目。
// 项目级记忆存储在 NetworkProject.memory 中，由 project-storage 管理。
// ============================================================
import type { AppSettings, MemoryEntry } from '@/components/node-flow/types';
import { generateId } from '@/lib/id';
import { reportError } from '@/lib/error-reporter';

/** 应用设置 localStorage key */
export const APP_SETTINGS_KEY = 'ai-debug:app-settings';
const SETTINGS_KEY = APP_SETTINGS_KEY;

/** 全局记忆 localStorage key */
export const GLOBAL_MEMORY_KEY = 'ai-debug:global-memory';

/**
 * 4.4.4：全局记忆条目数上限。超过时按 LRU 策略淘汰最旧条目。
 * 500 条 × 平均 200 字符 ≈ 100KB，可覆盖长期使用而不会无限增长。
 */
export const MAX_GLOBAL_MEMORY_ENTRIES = 500;

/** 默认设置：记忆默认关闭，冲突自动检测默认关闭，每轮提取（开启后），hover 路径摘要默认关闭 */
export const DEFAULT_SETTINGS: AppSettings = {
  enableGlobalMemory: false,
  enableProjectMemory: false,
  memoryFrequency: 1,
  enableConflictAutoCheck: false,
  conflictCheckFrequency: 1,
  globalRules: '',
  hoverShowPathSummary: false,
  nodeActionsStyle: 'both',
  assistantAutoCreateNodes: false,
};

/**
 * 读取应用设置。无记录时返回默认值；字段缺失时用默认值补齐。
 * 非浏览器环境（SSR）返回默认值。
 */
export function loadSettings(): AppSettings {
  if (typeof window === 'undefined') return { ...DEFAULT_SETTINGS };
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    // 合并默认值，保证新增字段有默认值
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** 写入应用设置。非浏览器环境静默跳过。配额满时通过 reportError 上报。 */
export function saveSettings(settings: AppSettings): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (err) {
    // H-18：不再静默吞掉 QuotaExceededError，上报到 console.error
    reportError(err, 'saveSettings');
  }
}

/** 写入应用设置的别名（外部统一接口）。 */
export const saveAppSettings = saveSettings;

// ---------- 全局记忆 CRUD ----------

/** 读取全局记忆条目列表。非浏览器环境返回空数组。 */
export function loadGlobalMemory(): MemoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(GLOBAL_MEMORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as MemoryEntry[];
  } catch {
    return [];
  }
}

/**
 * 写入全局记忆条目列表。非浏览器环境静默跳过。配额满时通过 reportError 上报。
 *
 * 4.4.4：写入前若条目数超过 MAX_GLOBAL_MEMORY_ENTRIES（500），
 * 按 LRU 策略淘汰最旧条目（按 createdAt 升序丢弃超出部分），
 * 防止无限增长撑爆 localStorage。
 */
export function saveGlobalMemory(entries: MemoryEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    // 4.4.4：LRU 淘汰最旧条目
    let toSave = entries;
    if (entries.length > MAX_GLOBAL_MEMORY_ENTRIES) {
      // 按 createdAt 升序排序，保留最新的 MAX_GLOBAL_MEMORY_ENTRIES 条
      // （MemoryEntry 没有 lastAccessedAt 字段，用 createdAt 作为近似 LRU 依据）
      toSave = entries
        .slice()
        .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
        .slice(entries.length - MAX_GLOBAL_MEMORY_ENTRIES);
    }
    window.localStorage.setItem(GLOBAL_MEMORY_KEY, JSON.stringify(toSave));
  } catch (err) {
    // H-18：不再静默吞掉 QuotaExceededError，上报到 console.error
    reportError(err, 'saveGlobalMemory');
  }
}

/** 新增一条全局记忆，返回新条目。 */
export function addGlobalMemory(
  content: string,
  source: 'auto' | 'manual' = 'manual',
): MemoryEntry {
  const entry: MemoryEntry = {
    id: generateId('mem'),
    content: content.trim(),
    createdAt: Date.now(),
    source,
  };
  const list = loadGlobalMemory();
  list.push(entry);
  saveGlobalMemory(list);
  return entry;
}

/** 更新指定全局记忆条目的内容。 */
export function updateGlobalMemory(id: string, content: string): void {
  const list = loadGlobalMemory();
  const idx = list.findIndex((e) => e.id === id);
  if (idx === -1) return;
  list[idx] = { ...list[idx], content: content.trim() };
  saveGlobalMemory(list);
}

/** 删除指定全局记忆条目。 */
export function deleteGlobalMemory(id: string): void {
  const list = loadGlobalMemory().filter((e) => e.id !== id);
  saveGlobalMemory(list);
}

/** 清空全部全局记忆条目。非浏览器环境静默跳过。 */
export function clearGlobalMemory(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(GLOBAL_MEMORY_KEY);
  } catch {
    // 静默忽略
  }
}
