'use client';
import React, { useState, useCallback, useEffect, useRef } from 'react';
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
} from 'lucide-react';
import { useDebugStore } from '@/lib/debug-store';
import {
  getProject,
  updateProject,
  importProject,
} from '@/lib/project-storage';
import { analyzeNetwork, derivePrunedProject } from '@/lib/network-pruner';
import type { NetworkProject } from './types';

function formatTime(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (hours < 24) return `${hours} 小时前`;
  if (days < 30) return `${days} 天前`;
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function NodeSidebar() {
  const projects = useDebugStore((s) => s.projects);
  const currentProjectId = useDebugStore((s) => s.currentProjectId);
  const mobileSidebarOpen = useDebugStore((s) => s.mobileSidebarOpen);
  const startNewProject = useDebugStore((s) => s.startNewProject);
  const loadProject = useDebugStore((s) => s.loadProject);
  const deleteProject = useDebugStore((s) => s.deleteProject);
  const toggleMobileSidebar = useDebugStore((s) => s.toggleMobileSidebar);
  const setMobileSidebarOpen = useDebugStore((s) => s.setMobileSidebarOpen);
  const refreshProjects = useDebugStore((s) => s.refreshProjects);

  // 正在执行 AI 清理蛛网的项目 id（用于按钮 loading + 禁用）
  const [pruningProjectId, setPruningProjectId] = useState<string | null>(null);
  // 三点菜单：同时仅打开一个，null 表示全部关闭
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);

  const sortedProjects = React.useMemo(
    () => [...projects].sort((a, b) => b.updatedAt - a.updatedAt),
    [projects]
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
    const newName = window.prompt('重命名项目：', project.name);
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
    if (confirm(`确定删除项目「${project.name}」？此操作不可撤销。`)) {
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
          const name = typeof project?.name === 'string' ? project.name : '导入的项目';
          const newProject = importProject(name, nextNodes, nextEdges, nextViewport, nextMemory);
          refreshProjects();
          loadProject(newProject.id);
          setMobileSidebarOpen(false);
        } catch {
          alert('导入失败：文件格式无效');
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    },
    [refreshProjects, loadProject, setMobileSidebarOpen]
  );

  // AI 清理蛛网：分析当前项目 → 派生精简项目 → 刷新列表 → 切换到新项目
  const handlePruneNetwork = async (
    e: React.MouseEvent,
    project: NetworkProject,
  ) => {
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
      alert(`AI 清理蛛网失败：${msg}`);
    } finally {
      setPruningProjectId(null);
    }
  };

  // 点击派生标记跳转到原项目
  const handleJumpToOriginal = (
    e: React.MouseEvent,
    originalProjectId?: string,
  ) => {
    e.stopPropagation();
    if (!originalProjectId) return;
    loadProject(originalProjectId);
    setMobileSidebarOpen(false);
  };

  return (
    <>
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-20 md:hidden"
          onClick={toggleMobileSidebar}
        />
      )}

      <div
        className={`fixed inset-y-0 left-0 w-64 z-30 transform transition-transform duration-200 bg-white border-r border-slate-200 flex flex-col md:relative md:translate-x-0 md:z-auto ${
          mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
          <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
            <Folder size={16} className="text-blue-500" />
            项目列表
          </h2>
        </div>

        <div className="p-3 border-b border-slate-100">
          <button
            onClick={handleCreate}
            className="w-full bg-blue-500 text-white rounded-lg py-2 px-3 hover:bg-blue-600 flex items-center justify-center gap-2 transition-colors"
          >
            <Plus size={16} />
            <span className="text-sm font-medium">新建项目</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {sortedProjects.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-slate-400">
              还没有项目，点击上方新建
            </div>
          ) : (
            sortedProjects.map((project) => {
              const isActive = currentProjectId === project.id;
              return (
                <div
                  key={project.id}
                  onClick={() => handleSelect(project.id)}
                  className={`group p-3 border-b border-slate-100 hover:bg-slate-50 cursor-pointer flex items-center justify-between transition-colors ${
                    isActive
                      ? 'bg-blue-50 border-l-4 border-l-blue-300'
                      : 'border-l-4 border-l-transparent'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {project.projectType === 'derived-pruned' && (
                        <Scissors
                          size={12}
                          className="text-amber-500 flex-shrink-0"
                        />
                      )}
                      <div className="font-bold text-sm text-slate-800 truncate">
                        {project.name}
                      </div>
                    </div>
                    {project.projectType === 'derived-pruned' && (
                      <button
                        onClick={(e) =>
                          handleJumpToOriginal(e, project.originalProjectId)
                        }
                        className="mt-0.5 text-xs text-blue-500 hover:text-blue-700 hover:underline flex items-center gap-1 max-w-full"
                        title="跳转到原项目"
                      >
                        <span className="truncate">
                          派生自{' '}
                          {getProject(project.originalProjectId ?? '')?.name ??
                            '已删除'}
                        </span>
                      </button>
                    )}
                    <div className="text-xs text-slate-400 mt-1 flex items-center gap-2">
                      <span>{project.nodes.length} 个节点</span>
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
                        title="AI 清理蛛网"
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
                          setMenuOpenId((prev) =>
                            prev === project.id ? null : project.id
                          );
                        }}
                        className="md:opacity-0 md:group-hover:opacity-100 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 rounded transition-all p-1"
                        title="更多操作"
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="currentColor"
                        >
                          <circle cx="12" cy="5" r="2" />
                          <circle cx="12" cy="12" r="2" />
                          <circle cx="12" cy="19" r="2" />
                        </svg>
                      </button>
                      {menuOpenId === project.id && (
                        <div className="absolute right-0 top-full mt-1 w-32 bg-white border border-slate-200 rounded-lg shadow-lg z-50 py-1">
                          <button
                            onClick={(e) => handleRename(e, project)}
                            className="w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-blue-50 flex items-center gap-2"
                          >
                            <Pencil size={12} />
                            重命名
                          </button>
                          <button
                            onClick={(e) => handleExport(e, project)}
                            className="w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-sky-50 flex items-center gap-2"
                          >
                            <Download size={12} />
                            导出
                          </button>
                          <div className="border-t border-slate-100 my-1" />
                          <button
                            onClick={(e) => handleDelete(e, project)}
                            className="w-full text-left px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 flex items-center gap-2"
                          >
                            <Trash2 size={12} />
                            删除
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* 底部：从 JSON 文件导入 */}
        <div className="px-3 pt-1 pb-1 border-t border-slate-100">
          <input
            ref={importFileRef}
            type="file"
            accept=".json"
            onChange={handleImportFile}
            className="hidden"
          />
          <button
            onClick={() => importFileRef.current?.click()}
            className="flex items-center gap-2 w-full text-xs text-slate-500 hover:text-amber-600 py-2 px-2 rounded hover:bg-amber-50 transition-colors"
          >
            <Upload size={14} />
            从 JSON 文件导入
          </button>
        </div>
      </div>
    </>
  );
}
