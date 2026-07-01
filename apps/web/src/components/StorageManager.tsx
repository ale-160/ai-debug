'use client';

/**
 * 本地存储管理面板
 * 参考 hub-nav-open 的容量展示 + spark-flow 的按 key 清理
 */

import { useEffect, useState } from 'react';
import { Trash2, RefreshCw, AlertTriangle, Database } from 'lucide-react';
import { useDebugStore } from '@/lib/debug-store';
import {
  saveProjects,
  PROJECTS_KEY,
} from '@/lib/project-storage';
import {
  clearGlobalMemory,
  GLOBAL_MEMORY_KEY,
  saveAppSettings,
  APP_SETTINGS_KEY,
} from '@/lib/settings-storage';
import { clearConfig, LLM_CONFIG_KEY } from '@/lib/llm-config';

// localStorage key 显示配置
type KeyInfo = {
  key: string;
  label: string;
  description: string;
  clearFn: () => void;
};

// 字节数格式化
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// 计算 localStorage 中所有 key 的总占用（UTF-16 每字符 2 字节）
function getTotalLocalStorageSize(): number {
  if (typeof window === 'undefined') return 0;
  let total = 0;
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (!key) continue;
    const value = window.localStorage.getItem(key) ?? '';
    // key 和 value 都占空间，UTF-16 每字符 2 字节
    total += (key.length + value.length) * 2;
  }
  return total;
}

// 警告阈值（4MB）和上限（5MB）
const WARNING_THRESHOLD = 4 * 1024 * 1024;
const MAX_QUOTA = 5 * 1024 * 1024;

