"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  applyTheme,
  loadTheme,
  saveTheme,
  toggleTheme as toggleThemeFn,
  type Theme,
  THEME_STORAGE_KEY,
} from "@/lib/theme";

// 主题上下文类型
interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

// 主题上下文
const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

interface ThemeProviderProps {
  children: React.ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  // 初始值用 'light'，避免 SSR 与客户端不一致
  const [theme, setThemeState] = useState<Theme>("light");

  // mount 时读取已持久化的主题并应用
  useEffect(() => {
    const initial = loadTheme();
    setThemeState(initial);
    applyTheme(initial);
  }, []);

  // 监听 localStorage 的 storage 事件，跨标签页同步
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key !== THEME_STORAGE_KEY) {
        return;
      }
      const next = e.newValue === "dark" ? "dark" : "light";
      setThemeState(next);
      applyTheme(next);
    };
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  // 设置主题：更新状态、持久化、应用 DOM
  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    saveTheme(next);
    applyTheme(next);
  }, []);

  // 切换主题：复用 lib 中的 toggleTheme（已处理持久化与 DOM）
  const toggleTheme = useCallback(() => {
    const next = toggleThemeFn();
    setThemeState(next);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme, toggleTheme }),
    [theme, setTheme, toggleTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

/**
 * 主题 Hook，必须在 ThemeProvider 内部使用。
 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (ctx === undefined) {
    throw new Error("useTheme 必须在 ThemeProvider 内部使用");
  }
  return ctx;
}
