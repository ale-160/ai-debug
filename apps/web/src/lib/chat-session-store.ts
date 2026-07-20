// ============================================================
// AI Debug — 助手会话存储
//
// 在助手面板中支持多会话：每个会话独立维护 messages 列表，
// 可切换 / 重命名 / 删除。激活的会话 id 单独持久化。
// 单个 session 的 messages 上限 200 条（超出时丢弃最旧的）。
//
// 状态管理：useSyncExternalStore 模式，
// UI 通过 subscribe + getSnapshot 订阅，跨标签页通过 window 'storage' 事件同步。
// ============================================================

import type { AssistantMessage } from '@/components/node-flow/types';
import { generateId } from '@/lib/id';

/** 单个助手会话 */
export interface ChatSession {
  id: string; // 'sess-${timestamp}-${rand}'
  title: string; // 用户起的名字或从首条消息派生
  messages: AssistantMessage[];
  /** 会话级别激活的模型配置 id（null 表示用全局激活的） */
  activeLlmConfigId?: string | null;
  /** 会话级别激活的技能 id */
  activeSkillId?: string | null;
  createdAt: number;
  updatedAt: number;
}

/** 容量上限：最多保存 50 个会话 */
const MAX_SESSIONS = 50;
/** 单个会话 messages 上限：超出时丢弃最旧的 */
const MAX_MESSAGES = 200;

const STORAGE_KEY = 'ai-debug:chat-sessions';
const ACTIVE_KEY = 'ai-debug:active-chat-session-id';

// 订阅者集合
const subscribers = new Set<() => void>();

// 当前内存中的会话快照（保证引用变化以触发 useSyncExternalStore 重渲染）
let snapshot: ChatSession[] = [];

function notify(): void {
  subscribers.forEach((cb) => cb());
}

// generateId 已迁移至 @/lib/id（统一 CSPRNG ID 生成）

/**
 * 从 localStorage 读取会话列表。
 * - SSR（typeof window === 'undefined'）时返回空数组
 * - JSON 解析失败或格式不合法也返回空数组
 */
function readFromStorage(): ChatSession[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // 字段兼容性过滤：只保留合法会话
    return parsed.filter(
      (s): s is ChatSession =>
        s &&
        typeof s === 'object' &&
        typeof s.id === 'string' &&
        typeof s.title === 'string' &&
        Array.isArray(s.messages) &&
        typeof s.createdAt === 'number' &&
        typeof s.updatedAt === 'number',
    );
  } catch {
    return [];
  }
}

/** 写入 localStorage，失败时静默忽略 */
function writeToStorage(sessions: ChatSession[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    // 静默忽略
  }
}

/** 读取激活的会话 id */
function readActiveId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

/** 写入激活的会话 id（null 时移除） */
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

/** 刷新内存快照（从 localStorage 读取） */
function refreshSnapshot(): void {
  snapshot = readFromStorage();
}

// 模块加载时初始化快照
if (typeof window !== 'undefined') {
  refreshSnapshot();
  // 跨标签页同步：监听 window 'storage' 事件
  window.addEventListener('storage', (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === ACTIVE_KEY) {
      refreshSnapshot();
      notify();
    }
  });
}

// ========== useSyncExternalStore 接口 ==========

