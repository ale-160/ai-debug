'use client';

import React, { useState, useCallback, useEffect, useRef, lazy, Suspense } from 'react';
import { ReactFlowProvider } from 'reactflow';
import {
  Send,
  Settings,
  Sun,
  Moon,
  Laptop,
  Menu,
  HelpCircle,
  Network,
  Heart,
  Globe,
  Paperclip,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';

import NodeCanvas from './NodeCanvas';
import { useTheme, resolveTheme } from '@/components/ThemeProvider';
import { useDebugStore } from '@/lib/debug-store';
import { streamTurnResponse } from '@/lib/network-engine';
import { buildMemoryContext } from '@/lib/memory-engine';
import { isConfigured, maskKey } from '@/lib/llm-config';
import { hitlEventBus } from '@/lib/hitl-event-bus';
import { useTranslation, I18nProvider } from '@/components/I18nProvider';
import { useRouter } from 'next/navigation';
import { getStrings, type Language } from '@/data/i18n';
import ExecutionStatusBar from './ExecutionStatusBar';
import { on as onEvent, NODE_EVENTS, type ConflictDecisionPayload } from './event-bus';
import type { ConflictDecision } from './ConflictDecisionModal';
import type { NodeAttachment } from './types';
import { processFiles, MAX_FILE_SIZE } from '@/lib/attachment-helpers';
import AttachmentChips from './inspector/AttachmentChips';

// 快捷键帮助面板懒加载，用户点击帮助按钮后才渲染
const KeyboardShortcuts = lazy(() => import('./KeyboardShortcuts'));
// P1-1 命令面板懒加载：用户按 Alt+F 后才加载
const CommandPalette = lazy(() => import('./CommandPalette'));
// P1-3 快照管理面板懒加载：用户从命令面板或工具栏入口打开后才加载
const SnapshotManager = lazy(() => import('./SnapshotManager'));
// 自动推演对话框懒加载，用户点击"自动推演"入口按钮后才渲染
const AutoEvolutionDialog = lazy(() => import('./AutoEvolutionDialog'));
// P2-3 冲突决策 Modal 懒加载：检测到冲突或用户点击「人工决策」时才加载
const ConflictDecisionModal = lazy(() => import('./ConflictDecisionModal'));
// 模态框懒加载：用户点击设置/记忆按钮后才加载，避免首屏打包
const SettingsModal = lazy(() =>
  import('@/components/SettingsModal').then((m) => ({ default: m.SettingsModal })),
);
const MemoryPanel = lazy(() => import('@/components/MemoryPanel'));
// 技能管理面板懒加载：用户点击技能管理入口后才加载
const SkillManager = lazy(() => import('./SkillManager'));
// 侧边栏/检查器懒加载：首屏只需画布，侧边栏/Inspector 延迟加载
const NodeSidebar = lazy(() => import('./NodeSidebar'));
const NodeInspector = lazy(() => import('./NodeInspector'));
// Toaster 懒加载：用户可能根本看不到 toast，延迟加载 sonner 的 Toaster 组件
const Toaster = lazy(() => import('sonner').then((m) => ({ default: m.Toaster })));

function TopNav({ onShowHelp }: { onShowHelp: () => void }) {
  const { t, toggleLanguage } = useTranslation();
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();
  const llmConfig = useDebugStore((s) => s.llmConfig);
  const setShowSettings = useDebugStore((s) => s.setShowSettings);
  const toggleMobileSidebar = useDebugStore((s) => s.toggleMobileSidebar);

  // SSR/CSR 一致：初始值 'light'（与 resolveTheme('system') SSR 返回值一致），
  // 客户端挂载后 useEffect 中重新 resolve 获取真实主题（可能为 'dark'）。
  // 这样 title 属性在 hydration 首次渲染时与 SSR 输出一致，避免 hydration warning。
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light');
  useEffect(() => {
    setResolvedTheme(resolveTheme(theme));
  }, [theme]);

  const configured = !!llmConfig && !!llmConfig.apiKey && !!llmConfig.baseUrl && !!llmConfig.model;
  const maskedKey = llmConfig ? maskKey(llmConfig.apiKey) : '';

  const handleHelp = () => {
    onShowHelp();
  };

  const handleToggleLanguage = () => {
    const nextLang = toggleLanguage();
    // 同步路由跳转，确保 URL 与语言一致
    if (nextLang === 'zh') {
      router.replace('/zh');
    } else {
      router.replace('/');
    }
    const newT = getStrings(nextLang);
    toast.success(newT.languageSwitched);
  };

  return (
    <header className="relative h-14 bg-white border-b border-slate-200 flex items-center justify-between px-4 shrink-0 z-20 dark:bg-slate-900 dark:border-slate-700">
      {/* 左侧：汉堡菜单（移动端）+ Logo */}
      <div className="flex items-center gap-2">
        <button
          onClick={toggleMobileSidebar}
          className="md:hidden p-1.5 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors dark:text-slate-300 dark:hover:bg-slate-800"
          aria-label={t.toggleSidebar}
        >
          <Menu size={18} />
        </button>
        <div className="flex items-center gap-2">
          <Network className="w-5 h-5 text-violet-600" />
          <span className="font-bold text-slate-800 text-base dark:text-slate-100">AI Debug</span>
        </div>
      </div>

      {/* 右侧：API Key 徽章 + 主题切换 + 帮助 */}
      <div className="flex items-center gap-1">
        {configured ? (
          <button
            onClick={() => setShowSettings(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-green-50 border border-green-200 rounded text-xs font-medium text-green-700 hover:bg-green-100 transition-colors dark:bg-green-900/30 dark:border-green-800 dark:text-green-300"
            title={t.clickToModify}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
            {maskedKey}
          </button>
        ) : (
          <button
            onClick={() => setShowSettings(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-red-50 border border-red-200 rounded text-xs font-medium text-red-700 hover:bg-red-100 transition-colors dark:bg-red-900/30 dark:border-red-800 dark:text-red-300"
            title={t.clickToConfigure}
          >
            <Settings size={12} />
            {t.notConfigured}
          </button>
        )}
        <button
          onClick={toggleTheme}
          className="p-1.5 text-slate-400 hover:text-amber-500 hover:bg-amber-50 rounded transition-colors dark:hover:bg-slate-800 active:bg-amber-100 dark:active:bg-slate-700"
          title={
            theme === 'light'
              ? t.darkMode
              : theme === 'dark'
                ? t.systemMode
                : resolvedTheme === 'dark'
                  ? t.lightMode
                  : t.darkMode
          }
          aria-label={t.toggleTheme}
        >
          {theme === 'light' ? (
            <Sun size={16} />
          ) : theme === 'dark' ? (
            <Moon size={16} />
          ) : (
            <Laptop size={16} />
          )}
        </button>
        <button
          onClick={handleToggleLanguage}
          className="p-1.5 text-slate-400 hover:text-violet-500 hover:bg-violet-50 rounded transition-colors dark:hover:bg-slate-800"
          title={t.language}
          aria-label={t.language}
        >
          <Globe size={16} />
        </button>
        <button
          onClick={handleHelp}
          className="p-1.5 text-slate-400 hover:text-violet-500 hover:bg-violet-50 rounded transition-colors dark:hover:bg-slate-800"
          title={t.help}
          aria-label={t.help}
        >
          <HelpCircle size={16} />
        </button>
        <button
          onClick={() => setShowSettings(true)}
          className="p-1.5 text-slate-400 hover:text-blue-500 hover:bg-blue-50 rounded transition-colors dark:hover:bg-slate-800"
          title={t.settings}
          aria-label={t.settings}
        >
          <Settings size={16} />
        </button>
      </div>
    </header>
  );
}

function EmptyStateInput() {
  const { t, tf } = useTranslation();
  const [input, setInput] = useState('');
  /** PR-2: 附件列表（提交后清空，由 createTurnNode 携带到根节点 data） */
  const [attachments, setAttachments] = useState<NodeAttachment[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // ref 缓存 attachments，避免 handler 频繁重建（useEffect 同步，避免 render 阶段写 ref）
  const attachmentsRef = useRef(attachments);
  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);
  const createTurnNode = useDebugStore((s) => s.createTurnNode);
  const updateTurnNode = useDebugStore((s) => s.updateTurnNode);
  const appendAssistantChunk = useDebugStore((s) => s.appendAssistantChunk);
  const createProject = useDebugStore((s) => s.createProject);
  // 当前流式请求的 AbortController：用于在发起新请求前取消旧请求
  const abortRef = useRef<AbortController | null>(null);

  /** 处理文件列表：调用 processFiles 合并到现有附件，并对 failed 项 toast 提示 */
  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      setIsProcessing(true);
      try {
        const newAtts = await processFiles(files);
        setAttachments([...attachmentsRef.current, ...newAtts]);
        const failed = newAtts.filter((a) => a.parseStatus === 'failed');
        if (failed.length > 0) {
          const tooLarge = failed.filter((a) => a.parseError?.includes('exceeds'));
          if (tooLarge.length > 0) {
            toast.warning(
              tf('attachmentTooLarge', { max: Math.floor(MAX_FILE_SIZE / 1024 / 1024) }),
            );
          } else {
            for (const f of failed) {
              toast.error(tf('attachmentParseFailed', { message: f.parseError ?? '' }));
            }
          }
        }
      } finally {
        setIsProcessing(false);
      }
    },
    [tf],
  );

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      const files = e.dataTransfer.files;
      if (files && files.length > 0) void addFiles(files);
    },
    [addFiles],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageFiles: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault();
        void addFiles(imageFiles);
      }
    },
    [addFiles],
  );

  const handleFileInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      await addFiles(files);
      e.target.value = '';
    },
    [addFiles],
  );

  const handleSubmit = useCallback(async () => {
    const userMessage = input.trim();
    if (!userMessage) return;

    if (!isConfigured()) {
      alert(t.pleaseConfigureApiKey);
      return;
    }

    // 草稿态（初始 / 新建）：用首条消息派生项目名，创建并绑定项目后再建节点
    if (!useDebugStore.getState().currentProjectId) {
      const name = userMessage.length > 20 ? `${userMessage.slice(0, 20)}...` : userMessage;
      createProject(name);
    }

    // PR-2: 仅持久化 parseStatus=parsed 的附件，failed 项不写入节点
    const parsedAttachments = attachments.filter((a) => a.parseStatus === 'parsed');
    const newId = createTurnNode(
      userMessage,
      null,
      parsedAttachments.length > 0 ? { attachments: parsedAttachments } : undefined,
    );
    updateTurnNode(newId, { status: 'running' });

    // 读取创建后的最新 nodes 快照（createTurnNode 已同步写入 store）
    const currentNodes = useDebugStore.getState().nodes;

    // 构建注入到 system prompt 的记忆/规则上下文（与 NodeInspector 保持一致）
    const state = useDebugStore.getState();
    const globalMem = state.appSettings.enableGlobalMemory ? state.globalMemory : [];
    const projectMem =
      state.appSettings.enableProjectMemory && state.currentProjectId
        ? (state.projects.find((p) => p.id === state.currentProjectId)?.memory ?? [])
        : [];
    const extraContext =
      buildMemoryContext(state.appSettings.globalRules, globalMem, projectMem) || undefined;

    // 取消前一次流式请求（如有），再发起新请求
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const result = await streamTurnResponse(
      newId,
      currentNodes,
      (delta) => appendAssistantChunk(newId, delta),
      controller.signal,
      (summary) => updateTurnNode(newId, { summary }),
      extraContext,
      // 旁路回调：流式完成后异步生成根节点路径摘要并写入 data.pathSummary
      (pathSummary) => updateTurnNode(newId, { pathSummary }),
    );

    if (result.success) {
      updateTurnNode(newId, {
        status: 'success',
        suggestions: result.suggestions ?? [],
      });
    } else {
      updateTurnNode(newId, {
        status: 'error',
        errorMessage: result.error,
      });
    }

    setInput('');
    setAttachments([]);
  }, [
    input,
    attachments,
    createTurnNode,
    updateTurnNode,
    appendAssistantChunk,
    createProject,
    t.pleaseConfigureApiKey,
  ]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  return (
    <div className="pointer-events-auto w-[560px] max-w-[90%] flex flex-col items-center gap-4">
      <div className="text-center">
        <Network className="w-10 h-10 text-violet-500 mx-auto mb-3" />
        <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">{t.startYourDebug}</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t.startYourDebugDesc}</p>
      </div>
      <div className="w-full bg-white rounded-xl shadow-lg border border-slate-200 p-3 flex flex-col gap-2 dark:bg-slate-800 dark:border-slate-700">
        {/* PR-2: 附件预览区（有附件时显示） */}
        {attachments.length > 0 && (
          <AttachmentChips attachments={attachments} onRemove={removeAttachment} />
        )}

        {/* textarea + 拖拽叠层（拖入文件时显示蓝色虚线边框） */}
        <div className="relative">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            placeholder={t.inputPlaceholder}
            rows={3}
            className={`w-full resize-none text-base text-slate-800 placeholder:text-slate-400 bg-transparent focus:outline-none dark:text-slate-100 dark:placeholder:text-slate-500 rounded-lg p-2 border transition-colors ${
              isDragOver
                ? 'border-blue-400 border-dashed ring-2 ring-blue-200 dark:ring-blue-900/60 bg-blue-50/40 dark:bg-blue-900/20'
                : 'border-transparent'
            }`}
          />
          {/* 拖拽叠层提示 */}
          {isDragOver && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center text-blue-500 text-sm font-medium">
              {t.attachmentDropZone}
            </div>
          )}
          {/* 处理中指示器 */}
          {isProcessing && (
            <div className="absolute top-1.5 right-1.5 inline-flex items-center gap-1 text-xs text-blue-500 bg-white/80 dark:bg-slate-800/80 rounded px-1.5 py-0.5">
              <Loader2 size={12} className="animate-spin" />
              {t.attachmentProcessing}
            </div>
          )}
        </div>

        {/* 隐藏的 file input：multiple + 不限制 accept */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileInputChange}
        />

        {/* 按钮区：添加附件（左）+ 开始 Debug（右，flex-1） */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isProcessing}
            className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-sm text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title={t.attachmentDragDropHint}
          >
            <Paperclip size={14} />
            {t.attachmentButton}
          </button>
          <button
            onClick={() => void handleSubmit()}
            disabled={!input.trim()}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Send size={14} />
            {t.startDebug}
          </button>
        </div>
      </div>
      <p className="text-xs text-slate-400">{t.enterSubmit}</p>
    </div>
  );
}

