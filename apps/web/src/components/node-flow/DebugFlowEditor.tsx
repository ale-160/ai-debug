'use client';

import React, { useState, useCallback, useEffect, useRef, lazy, Suspense } from 'react';
import { ReactFlowProvider } from 'reactflow';
import { Send, Settings, Sun, Moon, Laptop, Menu, HelpCircle, Network, Heart, Globe } from 'lucide-react';
import { toast } from 'sonner';

import NodeCanvas from './NodeCanvas';
import NodeSidebar from './NodeSidebar';
import NodeInspector from './NodeInspector';
import { SettingsModal } from '@/components/SettingsModal';
import { MemoryPanel } from '@/components/MemoryPanel';
import { useTheme, resolveTheme } from '@/components/ThemeProvider';
import { useDebugStore } from '@/lib/debug-store';
import { streamTurnResponse } from '@/lib/network-engine';
import { buildMemoryContext } from '@/lib/memory-engine';
import { isConfigured, maskKey } from '@/lib/llm-config';
import { useTranslation, I18nProvider } from '@/components/I18nProvider';
import { useRouter } from 'next/navigation';
import { getStrings, type Language } from '@/data/i18n';
import ExecutionStatusBar from './ExecutionStatusBar';
import { on as onEvent, NODE_EVENTS } from './event-bus';

// 快捷键帮助面板懒加载，用户点击帮助按钮后才渲染
const KeyboardShortcuts = lazy(() => import('./KeyboardShortcuts'));
// 自动推演对话框懒加载，用户点击"自动推演"入口按钮后才渲染
const AutoEvolutionDialog = lazy(() => import('./AutoEvolutionDialog'));

function TopNav({ onShowHelp }: { onShowHelp: () => void }) {
  const { t, toggleLanguage } = useTranslation();
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();
  const currentProjectId = useDebugStore((s) => s.currentProjectId);
  const projects = useDebugStore((s) => s.projects);
  const llmConfig = useDebugStore((s) => s.llmConfig);
  const setShowSettings = useDebugStore((s) => s.setShowSettings);
  const toggleMobileSidebar = useDebugStore((s) => s.toggleMobileSidebar);

  const currentProject = projects.find((p) => p.id === currentProjectId);
  const projectLabel = currentProject?.name ?? t.noProjectSelected;

  const configured =
    !!llmConfig &&
    !!llmConfig.apiKey &&
    !!llmConfig.baseUrl &&
    !!llmConfig.model;
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
          <span className="font-bold text-slate-800 text-base dark:text-slate-100">
            AI Debug
          </span>
        </div>
      </div>

      {/* 中间：当前项目名 */}
      <div className="absolute left-1/2 -translate-x-1/2 hidden sm:block max-w-[40%] truncate">
        <span className="text-sm text-slate-500 dark:text-slate-300">
          {projectLabel}
        </span>
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
                : resolveTheme(theme) === 'dark'
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
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const createTurnNode = useDebugStore((s) => s.createTurnNode);
  const updateTurnNode = useDebugStore((s) => s.updateTurnNode);
  const appendAssistantChunk = useDebugStore((s) => s.appendAssistantChunk);
  const createProject = useDebugStore((s) => s.createProject);
  // 当前流式请求的 AbortController：用于在发起新请求前取消旧请求
  const abortRef = useRef<AbortController | null>(null);

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

    const newId = createTurnNode(userMessage, null);
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
    const extraContext = buildMemoryContext(state.appSettings.globalRules, globalMem, projectMem) || undefined;

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
  }, [input, createTurnNode, updateTurnNode, appendAssistantChunk, createProject]);

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
        <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">
          {t.startYourDebug}
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          {t.startYourDebugDesc}
        </p>
      </div>
      <div className="w-full bg-white rounded-xl shadow-lg border border-slate-200 p-3 flex items-end gap-2 dark:bg-slate-800 dark:border-slate-700">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t.inputPlaceholder}
          rows={3}
          className="flex-1 resize-none text-base text-slate-800 placeholder:text-slate-400 bg-transparent focus:outline-none dark:text-slate-100 dark:placeholder:text-slate-500"
        />
        <button
          onClick={() => void handleSubmit()}
          disabled={!input.trim()}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Send size={14} />
          {t.startDebug}
        </button>
      </div>
      <p className="text-xs text-slate-400">{t.enterSubmit}</p>
    </div>
  );
}

function EditorInner() {
  const { t } = useTranslation();
  const nodes = useDebugStore((s) => s.nodes);
  const showSettings = useDebugStore((s) => s.showSettings);
  const setShowSettings = useDebugStore((s) => s.setShowSettings);
  const showMemoryPanel = useDebugStore((s) => s.showMemoryPanel);
  const setShowMemoryPanel = useDebugStore((s) => s.setShowMemoryPanel);
  // 自动推演对话框可见性（懒加载，由 NodeSidebar 入口按钮触发）
  const showAutoEvolution = useDebugStore((s) => s.showAutoEvolution);
  const setShowAutoEvolution = useDebugStore((s) => s.setShowAutoEvolution);
  const refreshLlmConfig = useDebugStore((s) => s.refreshLlmConfig);
  const refreshProjects = useDebugStore((s) => s.refreshProjects);
  const refreshAppSettings = useDebugStore((s) => s.refreshAppSettings);
  const refreshGlobalMemory = useDebugStore((s) => s.refreshGlobalMemory);

  // hydration 守卫：客户端从 localStorage 加载数据完成前显示骨架，避免闪烁
  const [isHydrated, setIsHydrated] = useState(false);
  // 快捷键帮助面板可见性（懒加载，仅用户点击帮助按钮后渲染）
  const [showShortcuts, setShowShortcuts] = useState(false);

  const isEmpty = nodes.length === 0;

  // 挂载后从 localStorage 加载 llmConfig/projects/设置/全局记忆，保证首屏 SSR/CSR 一致
  useEffect(() => {
    refreshLlmConfig();
    refreshProjects();
    refreshAppSettings();
    refreshGlobalMemory();
    setIsHydrated(true);
  }, [refreshLlmConfig, refreshProjects, refreshAppSettings, refreshGlobalMemory]);

  // 监听 llm-config-updated 事件刷新 store 中的 llmConfig（TopNav 徽章随之更新）
  // 走 event-bus 类型安全事件总线
  useEffect(() => {
    return onEvent(NODE_EVENTS.LlmConfigUpdated, () => {
      refreshLlmConfig();
    });
  }, [refreshLlmConfig]);

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
      <TopNav onShowHelp={() => setShowShortcuts(true)} />
      <div className="flex-1 flex overflow-hidden relative">
        <NodeSidebar />
        <div id="main-canvas" className="flex-1 relative overflow-hidden" tabIndex={-1}>
          <NodeCanvas />
          {isEmpty && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none p-4">
              <EmptyStateInput />
            </div>
          )}
        </div>
        <NodeInspector />
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
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
          </svg>
          <span>{t.githubRepo}</span>
        </a>
        <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">|</span>
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
        <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">|</span>
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
      <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />
      <MemoryPanel open={showMemoryPanel} onClose={() => setShowMemoryPanel(false)} />
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
