// ============================================================
// AI Debug — 命令面板（P1-1，Alt+F 触发）
//
// 参考 spark-flow 的 CommandPalette，适配 ai-debug 简化场景：
// 1. ai-debug 节点类型只有 turn / merge 两种，无需节点类型搜索
// 2. 命令面板聚焦于「动作 + 项目」两类条目
// 3. 模糊匹配 label，键盘导航 ↑↓ Enter Esc
// 4. 选中后调用 store action 或 loadProject
//
// 与 P1-2 节点预设库的联动预留：未来可在 actions 中追加「插入预设」入口
// ============================================================
'use client';

import { useState, useEffect, useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import {
  Plus,
  Undo2,
  Redo2,
  GitBranch,
  Settings,
  Sparkles,
  Brain,
  PanelLeft,
  SunMoon,
  Folder,
  Bookmark,
  Camera,
} from 'lucide-react';
import { useDebugStore } from '@/lib/debug-store';
import { useTranslation } from '@/components/I18nProvider';
import {
  subscribe as subscribePresets,
  getSnapshot as getPresetSnapshot,
  getServerSnapshot as getPresetServerSnapshot,
} from '@/lib/node-presets-store';
import type { NodePreset } from '@/lib/node-presets-store';
import type { NetworkProject } from './types';

/** 命令面板条目类型 */
type PaletteItem =
  | { kind: 'action'; id: string; label: string; icon: typeof Plus; run: () => void }
  | {
      kind: 'preset';
      id: string;
      label: string;
      preset: NodePreset;
    }
  | { kind: 'project'; id: string; label: string; project: NetworkProject; isCurrent: boolean };

interface CommandPaletteProps {
  /** 是否打开 */
  open: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 切换主题（由 DebugFlowEditor 通过 useTheme 提供） */
  onToggleTheme: () => void;
  /** P1-3：打开快照管理面板 */
  onOpenSnapshots?: () => void;
}

export function CommandPalette({ open, onClose, onToggleTheme, onOpenSnapshots }: CommandPaletteProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // store 状态/动作
  const projects = useDebugStore((s) => s.projects);
  const currentProjectId = useDebugStore((s) => s.currentProjectId);
  const startNewProject = useDebugStore((s) => s.startNewProject);
  const loadProject = useDebugStore((s) => s.loadProject);
  const undo = useDebugStore((s) => s.undo);
  const redo = useDebugStore((s) => s.redo);
  const undoCount = useDebugStore((s) => s.undoCount);
  const redoCount = useDebugStore((s) => s.redoCount);
  const viewMode = useDebugStore((s) => s.viewMode);
  const setViewMode = useDebugStore((s) => s.setViewMode);
  const setShowSettings = useDebugStore((s) => s.setShowSettings);
  const setSkillManagerOpen = useDebugStore((s) => s.setSkillManagerOpen);
  const setShowMemoryPanel = useDebugStore((s) => s.setShowMemoryPanel);
  const sidebarCollapsed = useDebugStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useDebugStore((s) => s.setSidebarCollapsed);
  // P1-2 预设库：选中预设后以当前选中节点为 parentId 创建新节点（无选中则建根节点）
  const selectedNodeId = useDebugStore((s) => s.selectedNodeId);
  const createTurnNode = useDebugStore((s) => s.createTurnNode);

  // 订阅预设库快照（跨标签页同步）
  const presets = useSyncExternalStore(subscribePresets, getPresetSnapshot, getPresetServerSnapshot);

  // 构造动作列表
  const actions = useMemo(() => {
    const list: Array<{ id: string; label: string; icon: typeof Plus; run: () => void }> = [
      { id: 'new-project', label: t.commandPaletteActionNewProject, icon: Plus, run: () => startNewProject() },
      { id: 'undo', label: t.commandPaletteActionUndo, icon: Undo2, run: () => undo() },
      { id: 'redo', label: t.commandPaletteActionRedo, icon: Redo2, run: () => redo() },
      {
        id: 'toggle-view',
        label: t.commandPaletteActionToggleView,
        icon: GitBranch,
        run: () => setViewMode(viewMode === 'web' ? 'git' : 'web'),
      },
      {
        id: 'open-settings',
        label: t.commandPaletteActionOpenSettings,
        icon: Settings,
        run: () => setShowSettings(true),
      },
      {
        id: 'open-skills',
        label: t.commandPaletteActionOpenSkills,
        icon: Sparkles,
        run: () => setSkillManagerOpen(true),
      },
      {
        id: 'open-memory',
        label: t.commandPaletteActionOpenMemory,
        icon: Brain,
        run: () => setShowMemoryPanel(true),
      },
      ...(onOpenSnapshots
        ? [{
            id: 'open-snapshots',
            label: t.snapshotManager,
            icon: Camera,
            run: () => onOpenSnapshots(),
          }]
        : []),
      {
        id: 'toggle-sidebar',
        label: t.commandPaletteActionToggleSidebar,
        icon: PanelLeft,
        run: () => setSidebarCollapsed(!sidebarCollapsed),
      },
      {
        id: 'toggle-theme',
        label: t.commandPaletteActionToggleTheme,
        icon: SunMoon,
        run: () => onToggleTheme(),
      },
    ];
    // 撤销/重做不可用时仍然展示（点击会触发空栈提示）
    return list;
  }, [
    t,
    startNewProject,
    undo,
    redo,
    viewMode,
    setViewMode,
    setShowSettings,
    setSkillManagerOpen,
    setShowMemoryPanel,
    sidebarCollapsed,
    setSidebarCollapsed,
    onToggleTheme,
    onOpenSnapshots,
  ]);

  // 构造项目条目
  const projectItems = useMemo(() => {
    const list = [...projects].sort((a, b) => b.updatedAt - a.updatedAt);
    return list.map((p) => ({
      kind: 'project' as const,
      id: p.id,
      label: p.name,
      project: p,
      isCurrent: p.id === currentProjectId,
    }));
  }, [projects, currentProjectId]);

  // 构造预设条目（按 updatedAt 倒序，与 listPresets 一致）
  const presetItems = useMemo(() => {
    const list = [...presets].sort((a, b) => b.updatedAt - a.updatedAt);
    return list.map((p) => ({
      kind: 'preset' as const,
      id: p.id,
      label: p.name,
      preset: p,
    }));
  }, [presets]);

  // 合并 + 过滤：动作 → 预设 → 项目
  const items = useMemo<PaletteItem[]>(() => {
    const actionItems: PaletteItem[] = actions.map((a) => ({
      kind: 'action' as const,
      ...a,
    }));
    const all = [...actionItems, ...presetItems, ...projectItems];
    if (!query.trim()) return all;
    const q = query.toLowerCase();
    // 预设分组模糊匹配 name + userMessage，其余分组仅匹配 label
    return all.filter((item) => {
      if (item.kind === 'preset') {
        const nameMatch = item.preset.name.toLowerCase().includes(q);
        const msgMatch = item.preset.userMessage.toLowerCase().includes(q);
        return nameMatch || msgMatch;
      }
      return item.label.toLowerCase().includes(q);
    });
  }, [actions, presetItems, projectItems, query]);

  // 查询变化时重置选中索引
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // 打开时聚焦输入框并清空查询
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const handleSelect = useCallback(
    (item: PaletteItem) => {
      if (item.kind === 'action') {
        item.run();
      } else if (item.kind === 'preset') {
        // 以当前选中节点为 parentId 创建新节点（无选中则建根节点）
        createTurnNode(item.preset.userMessage, selectedNodeId ?? null);
      } else {
        loadProject(item.id);
      }
      onClose();
    },
    [loadProject, createTurnNode, selectedNodeId, onClose],
  );

  // 键盘导航
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, items.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const item = items[selectedIndex];
        if (item) handleSelect(item);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [items, selectedIndex, handleSelect, onClose],
  );

  // 滚动到选中项（键盘导航时保证可见）
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || !listRef.current) return;
    const selected = listRef.current.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`);
    selected?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex, open]);

  if (!open) return null;

  // 分组渲染
  const actionItems = items.filter((i): i is Extract<PaletteItem, { kind: 'action' }> => i.kind === 'action');
  const presetItemList = items.filter(
    (i): i is Extract<PaletteItem, { kind: 'preset' }> => i.kind === 'preset',
  );
  const projItems = items.filter((i): i is Extract<PaletteItem, { kind: 'project' }> => i.kind === 'project');

  // 计算各分组在 items 中的起始索引（顺序：动作 → 预设 → 项目）
  const actionStartIndex = 0;
  const presetStartIndex = actionItems.length;
  const projectStartIndex = presetStartIndex + presetItemList.length;
  // 多于 1 个分组时显示分组头
  const hasMultipleGroups =
    (actionItems.length > 0 ? 1 : 0) +
      (presetItemList.length > 0 ? 1 : 0) +
      (projItems.length > 0 ? 1 : 0) >
    1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] bg-black/20"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-white dark:bg-[#1c1c1e] rounded-lg shadow-2xl border border-slate-200 dark:border-white/10 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t.commandPalettePlaceholder}
          className="w-full px-4 py-3 text-sm border-b border-slate-200 dark:border-white/10 focus:outline-none bg-transparent text-slate-800 dark:text-white/90"
        />
        <div ref={listRef} className="max-h-80 overflow-y-auto">
          {items.length === 0 ? (
            <div className="px-4 py-8 text-center text-slate-400 dark:text-white/40 text-sm">
              {t.commandPaletteNoResults}
            </div>
          ) : (
            <>
              {/* 动作分组 */}
              {actionItems.length > 0 && (
                <div>
                  {hasMultipleGroups && (
                    <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
                      {t.commandPaletteActionGroup}
                    </div>
                  )}
                  {actionItems.map((item, i) => {
                    const absoluteIndex = actionStartIndex + i;
                    const Icon = item.icon;
                    return (
                      <button
                        key={`action-${item.id}`}
                        data-index={absoluteIndex}
                        onClick={() => handleSelect(item)}
                        onMouseEnter={() => setSelectedIndex(absoluteIndex)}
                        className={`w-full flex items-center gap-3 px-4 py-2 text-left text-sm transition-colors ${
                          absoluteIndex === selectedIndex
                            ? 'bg-blue-50 dark:bg-blue-500/15'
                            : 'hover:bg-slate-50 dark:hover:bg-white/5'
                        }`}
                      >
                        <Icon size={16} className="text-slate-500 dark:text-white/50" />
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-slate-800 dark:text-white/90 truncate">
                            {item.label}
                          </div>
                        </div>
                        {/* 撤销/重做显示栈深度提示 */}
                        {item.id === 'undo' && undoCount > 0 && (
                          <span className="text-[10px] text-slate-400 dark:text-white/40">
                            {undoCount}
                          </span>
                        )}
                        {item.id === 'redo' && redoCount > 0 && (
                          <span className="text-[10px] text-slate-400 dark:text-white/40">
                            {redoCount}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* 预设分组（amber 色系，与 violet 项目区分） */}
              {presetItemList.length > 0 && (
                <div>
                  <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400 border-t border-slate-100 dark:border-white/8">
                    {t.presetLibrary}
                  </div>
                  {presetItemList.map((item, i) => {
                    const absoluteIndex = presetStartIndex + i;
                    const typeLabel =
                      item.preset.nodeType === 'merge' ? t.presetTypeMerge : t.presetTypeTurn;
                    return (
                      <button
                        key={`preset-${item.id}`}
                        data-index={absoluteIndex}
                        onClick={() => handleSelect(item)}
                        onMouseEnter={() => setSelectedIndex(absoluteIndex)}
                        className={`w-full flex items-center gap-3 px-4 py-2 text-left text-sm transition-colors ${
                          absoluteIndex === selectedIndex
                            ? 'bg-amber-50 dark:bg-amber-500/15'
                            : 'hover:bg-slate-50 dark:hover:bg-white/5'
                        }`}
                      >
                        <Bookmark size={16} className="text-amber-500 dark:text-amber-400" />
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-slate-800 dark:text-white/90 truncate">
                            {item.label}
                          </div>
                          <div className="text-xs text-slate-500 dark:text-white/50 truncate">
                            {item.preset.userMessage}
                          </div>
                        </div>
                        <span className="text-[10px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/15 px-1.5 py-0.5 rounded shrink-0">
                          {typeLabel}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* 项目分组 */}
              {projItems.length > 0 && (
                <div>
                  <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-violet-500 border-t border-slate-100 dark:border-white/8">
                    {t.commandPaletteProjectGroup}
                  </div>
                  {projItems.map((item, i) => {
                    const absoluteIndex = projectStartIndex + i;
                    return (
                      <button
                        key={`project-${item.id}`}
                        data-index={absoluteIndex}
                        onClick={() => handleSelect(item)}
                        onMouseEnter={() => setSelectedIndex(absoluteIndex)}
                        className={`w-full flex items-center gap-3 px-4 py-2 text-left text-sm transition-colors ${
                          absoluteIndex === selectedIndex
                            ? 'bg-violet-50 dark:bg-violet-500/15'
                            : 'hover:bg-slate-50 dark:hover:bg-white/5'
                        }`}
                      >
                        <Folder size={16} className="text-violet-500" />
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-slate-800 dark:text-white/90 truncate">
                            {item.label}
                          </div>
                          <div className="text-xs text-slate-500 dark:text-white/50 truncate">
                            {t.nodesCount.replace('{count}', String(item.project.nodes.length))}
                          </div>
                        </div>
                        {item.isCurrent && (
                          <span className="text-[10px] text-violet-500 bg-violet-50 dark:bg-violet-500/15 px-1.5 py-0.5 rounded">
                            {t.commandPaletteCurrentProject}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default CommandPalette;
