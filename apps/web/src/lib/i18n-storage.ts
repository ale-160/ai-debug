import type { Language } from '@/data/i18n';

export const LANGUAGE_STORAGE_KEY = 'ai-debug:language';

/** 加载已存储的语言偏好；未设置时返回 null（由调用方决定回退策略） */
export function loadLanguage(): Language | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored === 'zh' || stored === 'en') return stored;
  } catch {
    // ignore
  }
  return null;
}

export function saveLanguage(lang: Language): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  } catch {
    // ignore
  }
}

export function applyLanguage(lang: Language): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
}
