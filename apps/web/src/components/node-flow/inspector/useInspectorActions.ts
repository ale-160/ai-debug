'use client';

import { useState, useRef, useEffect } from 'react';
import type { Node } from 'reactflow';
import { useDebugStore } from '@/lib/debug-store';
import { streamTurnResponse } from '@/lib/network-engine';
import { detectConflicts, type ConflictMark } from '@/lib/conflict-engine';
import { extractMemory, buildMemoryContext } from '@/lib/memory-engine';
import { isConfigured } from '@/lib/llm-config';
import { hitlEventBus, HitlRunId, HitlEventName } from '@/lib/hitl-event-bus';
import { useTranslation } from '@/components/I18nProvider';
import type { TurnNodeData, Suggestion, NodeAttachment } from '../types';
import { emit as emitNodeEvent, NODE_EVENTS, type ConflictDecisionPayload } from '../event-bus';
import type { ConflictDecision } from '../ConflictDecisionModal';

/** 冲突决策超时时间：5 分钟未决策自动按 ignore 处理 */
const CONFLICT_DECISION_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Inspector 操作逻辑 hook：托管输入框状态、流式请求 AbortController、
 * 冲突检测状态，以及继续追问/重新生成/弃用/忽略/冲突检测等全部处理函数。
 * 主组件仅负责渲染，所有副作用与 store 写入集中在此。
 */
