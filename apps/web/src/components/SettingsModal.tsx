'use client';

import { useEffect, useState } from 'react';
import { useDialogA11y } from '@/hooks/useDialogA11y';
import {
  AlertCircle,
  Check,
  Eye,
  EyeOff,
  ExternalLink,
  HelpCircle,
  Loader2,
  X,
  Brain,
  Key,
  Database,
  Palette,
  Plus,
  Pencil,
  Trash2,
  Power,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  loadConfig,
  saveConfig,
  PROVIDER_PRESETS,
  maskKey,
  type LLMConfig,
  type LLMProvider,
} from '@/lib/llm-config';
import { testLLMConnection } from '@/lib/llm-client';
import { useDebugStore } from '@/lib/debug-store';
import type { LLMConfigEntry } from '@/lib/multi-llm-config';
import {
  THEME_PRESETS,
  loadThemePresetId,
  setThemePreset,
  type ThemePresetId,
} from '@/lib/theme-presets';
import { StorageManager } from './StorageManager';
import { useTranslation } from '@/components/I18nProvider';
import type { AppSettings, PathSummaryConfig } from './node-flow/types';
import { emit, NODE_EVENTS } from './node-flow/event-bus';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

// 测试连接结果状态
interface TestResult {
  success: boolean;
  message: string;
}

