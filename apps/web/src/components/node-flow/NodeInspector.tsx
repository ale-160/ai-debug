'use client';

import React, { useState, useMemo, useRef } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Loader2, X, Send, Ban, RotateCcw, GitMerge, RefreshCw, EyeOff, AlertTriangle, ScanSearch, Info } from 'lucide-react';
import { useDebugStore } from '@/lib/debug-store';
import { streamTurnResponse } from '@/lib/network-engine';
import { detectConflicts } from '@/lib/conflict-engine';
import { extractMemory, buildMemoryContext } from '@/lib/memory-engine';
import { isConfigured } from '@/lib/llm-config';
import type { Node } from 'reactflow';
import type { TurnNodeData, Suggestion } from './types';

/** 取 userMessage 前 10 字作为面包屑摘要，超出追加省略号 */
function summarize(text: string): string {
  const t = text.trim();
  return t.length > 10 ? `${t.slice(0, 10)}...` : t;
}

/** Markdown 元素样式（项目未启用 tailwindcss/typography，故手动提供基础排版） */
const mdComponents: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
  h1: ({ children }) => (
    <h1 className="text-base font-bold mt-3 mb-2 first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-base font-semibold mt-3 mb-2 first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-sm font-semibold mt-2 mb-1 first:mt-0">{children}</h3>
  ),
  ul: ({ children }) => (
    <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-blue-600 underline break-all"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-slate-300 pl-2 italic text-slate-500 mb-2">
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
      <code className="bg-slate-100 text-pink-600 px-1 py-0.5 rounded text-xs">
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

export default function NodeInspector() {
  const selectedNodeId = useDebugStore((s) => s.selectedNodeId);
  const nodes = useDebugStore((s) => s.nodes);
  const createTurnNode = useDebugStore((s) => s.createTurnNode);
  const updateTurnNode = useDebugStore((s) => s.updateTurnNode);
  const appendAssistantChunk = useDebugStore((s) => s.appendAssistantChunk);
  const setSelectedNode = useDebugStore((s) => s.setSelectedNode);
  const abandonBranch = useDebugStore((s) => s.abandonBranch);
  const reactivateBranch = useDebugStore((s) => s.reactivateBranch);
  const ignoreNode = useDebugStore((s) => s.ignoreNode);
  const unignoreNode = useDebugStore((s) => s.unignoreNode);
  const deleteNode = useDebugStore((s) => s.deleteNode);
  const appSettings = useDebugStore((s) => s.appSettings);
  const projects = useDebugStore((s) => s.projects);
  const currentProjectId = useDebugStore((s) => s.currentProjectId);
  const addGlobalMemory = useDebugStore((s) => s.addGlobalMemory);
  const addProjectMemory = useDebugStore((s) => s.addProjectMemory);
  const incrementTurnCounter = useDebugStore((s) => s.incrementTurnCounter);
  const turnCounter = useDebugStore((s) => s.turnCounter);
  // 订阅 globalMemory（单一数据源，避免直接读 localStorage）
  const globalMemory = useDebugStore((s) => s.globalMemory);

  const [input, setInput] = useState('');
  const [checkingConflict, setCheckingConflict] = useState(false);
  // 当前流式请求的 AbortController：用于在发起新请求前取消旧请求
  const abortRef = useRef<AbortController | null>(null);

  const selectedNode = useMemo(
    () =>
      selectedNodeId
        ? nodes.find((n) => n.id === selectedNodeId) ?? null
        : null,
    [nodes, selectedNodeId],
  );

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
  const inputEmpty = input.trim() === '';
  const actionDisabled = inputEmpty || isRunning || isAbandoned || isIgnored;
  const regenerateDisabled = isRunning || isAbandoned || isIgnored;

  const userMessage = data.userMessage;
  const assistantMessage = data.assistantMessage;
  const suggestions = data.suggestions ?? [];
  const images = data.images;
  const errorMessage = data.errorMessage;
  const mergedFromIds = data.mergedFromIds;
  const conflictNote = data.conflictNote;

  /** 构建注入到 system prompt 的记忆上下文（依据设置开关） */
  const buildExtraContext = (): string | undefined => {
    const globalMem = appSettings.enableGlobalMemory ? globalMemory : [];
    const projectMem =
      appSettings.enableProjectMemory && currentProjectId
        ? (projects.find((p) => p.id === currentProjectId)?.memory ?? [])
        : [];
    const rules = appSettings.globalRules;
    const ctx = buildMemoryContext(rules, globalMem, projectMem);
    return ctx || undefined;
  };

  /**
   * 回答成功后的旁路钩子：按频率触发记忆提取 + 冲突自动检测。
   * 全部非阻塞，失败静默。异步回调内会校验项目是否变化，避免竞态写入错项目。
   */
  const runPostTurnSidecars = (nodeId: string, userMsg: string, assistantMsg: string) => {
    // 捕获当前项目 id，异步回调中校验是否仍为同一项目
    const projectIdAtCall = currentProjectId;
    // 计数器先 +1，再判断是否命中频率
    const newCount = turnCounter + 1;
    incrementTurnCounter();

    // 记忆提取：按 memoryFrequency 频率
    const shouldExtractMemory =
      (appSettings.enableGlobalMemory || appSettings.enableProjectMemory) &&
      newCount % Math.max(1, appSettings.memoryFrequency) === 0;
    if (shouldExtractMemory && assistantMsg.trim()) {
      void (async () => {
        const contents = await extractMemory(userMsg, assistantMsg);
        if (contents.length === 0) return;
        // 项目已切换：仅全局记忆仍可写入（跨项目共享），项目记忆跳过避免写错
        const stillSameProject =
          useDebugStore.getState().currentProjectId === projectIdAtCall;
        if (appSettings.enableGlobalMemory) {
          for (const c of contents) addGlobalMemory(c, 'auto');
        }
        if (appSettings.enableProjectMemory && projectIdAtCall && stillSameProject) {
          for (const c of contents) addProjectMemory(c, 'auto');
        }
      })();
    }

    // 冲突自动检测：按 conflictCheckFrequency 频率
    const shouldCheckConflict =
      appSettings.enableConflictAutoCheck &&
      newCount % Math.max(1, appSettings.conflictCheckFrequency) === 0;
    if (shouldCheckConflict) {
      void (async () => {
        const nodesNow = useDebugStore.getState().nodes;
        const marks = await detectConflicts(nodeId, nodesNow);
        // 项目已切换：放弃写入冲突标注，避免污染新项目节点
        if (useDebugStore.getState().currentProjectId !== projectIdAtCall) return;
        for (const m of marks) {
          updateTurnNode(m.nodeId, { conflictNote: m.note });
        }
      })();
    }
  };

  /** 创建子节点并流式生成 AI 回答（继续追问 / 分叉 / 建议方向 共用） */
  const createChildAndStream = async (userMsg: string) => {
    if (!isConfigured()) {
      alert('请先配置 API Key');
      return;
    }
    const parentId = selectedNodeId;
    if (!parentId) return;
    const newId = createTurnNode(userMsg, parentId);
    setSelectedNode(newId);
    updateTurnNode(newId, { status: 'running' });
    const currentNodes = useDebugStore.getState().nodes;
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
      buildExtraContext(),
    );
    if (result.success) {
      updateTurnNode(newId, {
        status: 'success',
        suggestions: result.suggestions ?? [],
      });
      runPostTurnSidecars(newId, userMsg, result.text ?? '');
    } else {
      updateTurnNode(newId, { status: 'error', errorMessage: result.error });
    }
  };

  const handleContinueQuestion = () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    void createChildAndStream(text);
  };

  /** 重新生成当前节点的 AI 回答；输入框有内容时作为补充并入 userMessage */
  const handleRegenerate = async () => {
    if (!isConfigured()) {
      alert('请先配置 API Key');
      return;
    }
    if (!selectedNodeId) return;
    const supplement = input.trim();
    const finalUserMsg = supplement
      ? `${data.userMessage}\n\n补充：${supplement}`
      : data.userMessage;
    if (supplement) {
      updateTurnNode(selectedNodeId, { userMessage: finalUserMsg });
      setInput('');
    }
    updateTurnNode(selectedNodeId, {
      status: 'running',
      assistantMessage: '',
      suggestions: [],
      errorMessage: undefined,
      summary: undefined,
      // 重新生成时清除旧冲突标注（若有），避免旧标注残留
      conflictNote: undefined,
    });
    const currentNodes = useDebugStore.getState().nodes;
    // 取消前一次流式请求（如有），再发起新请求，避免新旧 delta 竞争同一节点
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const result = await streamTurnResponse(
      selectedNodeId,
      currentNodes,
      (delta) => appendAssistantChunk(selectedNodeId, delta),
      controller.signal,
      (summary) => updateTurnNode(selectedNodeId, { summary }),
      buildExtraContext(),
    );
    if (result.success) {
      updateTurnNode(selectedNodeId, {
        status: 'success',
        suggestions: result.suggestions ?? [],
      });
      runPostTurnSidecars(selectedNodeId, finalUserMsg, result.text ?? '');
    } else {
      updateTurnNode(selectedNodeId, {
        status: 'error',
        errorMessage: result.error,
      });
    }
  };

  const handleSuggestionClick = (s: Suggestion) => {
    setInput(s.title);
  };

  const handleAbandon = () => {
    if (selectedNodeId) abandonBranch(selectedNodeId);
  };

  const handleReactivate = () => {
    if (selectedNodeId) reactivateBranch(selectedNodeId);
  };

  const handleIgnore = () => {
    if (selectedNodeId) ignoreNode(selectedNodeId);
  };

  const handleUnignore = () => {
    if (selectedNodeId) unignoreNode(selectedNodeId);
  };

  /** 手动检测当前支线冲突：调用 LLM 分析并标注冲突节点 */
  const handleCheckConflict = async () => {
    if (!isConfigured()) {
      alert('请先配置 API Key');
      return;
    }
    if (!selectedNodeId) return;
    setCheckingConflict(true);
    try {
      const nodesNow = useDebugStore.getState().nodes;
      // 先清空当前支线上的旧标注，避免残留
      const nodeMap = new Map<string, Node<TurnNodeData>>();
      for (const n of nodesNow) nodeMap.set(n.id, n);
      const pathIds: string[] = [];
      const visited = new Set<string>();
      let cur: string | null = selectedNodeId;
      while (cur !== null && !visited.has(cur)) {
        visited.add(cur);
        pathIds.push(cur);
        const n = nodeMap.get(cur);
        if (!n) break;
        cur = n.data.parentId;
      }
      for (const id of pathIds) {
        updateTurnNode(id, { conflictNote: undefined });
      }
      // 调用检测
      const marks = await detectConflicts(selectedNodeId, nodesNow);
      for (const m of marks) {
        updateTurnNode(m.nodeId, { conflictNote: m.note });
      }
      if (marks.length === 0) {
        // 无冲突，可选 toast；此处静默
      }
    } finally {
      setCheckingConflict(false);
    }
  };

  /** 清除当前节点的冲突标注 */
  const handleClearConflict = () => {
    if (selectedNodeId) updateTurnNode(selectedNodeId, { conflictNote: undefined });
  };

  /** 裁剪当前节点及其子树（冲突处理选项之一） */
  const handlePruneNode = () => {
    if (!selectedNodeId) return;
    if (confirm('将删除此节点及其所有下游子节点，确定裁剪？')) {
      deleteNode(selectedNodeId);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleContinueQuestion();
    }
  };

  return (
    <div className="w-full md:w-[420px] shrink-0 bg-white border-l border-slate-200 shadow-lg flex flex-col z-20 dark:bg-slate-900 dark:border-slate-700">
      {/* 路径面包屑 */}
      <div className="p-3 border-b border-slate-100 flex items-center gap-2">
        <div className="flex items-center gap-1 overflow-x-auto flex-1 min-w-0">
          {breadcrumb.map((n, idx) => (
            <div key={n.id} className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => setSelectedNode(n.id)}
                className={`text-xs px-1.5 py-0.5 rounded hover:bg-slate-100 transition-colors truncate max-w-[120px] ${
                  n.id === selectedNode.id
                    ? 'font-semibold text-slate-800'
                    : 'text-slate-500'
                }`}
                title={n.data.userMessage}
              >
                {n.data.summary ? n.data.summary : summarize(n.data.userMessage)}
              </button>
              {idx < breadcrumb.length - 1 && (
                <span className="text-slate-300 text-xs">&gt;</span>
              )}
            </div>
          ))}
        </div>
        <button
          onClick={() => setSelectedNode(null)}
          className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-md transition-colors shrink-0"
          title="关闭"
        >
          <X size={16} />
        </button>
      </div>

      {/* 主体：对话内容 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* 用户消息 */}
        <div className="flex flex-col items-end gap-2">
          <div className="max-w-[85%] rounded-lg bg-white border border-slate-200 px-3 py-2 text-slate-800 text-sm shadow-sm whitespace-pre-wrap break-words">
            {userMessage}
          </div>
          {images && images.length > 0 && (
            <div className="flex flex-wrap gap-2 justify-end">
              {images.map((src, i) => (
                <img
                  key={i}
                  src={src}
                  alt={`附件 ${i + 1}`}
                  className="max-w-32 rounded border border-slate-200"
                />
              ))}
            </div>
          )}
        </div>

        {/* AI 回答 */}
        <div className="rounded-lg bg-slate-50 border border-slate-100 p-3">
          {isRunning && assistantMessage === '' ? (
            <div className="flex items-center gap-2 text-slate-500 text-sm">
              <Loader2 className="animate-spin" size={14} />
              AI 思考中...
            </div>
          ) : status === 'error' ? (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2 break-words">
              出错了：{errorMessage ?? '未知错误'}
            </div>
          ) : assistantMessage === '' ? (
            <div className="text-slate-400 text-sm italic">等待生成...</div>
          ) : (
            <div className="text-sm text-slate-700 break-words">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={mdComponents}
              >
                {assistantMessage}
              </ReactMarkdown>
            </div>
          )}
        </div>

        {/* 冲突标注卡片：当前节点被标记冲突时显示，提供处理操作 */}
        {conflictNote && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-2">
            <div className="flex items-start gap-2">
              <AlertTriangle size={14} className="text-red-500 shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="text-xs font-semibold text-red-700 uppercase tracking-wide mb-1">
                  冲突标注
                </div>
                <div className="text-sm text-red-700 break-words">{conflictNote}</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 pt-1">
              <button
                onClick={handleAbandon}
                disabled={isAbandoned}
                className="inline-flex items-center gap-1 rounded bg-red-500 px-2 py-1 text-xs text-white hover:bg-red-600 disabled:opacity-50"
                title="弃用此支线（标记 abandoned，保留节点）"
              >
                <Ban size={12} />
                弃用支线
              </button>
              <button
                onClick={handlePruneNode}
                className="inline-flex items-center gap-1 rounded bg-orange-500 px-2 py-1 text-xs text-white hover:bg-orange-600"
                title="裁剪此节点及其子树（删除）"
              >
                <ScanSearch size={12} />
                裁剪节点
              </button>
              <button
                onClick={handleIgnore}
                disabled={isIgnored}
                className="inline-flex items-center gap-1 rounded bg-amber-500 px-2 py-1 text-xs text-white hover:bg-amber-600 disabled:opacity-50"
                title="忽略此节点（构建上下文时跳过）"
              >
                <EyeOff size={12} />
                忽略节点
              </button>
              <button
                onClick={handleClearConflict}
                className="inline-flex items-center gap-1 rounded bg-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-300"
                title="清除冲突标注（不做处理）"
              >
                清除标注
              </button>
            </div>
          </div>
        )}

        {/* 合并来源列表：仅合并节点显示，可点击跳转到来源节点 */}
        {mergedFromIds && mergedFromIds.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-violet-500 uppercase tracking-wide">
              合并来源（{mergedFromIds.length} 路）
            </h4>
            {mergedFromIds.map((id, i) => {
              const src = nodes.find((n) => n.id === id);
              if (!src) {
                return (
                  <div
                    key={id}
                    className="rounded-lg border border-slate-200 p-2 text-xs text-slate-400 italic"
                  >
                    分支 {i + 1}（节点已删除）
                  </div>
                );
              }
              return (
                <button
                  key={id}
                  onClick={() => setSelectedNode(id)}
                  className="w-full text-left rounded-lg border border-violet-200 hover:border-violet-400 hover:bg-violet-50 p-2 transition-colors"
                >
                  <div className="flex items-center gap-1.5">
                    <GitMerge size={12} className="text-violet-500 shrink-0" />
                    <span className="text-[11px] text-violet-500 shrink-0">
                      分支 {i + 1}
                    </span>
                  </div>
                  <div className="text-sm text-slate-700 mt-0.5 truncate">
                    {src.data.summary
                      ? src.data.summary
                      : summarize(src.data.userMessage)}
                  </div>
                </button>
              );
            })}
            {/* 合并节点冲突检测限制说明 */}
            <div className="flex items-start gap-1.5 text-[11px] text-slate-400 bg-slate-50 border border-slate-100 rounded p-1.5">
              <Info size={11} className="shrink-0 mt-0.5" />
              <span>冲突检测仅分析 parentId 主干路径，不展开合并来源多路（已知限制）</span>
            </div>
          </div>
        )}

        {/* 建议方向卡片列表 */}
        {suggestions.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              可能的下一步方向
            </h4>
            {suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => handleSuggestionClick(s)}
                disabled={isRunning || isAbandoned || isIgnored}
                className="w-full text-left rounded-lg border border-slate-200 hover:border-violet-300 hover:bg-violet-50 p-3 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white disabled:hover:border-slate-200"
              >
                <div className="font-semibold text-sm text-slate-800">
                  {s.title}
                </div>
                <div className="text-xs text-slate-500 mt-1">{s.description}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 底部输入区 */}
      <div className="p-3 border-t border-slate-100">
        {isAbandoned && (
          <div className="text-center text-sm text-slate-400 py-1 mb-2">
            此支线已放弃，可恢复后继续
          </div>
        )}
        {isIgnored && (
          <div className="text-center text-sm text-amber-500 py-1 mb-2">
            此节点已忽略，构建上下文时跳过，可随时取消忽略
          </div>
        )}
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入追问或新方向..."
          rows={3}
          className="w-full border border-slate-300 rounded-lg p-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        <div className="flex gap-2 mt-2">
          <button
            onClick={handleContinueQuestion}
            disabled={actionDisabled}
            className="flex-1 inline-flex items-center justify-center gap-1 bg-blue-500 text-white text-sm px-3 py-1.5 rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Send size={14} />
            继续追问
          </button>
          <button
            onClick={() => void handleRegenerate()}
            disabled={regenerateDisabled}
            title="重新生成本节点回答；输入框有内容时会作为补充并入问题"
            className="flex-1 inline-flex items-center justify-center gap-1 bg-slate-600 text-white text-sm px-3 py-1.5 rounded-md hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <RefreshCw size={14} />
            重新生成
          </button>
          {isAbandoned ? (
            <button
              onClick={handleReactivate}
              className="flex-1 inline-flex items-center justify-center gap-1 bg-emerald-500 text-white text-sm px-3 py-1.5 rounded-md hover:bg-emerald-600 transition-colors"
              title="恢复支线"
            >
              <RotateCcw size={14} />
              恢复支线
            </button>
          ) : (
            <button
              onClick={handleAbandon}
              className="flex-1 inline-flex items-center justify-center gap-1 bg-red-500 text-white text-sm px-3 py-1.5 rounded-md hover:bg-red-600 transition-colors"
              title="放弃此支线"
            >
              <Ban size={14} />
              放弃此支线
            </button>
          )}
        </div>
        {/* 忽略节点按钮：与支线操作独立，仅作用于当前节点 */}
        <div className="flex gap-2 mt-2">
          {isIgnored ? (
            <button
              onClick={handleUnignore}
              className="flex-1 inline-flex items-center justify-center gap-1 bg-amber-500 text-white text-sm px-3 py-1.5 rounded-md hover:bg-amber-600 transition-colors"
              title="取消忽略此节点"
            >
              <RotateCcw size={14} />
              取消忽略
            </button>
          ) : (
            <button
              onClick={handleIgnore}
              disabled={isRunning || isAbandoned}
              className="flex-1 inline-flex items-center justify-center gap-1 bg-amber-100 text-amber-700 text-sm px-3 py-1.5 rounded-md hover:bg-amber-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title="忽略此节点（构建上下文时跳过，子节点照常运行）"
            >
              <EyeOff size={14} />
              忽略此节点
            </button>
          )}
          {/* 手动检测当前支线冲突。
              合并节点（mergedFromIds 非空）仅检测 parentId 主干路径，
              不展开 mergedFromIds 多路 —— 此为已知限制。 */}
          <button
            onClick={() => void handleCheckConflict()}
            disabled={checkingConflict || isRunning || isAbandoned}
            className="flex-1 inline-flex items-center justify-center gap-1 bg-red-100 text-red-700 text-sm px-3 py-1.5 rounded-md hover:bg-red-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title={
              mergedFromIds && mergedFromIds.length > 0
                ? '合并节点：仅检测 parentId 主干路径，不展开 mergedFromIds 多路（已知限制）'
                : '检测当前支线（根→此节点）的前后冲突'
            }
          >
            {checkingConflict ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <ScanSearch size={14} />
            )}
            {checkingConflict ? '检测中...' : '检测冲突'}
          </button>
        </div>
      </div>
    </div>
  );
}
