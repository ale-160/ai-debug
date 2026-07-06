// ============================================================
// AI Debug — 节点公共样式与工具
// 集中导出节点状态配色与流式文本截断逻辑，供卡片与 MiniMap 共享，
// 避免配色逻辑分散导致卡片与缩略图颜色不一致。
// ============================================================
import type { TurnStatus } from '../types';

/** 节点状态对应的主题色（Tailwind 类名 + hex 值，卡片与 MiniMap 共用同一来源） */
export const statusColors: Record<
  TurnStatus,
  { border: string; bg: string; text: string; dot: string; hex: string }
> = {
  idle: {
    border: 'border-slate-200 dark:border-slate-600',
    bg: 'bg-white dark:bg-slate-800',
    text: 'text-slate-400 dark:text-slate-500',
    dot: 'bg-slate-300 dark:bg-slate-600',
    hex: '#cbd5e1', // slate-300
  },
  running: {
    border: 'border-blue-400 dark:border-blue-500',
    bg: 'bg-blue-50 dark:bg-blue-900/30',
    text: 'text-blue-500 dark:text-blue-400',
    dot: 'bg-blue-500',
    hex: '#3b82f6', // blue-500
  },
  success: {
    border: 'border-emerald-400 dark:border-emerald-500',
    bg: 'bg-emerald-50 dark:bg-emerald-900/30',
    text: 'text-emerald-600 dark:text-emerald-400',
    dot: 'bg-emerald-500',
    hex: '#10b981', // emerald-500
  },
  error: {
    border: 'border-red-400 dark:border-red-500',
    bg: 'bg-red-50 dark:bg-red-900/30',
    text: 'text-red-600 dark:text-red-400',
    dot: 'bg-red-500',
    hex: '#ef4444', // red-500
  },
  abandoned: {
    border: 'border-slate-300 dark:border-slate-600',
    bg: 'bg-slate-100 dark:bg-slate-800',
    text: 'text-slate-400 dark:text-slate-500',
    dot: 'bg-slate-400 dark:bg-slate-500',
    hex: '#94a3b8', // slate-400
  },
  ignored: {
    border: 'border-amber-400 dark:border-amber-500',
    bg: 'bg-amber-50 dark:bg-amber-900/30',
    text: 'text-amber-500 dark:text-amber-400',
    dot: 'bg-amber-400',
    hex: '#fbbf24', // amber-400
  },
};

/** 返回状态对应的 hex 颜色（供 MiniMap nodeColor 使用，与卡片配色保持一致） */
export function getStatusColor(status: TurnStatus): string {
  return statusColors[status]?.hex ?? '#ffffff';
}

/** 截断流式文本：保留尾部 maxLen 字，避免长对话渲染卡顿 */
export function truncateStreamingText(text: string, maxLen = 2000): string {
  if (!text) return '';
  return text.length > maxLen ? text.slice(-maxLen) : text;
}
