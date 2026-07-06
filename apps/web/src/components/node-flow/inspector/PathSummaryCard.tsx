'use client';

import { FileText } from 'lucide-react';
import { useTranslation } from '@/components/I18nProvider';
import { SUMMARY_THRESHOLD } from '@/lib/context-config';

interface PathSummaryCardProps {
  /** 当前节点的路径摘要（rolling summary），可能为 undefined */
  pathSummary?: string;
  /** 从根到当前节点的路径长度（含当前节点） */
  pathLength: number;
}

/**
 * 路径摘要卡片：在 Inspector 的"上下文"Tab 顶部展示当前节点的 pathSummary
 * 与混合模式状态。无 pathSummary 时显示"尚未生成"占位。
 */
export default function PathSummaryCard({
  pathSummary,
  pathLength,
}: PathSummaryCardProps) {
  const { t, tf } = useTranslation();
  const hasSummary = typeof pathSummary === 'string' && pathSummary.trim().length > 0;
  // 路径长度 > SUMMARY_THRESHOLD 时启用混合模式
  const hybridEnabled = pathLength > SUMMARY_THRESHOLD;

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
        {t.pathSummaryTitle}
      </h4>
      {/* 路径长度 + 混合模式状态徽章 */}
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="inline-flex items-center gap-1 rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-slate-600 dark:text-slate-300">
          <FileText size={10} />
          {t.pathLengthLabel}：{pathLength}
        </span>
        <span
          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 ${
            hybridEnabled
              ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
          }`}
          title={hybridEnabled ? t.hybridModeOn : t.hybridModeOff}
        >
          {hybridEnabled ? t.hybridModeOn : t.hybridModeOff}
        </span>
      </div>
      {/* 描述 + 摘要正文 / 空态 */}
      <div className="text-[11px] text-slate-400 dark:text-slate-500">
        {t.pathSummaryDesc}
      </div>
      {hasSummary ? (
        <div className="rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-2 text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words max-h-[200px] overflow-y-auto">
          {pathSummary}
        </div>
      ) : (
        <div className="text-xs text-slate-400 dark:text-slate-500 italic">
          {t.pathSummaryNotGenerated}
        </div>
      )}
      {/* 提示文案：避免在阈值边界困惑用户 */}
      {hybridEnabled && !hasSummary && (
        <div className="text-[10px] text-slate-400 dark:text-slate-500">
          {tf('pathLengthLabel')} &gt; {SUMMARY_THRESHOLD}，{t.hybridModeOn}
        </div>
      )}
    </div>
  );
}