function EditorInner() {
  const { t } = useTranslation();
  const { toggleTheme } = useTheme();
  const nodes = useDebugStore((s) => s.nodes);
  const selectedNodeId = useDebugStore((s) => s.selectedNodeId);
  const showSettings = useDebugStore((s) => s.showSettings);
  const setShowSettings = useDebugStore((s) => s.setShowSettings);
  const showMemoryPanel = useDebugStore((s) => s.showMemoryPanel);
  const setShowMemoryPanel = useDebugStore((s) => s.setShowMemoryPanel);
  // 自动推演对话框可见性（懒加载，由 NodeSidebar 入口按钮触发）
  const showAutoEvolution = useDebugStore((s) => s.showAutoEvolution);
  const setShowAutoEvolution = useDebugStore((s) => s.setShowAutoEvolution);
  // 技能管理面板可见性（懒加载，由 NodeSidebar 助手 tab 内入口触发）
  const skillManagerOpen = useDebugStore((s) => s.skillManagerOpen);
  const setSkillManagerOpen = useDebugStore((s) => s.setSkillManagerOpen);
  // 客户端挂载后从 localStorage 加载技能列表（SSR 安全）
  const refreshSkills = useDebugStore((s) => s.refreshSkills);
  const refreshLlmConfig = useDebugStore((s) => s.refreshLlmConfig);
  const refreshLlmConfigs = useDebugStore((s) => s.refreshLlmConfigs);
  const refreshChatSessions = useDebugStore((s) => s.refreshChatSessions);
  const refreshProjects = useDebugStore((s) => s.refreshProjects);
  const refreshAppSettings = useDebugStore((s) => s.refreshAppSettings);
  const refreshGlobalMemory = useDebugStore((s) => s.refreshGlobalMemory);

  // hydration 守卫：客户端从 localStorage 加载数据完成前显示骨架，避免闪烁
  const [isHydrated, setIsHydrated] = useState(false);
  // 快捷键帮助面板可见性（懒加载，仅用户点击帮助按钮后渲染）
  const [showShortcuts, setShowShortcuts] = useState(false);
  // P1-1 命令面板可见性（Alt+F 触发）
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  // P1-3 快照管理面板可见性
  const [showSnapshotManager, setShowSnapshotManager] = useState(false);
  // P2-3 待决策的冲突信息（接收 conflict-detected / conflict-decision-requested 事件后写入）
  const [pendingConflict, setPendingConflict] = useState<ConflictDecisionPayload | null>(null);

  const isEmpty = nodes.length === 0;

  // 挂载后从 localStorage 加载 llmConfig/projects/设置/全局记忆/技能/多 LLM 配置/会话，保证首屏 SSR/CSR 一致
  useEffect(() => {
    refreshLlmConfigs();
    refreshLlmConfig();
    refreshProjects();
    refreshAppSettings();
    refreshGlobalMemory();
    refreshSkills();
    refreshChatSessions();
    setIsHydrated(true);
  }, [
    refreshLlmConfig,
    refreshLlmConfigs,
    refreshProjects,
    refreshAppSettings,
    refreshGlobalMemory,
    refreshSkills,
    refreshChatSessions,
  ]);

  // P0-2：跨标签页 storage 事件同步
  // 其他标签页修改 localStorage 时，本标签页收到 storage 事件，按 key 触发对应 refresh。
  // 注意：storage 事件只在跨标签页时触发，本标签页的 setItem 不会触发，因此无需担心循环刷新。
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (!e.key) return;
      switch (e.key) {
        case 'ai-debug:network-projects':
          refreshProjects();
          break;
        case 'ai-debug:skills':
          refreshSkills();
          break;
        case 'ai-debug:llm-config':
          refreshLlmConfig();
          break;
        case 'ai-debug:multi-llm-configs':
        case 'ai-debug:active-llm-config-id':
          refreshLlmConfigs();
          refreshLlmConfig();
          break;
        case 'ai-debug:chat-sessions':
        case 'ai-debug:active-chat-session-id':
          refreshChatSessions();
          break;
        case 'ai-debug:app-settings':
          refreshAppSettings();
          break;
        case 'ai-debug:global-memory':
          refreshGlobalMemory();
          break;
        default:
          // 其他键（theme / user-lang / zustand persist 内部键）由各自 Provider 自行处理
          break;
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [
    refreshProjects,
    refreshSkills,
    refreshLlmConfig,
    refreshLlmConfigs,
    refreshChatSessions,
    refreshAppSettings,
    refreshGlobalMemory,
  ]);

  // 监听 llm-config-updated 事件刷新 store 中的 llmConfig（TopNav 徽章随之更新）
  // 走 event-bus 类型安全事件总线
  useEffect(() => {
    return onEvent(NODE_EVENTS.LlmConfigUpdated, () => {
      refreshLlmConfig();
    });
  }, [refreshLlmConfig]);

  // P2-3：监听 conflict-detected / conflict-decision-requested 事件，弹出冲突决策 Modal。
  // 两个事件 payload 结构相同（ConflictDecisionPayload），统一写入 pendingConflict 状态。
  useEffect(() => {
    const offDetected = onEvent(NODE_EVENTS.ConflictDetected, (payload) => {
      if (payload) setPendingConflict(payload);
    });
    const offRequested = onEvent(NODE_EVENTS.ConflictDecisionRequested, (payload) => {
      if (payload) setPendingConflict(payload);
    });
    return () => {
      offDetected();
      offRequested();
    };
  }, []);

  // 页面关闭/刷新前同步保存当前项目（自动保存的兜底，避免丢失最后几次防抖内的改动）
  useEffect(() => {
    const handleBeforeUnload = () => {
      const state = useDebugStore.getState();
      if (state.currentProjectId && state.isDirty) {
        state.saveProject();
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // P0-1：撤销/重做快捷键（Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z）
  // 在 EditorInner 层监听，直接调用 store.undo()/redo()，避免与 NodeCanvas 的局部快捷键冲突
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      // 输入框中不触发撤销/重做（避免与文本编辑冲突）
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      const isCtrl = e.ctrlKey || e.metaKey;
      if (!isCtrl) return;

      // Ctrl+Z 撤销
      if (!e.shiftKey && (e.key === 'z' || e.key === 'Z') && !e.repeat) {
        e.preventDefault();
        const state = useDebugStore.getState();
        if (state.undoCount > 0) {
          state.undo();
        } else {
          toast(t.undoEmpty);
        }
        return;
      }

      // Ctrl+Y 或 Ctrl+Shift+Z 重做
      if (e.key === 'y' || e.key === 'Y' || (e.shiftKey && (e.key === 'z' || e.key === 'Z'))) {
        if (!e.repeat) {
          e.preventDefault();
          const state = useDebugStore.getState();
          if (state.redoCount > 0) {
            state.redo();
          } else {
            toast(t.redoEmpty);
          }
        }
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [t.undoEmpty, t.redoEmpty]);

  // P1-1：命令面板快捷键（Alt+F）
  // 不在输入框中触发（避免与浏览器默认 Alt+F 行为冲突时仍能正常使用）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.altKey || e.repeat) return;
      if (e.key !== 'f' && e.key !== 'F') return;
      // 在输入框中不触发（避免影响文本编辑）
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }
      e.preventDefault();
      setShowCommandPalette((prev) => !prev);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // hydration 完成前显示骨架，避免空画布闪烁
  if (!isHydrated) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-100 dark:bg-slate-950">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-violet-500" />
          <span className="text-sm text-slate-500">{t.loadingEditor}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-slate-100 dark:bg-slate-950">
      <a href="#main-canvas" className="skip-link">
        {t.skipToContent}
      </a>
      {selectedNodeId && (
        <a href="#inspector" className="skip-link">
          {t.skipToInspector}
        </a>
      )}
      <TopNav onShowHelp={() => setShowShortcuts(true)} />
      <div className="flex-1 flex overflow-hidden relative">
        <Suspense fallback={<div className="w-64 bg-slate-100 dark:bg-slate-900 animate-pulse" />}>
          <NodeSidebar />
        </Suspense>
        <div id="main-canvas" className="flex-1 relative overflow-hidden" tabIndex={-1}>
          <NodeCanvas />
          {isEmpty && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none p-4">
              <EmptyStateInput />
            </div>
          )}
        </div>
        <Suspense fallback={<div className="w-80 bg-white dark:bg-slate-900 animate-pulse" />}>
          <NodeInspector />
        </Suspense>
      </div>
      {/* 页面底部链接：GitHub 仓库 | 赞赏支持 | 阿乐一百六（样式与 web-text 保持一致） */}
      <footer className="flex items-center justify-center gap-4 px-4 py-1.5 border-t border-slate-200 bg-slate-50/50 dark:border-slate-700 dark:bg-slate-900/50 text-xs text-slate-400">
        <a
          href="https://github.com/ale-160/ai-debug"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
          title={t.githubRepo}
        >
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
          </svg>
          <span>{t.githubRepo}</span>
        </a>
        <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">
          |
        </span>
        <a
          href="https://ale160.com/sponsor"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 hover:text-rose-500 dark:text-pink-400 transition-colors"
          title={t.sponsor}
        >
          <Heart className="w-3.5 h-3.5" />
          <span>{t.sponsor}</span>
        </a>
        <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">
          |
        </span>
        <a
          href="https://ale160.com"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 hover:text-blue-500 transition-colors"
          title={t.ale160}
        >
          <img src="https://ale160.com/images/Avatar-SVG.png" alt="" className="w-3.5 h-3.5" />
          <span>{t.ale160}</span>
        </a>
      </footer>
      {showSettings && (
        <Suspense fallback={null}>
          <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />
        </Suspense>
      )}
      {showMemoryPanel && (
        <Suspense fallback={null}>
          <MemoryPanel open={showMemoryPanel} onClose={() => setShowMemoryPanel(false)} />
        </Suspense>
      )}
      <ExecutionStatusBar />
      {showShortcuts && (
        <Suspense fallback={null}>
          <KeyboardShortcuts onClose={() => setShowShortcuts(false)} />
        </Suspense>
      )}
      {showAutoEvolution && (
        <Suspense fallback={null}>
          <AutoEvolutionDialog onClose={() => setShowAutoEvolution(false)} />
        </Suspense>
      )}
      {skillManagerOpen && (
        <Suspense fallback={null}>
          <SkillManager open={skillManagerOpen} onClose={() => setSkillManagerOpen(false)} />
        </Suspense>
      )}
      {showCommandPalette && (
        <Suspense fallback={null}>
          <CommandPalette
            open={showCommandPalette}
            onClose={() => setShowCommandPalette(false)}
            onToggleTheme={toggleTheme}
            onOpenSnapshots={() => setShowSnapshotManager(true)}
          />
        </Suspense>
      )}
      {showSnapshotManager && (
        <Suspense fallback={null}>
          <SnapshotManager
            open={showSnapshotManager}
            onClose={() => setShowSnapshotManager(false)}
          />
        </Suspense>
      )}
      {/* P2-3：冲突决策 Modal，监听 conflict-detected / conflict-decision-requested 后弹出 */}
      {pendingConflict && (
        <Suspense fallback={null}>
          <ConflictDecisionModal
            open={!!pendingConflict}
            conflict={pendingConflict}
            onDecide={(decision: ConflictDecision) => {
              if (!pendingConflict) return;
              // 通过 hitl-event-bus 唤醒等待方（useInspectorActions 中的 subscribe handler）
              hitlEventBus.emit('conflict-resolution', `conflict:${pendingConflict.id}`, {
                decision,
              });
            }}
            onClose={() => setPendingConflict(null)}
          />
        </Suspense>
      )}
      <Suspense fallback={null}>
        <Toaster position="top-center" richColors />
      </Suspense>
    </div>
  );
}

export default function DebugFlowEditor({ lang = 'en' }: { lang?: Language }) {
  return (
    <ReactFlowProvider>
      <I18nProvider defaultLang={lang}>
        <EditorInner />
      </I18nProvider>
    </ReactFlowProvider>
  );
}
