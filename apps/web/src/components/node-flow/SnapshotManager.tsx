// ============================================================
// AI Debug — 画布快照管理面板（P1-3）
//
// 轻量版命名快照 UI：
// 1. 顶部输入名称 + 保存按钮（草稿态/流式请求中禁用）
// 2. 列表显示当前项目的快照（按 createdAt 倒序）
// 3. 每条快照提供「恢复」「删除」操作
// 4. 跨标签页通过 useSyncExternalStore 实时同步
// ============================================================
'use client';

import { useState, useMemo, useSyncExternalStore } from 'react';
import { X, Camera, RotateCcw, Trash2, Loader2 } from 'lucide-react';
import {
  subscribe as subscribeSnapshots,
  getSnapshot as getSnapshotsSnapshot,
  getServerSnapshot as getSnapshotsServerSnapshot,
  listSnapshots,
  deleteSnapshot,
  type CanvasSnapshot,
} from '@/lib/canvas-snapshots-store';
import { useDebugStore } from '@/lib/debug-store';
import { useTranslation } from '@/components/I18nProvider';
import { toast } from 'sonner';

interface SnapshotManagerProps {
  /** 是否打开 */
  open: boolean;
  /** 关闭回调 */
  onClose: () => void;
}

export function SnapshotManager({ open, onClose }: SnapshotManagerProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');

  const currentProjectId = useDebugStore((s) => s.currentProjectId);
  const nodes = useDebugStore((s) => s.nodes);
  const saveSnapshot = useDebugStore((s) => s.saveSnapshot);
  const restoreSnapshot = useDebugStore((s) => s.restoreSnapshot);

  // 订阅快照列表（跨标签页同步）。useSyncExternalStore 返回值用于触发重渲染
  const _snapshotVersion = useSyncExternalStore(
    subscribeSnapshots,
    getSnapshotsSnapshot,
    getSnapshotsServerSnapshot,
  );

  // 当前项目的快照列表（按 createdAt 倒序）
  // 依赖 _snapshotVersion 以便 storage 变化时重新计算
  const snapshots = useMemo<CanvasSnapshot[]>(() => {
    if (!currentProjectId) return [];
    return listSnapshots(currentProjectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProjectId, _snapshotVersion]);

  // 流式请求中禁用保存/恢复
  const isRunning = nodes.some((n) => n.data.status === 'running');
  // 草稿态禁用保存
  const isDraft = !currentProjectId;

  if (!open) return null;

  const handleSave = () => {
    if (isDraft) {
      toast(t.snapshotDraftGuard);
      return;
    }
    if (isRunning) {
      toast(t.snapshotRunningGuard);
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      // 没起名称时用默认值
      const id = saveSnapshot(`快照 ${new Date().toLocaleString()}`);
      if (id) {
        toast.success(t.snapshotSaveSuccess);
        setName('');
      }
      return;
    }
    const id = saveSnapshot(trimmed);
    if (id) {
      toast.success(t.snapshotSaveSuccess);
      setName('');
    }
  };

  const handleRestore = (snap: CanvasSnapshot) => {
    if (isRunning) {
      toast(t.snapshotRunningGuard);
      return;
    }
    const confirmText = t.snapshotRestoreConfirm.replace('{name}', snap.name);
    if (!window.confirm(confirmText)) return;
    const ok = restoreSnapshot(snap.id);
    if (ok) {
      toast.success(t.snapshotRestoreSuccess.replace('{name}', snap.name));
      onClose();
    }
  };

  const handleDelete = (snap: CanvasSnapshot) => {
    const confirmText = t.snapshotDeleteConfirm.replace('{name}', snap.name);
    if (!window.confirm(confirmText)) return;
    deleteSnapshot(snap.id);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[80vh] flex flex-col bg-white dark:bg-[#1c1c1e] rounded-lg shadow-2xl border border-slate-200 dark:border-white/10 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-white/10">
          <div className="flex items-center gap-2">
            <Camera size={16} className="text-violet-500" />
            <h2 className="text-sm font-semibold text-slate-800 dark:text-white/90">
              {t.snapshotManager}
            </h2>
            {snapshots.length > 0 && (
              <span className="text-xs text-slate-400 dark:text-white/40">
                {t.snapshotCount.replace('{count}', String(snapshots.length))}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label={t.close}
            className="text-slate-400 hover:text-slate-600 dark:text-white/40 dark:hover:text-white/70"
          >
            <X size={18} />
          </button>
        </div>

        {/* 保存区 */}
        <div className="px-4 py-3 border-b border-slate-200 dark:border-white/10 bg-slate-50/50 dark:bg-white/[0.02]">
          <div className="flex gap-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave();
              }}
              placeholder={t.snapshotNamePlaceholder}
              disabled={isDraft || isRunning}
              className="flex-1 px-3 py-2 text-sm border border-slate-200 dark:border-white/10 rounded bg-white dark:bg-white/[0.04] text-slate-800 dark:text-white/90 placeholder:text-slate-400 dark:placeholder:text-white/30 focus:outline-none focus:border-violet-400 disabled:opacity-50"
            />
            <button
              onClick={handleSave}
              disabled={isDraft || isRunning}
              className="px-3 py-2 text-sm font-medium text-white bg-violet-500 hover:bg-violet-600 disabled:opacity-50 disabled:cursor-not-allowed rounded flex items-center gap-1.5"
            >
              {isRunning ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
              {t.snapshotSave}
            </button>
          </div>
          {(isDraft || isRunning) && (
            <p className="mt-2 text-xs text-amber-500">
              {isDraft ? t.snapshotDraftGuard : t.snapshotRunningGuard}
            </p>
          )}
        </div>

        {/* 列表区 */}
        <div className="flex-1 overflow-y-auto">
          {snapshots.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-slate-400 dark:text-white/40">
              {t.snapshotNoSnapshots}
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-white/8">
              {snapshots.map((snap) => (
                <li
                  key={snap.id}
                  className="px-4 py-3 flex items-start gap-3 hover:bg-slate-50 dark:hover:bg-white/[0.03]"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-slate-800 dark:text-white/90 truncate">
                      {snap.name}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-white/50 mt-0.5">
                      {snap.nodeCount} {t.nodesCount.replace('{count}', '').trim()}
                      {' · '}
                      {new Date(snap.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <button
                    onClick={() => handleRestore(snap)}
                    disabled={isRunning}
                    aria-label={t.snapshotRestore}
                    className="text-slate-400 hover:text-violet-500 dark:text-white/40 dark:hover:text-violet-400 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <RotateCcw size={14} />
                  </button>
                  <button
                    onClick={() => handleDelete(snap)}
                    aria-label={t.snapshotDelete}
                    className="text-slate-400 hover:text-red-500 dark:text-white/40 dark:hover:text-red-400"
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export default SnapshotManager;
