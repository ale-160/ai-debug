// 主题状态管理：明/暗/跟随系统三态切换，SSR 安全

// 主题类型：light 显式亮、dark 显式暗、system 跟随系统偏好
export type Theme = "light" | "dark" | "system";

// localStorage 存储键
export const THEME_STORAGE_KEY = "ai-debug:theme";

/**
 * 从 localStorage 读取主题，默认返回 'system'。
 * SSR 环境下直接返回默认值。
 */
export function loadTheme(): Theme {
  if (typeof window === "undefined") {
    return "system";
  }
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
  } catch {
    // localStorage 不可用（隐私模式等），忽略
  }
  return "system";
}

/**
 * 将主题写入 localStorage。
 * SSR 环境下为空操作。
 */
export function saveTheme(theme: Theme): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // localStorage 不可用，忽略
  }
}

/**
 * 根据 system 主题解析实际渲染主题（light/dark）。
 * 非 system 直接返回，system 读取 matchMedia。
 * SSR 环境下默认返回 'light'。
 */
export function resolveTheme(theme: Theme): "light" | "dark" {
  if (theme === "light" || theme === "dark") {
    return theme;
  }
  // system 分支
  if (typeof window === "undefined" || !window.matchMedia) {
    return "light";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * 在 document.documentElement 上添加/移除 `dark` class。
 * theme 为 system 时需先 resolveTheme 解析为 light/dark。
 * SSR 环境下为空操作。
 */
export function applyTheme(theme: Theme): void {
  if (typeof window === "undefined") {
    return;
  }
  const resolved = resolveTheme(theme);
  const root = document.documentElement;
  if (resolved === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
}

/**
 * 三态循环切换主题并持久化，返回新主题。
 * light → dark → system → light ...
 * SSR 环境下返回 'system'（不产生副作用）。
 */
export function toggleTheme(): Theme {
  if (typeof window === "undefined") {
    return "system";
  }
  const current = loadTheme();
  const next: Theme =
    current === "light" ? "dark" : current === "dark" ? "system" : "light";
  saveTheme(next);
  applyTheme(next);
  return next;
}
