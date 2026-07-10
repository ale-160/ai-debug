'use client';

import React, { useState } from 'react';
import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued';
import { X, GitCompare } from 'lucide-react';
import { useDebugStore } from '@/lib/debug-store';
import { useTranslation } from '@/components/I18nProvider';

interface DiffViewerProps {
  /** 要对比的两个节点 ID */
  nodeAId: string | null;
  nodeBId: string | null;
  onClose: () => void;
}

/**
 * diff 视图抽屉：对比两个节点的 assistantMessage 差异。
 * 支持 split（左右分栏）和 unified（上下合并）两种视图模式。
 * 仅在用户点击"对比"按钮后客户端渲染，不参与 SSR。
 */
export default function DiffViewer({ nodeAId, nodeBId, onClose }: DiffViewerProps) {
  const { t } = useTranslation();
  const nodes = useDebugStore((s) => s.nodes);
  const [viewMode, setViewMode] = useState<'split' | 'unified'>('split');

  if (!nodeAId || !nodeBId) return null;

  const nodeA = nodes.find((n) => n.id === nodeAId);
  const nodeB = nodes.find((n) => n.id === nodeBId);
  if (!nodeA || !nodeB) return null;

  const contentA = nodeA.data.assistantMessage || '(empty)';
  const contentB = nodeB.data.assistantMessage || '(empty)';

  // 标题：hash + summary
  const titleA = `${nodeA.data.shortHash ?? nodeA.id.slice(-7)} ${nodeA.data.summary ?? ''}`;
  const titleB = `${nodeB.data.shortHash ?? nodeB.id.slice(-7)} ${nodeB.data.summary ?? ''}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-[90%] max-w-5xl h-[80vh] flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <GitCompare size={16} className="text-blue-500" />
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              {t.compareNodes}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* 视图模式切换 */}
            <button
              onClick={() => setViewMode('split')}
              className={`px-2 py-1 text-xs rounded ${
                viewMode === 'split'
                  ? 'bg-blue-500 text-white'
                  : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
            >
              {t.diffSplit}
            </button>
            <button
              onClick={() => setViewMode('unified')}
              className={`px-2 py-1 text-xs rounded ${
                viewMode === 'unified'
                  ? 'bg-blue-500 text-white'
                  : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
            >
              {t.diffUnified}
            </button>
            <button
              onClick={onClose}
              className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              aria-label={t.close}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* 对比标题 */}
        <div className="flex items-center gap-4 px-4 py-2 text-xs text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-700">
          <span>
            A: <code className="font-mono">{titleA}</code>
          </span>
          <span>→</span>
          <span>
            B: <code className="font-mono">{titleB}</code>
          </span>
        </div>

        {/* diff 内容 */}
        <div className="flex-1 overflow-auto">
          <ReactDiffViewer
            oldValue={contentA}
            newValue={contentB}
            splitView={viewMode === 'split'}
            compareMethod={DiffMethod.WORDS}
            useDarkTheme={document.documentElement.classList.contains('dark')}
            hideLineNumbers={false}
            styles={{
              variables: {
                dark: {
                  diffViewerBackground: '#1e293b',
                  diffViewerColor: '#e2e8f0',
                },
              },
            }}
          />
        </div>
      </div>
    </div>
  );
}
