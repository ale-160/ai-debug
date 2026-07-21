// ============================================================
// AI Debug — 多 LLM 配置存储
//
// 在原有单一 llm-config（ai-debug:llm-config）之上，支持用户保存多组
// 命名的 LLM 配置组合（多 provider + 多 model），可在助手 / 设置之间
// 快速切换。激活的配置 id 单独持久化，store 据此加载对应 config。
//
// 状态管理：useSyncExternalStore 模式，
// UI 通过 subscribe + getSnapshot 订阅，跨标签页通过 window 'storage' 事件同步。
// ============================================================

import type { LLMConfig, LLMProvider } from './llm-config';
import { generateId } from '@/lib/id';
import {
  obfuscateJSON,
  deobfuscateJSON,
  obfuscateJSONAsync,
  deobfuscateJSONAsync,
} from '@/lib/crypto';

/** 单个命名的 LLM 配置组合 */
export interface LLMConfigEntry {
  id: string; // 'cfg-${timestamp}-${rand}'
  name: string; // 用户起的名字，如「mimo-v2.5」「doubao-pro」
  config: LLMConfig; // 完整配置（provider/apiKey/baseUrl/model）
  createdAt: number;
  updatedAt: number;
}

/** 容量上限：最多保存 20 个配置 */
const MAX_ENTRIES = 20;

const STORAGE_KEY = 'ai-debug:multi-llm-configs';
const ACTIVE_KEY = 'ai-debug:active-llm-config-id';
/** 旧版单一 LLM 配置 key（用于一次性迁移） */
const LEGACY_LLM_CONFIG_KEY = 'ai-debug:llm-config';

// 订阅者集合
const subscribers = new Set<() => void>();

// 当前内存中的配置快照（保证引用变化以触发 useSyncExternalStore 重渲染）
let snapshot: LLMConfigEntry[] = [];

function notify(): void {
  subscribers.forEach((cb) => cb());
}

// generateId 已迁移至 @/lib/id（统一 CSPRNG ID 生成）

/** 字段校验：过滤掉结构不合法的条目，防止 localStorage 损坏导致运行时崩溃 */
function filterValidEntries(list: unknown): LLMConfigEntry[] {
  if (!Array.isArray(list)) return [];
  return list.filter(
    (e): e is LLMConfigEntry =>
      e &&
      typeof e === 'object' &&
      typeof e.id === 'string' &&
      typeof e.name === 'string' &&
      e.config &&
      typeof e.config === 'object' &&
      typeof e.config.provider === 'string' &&
      typeof e.config.apiKey === 'string' &&
      typeof e.config.baseUrl === 'string' &&
      typeof e.config.model === 'string' &&
      typeof e.createdAt === 'number' &&
      typeof e.updatedAt === 'number',
  );
}

/**
 * 同步从 localStorage 读取配置列表。
 * - SSR（typeof window === 'undefined'）时返回空数组
 * - 仅能解密 `enc:` 前缀的旧 XOR 数据与明文 JSON
 * - `aes:` 前缀的 AES-GCM 数据需用 readFromStorageAsync 异步读取（本函数返回空数组）
 * - JSON 解析失败或格式不合法也返回空数组
 */
function readFromStorage(): LLMConfigEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    // 同步路径：仅处理 enc: 前缀的旧 XOR 数据与明文 JSON；aes: 前缀数据返回空（等异步加载）
    if (raw.startsWith('aes:')) return [];
    const parsed = deobfuscateJSON<LLMConfigEntry[]>(raw);
    return filterValidEntries(parsed);
  } catch {
    return [];
  }
}

/**
 * 异步从 localStorage 读取配置列表。
 * - 优先尝试 AES-GCM（`aes:` 前缀）解密
 * - 回退到同步 XOR（`enc:` 前缀）与明文 JSON
 * - 兼容从旧版本数据自动迁移到 AES-GCM
 */
async function readFromStorageAsync(): Promise<LLMConfigEntry[]> {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = await deobfuscateJSONAsync<LLMConfigEntry[]>(raw);
    return filterValidEntries(parsed);
  } catch {
    return [];
  }
}

/**
 * 异步写入 localStorage（AES-GCM 加密，避免明文 API Key）。
 * - 主路径：使用 Web Crypto AES-GCM 加密
 * - Fallback：Web Crypto 不可用时回退到同步 XOR 混淆
 * - 失败时静默忽略
 */
async function writeToStorage(entries: LLMConfigEntry[]): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    const encoded = await obfuscateJSONAsync(entries);
    window.localStorage.setItem(STORAGE_KEY, encoded);
  } catch {
    // 异步加密失败，回退到同步 XOR
    try {
      window.localStorage.setItem(STORAGE_KEY, obfuscateJSON(entries));
    } catch {
      // 静默忽略
    }
  }
}

