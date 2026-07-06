'use client';

import { useState, useRef } from 'react';
import type { Node } from 'reactflow';
import { useDebugStore } from '@/lib/debug-store';
import { streamTurnResponse } from '@/lib/network-engine';
import { detectConflicts } from '@/lib/conflict-engine';
import { extractMemory, buildMemoryContext } from '@/lib/memory-engine';
import { isConfigured } from '@/lib/llm-config';
import { useTranslation } from '@/components/I18nProvider';
import type { TurnNodeData, Suggestion } from '../types';

/**
 * Inspector 操作逻辑 hook：托管输入框状态、流式请求 AbortController、
 * 冲突检测状态，以及继续追问/重新生成/弃用/忽略/冲突检测等全部处理函数。
 * 主组件仅负责渲染，所有副作用与 store 写入集中在此。
 */
export function useInspectorActions(selectedNode: Node<TurnNodeData> | null) {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  const [checkingConflict, setCheckingConflict] = useState(false);
  /** 当前流式请求的 AbortController：用于在发起新请求前取消旧请求 */
  const abortRef = useRef<AbortController | null>(null);

  // store：节点与分支操作
  const selectedNodeId = useDebugStore((s) => s.selectedNodeId);
  const createTurnNode = useDebugStore((s) => s.createTurnNode);
  const updateTurnNode = useDebugStore((s) => s.updateTurnNode);
  const appendAssistantChunk = useDebugStore((s) => s.appendAssistantChunk);
  const setSelectedNode = useDebugStore((s) => s.setSelectedNode);
  const abandonBranch = useDebugStore((s) => s.abandonBranch);
  const reactivateBranch = useDebugStore((s) => s.reactivateBranch);
  const ignoreNode = useDebugStore((s) => s.ignoreNode);
  const unignoreNode = useDebugStore((s) => s.unignoreNode);
  const deleteNode = useDebugStore((s) => s.deleteNode);
  // store：设置与记忆
  const appSettings = useDebugStore((s) => s.appSettings);
  const projects = useDebugStore((s) => s.projects);
  const currentProjectId = useDebugStore((s) => s.currentProjectId);
  const addGlobalMemory = useDebugStore((s) => s.addGlobalMemory);
  const addProjectMemory = useDebugStore((s) => s.addProjectMemory);
  const incrementTurnCounter = useDebugStore((s) => s.incrementTurnCounter);
  const turnCounter = useDebugStore((s) => s.turnCounter);
  const globalMemory = useDebugStore((s) => s.globalMemory);

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
  const runPostTurnSidecars = (
    nodeId: string,
    userMsg: string,
    assistantMsg: string,
  ) => {
    const projectIdAtCall = currentProjectId;
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
      alert(t.pleaseConfigureApiKey);
      return;
    }
    const parentId = selectedNodeId;
    if (!parentId) return;
    const newId = createTurnNode(userMsg, parentId);
    setSelectedNode(newId);
    updateTurnNode(newId, { status: 'running' });
    const currentNodes = useDebugStore.getState().nodes;
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
      alert(t.pleaseConfigureApiKey);
      return;
    }
    if (!selectedNodeId || !selectedNode) return;
    const supplement = input.trim();
    const finalUserMsg = supplement
      ? `${selectedNode.data.userMessage}\n\n补充：${supplement}`
      : selectedNode.data.userMessage;
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
      alert(t.pleaseConfigureApiKey);
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
      const marks = await detectConflicts(selectedNodeId, nodesNow);
      for (const m of marks) {
        updateTurnNode(m.nodeId, { conflictNote: m.note });
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
    if (confirm(t.confirmPruneNode)) {
      deleteNode(selectedNodeId);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleContinueQuestion();
    }
  };

  return {
    input,
    setInput,
    checkingConflict,
    handleContinueQuestion,
    handleRegenerate,
    handleSuggestionClick,
    handleAbandon,
    handleReactivate,
    handleIgnore,
    handleUnignore,
    handleCheckConflict,
    handleClearConflict,
    handlePruneNode,
    handleKeyDown,
  };
}
