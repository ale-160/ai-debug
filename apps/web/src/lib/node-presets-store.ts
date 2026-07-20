// ============================================================
// AI Debug — 节点预设 Store（P1-2）
//
// 预设 = 用户保存的常用 userMessage 提问模板，
// 用户可从命令面板或 Inspector 中快速复用，一键生成新节点。
// 所有预设存储在浏览器 localStorage，不涉及后端；
// 支持导出为 JSON 文件、从 JSON 文件导入。
//
// 状态管理：useSyncExternalStore 模式，
// UI 通过 subscribe + getSnapshot 订阅，跨标签页通过 window 'storage' 事件同步。
// ============================================================

/** ai-debug 仅有的节点类型：turn 用户消息节点 / merge 合并节点 */
export type PresetNodeType = 'turn' | 'merge';

export interface NodePreset {
  /** uuid */
  id: string;
  /** 用户起的名字，如"代码评审提问" */
  name: string;
  /** 节点类型：ai-debug 仅 'turn' | 'merge' */
  nodeType: PresetNodeType;
  /** 预设的 userMessage 文本（核心字段） */
  userMessage: string;
  /** 可选：标签列表 */
  tags?: string[];
  /** 可选：emoji 或 lucide 图标名 */
  icon?: string;
  /** 创建时间戳 */
  createdAt: number;
  /** 更新时间戳 */
  updatedAt: number;
}

/** 预设最大容量，超过时丢弃最旧条目 */
const MAX_PRESETS = 100;

const STORAGE_KEY = 'ai-debug:node-presets';

// 订阅者集合
const subscribers = new Set<() => void>();

// 当前内存中的预设快照（保证引用变化以触发 useSyncExternalStore 重渲染）
let snapshot: NodePreset[] = [];

function notify() {
  subscribers.forEach((cb) => cb());
}

/**
 * 从 localStorage 读取预设列表并刷新内存快照。
 * - SSR（typeof window === 'undefined'）时返回空数组
 * - JSON 解析失败也返回空数组
 */
function readFromStorage(): NodePreset[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // 字段兼容性过滤：只保留含 id/name/nodeType/userMessage 的合法预设
    return parsed.filter(
      (p): p is NodePreset =>
        p &&
        typeof p === 'object' &&
        typeof p.id === 'string' &&
        typeof p.name === 'string' &&
        (p.nodeType === 'turn' || p.nodeType === 'merge') &&
        typeof p.userMessage === 'string',
    );
  } catch {
    return [];
  }
}

function writeToStorage(presets: NodePreset[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // 忽略 quota 错误或其它存储异常
  }
}

/**
 * 刷新内存快照（从 localStorage 读取）。
 * 内部使用：每次写入后或外部 storage 事件触发时调用。
 */
function refreshSnapshot(): void {
  snapshot = readFromStorage();
}

// 模块加载时初始化快照
if (typeof window !== 'undefined') {
  refreshSnapshot();
  // 跨标签页同步：监听 window 'storage' 事件
  window.addEventListener('storage', (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      refreshSnapshot();
      notify();
    }
  });
}

// ========== useSyncExternalStore 接口 ==========

/**
 * 订阅预设变化。返回取消订阅的函数。
 */
export function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

/**
 * 获取当前预设快照（useSyncExternalStore 所需）。
 * 每次写入都会创建新数组引用以触发组件重渲染。
 */
export function getSnapshot(): NodePreset[] {
  return snapshot;
}

/**
 * SSR 快照（useSyncExternalStore 第三参数）：服务端恒为空数组。
 */
export function getServerSnapshot(): NodePreset[] {
  return [];
}

// ========== CRUD API ==========

/**
 * 列出所有预设（按更新时间倒序）。
 */
