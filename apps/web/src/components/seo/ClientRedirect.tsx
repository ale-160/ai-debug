'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LANGUAGE_STORAGE_KEY } from '@/lib/i18n-storage';

/**
 * 客户端语言检测重定向：
 * - 仅挂在英文首页 `/`，中文页 `/zh/` 不挂载（单向跳转）
 * - 如果用户主动切换过语言（localStorage 有值），尊重其选择
 * - 如果未设置过且浏览器首选中文，自动跳转到 `/zh/`
 * - 使用 router.replace 避免在历史记录中留下跳转前的 `/`
 * - 跳转期间 ready=false 返回 null，避免英文内容闪烁
 */
export default function ClientRedirect() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // 1. 检查用户是否主动切换过语言
    let savedLang: string | null = null;
    try {
      savedLang = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    } catch {
      // localStorage 不可用时跳过
    }

    // 用户主动选择过中文 → 跳转 /zh/，ready 保持 false 不渲染英文页
    if (savedLang === 'zh') {
      router.replace('/zh');
      return;
    }

    // 用户主动选择过英文 → 留在 /，ready=true 允许渲染
    if (savedLang === 'en') {
      setReady(true);
      return;
    }

    // 2. 未设置过 → 根据浏览器语言自动判断
    const browserLang = navigator.language || '';
    if (browserLang.toLowerCase().startsWith('zh')) {
      router.replace('/zh');
      return; // ready 保持 false，跳转期间不渲染英文页
    }
    setReady(true);
  }, [router]);

  // 跳转中返回 null，避免英文页内容闪烁
  if (!ready) return null;
  return null;
}
