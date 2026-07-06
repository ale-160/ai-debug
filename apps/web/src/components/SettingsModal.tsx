"use client";

import { useEffect, useState } from "react";
import { useDialogA11y } from "@/hooks/useDialogA11y";
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
} from "lucide-react";
import { toast } from "sonner";
import {
  loadConfig,
  saveConfig,
  PROVIDER_PRESETS,
  type LLMConfig,
  type LLMProvider,
} from "@/lib/llm-config";
import { testLLMConnection } from "@/lib/llm-client";
import { useDebugStore } from "@/lib/debug-store";
import { StorageManager } from "./StorageManager";
import { useTranslation } from "@/components/I18nProvider";
import type { AppSettings } from "./node-flow/types";
import { emit, NODE_EVENTS } from "./node-flow/event-bus";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

// 测试连接结果状态
interface TestResult {
  success: boolean;
  message: string;
}

type SettingsTab = "api" | "memory" | "data";

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { t, tf } = useTranslation();

  // 当前 Tab
  const [activeTab, setActiveTab] = useState<SettingsTab>("api");

  // 表单字段
  const [provider, setProvider] = useState<LLMProvider>("mimo");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");

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
      setProvider("mimo");
      setApiKey("");
      setBaseUrl(preset.baseUrl);
      setModel(preset.model);
    }
    // 同步应用设置到本地草稿
    setSettingsDraft(appSettings);
    // 重置测试状态
    setTestResult(null);
    setShowKey(false);
  }, [open, appSettings]);

  // ESC 键关闭弹窗
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
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
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
            {t.settings}
          </h2>
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
            onClick={() => setActiveTab("api")}
            className={`flex items-center gap-1.5 px-6 py-2.5 text-sm font-medium transition-colors ${
              activeTab === "api"
                ? "border-b-2 border-violet-500 text-violet-600 dark:text-violet-300"
                : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            <Key className="h-4 w-4" />
            {t.apiConfig}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("memory")}
            className={`flex items-center gap-1.5 px-6 py-2.5 text-sm font-medium transition-colors ${
              activeTab === "memory"
                ? "border-b-2 border-violet-500 text-violet-600 dark:text-violet-300"
                : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
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
            onClick={() => setActiveTab("data")}
            className={`flex items-center gap-1.5 px-6 py-2.5 text-sm font-medium transition-colors ${
              activeTab === "data"
                ? "border-b-2 border-cyan-500 text-cyan-600 dark:text-cyan-300"
                : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            <Database className="h-4 w-4" />
            {t.dataManagement}
          </button>
        </div>

        {/* Tab 内容 */}
        <div className="px-6 py-4">
          {activeTab === "api" && (
            <div className="space-y-4">
              {/* Provider 选择 */}
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                  {t.provider}
                </label>
                <select
                  value={provider}
                  onChange={(e) =>
                    handleProviderChange(e.target.value as LLMProvider)
                  }
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
                    type={showKey ? "text" : "password"}
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
                    {showKey ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
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
                  {provider !== "custom" && (
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
                {showModelHelp && provider !== "custom" && (
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
                      ? "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-200"
                      : "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-200"
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
            </div>
          )}

          {activeTab === "memory" && (
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
                <p className="mt-1 text-[10px] text-slate-400">
                  {t.userRulesNote}
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
          {activeTab === "data" && (
            <div className="space-y-4">
              <StorageManager />
            </div>
          )}
        </div>

        {/* 操作按钮：仅 API/记忆 Tab 显示保存取消，数据管理 Tab 内部自带操作 */}
        {activeTab !== "data" && (
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
