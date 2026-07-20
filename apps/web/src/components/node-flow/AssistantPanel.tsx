'use client';

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Send,
  Trash2,
  X,
  Loader2,
  Square,
  Bot,
  User as UserIcon,
  Sparkles,
  ChevronDown,
  Plus,
  MessageSquare,
  Settings as SettingsIcon,
  Zap,
  ZapOff,
} from 'lucide-react';
import { toast } from 'sonner';
import { useDebugStore } from '@/lib/debug-store';
import { useTranslation } from '@/components/I18nProvider';
import { isConfigured, PROVIDER_PRESETS } from '@/lib/llm-config';
import {
  streamAssistantResponse,
  messagesToHistory,
  type CanvasContextSnapshot,
} from '@/lib/agent-engine';
import { generateId } from '@/lib/id';
import type { AssistantMessage, TurnNodeData } from './types';
import type { Node } from 'reactflow';

/** Markdown 渲染组件（复用 NodeInspector 风格，适配助手对话气泡） */
const mdComponents: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
  h1: ({ children }) => <h1 className="text-base font-bold mt-3 mb-2 first:mt-0">{children}</h1>,
  h2: ({ children }) => (
    <h2 className="text-base font-semibold mt-3 mb-2 first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => <h3 className="text-sm font-semibold mt-2 mb-1 first:mt-0">{children}</h3>,
  ul: ({ children }) => <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-blue-600 dark:text-blue-400 underline break-all"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-slate-300 dark:border-slate-600 pl-2 italic text-slate-500 dark:text-slate-400 mb-2">
      {children}
    </blockquote>
  ),
  code: ({ className, children }) => {
    const text = typeof children === 'string' ? children : '';
    // 含语言类名或换行 -> 块级代码（由 <pre> 提供深色背景）；否则为行内代码
    if (className || text.includes('\n')) {
      return <code className={className}>{children}</code>;
    }
    return (
      <code className="bg-slate-100 dark:bg-slate-800 text-pink-600 dark:text-pink-400 px-1 py-0.5 rounded text-xs">
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="bg-slate-800 text-slate-100 p-2 rounded mb-2 overflow-x-auto text-xs">
      {children}
    </pre>
  ),
};

/** 生成助手消息 ID（统一使用 @/lib/id 的 CSPRNG 方案） */
const genAssistantMessageId = () => generateId('asst');

