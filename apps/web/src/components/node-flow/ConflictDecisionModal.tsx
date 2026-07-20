'use client';

// ============================================================
// AI Debug — P2-3 冲突决策 Modal
//
// 当 conflict-engine 检测到支线冲突后，由 DebugFlowEditor 弹出本 Modal。
// 用户可在「保留 A / 保留 B / 合并两者 / 忽略」四种处理方式中选择，
// 决策结果通过 onDecide 回调上抛，由父组件 emit 到 hitl-event-bus 唤醒等待方。
// 样式参考 SnapshotManager.tsx（固定遮罩 + 居中卡片 + 深色模式适配）。
// ============================================================

import { X, AlertTriangle, GitMerge, EyeOff, Check } from 'lucide-react';
import { useTranslation } from '@/components/I18nProvider';
import { formatString } from '@/data/i18n';
import type { ConflictDecisionPayload } from './event-bus';

/** 用户可选的四种决策 */
export type ConflictDecision = 'keep-a' | 'keep-b' | 'merge' | 'ignore';

interface ConflictDecisionModalProps {
  /** 是否打开；为 false 时返回 null */
  open: boolean;
  /** 待决策的冲突信息；为 null 时不渲染 */
  conflict: ConflictDecisionPayload | null;
  /** 用户选择决策后回调；父组件负责 emit 到 hitl-event-bus */
  onDecide: (decision: ConflictDecision) => void;
  /** 关闭 Modal（点遮罩 / 关闭按钮 / 选完决策后调用） */
  onClose: () => void;
}

/** 冲突决策 Modal：四个按钮对应四种处理方式，附超时提示 */
export function ConflictDecisionModal({
  open,
  conflict,
  onDecide,
  onClose,
}: ConflictDecisionModalProps) {
  const { t, tf } = useTranslation();

  if (!open || !conflict) return null;

  // 分支 A / B 标签：复用现有 branchN 模板，避免新增 i18n key
  const branchALabel = tf('branchN', { n: 'A' });
  const branchBLabel = tf('branchN', { n: 'B' });

  /** 选择决策：调用 onDecide 后关闭 Modal */
  const handleDecide = (decision: ConflictDecision) => {
    onDecide(decision);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md flex flex-col bg-white dark:bg-[#1c1c1e] rounded-lg shadow-2xl border border-slate-200 dark:border-white/10 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-white/10">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-red-500" />
            <h2 className="text-sm font-semibold text-slate-800 dark:text-white/90">
              {t.conflictDecisionTitle}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label={t.close}
            className="text-slate-400 hover:text-slate-600 dark:text-white/40 dark:hover:text-white/70"
          >
            <X size={18} />
          </button>
        </div>

        {/* 描述区：说明 + 冲突信息 */}
        <div className="px-4 py-3 space-y-2 border-b border-slate-200 dark:border-white/10 bg-slate-50/50 dark:bg-white/[0.02]">
          <p className="text-sm text-slate-700 dark:text-slate-200">{t.conflictDescription}</p>
          <div className="rounded border border-red-200 dark:border-red-700/60 bg-red-50 dark:bg-red-900/20 px-2.5 py-1.5">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-red-700 dark:text-red-300 uppercase tracking-wide mb-0.5">
              <AlertTriangle size={11} />
              {t.conflictLabel}
            </div>
            <div className="text-xs text-red-700 dark:text-red-300 break-words">
              {conflict.description}
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-medium">{branchALabel}:</span>
            <span className="text-slate-700 dark:text-slate-200">{conflict.branchAName}</span>
            <span className="text-slate-300 dark:text-slate-600">vs</span>
            <span className="font-medium">{branchBLabel}:</span>
            <span className="text-slate-700 dark:text-slate-200">{conflict.branchBName}</span>
          </div>
        </div>

        {/* 按钮区：四种决策 */}
        <div className="p-4 grid grid-cols-2 gap-2">
          {/* 保留 A：保留前序/主干 */}
          <button
            onClick={() => handleDecide('keep-a')}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 transition-colors"
          >
            <Check size={14} />
            {formatString(t.conflictKeepA, { name: conflict.branchAName })}
          </button>
          {/* 保留 B：保留当前冲突节点所属分支 */}
          <button
            onClick={() => handleDecide('keep-b')}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded text-sm font-medium text-white bg-violet-500 hover:bg-violet-600 transition-colors"
          >
            <Check size={14} />
            {formatString(t.conflictKeepB, { name: conflict.branchBName })}
          </button>
          {/* 合并两者：触发后续合并流程 */}
          <button
            onClick={() => handleDecide('merge')}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded text-sm font-medium text-white bg-emerald-500 hover:bg-emerald-600 transition-colors"
          >
            <GitMerge size={14} />
            {t.conflictMerge}
          </button>
          {/* 忽略：仅清除冲突标注，不做处理 */}
          <button
            onClick={() => handleDecide('ignore')}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded text-sm font-medium text-slate-600 dark:text-slate-200 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors"
          >
            <EyeOff size={14} />
            {t.conflictIgnore}
          </button>
        </div>

        {/* 超时提示 */}
        <div className="px-4 pb-3 -mt-1">
          <p className="text-[11px] text-slate-400 dark:text-slate-500 text-center">
            {t.conflictTimeoutHint}
          </p>
        </div>
      </div>
    </div>
  );
}

export default ConflictDecisionModal;
