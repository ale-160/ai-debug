'use client';

import React, { useState } from 'react';
import { X, Plus, Trash2, Pencil, Check, Brain } from 'lucide-react';
import { useDebugStore } from '@/lib/debug-store';
import type { MemoryEntry } from './node-flow/types';

interface MemoryPanelProps {
  open: boolean;
  onClose: () => void;
}

/** 单条记忆条目：支持查看/编辑/删除 */
function MemoryItem({
  entry,
  onUpdate,
  onDelete,
}: {
  entry: MemoryEntry;
  onUpdate: (content: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.content);

  const handleSave = () => {
    const text = draft.trim();
    if (text) {
      onUpdate(text);
      setEditing(false);
    }
  };

  const handleCancel = () => {
    setDraft(entry.content);
    setEditing(false);
  };

  return (
    <div className="group rounded-lg border border-slate-200 bg-white p-2.5 text-sm dark:border-slate-600 dark:bg-slate-700">
      {editing ? (
        <div className="space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-violet-400 dark:border-slate-500 dark:bg-slate-600 dark:text-slate-100"
            autoFocus
          />
          <div className="flex justify-end gap-1">
            <button
              onClick={handleCancel}
              className="rounded px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-600"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              className="inline-flex items-center gap-1 rounded bg-violet-600 px-2 py-0.5 text-xs text-white hover:bg-violet-700"
            >
              <Check size={12} />
              保存
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div className="flex items-start gap-2">
            <span className="flex-1 text-slate-700 dark:text-slate-100 whitespace-pre-wrap break-words">
              {entry.content}
            </span>
            <div className="flex shrink-0 gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => setEditing(true)}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-600"
                title="编辑"
              >
                <Pencil size={12} />
              </button>
              <button
                onClick={onDelete}
                className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/30"
                title="删除"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
          <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-400">
            <span
              className={`px-1.5 py-0.5 rounded ${
                entry.source === 'auto'
                  ? 'bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-300'
                  : 'bg-slate-100 text-slate-500 dark:bg-slate-600 dark:text-slate-300'
              }`}
            >
              {entry.source === 'auto' ? '自动' : '手动'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export function MemoryPanel({ open, onClose }: MemoryPanelProps) {
  const globalMemory = useDebugStore((s) => s.globalMemory);
  const projects = useDebugStore((s) => s.projects);
  const currentProjectId = useDebugStore((s) => s.currentProjectId);
  const addGlobalMemory = useDebugStore((s) => s.addGlobalMemory);
  const updateGlobalMemory = useDebugStore((s) => s.updateGlobalMemory);
  const deleteGlobalMemory = useDebugStore((s) => s.deleteGlobalMemory);
  const addProjectMemory = useDebugStore((s) => s.addProjectMemory);
  const updateProjectMemory = useDebugStore((s) => s.updateProjectMemory);
  const deleteProjectMemory = useDebugStore((s) => s.deleteProjectMemory);

  const [globalDraft, setGlobalDraft] = useState('');
  const [projectDraft, setProjectDraft] = useState('');

  const currentProject = projects.find((p) => p.id === currentProjectId);
  const projectMemory = currentProject?.memory ?? [];

  const handleAddGlobal = () => {
    const text = globalDraft.trim();
    if (!text) return;
    addGlobalMemory(text);
    setGlobalDraft('');
  };

  const handleAddProject = () => {
    const text = projectDraft.trim();
    if (!text) return;
    addProjectMemory(text);
    setProjectDraft('');
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="记忆管理"
    >
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-lg bg-white shadow-xl dark:bg-slate-800"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between border-b border-slate-100 p-4 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-violet-500" />
            <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
              记忆管理
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 主体：两栏 */}
        <div className="grid flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 md:grid-cols-2">
          {/* 全局记忆 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                全局记忆
              </h3>
              <span className="text-xs text-slate-400">
                {globalMemory.length} 条 · 跨项目
              </span>
            </div>
            <div className="flex gap-1">
              <input
                value={globalDraft}
                onChange={(e) => setGlobalDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddGlobal();
                }}
                placeholder="添加全局记忆条目..."
                className="flex-1 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-violet-400 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
              />
              <button
                onClick={handleAddGlobal}
                disabled={!globalDraft.trim()}
                className="inline-flex items-center gap-1 rounded bg-violet-600 px-2 py-1 text-xs text-white hover:bg-violet-700 disabled:opacity-50"
              >
                <Plus size={12} />
                添加
              </button>
            </div>
            <div className="space-y-1.5">
              {globalMemory.length === 0 ? (
                <div className="rounded border border-dashed border-slate-200 p-3 text-center text-xs text-slate-400 dark:border-slate-600">
                  暂无全局记忆
                </div>
              ) : (
                globalMemory.map((entry) => (
                  <MemoryItem
                    key={entry.id}
                    entry={entry}
                    onUpdate={(content) => updateGlobalMemory(entry.id, content)}
                    onDelete={() => deleteGlobalMemory(entry.id)}
                  />
                ))
              )}
            </div>
          </div>

          {/* 项目记忆 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                项目记忆
              </h3>
              <span className="text-xs text-slate-400 truncate max-w-[120px]">
                {currentProject ? currentProject.name : '未选择项目'}
              </span>
            </div>
            {currentProject ? (
              <>
                <div className="flex gap-1">
                  <input
                    value={projectDraft}
                    onChange={(e) => setProjectDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddProject();
                    }}
                    placeholder="添加项目记忆条目..."
                    className="flex-1 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-violet-400 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
                  />
                  <button
                    onClick={handleAddProject}
                    disabled={!projectDraft.trim()}
                    className="inline-flex items-center gap-1 rounded bg-violet-600 px-2 py-1 text-xs text-white hover:bg-violet-700 disabled:opacity-50"
                  >
                    <Plus size={12} />
                    添加
                  </button>
                </div>
                <div className="space-y-1.5">
                  {projectMemory.length === 0 ? (
                    <div className="rounded border border-dashed border-slate-200 p-3 text-center text-xs text-slate-400 dark:border-slate-600">
                      暂无项目记忆
                    </div>
                  ) : (
                    projectMemory.map((entry) => (
                      <MemoryItem
                        key={entry.id}
                        entry={entry}
                        onUpdate={(content) =>
                          updateProjectMemory(entry.id, content)
                        }
                        onDelete={() => deleteProjectMemory(entry.id)}
                      />
                    ))
                  )}
                </div>
              </>
            ) : (
              <div className="rounded border border-dashed border-slate-200 p-3 text-center text-xs text-slate-400 dark:border-slate-600">
                请先选择一个项目
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default MemoryPanel;
