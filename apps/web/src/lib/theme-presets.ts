// ============================================================
// AI Debug — 主题色预设（外观完善）
//
// 提供若干预设主题色，用户在设置 - 外观 tab 中切换。
// 切换时通过修改 :root 上的 --primary / --ring CSS 变量动态生效，
// 不破坏 light/dark 主题切换机制。
//
// 设计：
// - 每个 preset 含 light/dark 两套 primary + ring
// - accentColor 用于 UI 渲染色块预览
// - 持久化到 localStorage 'ai-debug:theme-preset'
// - 默认 'blue'（与 globals.css 初始 --primary 一致，向后兼容）
// ============================================================

/** 主题色预设 id */
export type ThemePresetId = 'blue' | 'violet' | 'emerald' | 'amber' | 'pink' | 'cyan';

/** 单个预设定义 */
export interface ThemePreset {
  id: ThemePresetId;
  /** 中英文标签（i18n key 在 i18n.ts 中维护） */
  labelKey: string;
  /** 预览色块（亮色场景的 primary） */
  swatch: string;
  /** 亮色模式下的 primary 颜色 */
  light: { primary: string; ring: string };
  /** 暗色模式下的 primary 颜色 */
  dark: { primary: string; ring: string };
}

/** 全部预设（顺序即 UI 展示顺序） */
export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'blue',
    labelKey: 'themePresetBlue',
    swatch: '#2563eb',
    light: { primary: '#2563eb', ring: '#2563eb' },
    dark: { primary: '#3b82f6', ring: '#3b82f6' },
  },
  {
    id: 'violet',
    labelKey: 'themePresetViolet',
    swatch: '#7c3aed',
    light: { primary: '#7c3aed', ring: '#7c3aed' },
    dark: { primary: '#8b5cf6', ring: '#8b5cf6' },
  },
  {
    id: 'emerald',
    labelKey: 'themePresetEmerald',
    swatch: '#059669',
    light: { primary: '#059669', ring: '#059669' },
    dark: { primary: '#10b981', ring: '#10b981' },
  },
  {
    id: 'amber',
    labelKey: 'themePresetAmber',
    swatch: '#d97706',
    light: { primary: '#d97706', ring: '#d97706' },
    dark: { primary: '#f59e0b', ring: '#f59e0b' },
  },
  {
    id: 'pink',
    labelKey: 'themePresetPink',
    swatch: '#db2777',
    light: { primary: '#db2777', ring: '#db2777' },
    dark: { primary: '#ec4899', ring: '#ec4899' },
  },
  {
    id: 'cyan',
    labelKey: 'themePresetCyan',
    swatch: '#0891b2',
    light: { primary: '#0891b2', ring: '#0891b2' },
    dark: { primary: '#06b6d4', ring: '#06b6d4' },
  },
];

/** localStorage 存储键 */
export const THEME_PRESET_STORAGE_KEY = 'ai-debug:theme-preset';

/** 默认预设（与 globals.css 初始 --primary 值一致） */
export const DEFAULT_THEME_PRESET: ThemePresetId = 'blue';

/**
 * 从 localStorage 读取主题色预设 id。
 * SSR 或读取失败时返回默认值 'blue'。
 */
export function loadThemePresetId(): ThemePresetId {
  if (typeof window === 'undefined') return DEFAULT_THEME_PRESET;
  try {
    const stored = window.localStorage.getItem(THEME_PRESET_STORAGE_KEY);
    if (stored && THEME_PRESETS.some((p) => p.id === stored)) {
      return stored as ThemePresetId;
    }
  } catch {
    // localStorage 不可用，忽略
  }
  return DEFAULT_THEME_PRESET;
}

/**
 * 持久化主题色预设 id 到 localStorage。
 * SSR 环境下为空操作。
 */
export function saveThemePresetId(id: ThemePresetId): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(THEME_PRESET_STORAGE_KEY, id);
  } catch {
    // 容量超限或隐私模式，忽略
  }
}

/**
 * 按 id 查找预设定义。未找到返回 undefined（理论上不应发生）。
 */
export function getThemePreset(id: ThemePresetId): ThemePreset | undefined {
  return THEME_PRESETS.find((p) => p.id === id);
}

/**
 * 应用主题色预设到 document.documentElement。
 * 根据当前暗色模式（document.documentElement.classList 包含 'dark'）
 * 选择 light/dark 配色覆盖 --primary 和 --ring CSS 变量。
 *
 * 注意：此函数依赖 DOM，必须在浏览器环境调用。
 * SSR 环境下为空操作。
 */
export function applyThemePreset(id: ThemePresetId): void {
  if (typeof window === 'undefined') return;
  const preset = getThemePreset(id);
  if (!preset) return;
  const root = document.documentElement;
  const isDark = root.classList.contains('dark');
  const palette = isDark ? preset.dark : preset.light;
  root.style.setProperty('--primary', palette.primary);
  root.style.setProperty('--ring', palette.ring);
}

/**
 * 切换主题色预设：持久化 + 应用。
 * 返回新预设 id。
 */
export function setThemePreset(id: ThemePresetId): ThemePresetId {
  saveThemePresetId(id);
  applyThemePreset(id);
  return id;
}