/** 读取激活的配置 id */
function readActiveId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

/** 写入激活的配置 id（null 时移除） */
function writeActiveId(id: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (id === null) {
      window.localStorage.removeItem(ACTIVE_KEY);
    } else {
      window.localStorage.setItem(ACTIVE_KEY, id);
    }
  } catch {
    // 静默忽略
  }
}

/** 刷新内存快照（同步路径，仅处理 enc: 旧 XOR / 明文 JSON） */
function refreshSnapshot(): void {
  snapshot = readFromStorage();
}

/**
 * 异步刷新内存快照（处理 aes: AES-GCM / enc: 旧 XOR / 明文 JSON）。
 * - 用于模块初始化时加载 AES-GCM 加密的数据
 * - 用于 storage 事件后重新加载跨标签页写入的 AES-GCM 数据
 * - 若 await 期间 snapshot 被同步写操作修改，则跳过本次更新（避免覆盖用户写入）
 */
let snapshotVersion = 0;
async function refreshSnapshotAsync(): Promise<void> {
  if (typeof window === 'undefined') return;
  const myVersion = snapshotVersion;
  const fresh = await readFromStorageAsync();
  // 如果 await 期间发生了同步写操作（saveLlmConfig / deleteLlmConfig 等），跳过本次更新
  if (snapshotVersion !== myVersion) return;
  if (fresh.length === 0 && snapshot.length > 0) {
    // 异步读取返回空（可能解密失败），但 snapshot 已有数据，保留 snapshot 不清空
    return;
  }
  snapshot = fresh;
  notify();
}

// 模块加载时初始化快照：先同步加载（用于首屏立即渲染），再异步加载 AES-GCM 数据
if (typeof window !== 'undefined') {
  refreshSnapshot();
  // 异步加载 AES-GCM 加密的数据（首屏可能为空，加载完成后通过 notify 触发重渲染）
  void refreshSnapshotAsync();
  // 跨标签页同步：监听 window 'storage' 事件
  window.addEventListener('storage', (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === ACTIVE_KEY) {
      refreshSnapshot();
      notify();
      // AES-GCM 数据需异步解密，再刷一次
      void refreshSnapshotAsync();
    }
  });
}

// ========== useSyncExternalStore 接口 ==========

