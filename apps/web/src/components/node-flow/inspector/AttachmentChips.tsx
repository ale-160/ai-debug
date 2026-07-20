'use client';

import { X, FileText, File, Image as ImageIcon, AlertCircle } from 'lucide-react';
import type { NodeAttachment } from '../types';
import { useTranslation } from '@/components/I18nProvider';
import { formatFileSize } from '@/lib/attachment-helpers';

interface AttachmentChipsProps {
  /** 当前附件列表 */
  attachments: NodeAttachment[];
  /** 移除附件回调（按 id）；不传则不显示移除按钮（只读模式，用于 Inspector 展示历史附件） */
  onRemove?: (id: string) => void;
}

/**
 * 附件预览 chips 列表（共享组件）。
 * - image: 显示缩略图（无 data 时回退为图标）
 * - text:  FileText 图标 + 文件名 + 大小
 * - binary: File 图标 + 文件名 + 大小
 * - failed: 红色背景 + AlertCircle + 错误提示（hover 显示 parseError）
 * 用于 MessageInput / EmptyStateInput（编辑态，含移除按钮）与 NodeInspector（只读态）。
 */
export default function AttachmentChips({ attachments, onRemove }: AttachmentChipsProps) {
  const { t, tf } = useTranslation();
  if (!attachments || attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {attachments.map((att) => {
        const isFailed = att.parseStatus === 'failed';
        const isImage = att.kind === 'image' && att.parseStatus === 'parsed' && att.data;
        return (
          <div
            key={att.id}
            className={`relative group rounded-md border overflow-hidden flex items-center gap-1.5 pl-1.5 pr-1 py-1 text-xs max-w-[220px] ${
              isFailed
                ? 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20'
                : 'border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/60'
            }`}
            title={
              isFailed ? tf('attachmentParseFailed', { message: att.parseError ?? '' }) : att.name
            }
          >
            {/* 缩略图 / 图标 */}
            {isImage ? (
              <img
                src={att.data}
                alt={att.name}
                className="w-7 h-7 object-cover rounded shrink-0"
              />
            ) : (
              <span className="shrink-0 text-slate-400 dark:text-slate-500">
                {isFailed ? (
                  <AlertCircle size={14} className="text-red-500" />
                ) : att.kind === 'image' ? (
                  <ImageIcon size={14} />
                ) : att.kind === 'text' ? (
                  <FileText size={14} />
                ) : (
                  <File size={14} />
                )}
              </span>
            )}

            {/* 文件名 + 大小 */}
            <span className="truncate text-slate-700 dark:text-slate-200 max-w-[130px]">
              {att.name}
            </span>
            <span className="text-[10px] text-slate-400 dark:text-slate-500 shrink-0">
              {formatFileSize(att.size)}
            </span>

            {/* 移除按钮（仅编辑态） */}
            {onRemove && (
              <button
                onClick={() => onRemove(att.id)}
                className="shrink-0 ml-0.5 rounded-full p-0.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/40 transition-colors"
                aria-label={t.attachmentRemove}
                title={t.attachmentRemove}
              >
                <X size={12} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
