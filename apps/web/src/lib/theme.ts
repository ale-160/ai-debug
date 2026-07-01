// 主题状态管理：明/暗模式切换，SSR 安全

// 主题类型
export type Theme = "light" | "dark";

// localStorage 存储键
export const THEME_STORAGE_KEY = "ai-debug:theme";

/**
 * 从 localStorage 读取主题，默认返回 'light'。
 * SSR 环境下直接返回默认值。
 */
export function loadTheme(): Theme {
  if (typeof window === "undefined") {
    return "light";
  }
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") {
      return stored;
    }
  } catch {
    // localStorage 不可用（隐私模式等），忽略
  }
  return "light";
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
 * 在 document.documentElement 上添加/移除 `dark` class。
 * SSR 环境下为空操作。
 */
export function applyTheme(theme: Theme): void {
  if (typeof window === "undefined") {
    return;
  }
  const root = document.documentElement;
  if (theme === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
}

/**
 * 切换主题并持久化，返回新主题。
 * SSR 环境下返回 'light'（不产生副作用）。
 */
export function toggleTheme(): Theme {
  if (typeof window === "undefined") {
    return "light";
  }
  const current = loadTheme();
  const next: Theme = current === "light" ? "dark" : "light";
  saveTheme(next);
  applyTheme(next);
  return next;
}
