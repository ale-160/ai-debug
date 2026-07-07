'use client';

import React, { useState, useMemo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Loader2, MessageSquare, GitBranch, Wrench, GitFork } from 'lucide-react';
import { useDebugStore } from '@/lib/debug-store';
import { useTranslation } from '@/components/I18nProvider';
import type { Node } from 'reactflow';
import type { TurnNodeData } from './types';
import { truncateStreamingText } from './nodes/node-utils';
import Breadcrumb from './inspector/Breadcrumb';
import ConflictCard from './inspector/ConflictCard';
import MergeSourcesList from './inspector/MergeSourcesList';
import SuggestionsList from './inspector/SuggestionsList';
import MessageInput from './inspector/MessageInput';
import PathSummaryCard from './inspector/PathSummaryCard';
import EvolutionMetaCard from './inspector/EvolutionMetaCard';
import { useInspectorActions } from './inspector/useInspectorActions';

/** Markdown 元素样式（项目未启用 tailwindcss/typography，故手动提供基础排版） */
const mdComponents: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
  h1: ({ children }) => <h1 className="text-base font-bold mt-3 mb-2 first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="text-base font-semibold mt-3 mb-2 first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="text-sm font-semibold mt-2 mb-1 first:mt-0">{children}</h3>,
  ul: ({ children }) => <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 underline break-all">
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
    <pre className="bg-slate-800 text-slate-100 p-2 rounded mb-2 overflow-x-auto text-xs">{children}</pre>
  ),
};

type InspectorTab = 'conversation' | 'context' | 'actions';

