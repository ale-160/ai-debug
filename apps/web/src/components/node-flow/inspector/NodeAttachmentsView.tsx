'use client';

import { useState } from 'react';
import { FileText, File, Image as ImageIcon, X, AlertCircle } from 'lucide-react';
import type { NodeAttachment } from '../types';
import { useTranslation } from '@/components/I18nProvider';
import { formatFileSize } from '@/lib/attachment-helpers';

interface NodeAttachmentsViewProps {
  /** 节点持久化的附件列表（只读展示，无移除按钮） */
  attachments: NodeAttachment[];
}

/**
 * 节点附件只读视图：在 Inspector 用户消息下方展示历史附件。
 * - image: 缩略图（点击放大到全屏 modal）
 * - text:  文件名 + 大小 + 文本前 200 字折叠预览
 * - binary: 文件名 + 大小 + "模型可能无法识别" 提示
 * - failed: 红色 + 错误原因（理论上节点不持久化 failed 项，这里兜底）
 * 与编辑态 AttachmentChips 区分：本组件用于展示节点已有附件，无修改能力。
 */
export default function NodeAttachmentsView({ attachments }: NodeAttachmentsViewProps) {
  const { t, tf } = useTranslation();
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  if (!attachments || attachments.length === 0) return null;

  return (
    <div className="mt-2 space-y-1.5 w-full max-w-[85%] self-end">
      <div className="text-[10px] text-slate-400 dark:text-slate-500 mb-0.5 text-right">
        {tf('attachmentCount', { count: attachments.length })}
      </div>
      {attachments.map((att) => {
        const isFailed = att.parseStatus === 'failed';
        const isImage = att.kind === 'image' && att.parseStatus === 'parsed' && att.data;
        const isText = att.kind === 'text' && att.parseStatus === 'parsed' && att.data;
        return (
          <div
            key={att.id}
            className={`rounded-md border px-2 py-1.5 text-xs ${
              isFailed
                ? 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
                : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300'
            }`}
          >
            <div className="flex items-center gap-2">
              {isImage ? (
                <button
                  onClick={() => setPreviewImage(att.data!)}
                  className="shrink-0"
                  title={t.attachmentPreview}
                >
                  <img
                    src={att.data}
                    alt={att.name}
                    className="w-10 h-10 object-cover rounded border border-slate-200 dark:border-slate-700 hover:ring-2 hover:ring-blue-300 transition"
                  />
                </button>
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
              <span className="truncate flex-1" title={att.name}>
                {att.name}
              </span>
              <span className="text-[10px] text-slate-400 dark:text-slate-500 shrink-0">
                {formatFileSize(att.size)}
              </span>
            </div>
            {/* 文本附件预览（折叠显示前 200 字） */}
            {isText && (
              <pre className="mt-1 text-[10px] text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-900/60 rounded p-1 max-h-20 overflow-auto whitespace-pre-wrap break-words">
                {att.data!.slice(0, 200)}
                {att.data!.length > 200 ? '...' : ''}
              </pre>
            )}
            {/* 二进制附件：模型可能无法识别提示 */}
            {att.kind === 'binary' && att.parseStatus === 'parsed' && (
              <div className="mt-1 text-[10px] text-amber-600 dark:text-amber-400">
                {t.attachmentModelUnrecognized}
              </div>
            )}
            {/* 失败提示 */}
            {isFailed && (
              <div className="mt-1 text-[10px] text-red-500">
                {tf('attachmentParseFailed', { message: att.parseError ?? '' })}
              </div>
            )}
          </div>
        );
      })}

      {/* 图片放大 modal：点击遮罩或 X 关闭，点击图片本身不关闭 */}
      {previewImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setPreviewImage(null)}
        >
          <button
            className="absolute top-4 right-4 text-white/80 hover:text-white"
            onClick={() => setPreviewImage(null)}
            aria-label={t.close}
          >
            <X size={24} />
          </button>
          <img
            src={previewImage}
            alt=""
            className="max-w-full max-h-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
