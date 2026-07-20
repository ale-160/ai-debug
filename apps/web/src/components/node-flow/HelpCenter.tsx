// ============================================================
// AI Debug — 应用内帮助中心
//
// 提供完整的使用说明：快速入门 / 核心概念 / 画布操作 / 助手工作流
// / 快捷键 / 常见问题。懒加载，由顶栏帮助按钮触发。
//
// 设计要点：
// - 左侧导航树 + 右侧滚动内容区，参考主流文档站点
// - 章节内容数据驱动，文案走 i18n
// - 集成原 KeyboardShortcuts 速查功能（已合并为本文组件的 shortcuts 章节）
// ============================================================
'use client';

import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { X, Search, BookOpen } from 'lucide-react';
import { useTranslation } from '@/components/I18nProvider';
import type { Strings } from '@/data/i18n';

interface HelpCenterProps {
  onClose: () => void;
}

/** 章节定义：左侧导航 + 右侧内容 */
interface HelpSection {
  id: string;
  title: string;
  icon: string;
  /** 段落数组：每段是标题 + 内容（content 可能是字符串数组或表格） */
  blocks: HelpBlock[];
}

type HelpBlock =
  | { type: 'para'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'kbd'; text: string; keys: string[] }
  | { type: 'qa'; q: string; a: string };

/**
 * 构建帮助中心章节内容。
 * 文案走 i18n，便于中英文切换。
 */
function buildSections(t: Strings): HelpSection[] {
  return [
    {
      id: 'quickstart',
      title: t.helpQuickstartTitle,
      icon: '🚀',
      blocks: [
        { type: 'para', text: t.helpQuickstartIntro },
        { type: 'list', items: t.helpQuickstartSteps },
        { type: 'para', text: t.helpQuickstartTip },
      ],
    },
    {
      id: 'concepts',
      title: t.helpConceptsTitle,
      icon: '🧠',
      blocks: [
        { type: 'para', text: t.helpConceptsIntro },
        { type: 'list', items: t.helpConceptsItems },
      ],
    },
    {
      id: 'canvas',
      title: t.helpCanvasTitle,
      icon: '🎨',
      blocks: [
        { type: 'para', text: t.helpCanvasIntro },
        { type: 'list', items: t.helpCanvasOps },
      ],
    },
    {
      id: 'assistant',
      title: t.helpAssistantTitle,
      icon: '🤖',
      blocks: [
        { type: 'para', text: t.helpAssistantIntro },
        { type: 'list', items: t.helpAssistantOps },
        { type: 'para', text: t.helpAssistantTip },
      ],
    },
    {
      id: 'shortcuts',
      title: t.helpShortcutsTitle,
      icon: '⌨️',
      blocks: [
        { type: 'para', text: t.helpShortcutsIntro },
        ...t.helpShortcutsItems.map((it) => ({
          type: 'kbd' as const,
          text: it.text,
          keys: it.keys,
        })),
      ],
    },
    {
      id: 'faq',
      title: t.helpFaqTitle,
      icon: '❓',
      blocks: t.helpFaqItems.map((it) => ({
        type: 'qa' as const,
        q: it.q,
        a: it.a,
      })),
    },
  ];
}

