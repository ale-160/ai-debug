'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  applyLanguage,
  loadLanguage,
  saveLanguage,
  LANGUAGE_STORAGE_KEY,
} from '@/lib/i18n-storage';
import { getStrings, formatString, type Language, type Strings } from '@/data/i18n';

interface I18nContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
  toggleLanguage: () => Language;
  t: Strings;
  tf: (key: keyof Strings, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

interface I18nProviderProps {
  children: React.ReactNode;
  /** 路由级默认语言：英文路由 / 传 'en'，中文路由 /zh/ 传 'zh' */
  defaultLang?: Language;
}

export function I18nProvider({ children, defaultLang = 'en' }: I18nProviderProps) {
  // 初始值用路由语言，避免首屏闪烁
  const [language, setLanguageState] = useState<Language>(defaultLang);

  useEffect(() => {
    // 客户端挂载后：优先读取 localStorage，没有则用路由默认语言
    const stored = loadLanguage();
    if (stored === 'zh' || stored === 'en') {
      setLanguageState(stored);
      applyLanguage(stored);
    } else {
      // 没有存储过，用路由语言作为默认值并持久化
      setLanguageState(defaultLang);
      saveLanguage(defaultLang);
      applyLanguage(defaultLang);
    }
  }, [defaultLang]);

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key !== LANGUAGE_STORAGE_KEY) return;
      const next = (e.newValue === 'en' ? 'en' : 'zh') as Language;
      setLanguageState(next);
      applyLanguage(next);
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    saveLanguage(next);
    applyLanguage(next);
  }, []);

  const toggleLanguage = useCallback(() => {
    const next: Language = language === 'zh' ? 'en' : 'zh';
    setLanguageState(next);
    saveLanguage(next);
    applyLanguage(next);
    return next;
  }, [language]);

  const t = useMemo(() => getStrings(language), [language]);

  const tf = useCallback(
    (key: keyof Strings, vars?: Record<string, string | number>) => {
      const template = t[key] as string;
      return vars ? formatString(template, vars) : template;
    },
    [t]
  );

  const value = useMemo<I18nContextValue>(
    () => ({ language, setLanguage, toggleLanguage, t, tf }),
    [language, setLanguage, toggleLanguage, t, tf]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useTranslation(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (ctx === undefined) {
    throw new Error('useTranslation must be used within I18nProvider');
  }
  return ctx;
}
