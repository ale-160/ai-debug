'use client';

import { useTranslation } from '@/components/I18nProvider';
import type { Suggestion } from '../types';

interface SuggestionsListProps {
  /** 建议方向列表 */
  suggestions: Suggestion[];
  /** 是否禁用点击（运行中/已弃用/已忽略） */
  disabled: boolean;
  /** 点击建议方向：填入输入框 */
  onSuggestionClick: (s: Suggestion) => void;
}

/** 建议方向卡片列表：AI 给出的下一步方向，点击后填入输入框 */
export default function SuggestionsList({
  suggestions,
  disabled,
  onSuggestionClick,
}: SuggestionsListProps) {
  const { t } = useTranslation();
  if (suggestions.length === 0) return null;
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
        {t.possibleNextDirections}
      </h4>
      {suggestions.map((s, i) => (
        <button
          key={i}
          onClick={() => onSuggestionClick(s)}
          disabled={disabled}
          className="w-full text-left rounded-lg border border-slate-200 dark:border-slate-700 hover:border-violet-300 hover:bg-violet-50 dark:hover:bg-violet-900/20 p-3 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white dark:disabled:hover:bg-slate-800 disabled:hover:border-slate-200 dark:disabled:hover:border-slate-700"
        >
          <div className="font-semibold text-sm text-slate-800 dark:text-slate-200">{s.title}</div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">{s.description}</div>
        </button>
      ))}
    </div>
  );
}
