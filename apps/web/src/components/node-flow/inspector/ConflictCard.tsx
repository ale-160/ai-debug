'use client';

import { AlertTriangle, Ban, ScanSearch, EyeOff, Scale } from 'lucide-react';
import { useTranslation } from '@/components/I18nProvider';

interface ConflictCardProps {
  /** 冲突标注文案 */
  conflictNote: string;
  /** 是否已弃用 */
  isAbandoned: boolean;
  /** 是否已忽略 */
  isIgnored: boolean;
  /** 弃用支线 */
  onAbandon: () => void;
  /** 裁剪节点（含子树） */
  onPrune: () => void;
  /** 忽略节点 */
  onIgnore: () => void;
  /** 清除冲突标注 */
  onClear: () => void;
  /** 人工决策：弹出 ConflictDecisionModal 让用户选择处理方式 */
  onManualDecision?: () => void;
}

/** 冲突标注卡片：当前节点被标记冲突时显示，提供处理操作（弃用/裁剪/忽略/清除/人工决策） */
export default function ConflictCard({
  conflictNote,
  isAbandoned,
  isIgnored,
  onAbandon,
  onPrune,
  onIgnore,
  onClear,
  onManualDecision,
}: ConflictCardProps) {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-700 p-3 space-y-2">
      <div className="flex items-start gap-2">
        <AlertTriangle size={14} className="text-red-500 shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="text-xs font-semibold text-red-700 dark:text-red-300 uppercase tracking-wide mb-1">
            {t.conflictLabel}
          </div>
          <div className="text-sm text-red-700 dark:text-red-300 break-words">{conflictNote}</div>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 pt-1">
        <button
          onClick={onAbandon}
          disabled={isAbandoned}
          className="inline-flex items-center gap-1 rounded bg-red-500 px-2 py-1 text-xs text-white hover:bg-red-600 disabled:opacity-50"
        >
          <Ban size={12} />
          {t.abandonBranch}
        </button>
        <button
          onClick={onPrune}
          className="inline-flex items-center gap-1 rounded bg-orange-500 px-2 py-1 text-xs text-white hover:bg-orange-600"
        >
          <ScanSearch size={12} />
          {t.pruneNode}
        </button>
        <button
          onClick={onIgnore}
          disabled={isIgnored}
          className="inline-flex items-center gap-1 rounded bg-amber-500 px-2 py-1 text-xs text-white hover:bg-amber-600 disabled:opacity-50"
        >
          <EyeOff size={12} />
          {t.ignoreNode}
        </button>
        <button
          onClick={onClear}
          className="inline-flex items-center gap-1 rounded bg-slate-200 dark:bg-slate-700 dark:text-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-300 dark:hover:bg-slate-600"
        >
          {t.clearLabel}
        </button>
        {/* 人工决策入口：触发 ConflictDecisionModal 让用户在 4 种处理方式中选择 */}
        {onManualDecision && (
          <button
            onClick={onManualDecision}
            className="inline-flex items-center gap-1 rounded bg-violet-500 px-2 py-1 text-xs text-white hover:bg-violet-600"
          >
            <Scale size={12} />
            {t.conflictDecision}
          </button>
        )}
      </div>
    </div>
  );
}
