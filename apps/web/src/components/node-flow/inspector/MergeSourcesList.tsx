'use client';

import { GitMerge, Info } from 'lucide-react';
import type { Node } from 'reactflow';
import { useTranslation } from '@/components/I18nProvider';
import type { TurnNodeData } from '../types';

/** 取 userMessage 前 10 字作为来源摘要，超出追加省略号 */
function summarize(text: string): string {
  const t = text.trim();
  return t.length > 10 ? `${t.slice(0, 10)}...` : t;
}

interface MergeSourcesListProps {
  /** 合并来源节点 ID 列表 */
  mergedFromIds: string[];
  /** 当前所有节点（用于查找来源节点详情） */
  nodes: Node<TurnNodeData>[];
  /** 点击某个来源节点跳转 */
  onSelect: (id: string) => void;
}

/** 合并来源列表：仅合并节点显示，可点击跳转到来源节点，附冲突检测限制说明 */
export default function MergeSourcesList({
  mergedFromIds,
  nodes,
  onSelect,
}: MergeSourcesListProps) {
  const { t, tf } = useTranslation();
  if (mergedFromIds.length === 0) return null;
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold text-violet-500 uppercase tracking-wide">
        {tf('mergeSources', { count: mergedFromIds.length })}
      </h4>
      {mergedFromIds.map((id, i) => {
        const src = nodes.find((n) => n.id === id);
        if (!src) {
          return (
            <div
              key={id}
              className="rounded-lg border border-slate-200 dark:border-slate-700 p-2 text-xs text-slate-400 italic"
            >
              {tf('branchN', { n: i + 1 })}（{t.nodeDeleted}）
            </div>
          );
        }
        return (
          <button
            key={id}
            onClick={() => onSelect(id)}
            className="w-full text-left rounded-lg border border-violet-200 dark:border-violet-700 hover:border-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20 p-2 transition-colors"
          >
            <div className="flex items-center gap-1.5">
              <GitMerge size={12} className="text-violet-500 shrink-0" />
              <span className="text-[11px] text-violet-500 shrink-0">
                {tf('branchN', { n: i + 1 })}
              </span>
            </div>
            <div className="text-sm text-slate-700 dark:text-slate-300 mt-0.5 truncate">
              {src.data.summary ? src.data.summary : summarize(src.data.userMessage)}
            </div>
          </button>
        );
      })}
      {/* 合并节点冲突检测限制说明 */}
      <div className="flex items-start gap-1.5 text-[11px] text-slate-400 bg-slate-50 dark:bg-slate-800 dark:border-slate-700 border border-slate-100 rounded p-1.5">
        <Info size={11} className="shrink-0 mt-0.5" />
        <span>{t.conflictLimitNote}</span>
      </div>
    </div>
  );
}
