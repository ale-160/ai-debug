'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Loader2, Send, RefreshCw, ScanSearch, Paperclip, Braces } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '@/components/I18nProvider';
import type { NodeAttachment } from '../types';
import { processFiles, MAX_FILE_SIZE } from '@/lib/attachment-helpers';
import AttachmentChips from './AttachmentChips';

/** P2-2 变量池：可引用节点条目（id 用于构造 {{#id.text#}}，label 用于下拉显示） */
export interface VariableRefNode {
  id: string;
  label: string;
}

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
  /** 当前附件列表 */
  attachments: NodeAttachment[];
  /** 附件变更回调 */
  onAttachmentsChange: (attachments: NodeAttachment[]) => void;
  /** 继续追问 */
  onContinueQuestion: () => void;
  /** 重新生成 */
  onRegenerate: () => void;
  /** 手动检测冲突 */
  onCheckConflict: () => void;
  /** P2-2 变量池：是否显示 {{#nodeId.text#}} 引用提示文案 */
  showVariableHint?: boolean;
  /** P2-2 变量池：可引用的最近节点列表（用于「插入变量引用」下拉） */
  variableRefNodes?: VariableRefNode[];
}

/** 底部输入区 + 操作按钮：继续追问 / 重新生成 / 检测冲突 / 添加附件
 *  T025 剥离了放弃/恢复/忽略/取消忽略按钮（已迁移到 T024 浮动工具条/右键菜单）
 *  PR-2 增加多模态附件支持：预览区 / 拖拽 / 粘贴 / 文件选择 */
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
  attachments,
  onAttachmentsChange,
  onContinueQuestion,
  onRegenerate,
  onCheckConflict,
  showVariableHint = false,
  variableRefNodes = [],
}: MessageInputProps) {
  const { t, tf } = useTranslation();
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  /** P2-2 变量池：插入变量引用下拉开关 */
  const [isVariablePopoverOpen, setIsVariablePopoverOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 用 ref 缓存 attachments，避免 handler 频繁重建（useEffect 同步，避免 render 阶段写 ref）
  const attachmentsRef = useRef(attachments);
  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  /** P2-2 变量池：点击外部关闭变量引用下拉 */
  useEffect(() => {
    if (!isVariablePopoverOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-variable-popover]')) {
        setIsVariablePopoverOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isVariablePopoverOpen]);

  /** P2-2 变量池：把 {{#nodeId.text#}} 追加到输入框末尾并关闭下拉 */
  const handleInsertVariableRef = useCallback(
    (nodeId: string) => {
      const ref = `{{#${nodeId}.text#}}`;
      // 当前输入末尾若无空白，补一个空格分隔
      const separator = input.length > 0 && !/\s$/.test(input) ? ' ' : '';
      onInputChange(`${input}${separator}${ref}`);
      setIsVariablePopoverOpen(false);
    },
    [input, onInputChange],
  );

  /** 处理文件列表：调用 processFiles 合并到现有附件，并对 failed 项 toast 提示 */
  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      setIsProcessing(true);
      try {
        const newAtts = await processFiles(files);
        onAttachmentsChange([...attachmentsRef.current, ...newAtts]);
        // 提示失败文件（大小超限 / 解析失败）
        const failed = newAtts.filter((a) => a.parseStatus === 'failed');
        if (failed.length > 0) {
          const tooLarge = failed.filter((a) => a.parseError?.includes('exceeds'));
          if (tooLarge.length > 0) {
            toast.warning(
              tf('attachmentTooLarge', { max: Math.floor(MAX_FILE_SIZE / 1024 / 1024) }),
            );
          } else {
            for (const f of failed) {
              toast.error(tf('attachmentParseFailed', { message: f.parseError ?? '' }));
            }
          }
        }
      } finally {
        setIsProcessing(false);
      }
    },
    [onAttachmentsChange, tf],
  );

  const removeAttachment = useCallback(
    (id: string) => {
      onAttachmentsChange(attachmentsRef.current.filter((a) => a.id !== id));
    },
    [onAttachmentsChange],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        void addFiles(files);
      }
    },
    [addFiles],
  );

  /** 粘贴事件：提取剪贴板中的图片文件 */
  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageFiles: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault();
        void addFiles(imageFiles);
      }
    },
    [addFiles],
  );

  const handleFileInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      await addFiles(files);
      // 清空以便相同文件可重新选择
      e.target.value = '';
    },
    [addFiles],
  );

  return (
    <div className="p-3 border-t border-slate-100 dark:border-slate-700">
      {isAbandoned && (
        <div className="text-center text-sm text-slate-400 py-1 mb-2">{t.branchAbandoned}</div>
      )}
      {isIgnored && (
        <div className="text-center text-sm text-amber-500 py-1 mb-2">{t.nodeIgnored}</div>
      )}

      {/* 附件预览区（有附件时显示） */}
      {attachments.length > 0 && (
        <div className="mb-2">
          <AttachmentChips attachments={attachments} onRemove={removeAttachment} />
        </div>
      )}

      {/* textarea + 拖拽叠层（拖入文件时显示蓝色虚线边框） */}
      <div className="relative">
        <textarea
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={handlePaste}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          placeholder={t.inputFollowUpPlaceholder}
          rows={3}
          className={`w-full border rounded-lg p-2 text-sm resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 dark:bg-slate-800 dark:text-slate-200 transition-colors ${
            isDragOver
              ? 'border-blue-400 border-dashed ring-2 ring-blue-200 dark:ring-blue-900/60 bg-blue-50/40 dark:bg-blue-900/20'
              : 'border-slate-300 dark:border-slate-600'
          }`}
        />
        {/* 拖拽叠层提示（仅 isDragOver 时显示） */}
        {isDragOver && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center text-blue-500 text-sm font-medium">
            {t.attachmentDropZone}
          </div>
        )}
        {/* 处理中指示器（右上角 spinner） */}
        {isProcessing && (
          <div className="absolute top-1.5 right-1.5 inline-flex items-center gap-1 text-xs text-blue-500 bg-white/80 dark:bg-slate-800/80 rounded px-1.5 py-0.5">
            <Loader2 size={12} className="animate-spin" />
            {t.attachmentProcessing}
          </div>
        )}
      </div>

      {/* P2-2 变量池：引用语法提示（仅非根节点显示） */}
      {showVariableHint && (
        <div className="mt-1 text-xs text-slate-400 dark:text-slate-500 leading-relaxed">
          {t.variablePoolHint}
        </div>
      )}

      {/* 隐藏的 file input：multiple + 不限制 accept（支持任意格式） */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileInputChange}
      />

      {/* 按钮区：添加附件（左）+ 插入变量引用（左，仅当有可引用节点时）+ 继续追问 / 重新生成 / 检测冲突（右，flex-1 平分） */}
      <div className="flex gap-2 mt-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isProcessing || isRunning || isAbandoned || isIgnored}
          className="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-md text-sm text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title={t.attachmentDragDropHint}
        >
          <Paperclip size={14} />
        </button>
        {/* P2-2 变量池：插入变量引用按钮 + 下拉 */}
        {showVariableHint && variableRefNodes.length > 0 && (
          <div className="relative" data-variable-popover>
            <button
              type="button"
              onClick={() => setIsVariablePopoverOpen((v) => !v)}
              disabled={isRunning || isAbandoned || isIgnored}
              className="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-md text-sm text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title={t.variablePoolInsert}
              aria-label={t.variablePoolInsert}
              aria-expanded={isVariablePopoverOpen}
            >
              <Braces size={14} />
            </button>
            {isVariablePopoverOpen && (
              <div className="absolute bottom-full left-0 mb-1 w-56 max-h-60 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg z-30">
                <div className="px-2 py-1 text-[11px] text-slate-400 dark:text-slate-500 border-b border-slate-100 dark:border-slate-700">
                  {t.variablePoolInsert}
                </div>
                {variableRefNodes.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => handleInsertVariableRef(n.id)}
                    className="block w-full text-left px-2 py-1.5 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 truncate"
                    title={`{{#${n.id}.text#}}`}
                  >
                    <span className="text-slate-400 dark:text-slate-500 mr-1 font-mono">
                      {n.id.slice(0, 7)}
                    </span>
                    {n.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
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