export default function NodeInspector() {
  const { t, tf } = useTranslation();
  const selectedNodeId = useDebugStore((s) => s.selectedNodeId);
  const nodes = useDebugStore((s) => s.nodes);
  const setSelectedNode = useDebugStore((s) => s.setSelectedNode);
  const appSettings = useDebugStore((s) => s.appSettings);
  const globalMemory = useDebugStore((s) => s.globalMemory);
  const projects = useDebugStore((s) => s.projects);
  const currentProjectId = useDebugStore((s) => s.currentProjectId);

  const [activeTab, setActiveTab] = useState<InspectorTab>('conversation');
  /** fork 提示态：true 时高亮"从此处分叉"按钮 + 展示提示 banner */
  const [forkHintVisible, setForkHintVisible] = useState(false);

  const selectedNode = useMemo(
    () => (selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) ?? null : null),
    [nodes, selectedNodeId],
  );

  // 所有操作逻辑（继续追问 / 重新生成 / 冲突检测等）托管在 hook 中
  const actions = useInspectorActions(selectedNode);

  // 通过 parentId 向上递归到根节点，收集从根到当前节点的路径
  const breadcrumb = useMemo(() => {
    if (!selectedNode) return [] as Node<TurnNodeData>[];
    const map = new Map<string, Node<TurnNodeData>>();
    for (const n of nodes) map.set(n.id, n);
    const path: Node<TurnNodeData>[] = [];
    const visited = new Set<string>();
    let cur: string | null = selectedNode.id;
    while (cur !== null && !visited.has(cur)) {
      visited.add(cur);
      const n = map.get(cur);
      if (!n) break;
      path.push(n);
      cur = n.data.parentId;
    }
    path.reverse();
    return path;
  }, [nodes, selectedNode]);

  if (!selectedNode) return null;

  const data = selectedNode.data;
  const status = data.status;
  const isAbandoned = status === 'abandoned';
  const isIgnored = status === 'ignored';
  const isRunning = status === 'running';
  const inputEmpty = actions.input.trim() === '';
  const actionDisabled = inputEmpty || isRunning || isAbandoned || isIgnored;
  const regenerateDisabled = isRunning || isAbandoned || isIgnored;

  const assistantMessage = data.assistantMessage;
  // 流式渲染时截断尾部 2000 字，避免长对话渲染卡顿
  const displayMessage = isRunning ? truncateStreamingText(assistantMessage) : assistantMessage;
  const suggestions = data.suggestions ?? [];
  const mergedFromIds = data.mergedFromIds;
  const conflictNote = data.conflictNote;

  // 当前路径注入的记忆条目（依据设置开关过滤）
  const projectMem =
    (currentProjectId ? projects.find((p) => p.id === currentProjectId)?.memory : undefined) ?? [];
  const injectedGlobalMemory = appSettings.enableGlobalMemory ? globalMemory : [];
  const injectedProjectMemory = appSettings.enableProjectMemory ? projectMem : [];
  const hasInjectedMemory = injectedGlobalMemory.length > 0 || injectedProjectMemory.length > 0;

  const tabs: { key: InspectorTab; label: string; icon: React.ReactNode }[] = [
    { key: 'conversation', label: t.inspectorTabConversation, icon: <MessageSquare size={14} /> },
    { key: 'context', label: t.inspectorTabContext, icon: <GitBranch size={14} /> },
    { key: 'actions', label: t.inspectorTabActions, icon: <Wrench size={14} /> },
  ];

  return (
    <div className="w-full md:w-[420px] shrink-0 bg-white border-l border-slate-200 shadow-lg flex flex-col z-20 dark:bg-slate-900 dark:border-slate-700">
      {/* 路径面包屑（始终可见，含关闭按钮） */}
      <Breadcrumb
        breadcrumb={breadcrumb}
        selectedNodeId={selectedNode.id}
        onSelect={setSelectedNode}
        onClose={() => setSelectedNode(null)}
      />

      {/* 显式 fork 入口：点击后高亮提示"下一条消息将作为此节点的新子分支"。
          复用现有 createChildAndStream 逻辑（提交消息时自动以当前选中节点为 parentId 创建子节点），
          此按钮仅为 UI 提示，不改变 store 状态。 */}
      <div className="px-3 pt-2 flex-shrink-0">
        <button
          onClick={() => setForkHintVisible((v) => !v)}
          className={`w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
            forkHintVisible
              ? 'bg-violet-50 dark:bg-violet-900/30 border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300'
              : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-violet-300 dark:hover:border-violet-700 hover:text-violet-600 dark:hover:text-violet-400'
          }`}
          aria-pressed={forkHintVisible}
          title={t.forkHint}
        >
          <GitFork size={12} />
          {t.forkFromHere}
        </button>
        {forkHintVisible && (
          <div className="mt-1.5 px-2.5 py-1.5 rounded bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-700/60 text-[11px] text-violet-700 dark:text-violet-300 leading-relaxed">
            {t.forkHint}
          </div>
        )}
      </div>

      {/* Tab 切换栏：底部下划线高亮 active Tab */}
      <div className="flex border-b border-slate-200 dark:border-slate-700 flex-shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors border-b-2 ${
              activeTab === tab.key
                ? 'text-blue-600 border-blue-500 bg-blue-50/50 dark:bg-blue-900/20 dark:text-blue-400'
                : 'text-slate-500 dark:text-slate-400 border-transparent hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab 1: 对话 —— 用户消息 + AI 回答（Markdown） */}
      {activeTab === 'conversation' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* 用户消息 */}
          <div className="flex flex-col items-end gap-2">
            <div className="max-w-[85%] rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-2 text-slate-800 dark:text-slate-200 text-sm shadow-sm whitespace-pre-wrap break-words">
              {data.userMessage}
            </div>
            {data.images && data.images.length > 0 && (
              <div className="flex flex-wrap gap-2 justify-end">
                {data.images.map((src, i) => (
                  <img
                    key={i}
                    src={src}
                    alt={tf('attachmentN', { n: i + 1 })}
                    className="max-w-32 rounded border border-slate-200 dark:border-slate-700"
                  />
                ))}
              </div>
            )}
          </div>
          {/* AI 回答 */}
          <div className="rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 p-3">
            {isRunning && assistantMessage === '' ? (
              <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 text-sm">
                <Loader2 className="animate-spin" size={14} />
                {t.aiThinking}
              </div>
            ) : status === 'error' ? (
              <div className="text-sm text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded p-2 break-words">
                {tf('errorOccurred', { message: data.errorMessage ?? t.unknownError })}
              </div>
            ) : assistantMessage === '' ? (
              <div className="text-slate-400 dark:text-slate-500 text-sm italic">{t.waitingForGeneration}</div>
            ) : (
              <div className="text-sm text-slate-700 dark:text-slate-300 break-words">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                  {displayMessage}
                </ReactMarkdown>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: 上下文 —— 路径摘要 + 推演元数据 + 合并来源 + 冲突标注 + 注入的记忆条目 */}
      {activeTab === 'context' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* 路径摘要（rolling summary）：从根到当前节点的聚合结论 */}
          <PathSummaryCard
            pathSummary={data.pathSummary}
            pathLength={breadcrumb.length}
          />
          {/* 推演元数据：自动推演产生的节点显示 step/confidence/startNodeId/reasoning + 清除按钮 */}
          {data.evolutionMeta && (
            <EvolutionMetaCard
              evolutionMeta={data.evolutionMeta}
              nodes={nodes}
              onClear={actions.handleClearEvolutionMeta}
            />
          )}
          {conflictNote && (
            <ConflictCard
              conflictNote={conflictNote}
              isAbandoned={isAbandoned}
              isIgnored={isIgnored}
              onAbandon={actions.handleAbandon}
              onPrune={actions.handlePruneNode}
              onIgnore={actions.handleIgnore}
              onClear={actions.handleClearConflict}
            />
          )}
          {mergedFromIds && mergedFromIds.length > 0 && (
            <MergeSourcesList mergedFromIds={mergedFromIds} nodes={nodes} onSelect={setSelectedNode} />
          )}
          {/* 注入的记忆条目：依据全局/项目记忆开关 */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
              {t.pathMemoryTitle}
            </h4>
            {hasInjectedMemory ? (
              <div className="space-y-1.5">
                {injectedGlobalMemory.map((m) => (
                  <div
                    key={m.id}
                    className="rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-2 text-xs text-slate-600 dark:text-slate-300 break-words"
                  >
                    <span className="text-[10px] text-blue-500 mr-1">[{t.globalMemory}]</span>
                    {m.content}
                  </div>
                ))}
                {injectedProjectMemory.map((m) => (
                  <div
                    key={m.id}
                    className="rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-2 text-xs text-slate-600 dark:text-slate-300 break-words"
                  >
                    <span className="text-[10px] text-violet-500 mr-1">[{t.projectMemory}]</span>
                    {m.content}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-slate-400 dark:text-slate-500 italic">{t.noPathMemory}</div>
            )}
          </div>
        </div>
      )}

      {/* Tab 3: 操作 —— 建议方向 + 输入框 + 操作按钮 */}
      {activeTab === 'actions' && (
        <>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {suggestions.length > 0 && (
              <SuggestionsList
                suggestions={suggestions}
                disabled={isRunning || isAbandoned || isIgnored}
                onSuggestionClick={actions.handleSuggestionClick}
              />
            )}
          </div>
          <MessageInput
            input={actions.input}
            onInputChange={actions.setInput}
            onKeyDown={actions.handleKeyDown}
            isAbandoned={isAbandoned}
            isIgnored={isIgnored}
            isRunning={isRunning}
            actionDisabled={actionDisabled}
            regenerateDisabled={regenerateDisabled}
            checkingConflict={actions.checkingConflict}
            hasMergeSources={!!mergedFromIds && mergedFromIds.length > 0}
            onContinueQuestion={actions.handleContinueQuestion}
            onRegenerate={actions.handleRegenerate}
            onAbandon={actions.handleAbandon}
            onReactivate={actions.handleReactivate}
            onIgnore={actions.handleIgnore}
            onUnignore={actions.handleUnignore}
            onCheckConflict={actions.handleCheckConflict}
          />
        </>
      )}
    </div>
  );
}