export function listPresets(): NodePreset[] {
  // 确保 snapshot 是最新的（防止某些场景下未触发 storage 事件）
  if (snapshot.length === 0 && typeof window !== 'undefined') {
    const fresh = readFromStorage();
    if (fresh.length > 0) {
      snapshot = fresh;
    }
  }
  return [...snapshot].sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * 按 id 获取单个预设。未找到返回 undefined。
 */
export function getPreset(id: string): NodePreset | undefined {
  return snapshot.find((p) => p.id === id);
}

/**
 * 保存（新增或更新）一个预设。
 * - 未传 id 时新增；传入已有 id 时更新。
 * - 自动维护 createdAt / updatedAt。
 * - 容量保护：新增后超过 MAX_PRESETS 时丢弃最旧条目。
 */
export function savePreset(input: Partial<NodePreset> & { name: string }): NodePreset {
  const now = Date.now();
  const existing = input.id ? snapshot.find((p) => p.id === input.id) : undefined;

  const next: NodePreset = existing
    ? {
        ...existing,
        ...input,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: now,
      }
    : {
        id: input.id || generateId(),
        name: input.name,
        nodeType: input.nodeType || 'turn',
        userMessage: input.userMessage ?? '',
        tags: input.tags,
        icon: input.icon,
        createdAt: now,
        updatedAt: now,
      };

  let nextList: NodePreset[];
  if (existing) {
    nextList = snapshot.map((p) => (p.id === next.id ? next : p));
  } else {
    nextList = [...snapshot, next];
    // 容量保护：超过上限时按 updatedAt 升序丢弃最旧条目
    if (nextList.length > MAX_PRESETS) {
      nextList = nextList
        .slice()
        .sort((a, b) => a.updatedAt - b.updatedAt)
        .slice(nextList.length - MAX_PRESETS);
    }
  }

  writeToStorage(nextList);
  snapshot = [...nextList];
  notify();
  return next;
}

/**
 * 按 id 删除一个预设。不存在时静默忽略。
 */
export function deletePreset(id: string): void {
  const nextList = snapshot.filter((p) => p.id !== id);
  if (nextList.length === snapshot.length) return;
  writeToStorage(nextList);
  snapshot = [...nextList];
  notify();
}

// ========== 导入 / 导出 ==========

/**
 * 导出全部预设为 JSON 文件（触发浏览器下载）。
 */
export function exportPresets(): void {
  const data = {
    type: 'ai-debug-node-presets',
    version: '1.0',
    exportedAt: new Date().toISOString(),
    presets: snapshot,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ai-debug-node-presets-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * 从 JSON 文本/对象导入预设。
 * - 同 id 的预设会被覆盖；新增的预设保留原 id。
 * - 容量保护：导入后超过 MAX_PRESETS 时丢弃最旧条目。
 * - 返回导入成功的预设数量。
 */
export function importPresets(input: string | { presets?: unknown[] }): number {
  let parsed: unknown;
  if (typeof input === 'string') {
    parsed = JSON.parse(input);
  } else {
    parsed = input;
  }

  const incoming = (parsed as { presets?: unknown[] })?.presets;
  if (!Array.isArray(incoming)) {
    throw new Error('无效的预设文件：缺少 presets 数组');
  }

  const valid: NodePreset[] = [];
  for (const item of incoming) {
    if (
      item &&
      typeof item === 'object' &&
      typeof (item as NodePreset).name === 'string' &&
      typeof (item as NodePreset).userMessage === 'string'
    ) {
      const p = item as NodePreset;
      const now = Date.now();
      const nodeType: PresetNodeType = p.nodeType === 'merge' ? 'merge' : 'turn';
      valid.push({
        id: typeof p.id === 'string' ? p.id : generateId(),
        name: p.name,
        nodeType,
        userMessage: p.userMessage,
        tags: Array.isArray(p.tags) ? p.tags : undefined,
        icon: typeof p.icon === 'string' ? p.icon : undefined,
        createdAt: typeof p.createdAt === 'number' ? p.createdAt : now,
        updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : now,
      });
    }
  }

  if (valid.length === 0) {
    throw new Error('预设文件中没有合法的预设条目');
  }

  // 同 id 覆盖，新 id 追加
  const byId = new Map<string, NodePreset>();
  for (const p of snapshot) byId.set(p.id, p);
  for (const p of valid) byId.set(p.id, p);
  let nextList = Array.from(byId.values());

  // 容量保护：超过上限时按 updatedAt 升序丢弃最旧条目
  if (nextList.length > MAX_PRESETS) {
    nextList = nextList
      .slice()
      .sort((a, b) => a.updatedAt - b.updatedAt)
      .slice(nextList.length - MAX_PRESETS);
  }

  writeToStorage(nextList);
  snapshot = [...nextList];
  notify();
  return valid.length;
}

// ========== 工具 ==========

function generateId(): string {
  // 优先使用 crypto.randomUUID（现代浏览器均支持）
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `preset-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