/** 助手对话面板（侧边栏 tab 内嵌） */
export default function AssistantPanel() {
  const { t, tf } = useTranslation();

  // ===== store 读取 =====
  const assistantMessages = useDebugStore((s) => s.assistantMessages);
  const activeSkillId = useDebugStore((s) => s.activeSkillId);
  const skills = useDebugStore((s) => s.skills);
  const llmConfig = useDebugStore((s) => s.llmConfig);
  const selectedNodeId = useDebugStore((s) => s.selectedNodeId);
  const setAssistantPanelOpen = useDebugStore((s) => s.setAssistantPanelOpen);

  // 会话与多 LLM 配置（PR-3）
  const chatSessions = useDebugStore((s) => s.chatSessions);
  const activeChatSessionId = useDebugStore((s) => s.activeChatSessionId);
  const llmConfigs = useDebugStore((s) => s.llmConfigs);
  const activeLlmConfigId = useDebugStore((s) => s.activeLlmConfigId);
  const setShowSettings = useDebugStore((s) => s.setShowSettings);

  // ===== store 写入 =====
  const addAssistantMessage = useDebugStore((s) => s.addAssistantMessage);
  const updateAssistantMessage = useDebugStore((s) => s.updateAssistantMessage);
  const appendAssistantMessageChunk = useDebugStore((s) => s.appendAssistantMessageChunk);
  const clearAssistantMessages = useDebugStore((s) => s.clearAssistantMessages);
  const setActiveSkillId = useDebugStore((s) => s.setActiveSkillId);
  const registerAssistantAbortController = useDebugStore((s) => s.registerAssistantAbortController);
  const abortAssistantStream = useDebugStore((s) => s.abortAssistantStream);
  const createTurnNode = useDebugStore((s) => s.createTurnNode);
  const setSkillManagerOpen = useDebugStore((s) => s.setSkillManagerOpen);

  // 会话与多 LLM 配置 actions（PR-3）
  const createChatSession = useDebugStore((s) => s.createChatSession);
  const switchChatSession = useDebugStore((s) => s.switchChatSession);
  const deleteChatSession = useDebugStore((s) => s.deleteChatSession);
  const persistCurrentChatSession = useDebugStore((s) => s.persistCurrentChatSession);
  const switchLlmConfig = useDebugStore((s) => s.switchLlmConfig);

  // 画布上下文注入 + 自动建图模式（让助手感知画布状态，可切换每次都建图）
  const nodes = useDebugStore((s) => s.nodes);
  const currentProjectId = useDebugStore((s) => s.currentProjectId);
  const projects = useDebugStore((s) => s.projects);
  const appSettings = useDebugStore((s) => s.appSettings);
  const updateAppSettings = useDebugStore((s) => s.updateAppSettings);

  // ===== 本地 UI 状态 =====
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [skillDropdownOpen, setSkillDropdownOpen] = useState(false);
  const [sessionDropdownOpen, setSessionDropdownOpen] = useState(false);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 当前激活的技能对象（用于顶部徽章显示）
  const activeSkill = useMemo(
    () => (activeSkillId ? skills.find((s) => s.id === activeSkillId) : undefined),
    [activeSkillId, skills],
  );

  // 当前激活的会话对象
  const activeSession = useMemo(
    () =>
      activeChatSessionId ? chatSessions.find((s) => s.id === activeChatSessionId) : undefined,
    [activeChatSessionId, chatSessions],
  );

  // 当前激活的 LLM 配置对象
  const activeLlmConfigEntry = useMemo(
    () => (activeLlmConfigId ? llmConfigs.find((c) => c.id === activeLlmConfigId) : undefined),
    [activeLlmConfigId, llmConfigs],
  );

  // API Key 是否已配置
  const configured = useMemo(() => {
    return !!llmConfig && !!llmConfig.apiKey && !!llmConfig.baseUrl && !!llmConfig.model;
  }, [llmConfig]);

  /**
   * 构建画布上下文快照（注入助手 system prompt，让助手感知画布状态）。
   * - 项目名/ID 来自 currentProjectId + projects
   * - 最近节点：按 createdAt 倒序取前 5 个，提取 userMessage 前 120 字
   * - 选中节点路径：从选中节点沿 parentId 链回溯到根，每项取 userMessage 前 80 字
   *
   * 节点变化 / 选中节点变化 / 项目切换时重新计算。
   */
  const canvasSnapshot = useMemo<CanvasContextSnapshot>(() => {
    const currentProject = currentProjectId
      ? projects.find((p) => p.id === currentProjectId)
      : null;
    const turnNodes = nodes.filter((n): n is Node<TurnNodeData> =>
      Boolean(n.data && typeof n.data === 'object'),
    );

    // 最近 5 个节点（按 createdAt 倒序；createdAt 缺失时按数组顺序兜底）
    const recentNodes = [...turnNodes]
      .sort((a, b) => (b.data.createdAt ?? 0) - (a.data.createdAt ?? 0))
      .slice(0, 5)
      .map((n) => ({
        id: n.id,
        userMessagePreview: (n.data.userMessage ?? '').slice(0, 120),
        parentId: n.data.parentId ?? null,
        status: n.data.status ?? 'active',
      }));

    // 选中节点路径：从选中节点沿 parentId 回溯到根
    const selectedPathPreview: Array<{ id: string; userMessagePreview: string }> = [];
    if (selectedNodeId) {
      const byId = new Map(turnNodes.map((n) => [n.id, n]));
      let currentId: string | null = selectedNodeId;
      const visited = new Set<string>(); // 防御环路
      while (currentId && !visited.has(currentId)) {
        visited.add(currentId);
        const n = byId.get(currentId);
        if (!n) break;
        selectedPathPreview.unshift({
          id: n.id,
          userMessagePreview: (n.data.userMessage ?? '').slice(0, 80),
        });
        currentId = n.data.parentId ?? null;
      }
    }

    return {
      projectName: currentProject?.name ?? null,
      projectId: currentProjectId,
      nodeCount: turnNodes.length,
      selectedNodeId: selectedNodeId ?? null,
      recentNodes,
      selectedPathPreview,
    };
  }, [nodes, currentProjectId, projects, selectedNodeId]);

  // 自动建图模式开关（持久化到 appSettings）
  const autoCreateNodes = appSettings.assistantAutoCreateNodes;
  const handleToggleAutoCreate = useCallback(() => {
    updateAppSettings({ assistantAutoCreateNodes: !autoCreateNodes });
    toast.success(autoCreateNodes ? t.assistantAutoCreateOff : t.assistantAutoCreateOn);
  }, [autoCreateNodes, updateAppSettings, t]);

  // 自动滚动到底部（消息列表变化或流式更新时）
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [assistantMessages]);

  // 点击技能下拉外部关闭
  useEffect(() => {
    if (!skillDropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-skill-dropdown]')) {
        setSkillDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [skillDropdownOpen]);

  // 点击会话下拉外部关闭
  useEffect(() => {
    if (!sessionDropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-session-dropdown]')) {
        setSessionDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [sessionDropdownOpen]);

  // 点击模型下拉外部关闭
  useEffect(() => {
    if (!modelDropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-model-dropdown]')) {
        setModelDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [modelDropdownOpen]);

  // 组件卸载时中止流式请求 + 持久化当前会话，避免悬挂和丢失数据
  useEffect(() => {
    return () => {
      abortAssistantStream();
      persistCurrentChatSession();
    };
  }, [abortAssistantStream, persistCurrentChatSession]);

  /**
   * 发送消息：构造用户消息 + 占位助手消息 → 流式调用 → 转发到节点（如触发）
   */
  const handleSend = useCallback(async () => {
    const userText = input.trim();
    if (!userText || isStreaming) return;
    if (!isConfigured()) {
      toast.error(t.assistantNeedApiKey);
      return;
    }

    // 发送前持久化当前会话（保存旧消息，避免切换/卸载丢失）
    persistCurrentChatSession();

    // 取消旧请求（如有），再发起新请求
    abortAssistantStream();
    const controller = new AbortController();
    registerAssistantAbortController(controller);

    // 构造用户消息
    const userMessage: AssistantMessage = {
      id: genAssistantMessageId(),
      role: 'user',
      content: userText,
      timestamp: Date.now(),
      status: 'done',
      skillId: activeSkillId ?? undefined,
    };
    addAssistantMessage(userMessage);

    // 占位助手消息（流式追加内容）
    const assistantMessageId = genAssistantMessageId();
    const placeholder: AssistantMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      status: 'pending',
      skillId: activeSkillId ?? undefined,
    };
    addAssistantMessage(placeholder);

    setInput('');
    setIsStreaming(true);

    // 历史上下文：取发送前的消息列表（不含当前占位）
    const history = messagesToHistory(assistantMessages);

    const result = await streamAssistantResponse(userText, {
      skillId: activeSkillId,
      skills,
      history,
      canvasContext: canvasSnapshot,
      autoCreateNode: autoCreateNodes,
      signal: controller.signal,
      onDelta: (delta) => {
        appendAssistantMessageChunk(assistantMessageId, delta);
      },
      onForwarded: (forwardedText) => {
        // 转发到节点：取选中节点为父节点，否则作为根节点
        const parentId = selectedNodeId ?? null;
        try {
          const newNodeId = createTurnNode(forwardedText, parentId, { source: 'assistant' });
          updateAssistantMessage(assistantMessageId, { relatedNodeId: newNodeId });
          toast.success(t.assistantForwarded);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          toast.error(tf('assistantForwardFailed', { message: msg }));
        }
      },
    });

    // 流式结束：更新助手消息状态 + 持久化当前会话（保存新消息）
    if (result.status === 'success') {
      updateAssistantMessage(assistantMessageId, { status: 'done' });
    } else if (result.status === 'aborted') {
      updateAssistantMessage(assistantMessageId, {
        status: 'error',
        errorMessage: t.cancelled,
      });
    } else {
      updateAssistantMessage(assistantMessageId, {
        status: 'error',
        errorMessage: result.errorMessage ?? 'unknown error',
      });
    }

    // 流式结束后持久化当前会话（保存新消息）
    persistCurrentChatSession();

    setIsStreaming(false);
    registerAssistantAbortController(null);
  }, [
    input,
    isStreaming,
    activeSkillId,
    skills,
    selectedNodeId,
    assistantMessages,
    abortAssistantStream,
    registerAssistantAbortController,
    addAssistantMessage,
    appendAssistantMessageChunk,
    updateAssistantMessage,
    createTurnNode,
    persistCurrentChatSession,
    canvasSnapshot,
    autoCreateNodes,
    t,
    tf,
  ]);

  /** 停止流式响应 */
  const handleStop = useCallback(() => {
    abortAssistantStream();
    setIsStreaming(false);
  }, [abortAssistantStream]);

  /** 清空对话（流式进行中禁用） */
  const handleClear = useCallback(() => {
    if (isStreaming) return;
    clearAssistantMessages();
  }, [isStreaming, clearAssistantMessages]);

  /** 关闭面板 */
  const handleClose = useCallback(() => {
    setAssistantPanelOpen(false);
  }, [setAssistantPanelOpen]);

  /** 清除激活技能 */
  const handleClearSkill = useCallback(() => {
    setActiveSkillId(null);
    setSkillDropdownOpen(false);
    toast.success(t.skillDeactivated);
  }, [setActiveSkillId, t]);

  /** 选择激活技能 */
  const handleSelectSkill = useCallback(
    (skillId: string) => {
      const skill = skills.find((s) => s.id === skillId);
      setActiveSkillId(skillId);
      setSkillDropdownOpen(false);
      if (skill) {
        toast.success(tf('skillActivated', { name: skill.name }));
      }
    },
    [skills, setActiveSkillId, tf],
  );

  /** 打开技能管理面板 */
  const handleOpenSkillManager = useCallback(() => {
    setSkillManagerOpen(true);
    setSkillDropdownOpen(false);
  }, [setSkillManagerOpen]);

  /** 新建会话 */
  const handleNewSession = useCallback(() => {
    if (isStreaming) return;
    createChatSession();
    setSessionDropdownOpen(false);
  }, [isStreaming, createChatSession]);

  /** 切换会话 */
  const handleSwitchSession = useCallback(
    (id: string) => {
      if (isStreaming) return;
      switchChatSession(id);
      setSessionDropdownOpen(false);
    },
    [isStreaming, switchChatSession],
  );

  /** 删除会话 */
  const handleDeleteSession = useCallback(
    (id: string) => {
      if (isStreaming) return;
      deleteChatSession(id);
    },
    [isStreaming, deleteChatSession],
  );

  /** 切换激活的 LLM 配置 */
  const handleSwitchModel = useCallback(
    (id: string) => {
      switchLlmConfig(id);
      setModelDropdownOpen(false);
    },
    [switchLlmConfig],
  );

  /** 打开设置 Modal */
  const handleOpenSettings = useCallback(() => {
    setShowSettings(true);
    setModelDropdownOpen(false);
  }, [setShowSettings]);

  /** Enter 发送 / Shift+Enter 换行 */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  /** 渲染单条消息气泡 */
  const renderMessage = (msg: AssistantMessage) => {
    const isUser = msg.role === 'user';
    const isError = msg.status === 'error';
    const isStreamingMsg = msg.status === 'streaming' || msg.status === 'pending';

    return (
      <div key={msg.id} className={`flex gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
        {/* 头像 */}
        <div
          className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${
            isUser
              ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300'
              : 'bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-300'
          }`}
        >
          {isUser ? <UserIcon size={12} /> : <Bot size={12} />}
        </div>
        {/* 气泡 */}
        <div
          className={`max-w-[80%] rounded-lg px-3 py-2 text-xs ${
            isUser
              ? 'bg-blue-500 text-white'
              : isError
                ? 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300 border border-red-200 dark:border-red-800'
                : 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100'
          }`}
        >
          {/* 用户消息直接渲染文本，助手消息渲染 Markdown */}
          {isUser ? (
            <div className="whitespace-pre-wrap break-words">{msg.content}</div>
          ) : isError ? (
            <div className="break-words">
              {tf('assistantError', { message: msg.errorMessage ?? '' })}
            </div>
          ) : msg.content ? (
            <div className="break-words">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                {msg.content}
              </ReactMarkdown>
              {isStreamingMsg && (
                <span className="inline-block w-1.5 h-3 ml-0.5 bg-violet-500 animate-pulse align-middle" />
              )}
            </div>
          ) : isStreamingMsg ? (
            <div className="flex items-center gap-1 text-slate-400">
              <Loader2 size={10} className="animate-spin" />
              <span>{t.assistantStreaming}</span>
            </div>
          ) : null}
          {/* 转发到节点的提示 */}
          {msg.relatedNodeId && (
            <div className="mt-1 text-[10px] opacity-70 flex items-center gap-1">
              <Sparkles size={9} />
              {t.assistantForwarded}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      {/* 顶部：标题 + 当前技能徽章 + 会话切换 + 清空 + 关闭 */}
      <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <Bot size={14} className="text-violet-500 flex-shrink-0" />
          <span className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">
            {t.assistantTitle}
          </span>
          {/* 当前激活技能徽章（可清除） */}
          {activeSkill && (
            <button
              onClick={handleClearSkill}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300 hover:bg-violet-200 dark:hover:bg-violet-900/60 transition-colors"
              title={t.assistantClearSkill}
            >
              <span>{activeSkill.icon ?? '⭐'}</span>
              <span className="max-w-[80px] truncate">{activeSkill.name}</span>
              <X size={9} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* 会话切换下拉 */}
          <div className="relative" data-session-dropdown>
            <button
              onClick={() => setSessionDropdownOpen((v) => !v)}
              disabled={isStreaming}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title={t.assistantSession}
            >
              <MessageSquare size={10} />
              <span className="max-w-[80px] truncate">
                {activeSession ? activeSession.title : t.assistantSession}
              </span>
              <ChevronDown size={9} />
            </button>
            {sessionDropdownOpen && (
              <div className="absolute right-0 top-full mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md shadow-lg z-20 w-56 max-h-64 overflow-y-auto">
                {/* 会话列表 */}
                {chatSessions.length === 0 ? (
                  <div className="px-2 py-3 text-[11px] text-slate-400 text-center">
                    {t.assistantSessionEmpty}
                  </div>
                ) : (
                  chatSessions.map((s) => (
                    <div
                      key={s.id}
                      className={`group flex items-center gap-1 px-2 py-1.5 text-[11px] hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer ${
                        s.id === activeChatSessionId
                          ? 'text-violet-600 dark:text-violet-300 font-medium'
                          : 'text-slate-600 dark:text-slate-300'
                      }`}
                      onClick={() => handleSwitchSession(s.id)}
                    >
                      <span className="flex-1 truncate">{s.title}</span>
                      {s.id === activeChatSessionId && (
                        <span className="text-[9px] text-violet-400">
                          {t.assistantSessionActive}
                        </span>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteSession(s.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 transition-opacity"
                        title={t.assistantSessionDelete}
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  ))
                )}
                {/* 新建会话 */}
                <div className="border-t border-slate-100 dark:border-slate-700">
                  <button
                    onClick={handleNewSession}
                    className="w-full text-left px-2 py-1.5 text-[11px] text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors flex items-center gap-1"
                  >
                    <Plus size={10} />
                    <span>{t.assistantSessionNew}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
          {/* 自动建图模式切换：开启后每次助手回答都自动把用户消息转发为新节点 */}
          <button
            onClick={handleToggleAutoCreate}
            className={`p-1 rounded transition-colors ${
              autoCreateNodes
                ? 'text-amber-500 bg-amber-50 dark:bg-amber-900/30'
                : 'text-slate-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-slate-700'
            }`}
            aria-label={t.assistantAutoCreate}
            aria-pressed={autoCreateNodes}
            title={autoCreateNodes ? t.assistantAutoCreateOn : t.assistantAutoCreateOff}
          >
            {autoCreateNodes ? <Zap size={12} /> : <ZapOff size={12} />}
          </button>
          <button
            onClick={handleClear}
            disabled={isStreaming || assistantMessages.length === 0}
            className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label={t.assistantClear}
            title={t.assistantClear}
          >
            <Trash2 size={12} />
          </button>
          <button
            onClick={handleClose}
            className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 dark:hover:text-slate-200 rounded transition-colors"
            aria-label={t.close}
            title={t.close}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* 中间：消息列表 */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {assistantMessages.length === 0 ? (
          <div className="text-center text-xs text-slate-400 dark:text-slate-500 py-8 px-2">
            {t.assistantEmpty}
          </div>
        ) : (
          assistantMessages.map((msg) => renderMessage(msg))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 底部：技能选择 + 模型选择 + 输入框 + 发送按钮 */}
      <div className="border-t border-slate-200 dark:border-slate-700 p-2 space-y-2">
        {/* API Key 未配置提示 */}
        {!configured ? (
          <div className="text-[10px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-2 py-1 rounded">
            {t.assistantNeedApiKey}
          </div>
        ) : null}

        {/* 技能选择下拉 + 模型切换下拉（同行） */}
        <div className="flex items-stretch gap-1.5">
          {/* 技能选择下拉 */}
          <div className="relative flex-1 min-w-0" data-skill-dropdown>
            <button
              onClick={() => setSkillDropdownOpen((v) => !v)}
              disabled={isStreaming}
              className="w-full flex items-center justify-between gap-1 px-2 py-1 text-[11px] rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="flex items-center gap-1 min-w-0">
                <Sparkles size={10} className="text-violet-500 flex-shrink-0" />
                <span className="truncate">
                  {activeSkill
                    ? `${activeSkill.icon ?? '⭐'} ${activeSkill.name}`
                    : t.assistantNoSkill}
                </span>
              </span>
              <ChevronDown size={10} className="flex-shrink-0" />
            </button>
            {skillDropdownOpen && (
              <div className="absolute bottom-full left-0 right-0 mb-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md shadow-lg z-20 max-h-48 overflow-y-auto">
                {/* 通用助手（清除技能） */}
                <button
                  onClick={handleClearSkill}
                  className={`w-full text-left px-2 py-1.5 text-[11px] hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors flex items-center gap-1 ${
                    !activeSkillId
                      ? 'text-violet-600 dark:text-violet-300 font-medium'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  <span>💡</span>
                  <span>{t.assistantNoSkill}</span>
                </button>
                {/* 技能列表 */}
                {skills
                  .filter((s) => s.enabled)
                  .map((skill) => (
                    <button
                      key={skill.id}
                      onClick={() => handleSelectSkill(skill.id)}
                      className={`w-full text-left px-2 py-1.5 text-[11px] hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors flex items-center gap-1 ${
                        activeSkillId === skill.id
                          ? 'text-violet-600 dark:text-violet-300 font-medium'
                          : 'text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      <span>{skill.icon ?? '⭐'}</span>
                      <span className="truncate">{skill.name}</span>
                    </button>
                  ))}
                {/* 技能管理入口 */}
                <div className="border-t border-slate-100 dark:border-slate-700">
                  <button
                    onClick={handleOpenSkillManager}
                    className="w-full text-left px-2 py-1.5 text-[11px] text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors flex items-center gap-1"
                  >
                    <Sparkles size={10} />
                    <span>{t.skillManager}</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 模型切换下拉 */}
          <div className="relative flex-1 min-w-0" data-model-dropdown>
            <button
              onClick={() => setModelDropdownOpen((v) => !v)}
              disabled={isStreaming}
              className="w-full flex items-center justify-between gap-1 px-2 py-1 text-[11px] rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="flex items-center gap-1 min-w-0">
                <Bot size={10} className="text-blue-500 flex-shrink-0" />
                <span className="truncate">
                  {activeLlmConfigEntry ? activeLlmConfigEntry.name : t.assistantModelSelect}
                </span>
              </span>
              <ChevronDown size={10} className="flex-shrink-0" />
            </button>
            {modelDropdownOpen && (
              <div className="absolute bottom-full left-0 right-0 mb-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md shadow-lg z-20 max-h-48 overflow-y-auto">
                {/* 配置列表 */}
                {llmConfigs.length === 0 ? (
                  <div className="px-2 py-3 text-[11px] text-slate-400 text-center">
                    {t.assistantModelEmpty}
                  </div>
                ) : (
                  llmConfigs.map((cfg) => (
                    <button
                      key={cfg.id}
                      onClick={() => handleSwitchModel(cfg.id)}
                      className={`w-full text-left px-2 py-1.5 text-[11px] hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors flex items-center gap-1 ${
                        cfg.id === activeLlmConfigId
                          ? 'text-blue-600 dark:text-blue-300 font-medium'
                          : 'text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      <span className="flex-1 min-w-0">
                        <div className="truncate">{cfg.name}</div>
                        <div className="text-[9px] text-slate-400 truncate">
                          {PROVIDER_PRESETS[cfg.config.provider]?.label ?? cfg.config.provider} ·{' '}
                          {cfg.config.model}
                        </div>
                      </span>
                    </button>
                  ))
                )}
                {/* 管理配置入口 */}
                <div className="border-t border-slate-100 dark:border-slate-700">
                  <button
                    onClick={handleOpenSettings}
                    className="w-full text-left px-2 py-1.5 text-[11px] text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors flex items-center gap-1"
                  >
                    <SettingsIcon size={10} />
                    <span>{t.assistantModelManage}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 附件预览区（PR-2 会用到，先留位置） */}
        {/* TODO: PR-2 附件体系 */}

        {/* 输入框 + 发送/停止按钮 */}
        <div className="flex items-end gap-1.5">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t.assistantInputPlaceholder}
            rows={2}
            disabled={!configured}
            className="flex-1 resize-none text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-400 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-400 focus:border-violet-400 disabled:opacity-50 disabled:cursor-not-allowed"
          />
          {isStreaming ? (
            <button
              onClick={handleStop}
              className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-red-500 text-white hover:bg-red-600 transition-colors flex-shrink-0"
              aria-label={t.assistantStop}
              title={t.assistantStop}
            >
              <Square size={12} />
            </button>
          ) : (
            <button
              onClick={() => void handleSend()}
              disabled={!input.trim() || !configured}
              className="inline-flex items-center justify-center w-8 h-8 rounded-md bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
              aria-label={t.assistantSend}
              title={t.assistantSend}
            >
              <Send size={12} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