export function StorageManager() {
  const [totalSize, setTotalSize] = useState(0);
  const [keySizes, setKeySizes] = useState<{ key: string; size: number }[]>([]);
  const [clearing, setClearing] = useState(false);
  const [clearedKey, setClearedKey] = useState<string | null>(null);

  const refreshLlmConfig = useDebugStore((s) => s.refreshLlmConfig);
  const refreshProjects = useDebugStore((s) => s.refreshProjects);
  const refreshAppSettings = useDebugStore((s) => s.refreshAppSettings);
  const refreshGlobalMemory = useDebugStore((s) => s.refreshGlobalMemory);
  const loadProject = useDebugStore((s) => s.loadProject);

  // 刷新存储占用统计
  const refreshSizes = () => {
    setTotalSize(getTotalLocalStorageSize());
    if (typeof window === 'undefined') return;
    const sizes: { key: string; size: number }[] = [];
    const keysToCheck = [
      PROJECTS_KEY,
      GLOBAL_MEMORY_KEY,
      APP_SETTINGS_KEY,
      LLM_CONFIG_KEY,
    ];
    for (const key of keysToCheck) {
      const value = window.localStorage.getItem(key);
      const size = value ? (key.length + value.length) * 2 : 0;
      sizes.push({ key, size });
    }
    // 按大小降序
    sizes.sort((a, b) => b.size - a.size);
    setKeySizes(sizes);
  };

  useEffect(() => {
    refreshSizes();
  }, []);

  // 各 key 的清理函数
  const clearApiKey = () => {
    clearConfig();
    refreshLlmConfig();
    refreshSizes();
    setClearedKey(LLM_CONFIG_KEY);
    setTimeout(() => setClearedKey(null), 2000);
  };

  const clearProjectsKey = () => {
    saveProjects([]);
    refreshProjects();
    refreshSizes();
    setClearedKey(PROJECTS_KEY);
    setTimeout(() => setClearedKey(null), 2000);
  };

  const clearMemoryKey = () => {
    clearGlobalMemory();
    refreshGlobalMemory();
    refreshSizes();
    setClearedKey(GLOBAL_MEMORY_KEY);
    setTimeout(() => setClearedKey(null), 2000);
  };

  const clearSettingsKey = () => {
    // 仅重置设置为默认（不直接清空，避免丢失 API Key 等）
    const defaults = {
      globalRules: '',
      enableGlobalMemory: false,
      enableProjectMemory: false,
      memoryFrequency: 5,
      enableConflictAutoCheck: false,
      conflictCheckFrequency: 5,
      nodeDisplayMode: 'detailed' as const,
    };
    saveAppSettings(defaults);
    refreshAppSettings();
    refreshSizes();
    setClearedKey(APP_SETTINGS_KEY);
    setTimeout(() => setClearedKey(null), 2000);
  };

  const keyInfos: KeyInfo[] = [
    {
      key: PROJECTS_KEY,
      label: '项目数据',
      description: '所有蛛网项目的节点、边、视口、记忆、turnCounter',
      clearFn: clearProjectsKey,
    },
    {
      key: GLOBAL_MEMORY_KEY,
      label: '全局记忆',
      description: '跨项目共享的长期记忆条目',
      clearFn: clearMemoryKey,
    },
    {
      key: APP_SETTINGS_KEY,
      label: '应用设置',
      description: '规则、频率、模式开关等（不含 API Key）',
      clearFn: clearSettingsKey,
    },
    {
      key: LLM_CONFIG_KEY,
      label: 'API 配置',
      description: '服务商、API Key、Base URL、模型',
      clearFn: clearApiKey,
    },
  ];

  // 清空全部数据（危险操作）
  const clearAll = () => {
    if (
      !confirm(
        '确定清空全部本地数据吗？\n\n此操作将删除：\n• 所有项目与节点\n• 全局/项目记忆\n• 应用设置\n• API 配置\n\n删除后无法恢复，建议先导出备份。',
      )
    )
      return;
    setClearing(true);
    try {
      window.localStorage.clear();
      refreshLlmConfig();
      refreshProjects();
      refreshAppSettings();
      refreshGlobalMemory();
      refreshSizes();
      setClearedKey('__all__');
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } finally {
      setClearing(false);
    }
  };

  const usagePercent = Math.min(100, (totalSize / MAX_QUOTA) * 100);
  const isWarning = totalSize >= WARNING_THRESHOLD;

  return (
    <div className="space-y-5">
      {/* 总览卡片 */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-violet-500" />
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            本地存储总览
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-50 dark:bg-slate-800 rounded-md p-3">
            <div className="text-xs text-slate-500 dark:text-slate-400">总占用</div>
            <div
              className={`text-lg font-bold ${
                isWarning
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-slate-700 dark:text-slate-200'
              }`}
            >
              {formatBytes(totalSize)}
            </div>
          </div>
          <div className="bg-slate-50 dark:bg-slate-800 rounded-md p-3">
            <div className="text-xs text-slate-500 dark:text-slate-400">建议上限</div>
            <div className="text-lg font-bold text-slate-700 dark:text-slate-200">
              {formatBytes(MAX_QUOTA)}
            </div>
          </div>
        </div>
        {/* 使用率进度条 */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-slate-500 dark:text-slate-400">使用率</span>
            <span
              className={
                isWarning
                  ? 'text-amber-600 dark:text-amber-400 font-medium'
                  : 'text-slate-500 dark:text-slate-400'
              }
            >
              {usagePercent.toFixed(1)}%
            </span>
          </div>
          <div className="h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all ${
                isWarning ? 'bg-amber-500' : 'bg-violet-500'
              }`}
              style={{ width: `${usagePercent}%` }}
            />
          </div>
        </div>
        {isWarning && (
          <div className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded p-2">
            <AlertTriangle size={12} className="shrink-0 mt-0.5" />
            <span>
              本地存储接近上限，建议导出备份后清理旧项目，避免保存失败导致数据丢失。
            </span>
          </div>
        )}
        <button
          onClick={clearAll}
          disabled={clearing}
          className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-sm bg-red-50 text-red-600 border border-red-200 rounded-md hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors dark:bg-red-900/20 dark:text-red-400 dark:border-red-800 dark:hover:bg-red-900/30"
        >
          {clearing ? (
            <RefreshCw size={14} className="animate-spin" />
          ) : (
            <Trash2 size={14} />
          )}
          {clearing ? '正在清空...' : '清空全部数据'}
        </button>
        {clearedKey === '__all__' && (
          <div className="text-xs text-center text-amber-600 dark:text-amber-400">
            即将刷新页面...
          </div>
        )}
      </div>

      {/* 按 key 分类清理 */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
          按分类清理
        </h4>
        {keyInfos.map((info) => {
          const sizeInfo = keySizes.find((s) => s.key === info.key);
          const size = sizeInfo?.size ?? 0;
          const isCleared = clearedKey === info.key;
          return (
            <div
              key={info.key}
              className="flex items-center justify-between gap-3 rounded-md border border-slate-200 dark:border-slate-700 p-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    {info.label}
                  </span>
                  <span className="text-xs text-slate-400">
                    {formatBytes(size)}
                  </span>
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                  {info.description}
                </div>
              </div>
              <button
                onClick={() => {
                  if (
                    confirm(
                      `确定清理「${info.label}」吗？此操作不可恢复，建议先导出备份。`,
                    )
                  ) {
                    info.clearFn();
                  }
                }}
                disabled={size === 0}
                className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-slate-100 text-slate-600 rounded hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                title={`清理 ${info.label}`}
              >
                {isCleared ? (
                  <RefreshCw size={12} className="animate-spin" />
                ) : (
                  <Trash2 size={12} />
                )}
                {isCleared ? '已清理' : '清理'}
              </button>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-slate-400 dark:text-slate-500">
        提示：浏览器 localStorage 单域名配额约 5MB，适合中小型项目。大型项目建议定期导出备份后清理，避免保存失败。
      </p>
    </div>
  );
}