function HelpCenter({ onClose }: HelpCenterProps) {
  const { t } = useTranslation();
  const [activeId, setActiveId] = useState<string>('quickstart');
  const [query, setQuery] = useState('');

  const allSections = useMemo(() => buildSections(t), [t]);

  // 搜索过滤：query 非空时只显示命中的段落
  const filteredSections = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allSections;
    return allSections
      .map((s) => ({
        ...s,
        blocks: s.blocks.filter((b) => {
          if (b.type === 'para') return b.text.toLowerCase().includes(q);
          if (b.type === 'list') return b.items.some((i) => i.toLowerCase().includes(q));
          if (b.type === 'kbd') return b.text.toLowerCase().includes(q);
          if (b.type === 'qa')
            return b.q.toLowerCase().includes(q) || b.a.toLowerCase().includes(q);
          return false;
        }),
      }))
      .filter((s) => s.blocks.length > 0);
  }, [allSections, query]);

  // ESC 关闭
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // 搜索命中时自动跳到第一个匹配章节
  useEffect(() => {
    if (filteredSections.length > 0 && !filteredSections.find((s) => s.id === activeId)) {
      setActiveId(filteredSections[0].id);
    }
  }, [filteredSections, activeId]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  const activeSection = filteredSections.find((s) => s.id === activeId) ?? filteredSections[0];

  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center animate-[fadeIn_0.2s_ease-out] dark:bg-black/60"
      onClick={handleBackdropClick}
    >
      <div className="bg-white rounded-xl shadow-2xl w-[860px] max-w-[94vw] h-[80vh] overflow-hidden flex flex-col animate-[slideUp_0.25s_ease-out] dark:bg-slate-800">
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-sky-500 flex items-center justify-center">
              <BookOpen size={16} className="text-white" />
            </div>
            <div>
              <h2 className="font-semibold text-slate-800 text-sm dark:text-slate-100">
                {t.helpCenterTitle}
              </h2>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                {t.helpCenterSubtitle}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-md transition-colors dark:hover:text-slate-200 dark:hover:bg-slate-700 active:bg-slate-200 dark:active:bg-slate-600"
            aria-label={t.close}
          >
            <X size={16} />
          </button>
        </div>

        {/* 搜索框 */}
        <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-700">
          <div className="relative">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.helpSearchPlaceholder}
              className="w-full pl-8 pr-3 py-1.5 text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-400 dark:text-slate-200 dark:bg-slate-700/50 dark:border-slate-600 dark:focus:ring-violet-500/30"
              aria-label={t.helpSearchPlaceholder}
            />
          </div>
        </div>

        {/* 主体：左侧导航 + 右侧内容 */}
        <div className="flex-1 flex overflow-hidden">
          {/* 左侧导航 */}
          <nav className="w-44 shrink-0 border-r border-slate-100 dark:border-slate-700 overflow-y-auto py-2">
            {filteredSections.length === 0 ? (
              <div className="px-4 py-6 text-center text-[11px] text-slate-400">
                {t.helpNoMatch}
              </div>
            ) : (
              filteredSections.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setActiveId(s.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors ${
                    activeSection?.id === s.id
                      ? 'bg-violet-50 text-violet-700 font-medium dark:bg-violet-900/30 dark:text-violet-300'
                      : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700/50'
                  }`}
                >
                  <span className="text-sm">{s.icon}</span>
                  <span className="truncate">{s.title}</span>
                </button>
              ))
            )}
          </nav>

          {/* 右侧内容 */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4 text-slate-700 dark:text-slate-200">
            {activeSection && (
              <>
                <div className="flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-slate-700">
                  <span className="text-lg">{activeSection.icon}</span>
                  <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                    {activeSection.title}
                  </h3>
                </div>
                {activeSection.blocks.map((b, i) => {
                  if (b.type === 'para') {
                    return (
                      <p
                        key={i}
                        className="text-[13px] leading-relaxed text-slate-600 dark:text-slate-300"
                      >
                        {b.text}
                      </p>
                    );
                  }
                  if (b.type === 'list') {
                    return (
                      <ul key={i} className="space-y-1.5 pl-1">
                        {b.items.map((it, ii) => (
                          <li
                            key={ii}
                            className="flex gap-2 text-[13px] text-slate-600 dark:text-slate-300"
                          >
                            <span className="text-violet-500 mt-0.5">•</span>
                            <span className="flex-1 leading-relaxed">{it}</span>
                          </li>
                        ))}
                      </ul>
                    );
                  }
                  if (b.type === 'kbd') {
                    return (
                      <div
                        key={i}
                        className="flex items-center justify-between py-1.5 px-2.5 rounded-md bg-slate-50 dark:bg-slate-700/40"
                      >
                        <span className="text-[12px] text-slate-600 dark:text-slate-300">
                          {b.text}
                        </span>
                        <div className="flex items-center gap-1">
                          {b.keys.map((k, ki) => (
                            <kbd
                              key={ki}
                              className="px-1.5 py-0.5 text-[10px] font-mono text-slate-600 bg-white border border-slate-200 rounded shadow-sm dark:text-slate-300 dark:bg-slate-700 dark:border-slate-600"
                            >
                              {k}
                            </kbd>
                          ))}
                        </div>
                      </div>
                    );
                  }
                  if (b.type === 'qa') {
                    return (
                      <div key={i} className="space-y-1">
                        <p className="text-[13px] font-medium text-slate-800 dark:text-slate-100">
                          Q：{b.q}
                        </p>
                        <p className="text-[13px] leading-relaxed text-slate-600 dark:text-slate-300 pl-4">
                          A：{b.a}
                        </p>
                      </div>
                    );
                  }
                  return null;
                })}
              </>
            )}
          </div>
        </div>

        {/* 底部提示 */}
        <div className="px-5 py-2.5 border-t border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40">
          <p className="text-[11px] text-slate-500 dark:text-slate-400">💡 {t.helpFooterTip}</p>
        </div>
      </div>
    </div>
  );
}

export default memo(HelpCenter);
