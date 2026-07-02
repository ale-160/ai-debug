'use client';

import dynamic from 'next/dynamic';
import type { Language } from '@/data/i18n';

const DebugFlowEditor = dynamic(() => import('@/components/node-flow/DebugFlowEditor'), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen w-screen items-center justify-center bg-slate-100 dark:bg-slate-950">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-violet-500" />
        <span className="text-sm text-slate-500">Loading...</span>
      </div>
    </div>
  ),
});

export default function DebugFlowEditorLoader({ lang }: { lang: Language }) {
  return <DebugFlowEditor lang={lang} />;
}
