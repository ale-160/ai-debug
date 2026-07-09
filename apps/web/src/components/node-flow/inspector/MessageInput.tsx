'use client';

import { Loader2, Send, RefreshCw, ScanSearch } from 'lucide-react';
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
  /** 手动检测冲突 */
  onCheckConflict: () => void;
}

/** 底部输入区 + 操作按钮：继续追问 / 重新生成 / 检测冲突
 *  T025 剥离了放弃/恢复/忽略/取消忽略按钮（已迁移到 T024 浮动工具条/右键菜单） */
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
