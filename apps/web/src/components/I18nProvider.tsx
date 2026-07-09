'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { applyLanguage, saveLanguage, LANGUAGE_STORAGE_KEY } from '@/lib/i18n-storage';
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
  // 路由语言作为初始值，确保首屏与 URL 一致
  const [language, setLanguageState] = useState<Language>(defaultLang);

  useEffect(() => {
    // 路由语言优先：/zh/ 始终显示中文，/ 始终显示英文
    // localStorage 仅在用户主动切换语言时更新（切换会同时跳转路由）
    setLanguageState(defaultLang);
    applyLanguage(defaultLang);
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
    [t],
  );

  const value = useMemo<I18nContextValue>(
    () => ({ language, setLanguage, toggleLanguage, t, tf }),
    [language, setLanguage, toggleLanguage, t, tf],
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
