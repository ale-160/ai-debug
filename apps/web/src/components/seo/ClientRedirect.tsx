'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { LANGUAGE_STORAGE_KEY } from '@/lib/i18n-storage';

/**
 * 客户端语言检测重定向：
 * - 仅挂在英文首页 `/`，中文页 `/zh/` 不挂载（单向跳转）
 * - 如果用户已设置语言偏好（localStorage），尊重其选择
 * - 如果未设置过且浏览器首选中文，自动跳转到 `/zh/`
 * - 使用 router.replace 避免在历史记录中留下跳转前的 `/`
 */
export default function ClientRedirect() {
  const router = useRouter();

  useEffect(() => {
    // 1. 优先尊重用户已设置的语言偏好
    let savedLang: string | null = null;
    try {
      savedLang = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    } catch {
      // localStorage 不可用时跳过
    }
    if (savedLang === 'zh' || savedLang === 'en') {
      if (savedLang === 'zh') {
        router.replace('/zh');
      }
      return;
    }

    // 2. 没设置过 + 浏览器首选中文 → 自动跳 /zh
    const browserLang = navigator.language || '';
    if (browserLang.toLowerCase().startsWith('zh')) {
      router.replace('/zh');
    }
  }, [router]);

  return null;
}
