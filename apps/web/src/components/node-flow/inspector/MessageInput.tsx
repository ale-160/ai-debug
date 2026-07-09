'use client';

import { Loader2, Send, Ban, RotateCcw, RefreshCw, EyeOff, ScanSearch } from 'lucide-react';
import { useTranslation } from '@/components/I18nProvider';

interface MessageInputProps {
  /** 输入框内容 */
  input: string;
  /** 输入框内容变更 */
  onInputChange: (v: string) => void;
  /** 键盘事件（Enter 提交） */
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  /** 是否已弃用 */
  isAbandoned: boolean;
  /** 是否已忽略 */
  isIgnored: boolean;
  /** 是否运行中 */
  isRunning: boolean;
  /** 继续追问按钮禁用 */
  actionDisabled: boolean;
  /** 重新生成按钮禁用 */
  regenerateDisabled: boolean;
  /** 是否正在检测冲突 */
  checkingConflict: boolean;
  /** 是否为合并节点（影响冲突检测 tooltip） */
  hasMergeSources: boolean;
  /** 继续追问 */
  onContinueQuestion: () => void;
  /** 重新生成 */
  onRegenerate: () => void;
  /** 弃用支线 */
  onAbandon: () => void;
  /** 恢复支线 */
  onReactivate: () => void;
  /** 忽略节点 */
  onIgnore: () => void;
  /** 取消忽略 */
  onUnignore: () => void;
  /** 手动检测冲突 */
  onCheckConflict: () => void;
}

/** 底部输入区 + 操作按钮：继续追问 / 重新生成 / 弃用·恢复 / 忽略·取消忽略 / 冲突检测 */
export default function MessageInput({
  input,
  onInputChange,
  onKeyDown,
  isAbandoned,
  isIgnored,
  isRunning,
  actionDisabled,
  regenerateDisabled,
  checkingConflict,
  hasMergeSources,
  onContinueQuestion,
  onRegenerate,
  onAbandon,
  onReactivate,
  onIgnore,
  onUnignore,
  onCheckConflict,
}: MessageInputProps) {
  const { t } = useTranslation();
  return (
    <div className="p-3 border-t border-slate-100 dark:border-slate-700">
      {isAbandoned && (
        <div className="text-center text-sm text-slate-400 py-1 mb-2">{t.branchAbandoned}</div>
      )}
      {isIgnored && (
        <div className="text-center text-sm text-amber-500 py-1 mb-2">{t.nodeIgnored}</div>
      )}
      <textarea
        value={input}
        onChange={(e) => onInputChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={t.inputFollowUpPlaceholder}
        rows={3}
        className="w-full border border-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 rounded-lg p-2 text-sm resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
      />
      <div className="flex gap-2 mt-2">
        <button
          onClick={onContinueQuestion}
          disabled={actionDisabled}
          className="flex-1 inline-flex items-center justify-center gap-1 bg-blue-500 text-white text-sm px-3 py-1.5 rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Send size={14} />
          {t.continueQuestion}
        </button>
        <button
          onClick={onRegenerate}
          disabled={regenerateDisabled}
          title={t.regenerate}
          className="flex-1 inline-flex items-center justify-center gap-1 bg-slate-600 text-white text-sm px-3 py-1.5 rounded-md hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <RefreshCw size={14} />
          {t.regenerate}
        </button>
        {isAbandoned ? (
          <button
            onClick={onReactivate}
            className="flex-1 inline-flex items-center justify-center gap-1 bg-emerald-500 text-white text-sm px-3 py-1.5 rounded-md hover:bg-emerald-600 transition-colors"
            title={t.restoreBranch}
          >
            <RotateCcw size={14} />
            {t.restoreBranch}
          </button>
        ) : (
          <button
            onClick={onAbandon}
            className="flex-1 inline-flex items-center justify-center gap-1 bg-red-500 text-white text-sm px-3 py-1.5 rounded-md hover:bg-red-600 transition-colors"
            title={t.abandonThisBranch}
          >
            <Ban size={14} />
            {t.abandonThisBranch}
          </button>
        )}
      </div>
      {/* 忽略节点按钮：与支线操作独立，仅作用于当前节点 */}
      <div className="flex gap-2 mt-2">
        {isIgnored ? (
          <button
            onClick={onUnignore}
            className="flex-1 inline-flex items-center justify-center gap-1 bg-amber-500 text-white text-sm px-3 py-1.5 rounded-md hover:bg-amber-600 transition-colors"
            title={t.unignore}
          >
            <RotateCcw size={14} />
            {t.unignore}
          </button>
        ) : (
          <button
            onClick={onIgnore}
            disabled={isRunning || isAbandoned}
            className="flex-1 inline-flex items-center justify-center gap-1 bg-amber-100 text-amber-700 text-sm px-3 py-1.5 rounded-md hover:bg-amber-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title={t.ignoreThisNode}
          >
            <EyeOff size={14} />
            {t.ignoreThisNode}
          </button>
        )}
        {/* 手动检测当前支线冲突。
            合并节点（mergedFromIds 非空）仅检测 parentId 主干路径，
            不展开 mergedFromIds 多路 —— 此为已知限制。 */}
        <button
          onClick={onCheckConflict}
          disabled={checkingConflict || isRunning || isAbandoned}
          className="flex-1 inline-flex items-center justify-center gap-1 bg-red-100 text-red-700 text-sm px-3 py-1.5 rounded-md hover:bg-red-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title={hasMergeSources ? t.mergeNodeLimitDesc : t.detectConflict}
        >
          {checkingConflict ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <ScanSearch size={14} />
          )}
          {checkingConflict ? t.detecting : t.detectConflict}
        </button>
      </div>
    </div>
  );
}