export function useInspectorActions(selectedNode: Node<TurnNodeData> | null) {
  const { t } = useTranslation();
  const [input, setInput] = useState('');
  /** 当前编辑中的附件列表（提交后清空，由 createTurnNode 携带到节点 data） */
  const [attachments, setAttachments] = useState<NodeAttachment[]>([]);
  const [checkingConflict, setCheckingConflict] = useState(false);
  /** 当前流式请求的 AbortController：用于在发起新请求前取消旧请求 */
  const abortRef = useRef<AbortController | null>(null);
  /**
   * 5.9.2：旁路任务（记忆提取 / 冲突自动检测）项目级 AbortController。
   * - 切换项目（currentProjectId 变化）或组件卸载时 abort，避免旁路任务写入旧项目
   * - 通过 ref 持有，每次切换项目时创建新 controller；旧 controller.abort() 后
   *   旁路异步任务内的 getState() === projectIdAtCall 校验虽能防错写，但 abort 可
   *   提前取消未完成的 LLM 调用（extractMemory / detectConflicts），节省 token 与算力
   */
  const sidecarAbortRef = useRef<AbortController | null>(null);
  // 当前项目 ID：提前声明，供下方 sidecarAbortRef 的 useEffect deps 使用
  const currentProjectId = useDebugStore((s) => s.currentProjectId);
  useEffect(() => {
    // 首次挂载：创建初始 controller
    if (!sidecarAbortRef.current) {
      sidecarAbortRef.current = new AbortController();
    }
    return () => {
      // 组件卸载时 abort 所有旁路任务
      sidecarAbortRef.current?.abort();
    };
  }, []);
  useEffect(() => {
    // currentProjectId 变化时 abort 旧旁路任务并创建新 controller
    // 首次挂载由上一个 effect 处理，这里通过 sidecarAbortRef 已存在判断跳过
    if (!sidecarAbortRef.current) {
      sidecarAbortRef.current = new AbortController();
      return;
    }
    sidecarAbortRef.current.abort();
    sidecarAbortRef.current = new AbortController();
  }, [currentProjectId]);

  // store：节点与分支操作
  const selectedNodeId = useDebugStore((s) => s.selectedNodeId);
  const createTurnNode = useDebugStore((s) => s.createTurnNode);
  const updateTurnNode = useDebugStore((s) => s.updateTurnNode);
  const appendAssistantChunk = useDebugStore((s) => s.appendAssistantChunk);
  // H-8：流式结束后强制 flush buffer
  const flushStreamBuffer = useDebugStore((s) => s.flushStreamBuffer);
  const setSelectedNode = useDebugStore((s) => s.setSelectedNode);
  const abandonBranch = useDebugStore((s) => s.abandonBranch);
  const reactivateBranch = useDebugStore((s) => s.reactivateBranch);
  const ignoreNode = useDebugStore((s) => s.ignoreNode);
  const unignoreNode = useDebugStore((s) => s.unignoreNode);
  const deleteNode = useDebugStore((s) => s.deleteNode);
  // store：设置与记忆
  const appSettings = useDebugStore((s) => s.appSettings);
  const projects = useDebugStore((s) => s.projects);
  const addGlobalMemory = useDebugStore((s) => s.addGlobalMemory);
  const addProjectMemory = useDebugStore((s) => s.addProjectMemory);
  const incrementTurnCounter = useDebugStore((s) => s.incrementTurnCounter);
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
   * 应用冲突决策：在 HITL handler 中根据用户选择执行对应副作用。
   * - keep-a：保留前序主干 → 弃用冲突节点所属分支
   * - keep-b：保留冲突节点 → 仅清除标注（让当前结论成立）
   * - merge：合并两者 → 暂同 keep-b（合并流程待后续实现）
   * - ignore：忽略 → 清除标注
   */
  const applyConflictDecision = (conflictId: string, decision: ConflictDecision) => {
    switch (decision) {
      case 'keep-a':
        // 保留 A：放弃冲突节点所属分支（含子树）
        abandonBranch(conflictId);
        break;
      case 'keep-b':
      case 'merge':
      case 'ignore':
      default:
        // 保留 B / 合并 / 忽略：清除冲突标注（合并流程待后续实现）
        updateTurnNode(conflictId, { conflictNote: undefined });
        break;
    }
  };

  /**
   * 构造冲突决策 payload：从节点列表解析分支名等展示信息。
   * 分支 A 取被标注节点的父节点（前序主干），分支 B 取被标注节点自身。
   * 无显式 branchName 时回退到 summary 或 userMessage 摘要。
   */
  const buildConflictPayload = (
    mark: ConflictMark,
    nodes: Node<TurnNodeData>[],
  ): ConflictDecisionPayload => {
    const conflictNode = nodes.find((n) => n.id === mark.nodeId);
    const fallbackB =
      conflictNode?.data.branchName ??
      conflictNode?.data.summary ??
      conflictNode?.data.userMessage.slice(0, 20) ??
      'B';
    const parentId = conflictNode?.data.parentId;
    const parentNode = parentId ? nodes.find((n) => n.id === parentId) : null;
    const fallbackA =
      parentNode?.data.branchName ??
      parentNode?.data.summary ??
      parentNode?.data.userMessage.slice(0, 20) ??
      'A';
    return {
      id: mark.nodeId,
      nodeId: mark.nodeId,
      branchAName: fallbackA,
      branchBName: fallbackB,
      description: mark.note,
    };
  };

  /**
   * 订阅冲突决策 HITL：等待 DebugFlowEditor 通过 emit 唤醒。
   * 同 (runId, eventName) 覆盖语义，重复订阅安全。
   * 超时 5 分钟未决策自动按 ignore 处理（清除标注）。
   */
  const subscribeConflictDecision = (conflictId: string) => {
    const eventName = HitlEventName.conflict(conflictId);
    hitlEventBus.subscribe(
      HitlRunId.CONFLICT_RESOLUTION,
      eventName,
      (payload) => {
        const { decision } = (payload ?? {}) as { decision?: ConflictDecision };
        if (!decision) return;
        applyConflictDecision(conflictId, decision);
      },
      () => {
        // 超时：自动按 ignore 处理
        updateTurnNode(conflictId, { conflictNote: undefined });
      },
      CONFLICT_DECISION_TIMEOUT_MS,
    );
  };

  /**
   * 冲突检测命中后的统一接入点：
   * 1. 写入 conflictNote（已有行为）
   * 2. 订阅 HITL 等待用户决策
   * 3. 派发 conflict-detected 事件，DebugFlowEditor 监听后弹 Modal
   */
  const handleConflictDetected = (marks: ConflictMark[], nodes: Node<TurnNodeData>[]) => {
    for (const m of marks) {
      subscribeConflictDecision(m.nodeId);
      const payload = buildConflictPayload(m, nodes);
      emitNodeEvent(NODE_EVENTS.ConflictDetected, payload);
    }
  };

  /**
   * 回答成功后的旁路钩子：按频率触发记忆提取 + 冲突自动检测。
   * 全部非阻塞，失败静默。异步回调内会校验项目是否变化，避免竞态写入错项目。
   *
   * 5.9.2：旁路任务接入 sidecarAbortRef（项目级 AbortController）。
   * - 调用前检查 signal.aborted，已取消则跳过
   * - LLM 调用返回后再检查 signal.aborted，已取消则不写入 store
   * - 真正取消 LLM 调用需 extractMemory/detectConflicts 内部接 signal（当前未接，
   *   仅靠前后检查避免错写 + 节省后续写入；TODO：在两个引擎内接入 AbortSignal）
   *
   * 3.5.2：闭包捕获的 appSettings 在多次流式并发完成时可能读到旧值，
   * 内部通过 useDebugStore.getState() 读取最新 appSettings，避免频率判断失效。
   * 3.5.3：冲突检测的 nodesNow 在 await 期间可能过期（用户删节点/切项目），
   * 在 updateTurnNode 前校验节点存在，handleConflictDetected 前过滤已删除 marks。
   */
  const runPostTurnSidecars = (nodeId: string, userMsg: string, assistantMsg: string) => {
    const projectIdAtCall = currentProjectId;
    // 使用 incrementTurnCounter 返回值，避免闭包 turnCounter 旧值竞态（两个流式同时完成时读到相同旧值）
    const newCount = incrementTurnCounter();
    const sidecarSignal = sidecarAbortRef.current?.signal;
    // 3.5.2：从 store 读取最新 appSettings，避免闭包过期值
    const settingsNow = useDebugStore.getState().appSettings;

    // 记忆提取：按 memoryFrequency 频率
    const shouldExtractMemory =
      (settingsNow.enableGlobalMemory || settingsNow.enableProjectMemory) &&
      newCount % Math.max(1, settingsNow.memoryFrequency) === 0;
    if (shouldExtractMemory && assistantMsg.trim()) {
      // 5.9.2：项目已切换则跳过启动旁路任务
      if (sidecarSignal?.aborted) return;
      void (async () => {
        const contents = await extractMemory(userMsg, assistantMsg);
        if (contents.length === 0) return;
        // 5.9.2：旁路任务期间项目已切换 / 组件已卸载 → 丢弃结果
        if (sidecarSignal?.aborted) return;
        const stillSameProject = useDebugStore.getState().currentProjectId === projectIdAtCall;
        // 3.5.2：再次读取最新 appSettings，避免 await 期间用户修改设置
        const settingsAfter = useDebugStore.getState().appSettings;
        if (settingsAfter.enableGlobalMemory) {
          for (const c of contents) addGlobalMemory(c, 'auto');
        }
        if (settingsAfter.enableProjectMemory && projectIdAtCall && stillSameProject) {
          for (const c of contents) addProjectMemory(c, 'auto');
        }
      })();
    }

    // 冲突自动检测：按 conflictCheckFrequency 频率
    const shouldCheckConflict =
      settingsNow.enableConflictAutoCheck &&
      newCount % Math.max(1, settingsNow.conflictCheckFrequency) === 0;
    if (shouldCheckConflict) {
      // 5.9.2：项目已切换则跳过启动旁路任务
      if (sidecarSignal?.aborted) return;
      void (async () => {
        const nodesNow = useDebugStore.getState().nodes;
        const marks = await detectConflicts(nodeId, nodesNow);
        // 5.9.2：旁路任务期间项目已切换 / 组件已卸载 → 丢弃结果
        if (sidecarSignal?.aborted) return;
        if (useDebugStore.getState().currentProjectId !== projectIdAtCall) return;
        // 3.5.3：await 期间用户可能删除节点，过滤已不存在的 marks 避免错写
        const nodesAfterDetect = useDebugStore.getState().nodes;
        const existingIds = new Set(nodesAfterDetect.map((n) => n.id));
        const validMarks = marks.filter((m) => existingIds.has(m.nodeId));
        for (const m of validMarks) {
          updateTurnNode(m.nodeId, { conflictNote: m.note });
        }
        // P2-3：检测命中后接入 HITL 决策流（订阅 + 派发 conflict-detected 事件）
        if (validMarks.length > 0) {
          const nodesAfter = useDebugStore.getState().nodes;
          handleConflictDetected(validMarks, nodesAfter);
        }
      })();
    }
  };

  /** 创建子节点并流式生成 AI 回答（继续追问 / 分叉 / 建议方向 共用）
   *  @param userMsg  用户消息文本
   *  @param attachs  可选附件列表（仅 parsed 项会持久化到节点 data） */
  const createChildAndStream = async (userMsg: string, attachs?: NodeAttachment[]) => {
    if (!isConfigured()) {
      alert(t.pleaseConfigureApiKey);
      return;
    }
    const parentId = selectedNodeId;
    if (!parentId) return;
    // 仅持久化 parseStatus=parsed 的附件，failed 项不写入节点（避免污染 localStorage）
    const parsedAttachments = attachs?.filter((a) => a.parseStatus === 'parsed');
    const newId = createTurnNode(
      userMsg,
      parentId,
      parsedAttachments && parsedAttachments.length > 0
        ? { attachments: parsedAttachments }
        : undefined,
    );
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
      // 旁路回调：流式完成后异步生成路径摘要并写入节点 data.pathSummary
      (pathSummary) => updateTurnNode(newId, { pathSummary }),
    );
    // H-8：流式结束后强制 flush buffer，确保最后的 chunk 落到 nodes 后再切换 status
    flushStreamBuffer(newId);
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
    // 提交时把当前附件一起带走，然后清空输入与附件
    const currentAttachments = attachments;
    setInput('');
    setAttachments([]);
    void createChildAndStream(text, currentAttachments);
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
      // 旁路回调：重新生成时也刷新路径摘要（基于新回答内容）
      (pathSummary) => updateTurnNode(selectedNodeId, { pathSummary }),
    );
    // H-8：流式结束后强制 flush buffer，确保最后的 chunk 落到 nodes 后再切换 status
    flushStreamBuffer(selectedNodeId);
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
      // P2-3：检测命中后接入 HITL 决策流（订阅 + 派发 conflict-detected 事件）
      if (marks.length > 0) {
        const nodesAfter = useDebugStore.getState().nodes;
        handleConflictDetected(marks, nodesAfter);
      }
    } finally {
      setCheckingConflict(false);
    }
  };

  /**
   * 人工决策入口：在 ConflictCard 中点击「人工决策」时调用。
   * 重新订阅 HITL（覆盖语义，若已订阅则刷新；若已超时则重建），
   * 然后派发 conflict-decision-requested 事件让 DebugFlowEditor 弹 Modal。
   */
  const handleManualDecision = () => {
    if (!selectedNodeId || !selectedNode) return;
    const note = selectedNode.data.conflictNote;
    if (!note) return;
    // 重新订阅（覆盖语义安全）：处理超时后用户再次唤起的场景
    subscribeConflictDecision(selectedNodeId);
    // 构造 payload：与自动检测共用 buildConflictPayload
    const nodesNow = useDebugStore.getState().nodes;
    const payload = buildConflictPayload({ nodeId: selectedNodeId, note }, nodesNow);
    emitNodeEvent(NODE_EVENTS.ConflictDecisionRequested, payload);
  };

  /** 清除当前节点的冲突标注 */
  const handleClearConflict = () => {
    if (selectedNodeId) updateTurnNode(selectedNodeId, { conflictNote: undefined });
  };

  /** 清除当前节点的推演元数据（转为普通节点） */
  const handleClearEvolutionMeta = () => {
    if (!selectedNodeId) return;
    if (confirm(t.autoEvolutionConfirmClearMeta)) {
      updateTurnNode(selectedNodeId, { evolutionMeta: undefined });
    }
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
    attachments,
    setAttachments,
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
    handleClearEvolutionMeta,
    handlePruneNode,
    handleManualDecision,
    handleKeyDown,
  };
}