/** 订阅配置变化。返回取消订阅的函数 */
export function subscribeLlmConfigs(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

/** 获取当前配置快照（useSyncExternalStore 所需） */
export function getLlmConfigsSnapshot(): LLMConfigEntry[] {
  return snapshot;
}

/** SSR 快照（useSyncExternalStore 第三参数）：服务端恒为空数组 */
export function getLlmConfigsServerSnapshot(): LLMConfigEntry[] {
  return [];
}

// ========== CRUD API ==========

/** 列出所有配置（按更新时间倒序） */
export function listLlmConfigs(): LLMConfigEntry[] {
  // 确保 snapshot 是最新的
  if (snapshot.length === 0 && typeof window !== 'undefined') {
    const fresh = readFromStorage();
    if (fresh.length > 0) {
      snapshot = fresh;
    }
  }
  return [...snapshot].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** 按 id 获取单个配置。未找到返回 undefined */
export function getLlmConfig(id: string): LLMConfigEntry | undefined {
  return snapshot.find((e) => e.id === id);
}

/**
 * 保存（新增或更新）一个配置。
 * - 未传 id 时新增；传入已有 id 时更新。
 * - 自动维护 createdAt / updatedAt。
 * - 容量保护：新增后超过 MAX_ENTRIES 时丢弃最旧条目。
 */
export function saveLlmConfig(
  input: Omit<LLMConfigEntry, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
): LLMConfigEntry {
  const now = Date.now();
  const existing = input.id ? snapshot.find((e) => e.id === input.id) : undefined;

  // 校验 provider 合法性（与 llm-config.ts 的 LLMProvider 一致）
  const validProviders: LLMProvider[] = [
    'mimo',
    'volcengine',
    'openrouter',
    'deepseek',
    'openai',
    'custom',
  ];
  const provider: LLMProvider = validProviders.includes(input.config.provider)
    ? input.config.provider
    : 'custom';

  const next: LLMConfigEntry = existing
    ? {
        ...existing,
        name: input.name,
        config: { ...input.config, provider },
        updatedAt: now,
      }
    : {
        id: input.id || generateId('cfg'),
        name: input.name,
        config: { ...input.config, provider },
        createdAt: now,
        updatedAt: now,
      };

  let nextList: LLMConfigEntry[];
  if (existing) {
    nextList = snapshot.map((e) => (e.id === next.id ? next : e));
  } else {
    nextList = [...snapshot, next];
    // 容量保护：超过上限时按 updatedAt 升序丢弃最旧条目
    if (nextList.length > MAX_ENTRIES) {
      nextList = nextList
        .slice()
        .sort((a, b) => a.updatedAt - b.updatedAt)
        .slice(nextList.length - MAX_ENTRIES);
    }
  }

  // 异步写入 AES-GCM 加密数据（fire-and-forget）；snapshot 同步更新保证 UI 立即响应
  void writeToStorage(nextList);
  snapshot = [...nextList];
  // 标记 snapshot 被同步修改，使进行中的 refreshSnapshotAsync 失效（避免覆盖用户写入）
  snapshotVersion++;
  notify();
  return next;
}

/** 按 id 删除一个配置。不存在时静默忽略。若删除的是当前激活配置，激活态清空 */
export function deleteLlmConfig(id: string): void {
  const nextList = snapshot.filter((e) => e.id !== id);
  if (nextList.length === snapshot.length) return;
  // 异步写入 AES-GCM 加密数据（fire-and-forget）；snapshot 同步更新保证 UI 立即响应
  void writeToStorage(nextList);
  snapshot = [...nextList];
  snapshotVersion++;
  // 若删除的是激活配置，清空激活态
  if (readActiveId() === id) {
    writeActiveId(null);
  }
  notify();
}

/** 获取当前激活的配置 id（null 表示未激活） */
export function getActiveLlmConfigId(): string | null {
  return readActiveId();
}

/** 设置当前激活的配置 id（null 清空） */
export function setActiveLlmConfigId(id: string | null): void {
  writeActiveId(id);
  notify();
}

/**
 * 获取当前激活的配置。
 * - 若 active id 有效，返回对应条目
 * - 若 active id 无效或为 null，返回列表第一个或 null
 */
export function getActiveLlmConfig(): LLMConfigEntry | null {
  const id = readActiveId();
  if (id) {
    const entry = snapshot.find((e) => e.id === id);
    if (entry) return entry;
  }
  // 回退：列表第一个（按 updatedAt 倒序）
  const sorted = [...snapshot].sort((a, b) => b.updatedAt - a.updatedAt);
  return sorted[0] ?? null;
}

/**
 * 迁移：若 multi-llm-configs 为空但旧的 ai-debug:llm-config 存在，
 * 自动迁移为「默认」条目并设为激活，并删除旧 key 避免重复迁移。
 * 非浏览器环境（SSR）静默跳过。
 */
export function migrateFromLegacyIfNeeded(): void {
  if (typeof window === 'undefined') return;
  try {
    // 已有 multi 配置：跳过迁移，但仍清理可能残留的旧 key
    const existingMulti = readFromStorage();
    if (existingMulti.length > 0) {
      // 已有数据，安全清理旧 key（避免每次启动都尝试迁移）
      try {
        window.localStorage.removeItem(LEGACY_LLM_CONFIG_KEY);
      } catch {
        // 静默忽略
      }
      return;
    }

    const legacyRaw = window.localStorage.getItem(LEGACY_LLM_CONFIG_KEY);
    if (!legacyRaw) return;
    const legacy = JSON.parse(legacyRaw);
    if (
      !legacy ||
      typeof legacy.provider !== 'string' ||
      typeof legacy.apiKey !== 'string' ||
      typeof legacy.baseUrl !== 'string' ||
      typeof legacy.model !== 'string'
    ) {
      // 旧数据损坏，删除以避免下次再尝试解析
      try {
        window.localStorage.removeItem(LEGACY_LLM_CONFIG_KEY);
      } catch {
        // 静默忽略
      }
      return;
    }

    // 迁移为「默认」条目
    const now = Date.now();
    const entry: LLMConfigEntry = {
      id: generateId('cfg'),
      name: '默认',
      config: {
        provider: legacy.provider as LLMProvider,
        apiKey: legacy.apiKey,
        baseUrl: legacy.baseUrl,
        model: legacy.model,
      },
      createdAt: now,
      updatedAt: now,
    };
    // 写入新格式数据（异步 AES-GCM 加密）
    void writeToStorage([entry]);
    writeActiveId(entry.id);
    snapshot = [entry];
    snapshotVersion++;
    // 迁移成功后删除旧 key，避免重复迁移
    try {
      window.localStorage.removeItem(LEGACY_LLM_CONFIG_KEY);
    } catch {
      // 静默忽略
    }
    notify();
  } catch {
    // 旧数据损坏，静默跳过
  }
}
