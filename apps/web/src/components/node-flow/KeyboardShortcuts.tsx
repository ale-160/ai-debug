// ============================================================
// AI Debug — 画布快捷键帮助面板
// 懒加载组件，用户点击帮助按钮后才渲染
// ============================================================
'use client';

import React, { memo, useCallback, useMemo } from 'react';
import { X, MousePointer, Move, Copy } from 'lucide-react';
import { useTranslation } from '@/components/I18nProvider';
import type { Strings } from '@/data/i18n';

interface KeyboardShortcutsProps {
  onClose: () => void;
}

interface ShortcutGroup {
  title: string;
  icon: React.ReactNode;
  items: Array<{
    action: string;
    keys: string[];
    description?: string;
  }>;
}

/** 数据驱动构建快捷键分组，文案走 i18n */
function buildShortcutGroups(t: Strings): ShortcutGroup[] {
  return [
    {
      title: t.shortcutGroupCanvas,
      icon: <Move size={14} />,
      items: [
        { action: t.shortcutActionZoomIn, keys: ['Ctrl', '滚轮↑'], description: t.shortcutDescZoom },
        { action: t.shortcutActionZoomOut, keys: ['Ctrl', '滚轮↓'], description: t.shortcutDescZoom },
        { action: t.shortcutActionHandDrag, keys: ['Space', '拖拽'], description: t.shortcutDescHandDrag },
        { action: t.shortcutActionFitView, keys: ['F'], description: t.shortcutDescFitView },
      ],
    },
    {
      title: t.shortcutGroupTool,
      icon: <MousePointer size={14} />,
      items: [
        { action: t.shortcutActionSelect, keys: ['V'], description: t.shortcutDescSelect },
        { action: t.shortcutActionHand, keys: ['H'], description: t.shortcutDescHand },
        { action: t.shortcutActionTempHand, keys: ['Space'], description: t.shortcutDescTempHand },
      ],
    },
    {
      title: t.shortcutGroupNode,
      icon: <Copy size={14} />,
      items: [
        { action: t.shortcutActionClickSelect, keys: ['点击'] },
        { action: t.shortcutActionMultiSelect, keys: ['Shift', '点击'] },
        { action: t.shortcutActionDeleteNode, keys: ['Delete', 'Backspace'], description: t.shortcutDescDelete },
      ],
    },
  ];
}

function KeyboardShortcuts({ onClose }: KeyboardShortcutsProps) {
  const { t } = useTranslation();
  const shortcutGroups = useMemo(() => buildShortcutGroups(t), [t]);

  // 背景点击关闭：仅当点击的是遮罩本身而非内部内容时关闭
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center animate-[fadeIn_0.2s_ease-out] dark:bg-black/50"
      onClick={handleBackdropClick}
    >
      <div className="bg-white rounded-xl shadow-2xl w-[560px] max-w-[90vw] max-h-[80vh] overflow-hidden animate-[slideUp_0.25s_ease-out] dark:bg-slate-800">
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-sky-500 flex items-center justify-center">
              <span className="text-white text-sm">⌨️</span>
            </div>
            <div>
              <h2 className="font-semibold text-slate-800 text-sm dark:text-slate-100">{t.shortcutTitle}</h2>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">{t.shortcutSubtitle}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-md transition-colors dark:hover:text-slate-200 dark:hover:bg-slate-700"
            aria-label={t.close}
          >
            <X size={16} />
          </button>
        </div>

        {/* 内容 */}
        <div className="p-5 overflow-y-auto max-h-[calc(80vh-64px)] space-y-5">
          {shortcutGroups.map((group, gi) => (
            <div key={gi}>
              <div className="flex items-center gap-2 mb-2.5">
                <span className="text-violet-500">{group.icon}</span>
                <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-200">{group.title}</h3>
              </div>
              <div className="space-y-1.5 pl-6">
                {group.items.map((item, ii) => (
                  <div
                    key={ii}
                    className="flex items-center justify-between py-1.5 px-2.5 rounded-md hover:bg-slate-50 transition-colors dark:hover:bg-slate-700/50"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] text-slate-600 dark:text-slate-300">{item.action}</span>
                      {item.description && (
                        <span className="text-[10px] text-slate-400 dark:text-slate-500">{item.description}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {item.keys.map((key, ki) => (
                        <kbd
                          key={ki}
                          className="px-1.5 py-0.5 text-[10px] font-mono text-slate-600 bg-slate-100 border border-slate-200 rounded shadow-sm dark:text-slate-300 dark:bg-slate-700 dark:border-slate-600"
                        >
                          {key}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* 提示 */}
          <div className="mt-6 p-3 bg-gradient-to-r from-violet-50 to-sky-50 rounded-lg border border-violet-100 dark:from-violet-900/30 dark:to-sky-900/30 dark:border-violet-800">
            <p className="text-[11px] text-slate-600 leading-relaxed dark:text-slate-300">
              💡 <span className="font-medium text-violet-700 dark:text-violet-300">{t.shortcutTip}</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(KeyboardShortcuts);
