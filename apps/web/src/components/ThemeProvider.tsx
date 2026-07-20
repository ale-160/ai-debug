'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  applyTheme,
  loadTheme,
  resolveTheme,
  saveTheme,
  toggleTheme as toggleThemeFn,
  type Theme,
  THEME_STORAGE_KEY,
} from '@/lib/theme';
import {
  applyThemePreset,
  loadThemePresetId,
  THEME_PRESET_STORAGE_KEY,
} from '@/lib/theme-presets';

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
  // 初始值用 'system'，与 loadTheme 默认值一致；SSR 与首次 CSR 都用此值，避免 hydration mismatch
  const [theme, setThemeState] = useState<Theme>('system');

  // mount 时读取已持久化的主题并应用
  useEffect(() => {
    const initial = loadTheme();
    setThemeState(initial);
    applyTheme(initial);
    // 同步应用主题色预设（覆盖 --primary / --ring CSS 变量）
    applyThemePreset(loadThemePresetId());
  }, []);

  // 监听 localStorage 的 storage 事件，跨标签页同步主题与主题色预设
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === THEME_STORAGE_KEY) {
        const next: Theme =
          e.newValue === 'light' || e.newValue === 'dark' || e.newValue === 'system'
            ? (e.newValue as Theme)
            : 'system';
        setThemeState(next);
        applyTheme(next);
        // 主题模式切换后需重新应用预设（dark/light 下预设配色不同）
        applyThemePreset(loadThemePresetId());
      } else if (e.key === THEME_PRESET_STORAGE_KEY) {
        // 主题色预设跨标签页同步
        applyThemePreset(loadThemePresetId());
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  // system 模式下监听系统主题变化，实时响应
  useEffect(() => {
    if (theme !== 'system' || typeof window === 'undefined' || !window.matchMedia) {
      return;
    }
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    // 系统主题变化时同时重新应用主题预设（预设 light/dark 配色不同）
    const handleChange = () => {
      applyTheme('system');
      applyThemePreset(loadThemePresetId());
    };
    // 标准浏览器支持 addEventListener，旧 Safari 用 addListener
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', handleChange);
      return () => mql.removeEventListener('change', handleChange);
    }
    // 兼容旧 Safari
    if (typeof mql.addListener === 'function') {
      mql.addListener(handleChange);
      return () => mql.removeListener(handleChange);
    }
  }, [theme]);

  // 设置主题：更新状态、持久化、应用 DOM；切换后需重新应用预设（预设 light/dark 配色不同）
  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    saveTheme(next);
    applyTheme(next);
    applyThemePreset(loadThemePresetId());
  }, []);

  // 切换主题：复用 lib 中的 toggleTheme（已处理持久化与 DOM），再重新应用预设
  const toggleTheme = useCallback(() => {
    const next = toggleThemeFn();
    setThemeState(next);
    applyThemePreset(loadThemePresetId());
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme, toggleTheme }),
    [theme, setTheme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * 主题 Hook，必须在 ThemeProvider 内部使用。
 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (ctx === undefined) {
    throw new Error('useTheme 必须在 ThemeProvider 内部使用');
  }
  return ctx;
}

// 重导出 resolveTheme 供组件层判断实际渲染主题（如主题按钮图标）
export { resolveTheme };
