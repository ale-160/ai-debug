'use client';

import { useEffect, useState } from 'react';
import DebugFlowEditor from '@/components/node-flow/DebugFlowEditor';
import type { Language } from '@/data/i18n';

/**
 * 编辑器加载器：
 * 使用 mounted 模式替代 dynamic ssr:false，
 * 确保 lang prop 直接传递，不经过动态导入序列化。
 * SSR 阶段渲染骨架屏，客户端挂载后才渲染编辑器（ReactFlow 不支持 SSR）。
 */
export default function DebugFlowEditorLoader({ lang }: { lang: Language }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
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
