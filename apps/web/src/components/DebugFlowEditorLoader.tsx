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
      <div className="flex h-screen w-screen items-center justify-center bg-slate-100 dark:bg-slate-950">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-violet-500" />
          <span className="text-sm text-slate-500">
            {lang === 'zh' ? '加载蛛网编辑器...' : 'Loading editor...'}
          </span>
        </div>
      </div>
    );
  }

  return <DebugFlowEditor lang={lang} />;
}
