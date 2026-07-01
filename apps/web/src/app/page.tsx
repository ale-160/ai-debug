'use client';

import dynamic from 'next/dynamic';

// 编辑器组件不参与 SSR：
// 1. ReactFlow 等重型依赖拆分为独立 chunk，首屏不加载
// 2. 整个编辑器客户端渲染，避免依赖 localStorage 的初始 state 导致 hydration mismatch
// 3. chunk 加载期间显示骨架，避免白屏
const DebugFlowEditor = dynamic(() => import('@/components/node-flow/DebugFlowEditor'), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen w-screen items-center justify-center bg-slate-100 dark:bg-slate-950">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-violet-500" />
        <span className="text-sm text-slate-500">加载蛛网编辑器...</span>
      </div>
    </div>
  ),
});

export default function Home() {
  return <DebugFlowEditor />;
}
