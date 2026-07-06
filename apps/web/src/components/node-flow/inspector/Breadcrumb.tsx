'use client';

import { X } from 'lucide-react';
import type { Node } from 'reactflow';
import { useTranslation } from '@/components/I18nProvider';
import type { TurnNodeData } from '../types';

/** 取 userMessage 前 10 字作为面包屑摘要，超出追加省略号 */
function summarize(text: string): string {
  const t = text.trim();
  return t.length > 10 ? `${t.slice(0, 10)}...` : t;
}

interface BreadcrumbProps {
  /** 从根到当前节点的路径（已 reverse，正序） */
  breadcrumb: Node<TurnNodeData>[];
  /** 当前选中节点 ID */
  selectedNodeId: string;
  /** 点击某个路径节点 */
  onSelect: (id: string) => void;
  /** 关闭 Inspector */
  onClose: () => void;
}

/** 路径面包屑：从根到当前节点的 parentId 链，可点击跳转，含关闭按钮 */
export default function Breadcrumb({
  breadcrumb,
  selectedNodeId,
  onSelect,
  onClose,
}: BreadcrumbProps) {
  const { t } = useTranslation();
  return (
    <div className="p-3 border-b border-slate-100 dark:border-slate-700 flex items-center gap-2">
      <div className="flex items-center gap-1 overflow-x-auto flex-1 min-w-0">
        {breadcrumb.map((n, idx) => (
          <div key={n.id} className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => onSelect(n.id)}
              className={`text-xs px-1.5 py-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors truncate max-w-[120px] ${
                n.id === selectedNodeId
                  ? 'font-semibold text-slate-800 dark:text-slate-200'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
              title={n.data.userMessage}
            >
              {n.data.summary ? n.data.summary : summarize(n.data.userMessage)}
            </button>
            {idx < breadcrumb.length - 1 && (
              <span
                className="text-slate-300 dark:text-slate-600 text-xs"
                aria-hidden="true"
              >
                &gt;
              </span>
            )}
          </div>
        ))}
      </div>
      <button
        onClick={onClose}
        className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 dark:hover:text-slate-300 rounded-md transition-colors shrink-0"
        title={t.closeInspector}
        aria-label={t.closeInspector}
      >
        <X size={16} />
      </button>
    </div>
  );
}