type SettingsTab = 'api' | 'memory' | 'data' | 'appearance';

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { t, tf } = useTranslation();

  // 当前 Tab
  const [activeTab, setActiveTab] = useState<SettingsTab>('api');

  // 表单字段
  const [provider, setProvider] = useState<LLMProvider>('mimo');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');

  // UI 状态
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [showModelHelp, setShowModelHelp] = useState(false);

  // 应用设置（记忆/冲突/规则）：从 store 读取，本地编辑，保存时回写
  const appSettings = useDebugStore((s) => s.appSettings);
  const updateAppSettings = useDebugStore((s) => s.updateAppSettings);
  const setShowMemoryPanel = useDebugStore((s) => s.setShowMemoryPanel);
  const [settingsDraft, setSettingsDraft] = useState<AppSettings>(appSettings);

  // 多 LLM 配置管理（PR-3）
  const llmConfigs = useDebugStore((s) => s.llmConfigs);
  const activeLlmConfigId = useDebugStore((s) => s.activeLlmConfigId);
  const addLlmConfig = useDebugStore((s) => s.addLlmConfig);
  const removeLlmConfig = useDebugStore((s) => s.removeLlmConfig);
  const switchLlmConfig = useDebugStore((s) => s.switchLlmConfig);
  // 编辑中的配置 id（null = 新增模式）
  const [editingConfigId, setEditingConfigId] = useState<string | null>(null);

  // 主题色预设：从 localStorage 读取，点击色块时即时切换
  const [themePresetId, setThemePresetId] = useState<ThemePresetId>('blue');

  // 打开弹窗时从 localStorage 读取当前配置初始化表单
  useEffect(() => {
    if (!open) return;
    const config = loadConfig();
    if (config) {
      setProvider(config.provider);
      setApiKey(config.apiKey);
      setBaseUrl(config.baseUrl);
      setModel(config.model);
    } else {
      // 无配置时使用 mimo preset 作为默认值（mimo 为首选服务商）
      const preset = PROVIDER_PRESETS.mimo;
      setProvider('mimo');
      setApiKey('');
      setBaseUrl(preset.baseUrl);
      setModel(preset.model);
    }
    // 同步应用设置到本地草稿
    setSettingsDraft(appSettings);
    // 同步当前主题色预设
    setThemePresetId(loadThemePresetId());
    // 重置测试状态
    setTestResult(null);
    setShowKey(false);
  }, [open, appSettings]);

  // ESC 键关闭弹窗
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  // 切换 Provider：若当前 baseUrl/model 为空或等于上一个 preset，则自动填充新 preset
  const handleProviderChange = (next: LLMProvider) => {
    const prevPreset = PROVIDER_PRESETS[provider];
    const nextPreset = PROVIDER_PRESETS[next];

    setProvider(next);
    // 仅在用户未手动修改（仍为旧 preset 或为空）时自动覆盖
    if (!baseUrl || baseUrl === prevPreset.baseUrl) {
      setBaseUrl(nextPreset.baseUrl);
    }
    if (!model || model === prevPreset.model) {
      setModel(nextPreset.model);
    }
    // 切换 provider 后清空旧的测试结果
    setTestResult(null);
    setShowModelHelp(false);
  };

  // 当前生效的 pathSummary 配置：用户覆盖 > provider 预设
  // settingsDraft.pathSummaryConfig 为 undefined 时显示 provider 预设（向后兼容老数据）
  const activePathSummaryConfig: PathSummaryConfig =
    settingsDraft.pathSummaryConfig ?? PROVIDER_PRESETS[provider].pathSummary;

  // 更新 pathSummaryConfig 字段：首次编辑时从 provider 预设 materialize 为显式对象
  const updatePathSummaryConfig = (patch: Partial<PathSummaryConfig>) => {
    const base = settingsDraft.pathSummaryConfig ?? PROVIDER_PRESETS[provider].pathSummary;
    setSettingsDraft({
      ...settingsDraft,
      pathSummaryConfig: { ...base, ...patch },
    });
  };

  // 测试连接
  const handleTest = async () => {
    if (!apiKey.trim()) {
      setTestResult({ success: false, message: t.pleaseFillApiKey });
      return;
    }
    if (!baseUrl.trim()) {
      setTestResult({ success: false, message: t.pleaseFillBaseUrl });
      return;
    }
    if (!model.trim()) {
      setTestResult({ success: false, message: t.pleaseFillModelName });
      return;
    }

    setTesting(true);
    setTestResult(null);
    try {
      const config: LLMConfig = {
        provider,
        apiKey: apiKey.trim(),
        baseUrl: baseUrl.trim(),
        model: model.trim(),
      };
      const result = await testLLMConnection(config);
      setTestResult(result);
    } finally {
      setTesting(false);
    }
  };

  // 保存配置
  const handleSave = () => {
    const config: LLMConfig = {
      provider,
      apiKey: apiKey.trim(),
      baseUrl: baseUrl.trim(),
      model: model.trim(),
    };
    saveConfig(config);
    // 同步保存应用设置（记忆/冲突/规则）
    updateAppSettings(settingsDraft);
    // 通知全局配置已更新（走类型安全事件总线）
    emit(NODE_EVENTS.LlmConfigUpdated);
    toast.success(t.settingsSaved);
    onClose();
  };

  // ===== 多 LLM 配置管理（PR-3）=====

  /** 把当前表单内容保存为新的预设配置 */
  const handleSaveAsPreset = () => {
    const name = window.prompt(t.llmConfigNamePrompt);
    if (!name || !name.trim()) return;
    const config: LLMConfig = {
      provider,
      apiKey: apiKey.trim(),
      baseUrl: baseUrl.trim(),
      model: model.trim(),
    };
    const entry = addLlmConfig({ name: name.trim(), config });
    // 自动激活新增的配置
    switchLlmConfig(entry.id);
    emit(NODE_EVENTS.LlmConfigUpdated);
    toast.success(t.llmConfigSaved);
  };

  /** 把当前表单内容写回编辑中的配置 */
  const handleSavePresetEdit = () => {
    if (!editingConfigId) return;
    const config: LLMConfig = {
      provider,
      apiKey: apiKey.trim(),
      baseUrl: baseUrl.trim(),
      model: model.trim(),
    };
    const entry = addLlmConfig({ id: editingConfigId, name: nameFromId(editingConfigId), config });
    switchLlmConfig(entry.id);
    emit(NODE_EVENTS.LlmConfigUpdated);
    toast.success(t.llmConfigSaved);
    setEditingConfigId(null);
  };

  /** 根据 id 从 llmConfigs 取 name */
  function nameFromId(id: string): string {
    return llmConfigs.find((c) => c.id === id)?.name ?? '未命名';
  }

  /** 激活某个配置：调用 switchLlmConfig，同时把表单字段更新为该配置的值 */
  const handleActivatePreset = (entry: LLMConfigEntry) => {
    setProvider(entry.config.provider);
    setApiKey(entry.config.apiKey);
    setBaseUrl(entry.config.baseUrl);
    setModel(entry.config.model);
    switchLlmConfig(entry.id);
    saveConfig(entry.config);
    emit(NODE_EVENTS.LlmConfigUpdated);
    toast.success(tf('llmConfigActivated', { name: entry.name }));
  };

  /** 编辑某个配置：把表单字段填充为该配置的值 */
  const handleEditPreset = (entry: LLMConfigEntry) => {
    setProvider(entry.config.provider);
    setApiKey(entry.config.apiKey);
    setBaseUrl(entry.config.baseUrl);
    setModel(entry.config.model);
    setEditingConfigId(entry.id);
    setTestResult(null);
    setShowModelHelp(false);
  };

  /** 删除某个配置 */
  const handleDeletePreset = (entry: LLMConfigEntry) => {
    removeLlmConfig(entry.id);
    emit(NODE_EVENTS.LlmConfigUpdated);
    toast.success(t.llmConfigDeleted);
    // 若编辑中的配置被删除，退出编辑模式
    if (editingConfigId === entry.id) {
      setEditingConfigId(null);
    }
  };

  const dialogRef = useDialogA11y(open, onClose);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="w-full max-w-lg rounded-lg bg-white shadow-xl dark:bg-slate-800"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t.settings}
        tabIndex={-1}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-slate-700">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">{t.settings}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200"
            aria-label={t.close}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tab 切换栏 */}
        <div className="flex border-b border-slate-100 dark:border-slate-700">
          <button
            type="button"
            onClick={() => setActiveTab('api')}
            className={`flex items-center gap-1.5 px-6 py-2.5 text-sm font-medium transition-colors ${
              activeTab === 'api'
                ? 'border-b-2 border-violet-500 text-violet-600 dark:text-violet-300'
                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <Key className="h-4 w-4" />
            {t.apiConfig}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('memory')}
            className={`flex items-center gap-1.5 px-6 py-2.5 text-sm font-medium transition-colors ${
              activeTab === 'memory'
                ? 'border-b-2 border-violet-500 text-violet-600 dark:text-violet-300'
                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <Brain className="h-4 w-4" />
            {t.memoryRules}
            <span className="ml-1 inline-flex items-center rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
              Beta
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('data')}
            className={`flex items-center gap-1.5 px-6 py-2.5 text-sm font-medium transition-colors ${
              activeTab === 'data'
                ? 'border-b-2 border-cyan-500 text-cyan-600 dark:text-cyan-300'
                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <Database className="h-4 w-4" />
            {t.dataManagement}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('appearance')}
            className={`flex items-center gap-1.5 px-6 py-2.5 text-sm font-medium transition-colors ${
              activeTab === 'appearance'
                ? 'border-b-2 border-pink-500 text-pink-600 dark:text-pink-300'
                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <Palette className="h-4 w-4" />
            {t.settingsTabAppearance}
          </button>
        </div>

        {/* Tab 内容 */}
        <div className="px-6 py-4">
          {activeTab === 'api' && (
            <div className="space-y-4">
              {/* Provider 选择 */}
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                  {t.provider}
                </label>
                <select
                  value={provider}
                  onChange={(e) => handleProviderChange(e.target.value as LLMProvider)}
                  className="w-full rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:outline-none dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
                >
                  {(Object.keys(PROVIDER_PRESETS) as LLMProvider[]).map((key) => (
                    <option key={key} value={key}>
                      {PROVIDER_PRESETS[key].label}
                    </option>
                  ))}
                </select>
              </div>

              {/* API Key 输入 */}
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                  {t.apiKey}
                </label>
                <div className="relative">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      setTestResult(null);
                    }}
                    placeholder="sk-..."
                    className="w-full rounded border border-slate-200 bg-white px-3 py-2 pr-10 text-sm text-slate-800 focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:outline-none dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((v) => !v)}
                    className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                    aria-label={showKey ? t.hideApiKey : t.showApiKey}
                  >
                    {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Base URL 输入 */}
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                  {t.baseUrl}
                </label>
                <input
                  type="text"
                  value={baseUrl}
                  onChange={(e) => {
                    setBaseUrl(e.target.value);
                    setTestResult(null);
                  }}
                  placeholder="https://api.example.com/v1"
                  className="w-full rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:outline-none dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
                  autoComplete="off"
                />
              </div>

              {/* 模型名输入 */}
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                    {t.modelName}
                  </label>
                  {provider !== 'custom' && (
                    <button
                      type="button"
                      onClick={() => setShowModelHelp((v) => !v)}
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-violet-600 hover:bg-violet-50 hover:text-violet-700 dark:text-violet-300 dark:hover:bg-violet-900/30"
                      title={t.officialGuide}
                    >
                      <HelpCircle className="h-3 w-3" />
                      {t.howToGet}
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  value={model}
                  onChange={(e) => {
                    setModel(e.target.value);
                    setTestResult(null);
                  }}
                  placeholder="gpt-4o-mini"
                  className="w-full rounded border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:outline-none dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
                  autoComplete="off"
                />
                {/* 官方文档链接提示 */}
                {showModelHelp && provider !== 'custom' && (
                  <div className="mt-2 rounded border border-violet-200 bg-violet-50 px-3 py-2 text-xs dark:border-violet-800 dark:bg-violet-900/30">
                    <div className="mb-1 font-medium text-violet-800 dark:text-violet-200">
                      {t.officialGuide}
                    </div>
                    <p className="mb-2 text-violet-700 dark:text-violet-300">
                      {tf('goToProviderConsole', { provider: PROVIDER_PRESETS[provider].label })}
                    </p>
                    <a
                      href={PROVIDER_PRESETS[provider].docsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded bg-violet-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-violet-700"
                    >
                      <ExternalLink className="h-3 w-3" />
                      {PROVIDER_PRESETS[provider].docsLabel}
                    </a>
                  </div>
                )}
              </div>

              {/* 安全提示 */}
              <div className="rounded bg-yellow-50 px-3 py-2 text-xs text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-200">
                {t.apiKeySecurityNote}
              </div>

              {/* 测试连接结果 */}
              {testResult && (
                <div
                  className={`flex items-start gap-2 rounded px-3 py-2 text-xs ${
                    testResult.success
                      ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-200'
                      : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-200'
                  }`}
                >
                  {testResult.success ? (
                    <Check className="mt-0.5 h-4 w-4 shrink-0" />
                  ) : (
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  )}
                  <span className="break-words">{testResult.message}</span>
                </div>
              )}

              {/* 测试连接按钮（API Tab 内） */}
              <button
                type="button"
                onClick={handleTest}
                disabled={testing}
                className="inline-flex items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600"
              >
                {testing && <Loader2 className="h-4 w-4 animate-spin" />}
                {testing ? t.testing : t.testConnection}
              </button>

              {/* ========== 多 LLM 配置管理（PR-3） ========== */}
              <div className="border-t border-slate-200 pt-4 dark:border-slate-700">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                    {t.llmConfigList}
                  </h3>
                  <div className="flex items-center gap-1.5">
                    {/* 编辑模式下的「保存编辑」按钮 */}
                    {editingConfigId && (
                      <button
                        type="button"
                        onClick={handleSavePresetEdit}
                        className="inline-flex items-center gap-1 rounded bg-violet-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-violet-700"
                      >
                        <Check className="h-3 w-3" />
                        {t.save}
                      </button>
                    )}
                    {/* 「保存当前为预设」按钮 */}
                    <button
                      type="button"
                      onClick={handleSaveAsPreset}
                      className="inline-flex items-center gap-1 rounded border border-violet-200 bg-violet-50 px-2 py-1 text-[11px] font-medium text-violet-700 hover:bg-violet-100 dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-300"
                    >
                      <Plus className="h-3 w-3" />
                      {t.llmConfigSaveCurrent}
                    </button>
                  </div>
                </div>

                {/* 已保存的配置列表 */}
                {llmConfigs.length === 0 ? (
                  <p className="rounded border border-dashed border-slate-200 px-3 py-3 text-center text-[11px] text-slate-400 dark:border-slate-700">
                    {t.assistantModelEmpty}
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {llmConfigs.map((entry) => {
                      const isActive = entry.id === activeLlmConfigId;
                      const isEditing = entry.id === editingConfigId;
                      return (
                        <li
                          key={entry.id}
                          className={`flex items-center gap-2 rounded border px-2.5 py-1.5 text-xs ${
                            isActive
                              ? 'border-violet-300 bg-violet-50 dark:border-violet-700 dark:bg-violet-900/20'
                              : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800'
                          }`}
                        >
                          {/* 名称 + 元信息 */}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate font-medium text-slate-700 dark:text-slate-100">
                                {entry.name}
                              </span>
                              {isActive && (
                                <span className="inline-flex items-center rounded bg-violet-100 px-1 py-0.5 text-[9px] font-semibold leading-none text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                                  {t.assistantSessionActive}
                                </span>
                              )}
                              {isEditing && (
                                <span className="inline-flex items-center rounded bg-amber-100 px-1 py-0.5 text-[9px] font-semibold leading-none text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                                  {t.llmConfigEdit}
                                </span>
                              )}
                            </div>
                            <div className="mt-0.5 truncate text-[10px] text-slate-500 dark:text-slate-400">
                              {PROVIDER_PRESETS[entry.config.provider]?.label ?? entry.config.provider}
                              {' · '}
                              {entry.config.model}
                              {' · '}
                              <span className="font-mono">{maskKey(entry.config.apiKey)}</span>
                            </div>
                          </div>

                          {/* 操作按钮组 */}
                          <div className="flex shrink-0 items-center gap-0.5">
                            {!isActive && (
                              <button
                                type="button"
                                onClick={() => handleActivatePreset(entry)}
                                title={t.llmConfigActivate}
                                className="rounded p-1 text-violet-600 hover:bg-violet-100 dark:text-violet-300 dark:hover:bg-violet-900/30"
                              >
                                <Power className="h-3.5 w-3.5" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleEditPreset(entry)}
                              title={t.llmConfigEdit}
                              className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeletePreset(entry)}
                              title={t.llmConfigDeleted}
                              className="rounded p-1 text-slate-500 hover:bg-red-50 hover:text-red-600 dark:text-slate-400 dark:hover:bg-red-900/30 dark:hover:text-red-400"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          )}

          {activeTab === 'memory' && (
            <div className="space-y-4">
              {/* 记忆开关 */}
              <div className="space-y-2">
                <div className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  {t.memoryFunction}
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={settingsDraft.enableGlobalMemory}
                    onChange={(e) =>
                      setSettingsDraft({
                        ...settingsDraft,
                        enableGlobalMemory: e.target.checked,
                      })
                    }
                    className="rounded"
                  />
                  {t.enableGlobalMemory}
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={settingsDraft.enableProjectMemory}
                    onChange={(e) =>
                      setSettingsDraft({
                        ...settingsDraft,
                        enableProjectMemory: e.target.checked,
                      })
                    }
                    className="rounded"
                  />
                  {t.enableProjectMemory}
                </label>
              </div>

              {/* 记忆频率 */}
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                  {t.memoryFrequency}
                </label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={settingsDraft.memoryFrequency}
                  onChange={(e) =>
                    setSettingsDraft({
                      ...settingsDraft,
                      memoryFrequency: Math.max(1, Number(e.target.value) || 1),
                    })
                  }
                  className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet-400 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
                />
              </div>

              {/* 冲突自动检测 */}
              <div className="space-y-2">
                <div className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  {t.conflictDetection}
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={settingsDraft.enableConflictAutoCheck}
                    onChange={(e) =>
                      setSettingsDraft({
                        ...settingsDraft,
                        enableConflictAutoCheck: e.target.checked,
                      })
                    }
                    className="rounded"
                  />
                  {t.enableConflictAutoCheck}
                </label>
                {settingsDraft.enableConflictAutoCheck && (
                  <div>
                    <label className="mb-1 block text-[11px] text-slate-500 dark:text-slate-400">
                      {t.conflictCheckFrequency}
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={settingsDraft.conflictCheckFrequency}
                      onChange={(e) =>
                        setSettingsDraft({
                          ...settingsDraft,
                          conflictCheckFrequency: Math.max(1, Number(e.target.value) || 1),
                        })
                      }
                      className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet-400 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
                    />
                  </div>
                )}
              </div>

              {/* 用户规则（补充指令） */}
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                  {t.userRules}
                </label>
                <textarea
                  value={settingsDraft.globalRules}
                  onChange={(e) =>
                    setSettingsDraft({
                      ...settingsDraft,
                      globalRules: e.target.value,
                    })
                  }
                  placeholder={t.userRulesPlaceholder}
                  rows={3}
                  className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet-400 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
                />
                <p className="mt-1 text-[10px] text-slate-400">{t.userRulesNote}</p>
              </div>

              {/* 可观测性：hover 节点显示路径摘要（默认关闭） */}
              <div className="space-y-2">
                <div className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  {t.observabilitySettings}
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={settingsDraft.hoverShowPathSummary}
                    onChange={(e) =>
                      setSettingsDraft({
                        ...settingsDraft,
                        hoverShowPathSummary: e.target.checked,
                      })
                    }
                    className="rounded"
                  />
                  {t.hoverShowPathSummary}
                </label>
              </div>

              {/* 节点操作入口样式（T024） */}
              <div className="space-y-2">
                <div className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  {t.nodeActionsStyle}
                </div>
                <select
                  value={settingsDraft.nodeActionsStyle}
                  onChange={(e) =>
                    setSettingsDraft({
                      ...settingsDraft,
                      nodeActionsStyle: e.target.value as 'toolbar' | 'context' | 'both',
                    })
                  }
                  className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet-400 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
                >
                  <option value="both">{t.nodeActionsStyleBoth}</option>
                  <option value="toolbar">{t.nodeActionsStyleToolbar}</option>
                  <option value="context">{t.nodeActionsStyleContext}</option>
                </select>
              </div>

              {/* 上下文压缩：pathSummary 混合模式参数（T007） */}
              <div className="space-y-2">
                <div className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  {t.contextCompression}
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={activePathSummaryConfig.enabled}
                    onChange={(e) => updatePathSummaryConfig({ enabled: e.target.checked })}
                    className="rounded"
                  />
                  {t.enableHybridMode}
                </label>
                {activePathSummaryConfig.enabled && (
                  <div className="space-y-2 pl-4">
                    <div>
                      <label className="mb-1 block text-[11px] text-slate-500 dark:text-slate-400">
                        {t.pathLengthThreshold}
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={50}
                        value={activePathSummaryConfig.threshold}
                        onChange={(e) =>
                          updatePathSummaryConfig({
                            threshold: Math.max(1, Number(e.target.value) || 1),
                          })
                        }
                        className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet-400 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] text-slate-500 dark:text-slate-400">
                        {t.recentKeepCount}
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={20}
                        value={activePathSummaryConfig.recentKeep}
                        onChange={(e) =>
                          updatePathSummaryConfig({
                            recentKeep: Math.max(1, Number(e.target.value) || 1),
                          })
                        }
                        className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet-400 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] text-slate-500 dark:text-slate-400">
                        {t.summaryMaxLength}
                      </label>
                      <input
                        type="number"
                        min={100}
                        max={10000}
                        step={100}
                        value={activePathSummaryConfig.maxLength}
                        onChange={(e) =>
                          updatePathSummaryConfig({
                            maxLength: Math.max(100, Number(e.target.value) || 100),
                          })
                        }
                        className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-800 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet-400 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
                      />
                    </div>
                  </div>
                )}
                <p className="text-[10px] leading-relaxed text-slate-400">
                  {t.contextCompressionNote}
                </p>
                <p className="text-[10px] text-slate-400">
                  {t.contextCompressionCurrentPreset}：
                  {PROVIDER_PRESETS[provider].pathSummary.threshold} /{' '}
                  {PROVIDER_PRESETS[provider].pathSummary.recentKeep} /{' '}
                  {PROVIDER_PRESETS[provider].pathSummary.maxLength}
                </p>
              </div>

              {/* 打开记忆管理面板 */}
              <button
                type="button"
                onClick={() => {
                  setShowMemoryPanel(true);
                  onClose();
                }}
                className="w-full rounded border border-violet-200 bg-violet-50 px-2 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-100 dark:border-violet-800 dark:bg-violet-900/30 dark:text-violet-300"
              >
                {t.openMemoryPanel}
              </button>
            </div>
          )}

          {/* 数据管理 Tab */}
          {activeTab === 'data' && (
            <div className="space-y-4">
              <StorageManager />
            </div>
          )}

          {activeTab === 'appearance' && (
            <div className="space-y-6">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">
                  {t.appearanceThemePreset}
                </label>
                <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
                  {t.appearanceThemePresetHint}
                </p>
                <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
                  {THEME_PRESETS.map((preset) => {
                    const isActive = preset.id === themePresetId;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => {
                          setThemePresetId(preset.id);
                          setThemePreset(preset.id);
                        }}
                        aria-label={t[preset.labelKey as keyof typeof t] as string}
                        title={t[preset.labelKey as keyof typeof t] as string}
                        className={`relative flex flex-col items-center gap-1.5 rounded-md border p-3 transition-all ${
                          isActive
                            ? 'border-slate-800 ring-2 ring-slate-800/20 dark:border-white dark:ring-white/20'
                            : 'border-slate-200 hover:border-slate-400 dark:border-slate-700 dark:hover:border-slate-500'
                        }`}
                      >
                        <span
                          className="block h-8 w-8 rounded-full shadow-sm"
                          style={{ backgroundColor: preset.swatch }}
                        />
                        <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
                          {t[preset.labelKey as keyof typeof t] as string}
                        </span>
                        {isActive && (
                          <Check
                            className="absolute right-1 top-1 text-slate-700 dark:text-white"
                            style={{ width: 14, height: 14 }}
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 操作按钮：仅 API/记忆 Tab 显示保存取消，数据管理 Tab 内部自带操作 */}
        {activeTab !== 'data' && (
          <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-6 py-4 dark:border-slate-700">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600"
            >
              {t.cancel}
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="rounded bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:outline-none disabled:opacity-60"
            >
              {t.save}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default SettingsModal;