/** 订阅会话变化。返回取消订阅的函数 */
export function subscribeChatSessions(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

/** 获取当前会话快照（useSyncExternalStore 所需） */
export function getChatSessionsSnapshot(): ChatSession[] {
  return snapshot;
}

/** SSR 快照（useSyncExternalStore 第三参数）：服务端恒为空数组 */
export function getChatSessionsServerSnapshot(): ChatSession[] {
  return [];
}

// ========== CRUD API ==========

/** 列出所有会话（按更新时间倒序） */
export function listChatSessions(): ChatSession[] {
  if (snapshot.length === 0 && typeof window !== 'undefined') {
    const fresh = readFromStorage();
    if (fresh.length > 0) {
      snapshot = fresh;
    }
  }
  return [...snapshot].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** 按 id 获取单个会话。未找到返回 undefined */
export function getChatSession(id: string): ChatSession | undefined {
  return snapshot.find((s) => s.id === id);
}

/**
 * 创建新会话。
 * - 未提供 title 时使用「会话 N」（N 为当前 sessions 数 + 1）
 * - 不自动激活；调用方需自行调用 setActiveChatSessionId
 */
export function createChatSession(title?: string): ChatSession {
  const now = Date.now();
  // 默认标题：会话 N
  const defaultTitle = `会话 ${snapshot.length + 1}`;
  const session: ChatSession = {
    id: generateId('sess'),
    title: title?.trim() || defaultTitle,
    messages: [],
    activeLlmConfigId: null,
    activeSkillId: null,
    createdAt: now,
    updatedAt: now,
  };

  let nextList = [...snapshot, session];
  // 容量保护：超过上限时按 updatedAt 升序丢弃最旧条目
  if (nextList.length > MAX_SESSIONS) {
    nextList = nextList
      .slice()
      .sort((a, b) => a.updatedAt - b.updatedAt)
      .slice(nextList.length - MAX_SESSIONS);
  }

  writeToStorage(nextList);
  snapshot = [...nextList];
  notify();
  return session;
}

/**
 * 保存（更新）会话。若会话不存在则忽略。
 * - 自动维护 updatedAt
 * - 容量保护：messages 超过 MAX_MESSAGES 时丢弃最旧的
 */
export function saveChatSession(session: ChatSession): void {
  const idx = snapshot.findIndex((s) => s.id === session.id);
  if (idx === -1) {
    // 不存在则视为新建追加
    let nextList = [...snapshot, { ...session, updatedAt: Date.now() }];
    if (nextList.length > MAX_SESSIONS) {
      nextList = nextList
        .slice()
        .sort((a, b) => a.updatedAt - b.updatedAt)
        .slice(nextList.length - MAX_SESSIONS);
    }
    writeToStorage(nextList);
    snapshot = [...nextList];
    notify();
    return;
  }

  // 容量保护：messages 超过上限时丢弃最旧的
  const trimmedMessages =
    session.messages.length > MAX_MESSAGES
      ? session.messages.slice(session.messages.length - MAX_MESSAGES)
      : session.messages;

  const next: ChatSession = {
    ...session,
    messages: trimmedMessages,
    updatedAt: Date.now(),
  };
  const nextList = snapshot.map((s) => (s.id === next.id ? next : s));
  writeToStorage(nextList);
  snapshot = [...nextList];
  notify();
}

/** 按 id 删除一个会话。不存在时静默忽略 */
export function deleteChatSession(id: string): void {
  const nextList = snapshot.filter((s) => s.id !== id);
  if (nextList.length === snapshot.length) return;
  writeToStorage(nextList);
  snapshot = [...nextList];
  // 若删除的是激活会话，清空激活态
  if (readActiveId() === id) {
    writeActiveId(null);
  }
  notify();
}

/** 重命名会话。不存在时静默忽略 */
export function renameChatSession(id: string, title: string): void {
  const idx = snapshot.findIndex((s) => s.id === id);
  if (idx === -1) return;
  const next: ChatSession = {
    ...snapshot[idx],
    title: title.trim() || snapshot[idx].title,
    updatedAt: Date.now(),
  };
  const nextList = snapshot.map((s) => (s.id === id ? next : s));
  writeToStorage(nextList);
  snapshot = [...nextList];
  notify();
}

/** 获取当前激活的会话 id（null 表示未激活） */
export function getActiveChatSessionId(): string | null {
  return readActiveId();
}

/** 设置当前激活的会话 id（null 清空） */
export function setActiveChatSessionId(id: string | null): void {
  writeActiveId(id);
  notify();
}
