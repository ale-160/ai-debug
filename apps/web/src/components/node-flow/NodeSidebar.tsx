'use client';
import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  Plus,
  Trash2,
  Folder,
  Sparkles,
  Scissors,
  Loader2,
  Download,
  Upload,
  Pencil,
  Zap,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Pin,
  PinOff,
  Clock,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useDebugStore } from '@/lib/debug-store';
import { getProject, updateProject, importProject } from '@/lib/project-storage';
import { analyzeNetwork, derivePrunedProject } from '@/lib/network-pruner';
import { useTranslation } from '@/components/I18nProvider';
import type { NetworkProject } from './types';

export default function NodeSidebar() {
  const { t, tf } = useTranslation();

  const projects = useDebugStore((s) => s.projects);
  const currentProjectId = useDebugStore((s) => s.currentProjectId);
  const mobileSidebarOpen = useDebugStore((s) => s.mobileSidebarOpen);
  const startNewProject = useDebugStore((s) => s.startNewProject);
  const loadProject = useDebugStore((s) => s.loadProject);
  const deleteProject = useDebugStore((s) => s.deleteProject);
  const toggleMobileSidebar = useDebugStore((s) => s.toggleMobileSidebar);
  const setMobileSidebarOpen = useDebugStore((s) => s.setMobileSidebarOpen);
  const refreshProjects = useDebugStore((s) => s.refreshProjects);
  // 自动推演：选中节点才可用，未选中时 disabled
  const selectedNodeId = useDebugStore((s) => s.selectedNodeId);
  const setShowAutoEvolution = useDebugStore((s) => s.setShowAutoEvolution);
  // 时间线视图：当前项目节点 + 选中跳转
  // 5.10.3：nodes 改用 useShallow，避免无 node 引用变化时的重排序
  const nodes = useDebugStore(useShallow((s) => s.nodes));
  const setSelectedNode = useDebugStore((s) => s.setSelectedNode);
  // 桌面端侧边栏收纳/展开
  const sidebarCollapsed = useDebugStore((s) => s.sidebarCollapsed);
  const toggleSidebarCollapsed = useDebugStore((s) => s.toggleSidebarCollapsed);

  const formatTime = useCallback(
    (ts: number): string => {
      const now = Date.now();
      const diff = now - ts;
      const seconds = Math.floor(diff / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);

      if (seconds < 60) return t.justNow;
      if (minutes < 60) return tf('minutesAgo', { count: minutes });
      if (hours < 24) return tf('hoursAgo', { count: hours });
      if (days < 30) return tf('daysAgo', { count: days });
      const d = new Date(ts);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    },
    [t, tf],
  );

  // 正在执行 AI 清理蛛网的项目 id（用于按钮 loading + 禁用）
  const [pruningProjectId, setPruningProjectId] = useState<string | null>(null);
  // 三点菜单：同时仅打开一个，null 表示全部关闭
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  // 项目搜索关键字（匹配项目名 + root 节点 summary）
  const [searchQuery, setSearchQuery] = useState('');
  // 侧边栏 tab 切换：项目列表 / 时间线（助手已独立为右侧侧边栏，由顶栏入口控制）
  const [sidebarTab, setSidebarTab] = useState<'projects' | 'timeline'>('projects');
  const importFileRef = useRef<HTMLInputElement>(null);

  const togglePinProject = useDebugStore((s) => s.togglePinProject);

  // 排序与搜索：置顶组在前（按 pinnedAt 降序），普通组在后（按 updatedAt 降序）。
  // 搜索匹配规则：项目名 substring + root 节点（parentId 为 null 的节点）summary substring。
  // summary 未生成（undefined / 空串）时按空字符串处理，仅匹配名称。
  const { pinnedProjects, normalProjects, hasSearchResult } = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const matchProject = (p: NetworkProject): boolean => {
      if (!q) return true;
      if (p.name.toLowerCase().includes(q)) return true;
      // 找 root 节点（parentId 为 null），匹配其 summary
      const root = p.nodes.find((n) => n.data.parentId === null);
      const rootSummary = root?.data.summary ?? '';
      if (rootSummary && rootSummary.toLowerCase().includes(q)) return true;
      return false;
    };
    const filtered = projects.filter(matchProject);
    const pinned = filtered
      .filter((p) => typeof p.pinnedAt === 'number')
      .sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0));
    const normal = filtered
      .filter((p) => typeof p.pinnedAt !== 'number')
      .sort((a, b) => b.updatedAt - a.updatedAt);
    return {
      pinnedProjects: pinned,
      normalProjects: normal,
      hasSearchResult: pinned.length + normal.length > 0,
    };
  }, [projects, searchQuery]);

  // 时间线：当前项目节点按 createdAt 倒序排列
  // 5.10.3 优化：useShallow 包裹 nodes selector，nodes 引用未变时跳过重排序。
  // 原 `[...nodes].sort(...)` 即使 nodes 未变也会因 useMemo deps 触发新数组分配；
  // 现在 useShallow 在 nodes 引用相等时返回缓存值，避免每次 store set 都重排序。
  // 注意：sort 仍会创建新数组（不影响渲染，因 map 也会创建新 JSX 数组）。
  const currentProjectNodes = useMemo(() => {
    return [...nodes].sort((a, b) => (b.data.createdAt ?? 0) - (a.data.createdAt ?? 0));
  }, [nodes]);

  // 点击时间线节点：选中并跳转到画布对应节点
  const handleTimelineNodeClick = useCallback(
    (nodeId: string) => {
      setSelectedNode(nodeId);
      setMobileSidebarOpen(false);
    },
    [setSelectedNode, setMobileSidebarOpen],
  );

  // 点击菜单外部关闭菜单
  useEffect(() => {
    if (!menuOpenId) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-project-menu]')) {
        setMenuOpenId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpenId]);

  // 新建项目：进入初始输入界面（草稿态），不弹窗。
  // 用户在初始输入界面提交首条消息后才真正创建并绑定项目。
  const handleCreate = () => {
    startNewProject();
    setMobileSidebarOpen(false);
  };

  const handleSelect = (id: string) => {
    loadProject(id);
    setMobileSidebarOpen(false);
  };

  // 重命名：弹窗输入新名称
  const handleRename = (e: React.MouseEvent, project: NetworkProject) => {
    e.stopPropagation();
    setMenuOpenId(null);
    const newName = window.prompt(t.renameProject, project.name);
    if (!newName || !newName.trim() || newName.trim() === project.name) return;
    updateProject(project.id, { name: newName.trim() });
    refreshProjects();
  };

  // 导出：打包为 JSON 下载
  const handleExport = (e: React.MouseEvent, project: NetworkProject) => {
    e.stopPropagation();
    setMenuOpenId(null);
    const payload = {
      version: 1,
      type: 'ai-debug-network',
      exportedAt: new Date().toISOString(),
      project: {
        name: project.name,
        nodes: project.nodes,
        edges: project.edges,
        viewport: project.viewport,
        memory: project.memory,
      },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name || 'network'}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDelete = (e: React.MouseEvent, project: NetworkProject) => {
    e.stopPropagation();
    setMenuOpenId(null);
    if (confirm(tf('confirmDeleteProject', { name: project.name }))) {
      deleteProject(project.id);
    }
  };

  // 导入：读取 JSON 文件 → 创建新项目 → 切换到新项目
  const handleImportFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result as string);
          const project = parsed?.project ?? parsed;
          const nextNodes = Array.isArray(project?.nodes) ? project.nodes : [];
          const nextEdges = Array.isArray(project?.edges) ? project.edges : [];
          const nextViewport = project?.viewport ?? null;
          const nextMemory = Array.isArray(project?.memory) ? project.memory : undefined;
          const name = typeof project?.name === 'string' ? project.name : t.importedProjectName;
          const newProject = importProject(name, nextNodes, nextEdges, nextViewport, nextMemory);
          refreshProjects();
          loadProject(newProject.id);
          setMobileSidebarOpen(false);
        } catch {
          alert(t.importFailed);
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    },
    [refreshProjects, loadProject, setMobileSidebarOpen, t],
  );

  // AI 清理蛛网：分析当前项目 → 派生精简项目 → 刷新列表 → 切换到新项目
  const handlePruneNetwork = async (e: React.MouseEvent, project: NetworkProject) => {
    e.stopPropagation();
    if (pruningProjectId) return;
    setPruningProjectId(project.id);
    try {
      const analysis = await analyzeNetwork(project);
      const newProject = derivePrunedProject(project, analysis);
      refreshProjects();
      loadProject(newProject.id);
      setMobileSidebarOpen(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(tf('aiPruneFailed', { message: msg }));
    } finally {
      setPruningProjectId(null);
    }
  };

  // 点击派生标记跳转到原项目
  const handleJumpToOriginal = (e: React.MouseEvent, originalProjectId?: string) => {
    e.stopPropagation();
    if (!originalProjectId) return;
    loadProject(originalProjectId);
    setMobileSidebarOpen(false);
  };

  // 打开自动推演对话框（需选中节点）
  const handleOpenAutoEvolution = () => {
    if (!selectedNodeId) return;
    setShowAutoEvolution(true);
    setMobileSidebarOpen(false);
  };

  // 切换置顶：调用 store action，再关闭菜单
  const handleTogglePin = (e: React.MouseEvent, project: NetworkProject) => {
    e.stopPropagation();
    setMenuOpenId(null);
    togglePinProject(project.id);
  };

  // 项目卡片渲染：搜索/置顶/排序由外层分组负责，本函数仅渲染单卡片。
  // 三点菜单含"置顶/取消置顶"项，置于"重命名"之上。
  const renderProjectCard = (project: NetworkProject) => {
    const isActive = currentProjectId === project.id;
    const isPinned = typeof project.pinnedAt === 'number';
    return (
      <div
        key={project.id}
        onClick={() => handleSelect(project.id)}
        className={`group p-3 border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer flex items-center justify-between transition-colors ${
          isActive
            ? 'bg-blue-50 dark:bg-blue-900/30 border-l-4 border-l-blue-300 dark:border-l-blue-600'
            : 'border-l-4 border-l-transparent'
        }`}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            {project.projectType === 'derived-pruned' && (
              <Scissors size={12} className="text-amber-500 flex-shrink-0" />
            )}
            {isPinned && <Pin size={10} className="text-amber-500 flex-shrink-0" />}
            <div className="font-bold text-sm text-slate-800 dark:text-slate-100 truncate">
              {project.name}
            </div>
          </div>
          {project.projectType === 'derived-pruned' && (
            <button
              onClick={(e) => handleJumpToOriginal(e, project.originalProjectId)}
              className="mt-0.5 text-xs text-blue-500 hover:text-blue-700 hover:underline flex items-center gap-1 max-w-full"
              title={t.jumpToOriginal}
            >
              <span className="truncate">
                {tf('derivedFrom', {
                  name: getProject(project.originalProjectId ?? '')?.name ?? t.deleted,
                })}
              </span>
            </button>
          )}
          <div className="text-xs text-slate-500 dark:text-slate-500 mt-1 flex items-center gap-2">
            <span>{tf('nodesCount', { count: project.nodes.length })}</span>
            <span>·</span>
            <span>{formatTime(project.updatedAt)}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {project.nodes.length >= 10 && (
            <button
              onClick={(e) => handlePruneNetwork(e, project)}
              disabled={pruningProjectId === project.id}
              className="md:opacity-0 md:group-hover:opacity-100 text-amber-500 hover:text-amber-700 disabled:opacity-50 transition-all p-1"
              title={t.aiPruneNetwork}
            >
              {pruningProjectId === project.id ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Sparkles size={14} />
              )}
            </button>
          )}
          {/* 三点菜单：移动端始终可见，桌面端仅 hover 显示 */}
          <div className="relative" data-project-menu>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpenId((prev) => (prev === project.id ? null : project.id));
              }}
              className="md:opacity-0 md:group-hover:opacity-100 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 rounded transition-all p-1"
              title={t.moreActions}
              aria-label={t.moreActions}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="5" r="2" />
                <circle cx="12" cy="12" r="2" />
                <circle cx="12" cy="19" r="2" />
              </svg>
            </button>
            {menuOpenId === project.id && (
              <div
                className="absolute right-0 top-full mt-1 w-32 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg z-50 py-1"
                role="menu"
              >
                <button
                  onClick={(e) => handleTogglePin(e, project)}
                  className="w-full text-left px-3 py-1.5 text-xs text-slate-700 dark:text-slate-200 hover:bg-amber-50 dark:hover:bg-amber-900/30 flex items-center gap-2"
                  role="menuitem"
                >
                  {isPinned ? <PinOff size={12} /> : <Pin size={12} />}
                  {isPinned ? t.unpin : t.pin}
                </button>
                <button
                  onClick={(e) => handleRename(e, project)}
                  className="w-full text-left px-3 py-1.5 text-xs text-slate-700 dark:text-slate-200 hover:bg-blue-50 dark:hover:bg-blue-900/30 flex items-center gap-2"
                  role="menuitem"
                >
                  <Pencil size={12} />
                  {t.rename}
                </button>
                <button
                  onClick={(e) => handleExport(e, project)}
                  className="w-full text-left px-3 py-1.5 text-xs text-slate-700 dark:text-slate-200 hover:bg-sky-50 dark:hover:bg-sky-900/30 flex items-center gap-2"
                  role="menuitem"
                >
                  <Download size={12} />
                  {t.export}
                </button>
                <div className="border-t border-slate-100 dark:border-slate-700 my-1" />
                <button
                  onClick={(e) => handleDelete(e, project)}
                  className="w-full text-left px-3 py-1.5 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 flex items-center gap-2"
                  role="menuitem"
                >
                  <Trash2 size={12} />
                  {t.delete}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-20 md:hidden"
          onClick={toggleMobileSidebar}
          aria-hidden="true"
        />
      )}

      {/* 桌面端收纳后展开按钮：浮动在画布左边缘 */}
      {sidebarCollapsed && (
        <button
          onClick={toggleSidebarCollapsed}
          className="hidden md:flex fixed top-3 left-2 z-30 items-center justify-center w-8 h-8 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-md text-slate-500 hover:text-violet-600 hover:border-violet-300 dark:hover:text-violet-400 dark:hover:border-violet-600 transition-colors"
          aria-label={t.expandSidebar}
          title={t.expandSidebar}
        >
          <PanelLeftOpen size={16} />
        </button>
      )}

      <div
        className={`fixed inset-y-0 left-0 w-64 z-30 transform transition-transform duration-200 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-700 flex flex-col md:relative md:z-auto ${
          mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } ${
          // 桌面端收纳：translate 隐藏 + 宽度归零避免占位
          sidebarCollapsed
            ? 'md:-translate-x-full md:w-0 md:border-0 md:overflow-hidden'
            : 'md:translate-x-0'
        }`}
        role="navigation"
        aria-label={t.projectList}
      >
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
          <h2 className="font-semibold text-slate-800 dark:text-slate-100 text-sm flex items-center gap-2">
            <Folder size={16} className="text-blue-500" />
            {t.projectList}
          </h2>
          {/* 桌面端收纳按钮（仅 md+ 显示） */}
          <button
            onClick={toggleSidebarCollapsed}
            className="hidden md:inline-flex p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:text-slate-200 dark:hover:bg-slate-700 rounded transition-colors"
            aria-label={t.collapseSidebar}
            title={t.collapseSidebar}
          >
            <PanelLeftClose size={16} />
          </button>
        </div>

        {/* 侧边栏 tab 切换：项目 / 时间线（助手已独立为右侧侧边栏） */}
        <div className="flex border-b border-slate-200 dark:border-slate-700">
          <button
            onClick={() => setSidebarTab('projects')}
            className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
              sidebarTab === 'projects'
                ? 'text-blue-500 border-b-2 border-blue-500'
                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
            }`}
          >
            {t.projects}
          </button>
          <button
            onClick={() => setSidebarTab('timeline')}
            className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
              sidebarTab === 'timeline'
                ? 'text-blue-500 border-b-2 border-blue-500'
                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'
            }`}
          >
            <Clock size={12} className="inline mr-1" />
            {t.timeline}
          </button>
        </div>

        {/* 项目 tab：新建 + 搜索 + 项目列表 */}
        {sidebarTab === 'projects' && (
          <>
            <div className="p-3 border-b border-slate-100 dark:border-slate-700 space-y-2">
              <button
                onClick={handleCreate}
                className="w-full bg-blue-500 text-white rounded-lg py-2 px-3 hover:bg-blue-600 flex items-center justify-center gap-2 transition-colors"
                aria-label={t.newProject}
              >
                <Plus size={16} />
                <span className="text-sm font-medium">{t.newProject}</span>
              </button>
              {/* 搜索框：匹配项目名 + root 节点 summary */}
              <div className="relative">
                <Search
                  size={12}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t.searchProjects}
                  className="w-full pl-7 pr-2 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400"
                  aria-label={t.searchProjects}
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {projects.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-slate-400 dark:text-slate-500">
                  {t.noProjects}
                </div>
              ) : !hasSearchResult ? (
                <div className="px-4 py-8 text-center text-sm text-slate-400 dark:text-slate-500">
                  {t.noSearchResult}
                </div>
              ) : (
                <>
                  {/* 5.10.1 注记（保守方案）：项目数 > 100 时建议引入 react-window 虚拟化，
                      当前不引入新依赖；threshold 检测保留为 TODO，超过 200 项目时性能仍可接受
                      （每张卡 ~200px 高，DOM 节点 < 200 个，浏览器可承受）。
                      TODO：实现 ProjectListVirtualizer 用 react-window 的 FixedSizeList。 */}
                  {pinnedProjects.length > 0 && (
                    <div>
                      <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400 flex items-center gap-1">
                        <Pin size={10} />
                        {t.pinnedSection}
                      </div>
                      {pinnedProjects.map((project) => renderProjectCard(project))}
                    </div>
                  )}
                  {normalProjects.length > 0 && (
                    <div>
                      {pinnedProjects.length > 0 && (
                        <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                          {t.projectsSection}
                        </div>
                      )}
                      {normalProjects.map((project) => renderProjectCard(project))}
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}

        {/* 时间线 tab：按 createdAt 倒序列出当前项目所有节点 */}
        {sidebarTab === 'timeline' && (
          <div className="flex-1 overflow-y-auto p-2">
            {currentProjectNodes.length === 0 ? (
              <div className="text-center text-xs text-slate-400 py-8">{t.noTimelineNodes}</div>
            ) : (
              <div className="space-y-1">
                {/* 5.10.2 注记（保守方案）：时间线节点数 > 200 时建议引入 react-window 虚拟化，
                    当前不引入新依赖；阈值检测：> 200 节点的项目罕见（深度对话蛛网通常 < 100 节点），
                    即使存在，DOM 节点 < 200 个，浏览器可承受。
                    TODO：与 5.10.1 共用 ProjectListVirtualizer，timeline 用 VariableSizeList
                    （节点高度因 tags/branchName 不同而变化）。 */}
                {currentProjectNodes.map((node) => (
                  <button
                    key={node.id}
                    onClick={() => handleTimelineNodeClick(node.id)}
                    className={`w-full text-left p-2 rounded-lg transition-colors ${
                      node.id === selectedNodeId
                        ? 'bg-blue-50 dark:bg-blue-900/30 ring-1 ring-blue-400'
                        : 'hover:bg-slate-100 dark:hover:bg-slate-700'
                    }`}
                  >
                    {/* hash + 时间 */}
                    <div className="flex items-center gap-2 mb-0.5">
                      <code className="text-[10px] font-mono text-slate-400">
                        {node.data.shortHash ?? node.id.slice(-7)}
                      </code>
                      <span className="text-[10px] text-slate-400">
                        {formatTime(node.data.createdAt)}
                      </span>
                    </div>
                    {/* summary 或 userMessage 摘要 */}
                    <div className="text-xs text-slate-700 dark:text-slate-300 truncate">
                      {node.data.summary ??
                        node.data.userMessage.slice(0, 40) +
                          (node.data.userMessage.length > 40 ? '…' : '')}
                    </div>
                    {/* 标签和分支名 */}
                    {(node.data.tags?.length || node.data.branchName) && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {node.data.branchName && (
                          <span className="px-1 py-0.5 rounded text-[9px] bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">
                            {node.data.branchName}
                          </span>
                        )}
                        {node.data.tags?.map((tag) => (
                          <span
                            key={tag}
                            className="px-1 py-0.5 rounded text-[9px] bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                    {/* 状态指示 */}
                    {node.data.status === 'abandoned' && (
                      <span className="text-[9px] text-slate-400 italic">({t.abandonedLabel})</span>
                    )}
                    {node.data.status === 'ignored' && (
                      <span className="text-[9px] text-slate-400 italic">({t.ignored})</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 底部：自动推演入口 + 从 JSON 文件导入 */}
        <div className="px-3 pt-2 pb-1 border-t border-slate-100 dark:border-slate-700 space-y-1">
          <button
            onClick={handleOpenAutoEvolution}
            disabled={!selectedNodeId}
            className="flex items-center gap-2 w-full text-xs font-medium py-2 px-2.5 rounded-lg bg-gradient-to-r from-violet-50 to-amber-50 dark:from-violet-900/20 dark:to-amber-900/20 text-violet-700 dark:text-violet-300 hover:from-violet-100 hover:to-amber-100 dark:hover:from-violet-900/30 dark:hover:to-amber-900/30 border border-violet-200/60 dark:border-violet-700/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:from-violet-50 disabled:hover:to-amber-50 dark:disabled:hover:from-violet-900/20 dark:disabled:hover:to-amber-900/20"
            aria-label={t.autoEvolutionEntry}
            title={t.autoEvolutionEntryHint}
          >
            <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-gradient-to-br from-violet-500 to-amber-500 text-white shrink-0">
              <Zap size={12} />
            </span>
            {t.autoEvolutionEntry}
          </button>
          <input
            ref={importFileRef}
            type="file"
            accept=".json"
            onChange={handleImportFile}
            className="hidden"
          />
          <button
            onClick={() => importFileRef.current?.click()}
            className="flex items-center gap-2 w-full text-xs text-slate-500 dark:text-slate-400 hover:text-amber-600 dark:hover:text-amber-400 py-2 px-2 rounded hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
            aria-label={t.importFromJson}
          >
            <Upload size={14} />
            {t.importFromJson}
          </button>
        </div>
      </div>
    </>
  );
}
