'use client';

import { useEffect, useState } from 'react';
import DebugFlowEditor from '@/components/node-flow/DebugFlowEditor';
import { useDebugStore, migrateLegacyProjectsKey } from '@/lib/debug-store';
import type { Language } from '@/data/i18n';

/**
 * 编辑器加载器：
 * 使用 mounted 模式替代 dynamic ssr:false，
 * 确保 lang prop 直接传递，不经过动态导入序列化。
 * SSR 阶段渲染骨架屏，客户端挂载后才渲染编辑器（ReactFlow 不支持 SSR）。
 *
 * persist 接管后：客户端挂载时先迁移旧 key，再手动 rehydrate store，
 * 完成后再渲染编辑器，确保 projects/currentProjectId 从 localStorage 恢复。
 *
 * 5.12.3 优化：rehydrate 用 requestIdleCallback 包裹，让出首帧给骨架屏渲染。
 * - 原 rehydrate 在 useEffect 首帧同步读取 localStorage（persist 同步存储），
 *   阻塞 ~5-15ms，导致骨架屏延后绘制
 * - 改为 scheduleIdle 后，骨架屏先绘制一帧，rehydrate 在下一个空闲帧执行
 * - timeout: 500ms 兜底，避免空闲期迟迟不触发导致编辑器无法加载
 * - fallback：不支持 requestIdleCallback 的环境用 setTimeout(0)
 */
export default function DebugFlowEditorLoader({ lang }: { lang: Language }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // 迁移旧 key ai-debug:network-projects → ai-debug-store（一次性，仅旧 key 有数据时）
    migrateLegacyProjectsKey();

    // 5.12.3：rehydrate 延迟到 idle 帧，让骨架屏先绘制
    const runRehydrate = () => {
      // 手动 rehydrate：persist 配置了 skipHydration:true，需在此触发
      // rehydrate 可能返回 void（同步存储）或 Promise（异步存储），用 Promise.resolve 兼容
      Promise.resolve(useDebugStore.persist.rehydrate()).then(() => {
        setMounted(true);
      });
    };

    let handle: number;
    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
      handle = window.requestIdleCallback(runRehydrate, { timeout: 500 }) as unknown as number;
      return () => {
        if (typeof window.cancelIdleCallback === 'function') {
          window.cancelIdleCallback(handle);
        }
      };
    }
    // SSR / 旧浏览器 fallback
    handle = window.setTimeout(runRehydrate, 0) as unknown as number;
    return () => window.clearTimeout(handle);
  }, []);

  if (!mounted) {
    return (
      <div className="h-screen flex flex-col bg-slate-100 dark:bg-slate-950">
        {/* 顶部导航栏骨架 */}
        <div className="h-14 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700 flex items-center px-4 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
            <div className="h-4 w-20 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
          </div>
          <div className="ml-auto flex gap-1">
            <div className="w-8 h-8 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
            <div className="w-8 h-8 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
          </div>
        </div>
        {/* 内容区骨架：侧边栏 + 画布 spinner */}
        <div className="flex-1 flex overflow-hidden">
          <div className="w-64 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-700 p-4 shrink-0">
            <div className="h-6 w-32 bg-slate-100 dark:bg-slate-800 rounded animate-pulse mb-3" />
            <div className="h-4 w-full bg-slate-100 dark:bg-slate-800 rounded animate-pulse mb-2" />
            <div className="h-4 w-3/4 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
          </div>
          <div className="flex-1 flex flex-col items-center justify-center gap-3">
            <div className="h-6 w-6 border-2 border-slate-200 dark:border-slate-700 border-t-violet-500 rounded-full animate-spin" />
            <span className="text-xs text-slate-400">
              {lang === 'zh' ? '加载蛛网编辑器...' : 'Loading editor...'}
            </span>
          </div>
        </div>
      </div>
    );
  }

  return <DebugFlowEditor lang={lang} />;
}
