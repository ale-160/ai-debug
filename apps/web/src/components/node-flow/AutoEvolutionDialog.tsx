// ============================================================
// AI Debug — 自动推演对话框（HITL 受控推演）
//
// 用户配置参数（步数/分叉/置信度阈值）→ 启动 runEvolution →
// 推演中实时显示进度 → 置信度低时弹窗询问 → 推演完成显示总结。
// 通过 AbortController 取消所有进行中的 LLM 调用。
// 懒加载组件，由 DebugFlowEditor 在用户点击"自动推演"按钮后渲染。
// ============================================================
'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  Zap,
  Play,
  Square,
  Trash2,
  Loader2,
  AlertTriangle,
  ArrowRight,
  RefreshCw,
} from 'lucide-react';
import { useDebugStore } from '@/lib/debug-store';
import { useTranslation } from '@/components/I18nProvider';
import { isConfigured } from '@/lib/llm-config';
import {
  runEvolution,
  findEffectiveLeaves,
  type EvolutionBranchResult,
} from '@/lib/auto-evolution-engine';
import { buildMemoryContext } from '@/lib/memory-engine';
import type { Node } from 'reactflow';
import type { TurnNodeData } from './types';

interface AutoEvolutionDialogProps {
  /** 关闭对话框 */
  onClose: () => void;
}

/** 推演参数默认值 */
const DEFAULT_MAX_STEPS = 3;
const DEFAULT_MAX_BRANCHES = 1;
const DEFAULT_CONFIDENCE = 0.6;
/** 每次 LLM 调用粗略 token 估算（用于成本预估） */
const TOKENS_PER_CALL = 2000;

/**
 * 低置信度弹窗内部状态：当 onLowConfidence 触发时由引擎等待用户决策。
 * - nodeId/confidence/reasoning：引擎传入的当前节点信息
 * - resolveRef：持有 Promise 的 resolve，用户点击选项后调用
 */
interface LowConfidencePrompt {
  nodeId: string;
  confidence: number;
  reasoning: string;
  resolveRef: (decision: 'continue' | 'stop' | { newDirection: string }) => void;
}

/**
 * 自动推演对话框：配置参数 + 启动 + 进度显示 + 低置信度弹窗 + 完成总结。
 * 通过 useDebugStore 订阅 autoEvolutionState 实时更新进度。
 */
function AutoEvolutionDialog({ onClose }: AutoEvolutionDialogProps) {
  const { t, tf } = useTranslation();

  // ========== 推演参数 ==========
  const [maxSteps, setMaxSteps] = useState(DEFAULT_MAX_STEPS);
  const [maxBranches, setMaxBranches] = useState(DEFAULT_MAX_BRANCHES);
  const [confidenceThreshold, setConfidenceThreshold] = useState(DEFAULT_CONFIDENCE);

  // ========== store 订阅 ==========
  const autoEvolutionState = useDebugStore((s) => s.autoEvolutionState);
  const nodes = useDebugStore((s) => s.nodes);
  const selectedNodeId = useDebugStore((s) => s.selectedNodeId);
  const startAutoEvolution = useDebugStore((s) => s.startAutoEvolution);
  const stopAutoEvolution = useDebugStore((s) => s.stopAutoEvolution);
  const doneAutoEvolution = useDebugStore((s) => s.doneAutoEvolution);
  const setAutoEvolutionStep = useDebugStore((s) => s.setAutoEvolutionStep);
  const deleteEvolutionNodes = useDebugStore((s) => s.deleteEvolutionNodes);
  const appSettings = useDebugStore((s) => s.appSettings);
  const globalMemory = useDebugStore((s) => s.globalMemory);
  const projects = useDebugStore((s) => s.projects);
  const currentProjectId = useDebugStore((s) => s.currentProjectId);

  // ========== 推演运行时状态 ==========
  /** 当前推演的 AbortController（用户停止时 abort） */
  const abortRef = useRef<AbortController | null>(null);
  /** 本次推演的各路结果（完成/停止后展示总结） */
  const [branchResults, setBranchResults] = useState<EvolutionBranchResult[]>([]);
  /** 本次推演的起点叶节点 id 列表（用于"删除本次推演"按 startNodeId 批量删除） */
  const [runStartIds, setRunStartIds] = useState<string[]>([]);
  /** 低置信度弹窗（onLowConfidence 触发时填入，用户决策后置空） */
  const [lowConfidencePrompt, setLowConfidencePrompt] =
    useState<LowConfidencePrompt | null>(null);
  /** "换一个方向"输入框 */
  const [newDirection, setNewDirection] = useState('');
  /** 推演是否正在运行（含 paused） */
  const isRunning =
    autoEvolutionState.status === 'running' || autoEvolutionState.status === 'paused';
  /** 推演是否已完成（done）或已停止（idle 但有结果） */
  const isFinished =
    autoEvolutionState.status === 'done' ||
    (autoEvolutionState.status === 'idle' && branchResults.length > 0);

  // ========== 成本预估 ==========
  const estimatedCalls = maxSteps * maxBranches * 2;
  const estimatedTokens = estimatedCalls * TOKENS_PER_CALL;

  // ========== 统计本次推演产生的节点 ==========
  /** 推演过程中实时已产生节点数（订阅 nodes 变化） */
  const producedNodeCount = useMemo(() => {
    if (runStartIds.length === 0) return 0;
    const idSet = new Set(runStartIds);
    return nodes.filter(
      (n) =>
        n.data.evolutionMeta && idSet.has(n.data.evolutionMeta.startNodeId),
    ).length;
  }, [nodes, runStartIds]);

  /** 完成时按 startNodeId 分组统计每路节点数 */
  const branchSummaries = useMemo(() => {
    return branchResults.map((r) => ({
      startNodeId: r.startNodeId,
      nodeCount: r.finalNodeIds.length,
      converged: r.converged,
      stopped: r.stopped,
    }));
  }, [branchResults]);

  // ========== 启动推演 ==========
  const handleStart = useCallback(async () => {
    if (!selectedNodeId) {
      alert(t.autoEvolutionNeedSelectNode);
      return;
    }
    if (!isConfigured()) {
      alert(t.autoEvolutionNotConfigured);
      return;
    }

    // 找出选中节点子树的有效叶节点
    const leaves = findEffectiveLeaves(selectedNodeId, nodes);
    if (leaves.length === 0) {
      alert(t.autoEvolutionNoEffectiveLeaves);
      return;
    }

    // 构建注入到 system prompt 的记忆/规则上下文（与 NodeInspector 保持一致）
    const projectMem =
      currentProjectId && appSettings.enableProjectMemory
        ? (projects.find((p) => p.id === currentProjectId)?.memory ?? [])
        : [];
    const globalMem = appSettings.enableGlobalMemory ? globalMemory : [];
    const extraContext =
      buildMemoryContext(appSettings.globalRules, globalMem, projectMem) || undefined;

    // 启动推演：状态置 running，初始化进度
    startAutoEvolution(maxSteps, leaves.length);
    setBranchResults([]);
    setRunStartIds(leaves);
    setLowConfidencePrompt(null);
    setNewDirection('');

    // 创建 AbortController（用户停止时 abort）
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const results = await runEvolution(
        leaves,
        {
          maxSteps,
          maxBranches,
          confidenceThreshold,
          extraContext,
          onStepStart: (step) => setAutoEvolutionStep(step),
          onStepDone: (step, startNodeId, childCount) => {
            // 简化进度更新：步数已由 onStepStart 更新
            void step;
            void startNodeId;
            void childCount;
          },
          onLowConfidence: (nodeId, confidence, reasoning) => {
            // 弹窗询问用户，返回 Promise 等待决策
            return new Promise<'continue' | 'stop' | { newDirection: string }>(
              (resolve) => {
                setLowConfidencePrompt({
                  nodeId,
                  confidence,
                  reasoning,
                  resolveRef: resolve,
                });
              },
            );
          },
        },
        controller.signal,
      );
      setBranchResults(results);
      doneAutoEvolution();
    } catch (err) {
      // 非预期错误：显示错误并停止
      const msg = err instanceof Error ? err.message : String(err);
      alert(tf('autoEvolutionStartFailed', { message: msg }));
      stopAutoEvolution();
    }
  }, [
    selectedNodeId,
    nodes,
    maxSteps,
    maxBranches,
    confidenceThreshold,
    appSettings,
    globalMemory,
    projects,
    currentProjectId,
    startAutoEvolution,
    setAutoEvolutionStep,
    doneAutoEvolution,
    stopAutoEvolution,
    t,
    tf,
  ]);

  // ========== 停止推演 ==========
  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    // 不立即 stopAutoEvolution：runEvolution 返回后会自然进入 done 分支
    // 但若用户停止时引擎正在等待弹窗，需主动 reject 弹窗
    if (lowConfidencePrompt) {
      lowConfidencePrompt.resolveRef('stop');
      setLowConfidencePrompt(null);
    }
  }, [lowConfidencePrompt]);

  // ========== 低置信度弹窗：用户决策 ==========
  const handleContinue = useCallback(() => {
    if (!lowConfidencePrompt) return;
    lowConfidencePrompt.resolveRef('continue');
    setLowConfidencePrompt(null);
  }, [lowConfidencePrompt]);

  const handleStopFromPrompt = useCallback(() => {
    if (!lowConfidencePrompt) return;
    lowConfidencePrompt.resolveRef('stop');
    setLowConfidencePrompt(null);
    // 同时 abort 进行中的请求
    abortRef.current?.abort();
  }, [lowConfidencePrompt]);

  const handleChangeDirection = useCallback(() => {
    if (!lowConfidencePrompt) return;
    const dir = newDirection.trim();
    if (!dir) return;
    lowConfidencePrompt.resolveRef({ newDirection: dir });
    setLowConfidencePrompt(null);
    setNewDirection('');
  }, [lowConfidencePrompt, newDirection]);

  // ========== 删除本次推演 ==========
  const handleDeleteRun = useCallback(
    (startNodeId?: string) => {
      // 删除单路或全部
      const idsToDelete = startNodeId ? [startNodeId] : runStartIds;
      let totalCount = 0;
      const idSet = new Set(idsToDelete);
      for (const n of nodes) {
        if (
          n.data.evolutionMeta &&
          idSet.has(n.data.evolutionMeta.startNodeId)
        ) {
          totalCount++;
        }
      }
      if (totalCount === 0) return;
      const confirmMsg = startNodeId
        ? tf('autoEvolutionConfirmDeleteBranch', { count: totalCount })
        : tf('autoEvolutionConfirmDelete', { count: totalCount });
      if (!confirm(confirmMsg)) return;
      if (startNodeId) {
        deleteEvolutionNodes(startNodeId);
      } else {
        for (const id of idsToDelete) deleteEvolutionNodes(id);
      }
      // 清理本对话框状态
      setBranchResults([]);
      setRunStartIds([]);
      stopAutoEvolution();
      onClose();
    },
    [runStartIds, nodes, tf, deleteEvolutionNodes, stopAutoEvolution, onClose],
  );

  // ========== 关闭对话框 ==========
  const handleClose = useCallback(() => {
    // 推演进行中时不允许直接关闭，需先停止
    if (isRunning) {
      handleStop();
    }
    onClose();
  }, [isRunning, handleStop, onClose]);

  // 组件卸载时取消进行中的请求
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // 弹窗显示时聚焦"换一个方向"输入框
  const newDirectionRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (lowConfidencePrompt && newDirectionRef.current) {
      newDirectionRef.current.focus();
    }
  }, [lowConfidencePrompt]);

  // 背景点击关闭：仅当不在推演中且无弹窗时允许
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && !isRunning && !lowConfidencePrompt) {
        onClose();
      }
    },
    [isRunning, lowConfidencePrompt, onClose],
  );

  // ========== 当前选中节点摘要（用于低置信度弹窗显示） ==========
  const lowConfidenceNode = useMemo<Node<TurnNodeData> | null>(() => {
    if (!lowConfidencePrompt) return null;
    return nodes.find((n) => n.id === lowConfidencePrompt.nodeId) ?? null;
  }, [lowConfidencePrompt, nodes]);

  const lowConfidenceNodeSummary = useMemo(() => {
    if (!lowConfidenceNode) return '';
    return (
      lowConfidenceNode.data.summary?.trim() ||
      lowConfidenceNode.data.userMessage.slice(0, 100)
    );
  }, [lowConfidenceNode]);

  return (
    <div
      className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center animate-[fadeIn_0.2s_ease-out] dark:bg-black/50"
      onClick={handleBackdropClick}
    >
      <div className="bg-white rounded-xl shadow-2xl w-[560px] max-w-[90vw] max-h-[85vh] overflow-hidden animate-[slideUp_0.25s_ease-out] dark:bg-slate-800 flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-amber-500 flex items-center justify-center">
              <Zap size={16} className="text-white" />
            </div>
            <div>
              <h2 className="font-semibold text-slate-800 text-sm dark:text-slate-100">
                {t.autoEvolutionTitle}
              </h2>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                {t.autoEvolutionSubtitle}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            disabled={isRunning && !lowConfidencePrompt}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-md transition-colors dark:hover:text-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label={t.autoEvolutionClose}
          >
            <X size={16} />
          </button>
        </div>

        {/* 内容区 */}
        <div className="p-5 overflow-y-auto flex-1 space-y-5">
          {/* 配置参数（仅未运行时显示） */}
          {!isRunning && !isFinished && (
            <>
              <div className="space-y-4">
                {/* 最大步数 */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                      {t.autoEvolutionMaxSteps}
                    </label>
                    <span className="text-xs font-mono text-violet-600 dark:text-violet-400">
                      {maxSteps}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    step={1}
                    value={maxSteps}
                    onChange={(e) => setMaxSteps(Number(e.target.value))}
                    className="w-full accent-violet-500"
                  />
                </div>

                {/* 分叉上限 */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                      {t.autoEvolutionMaxBranches}
                    </label>
                    <span className="text-xs font-mono text-violet-600 dark:text-violet-400">
                      {maxBranches}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={3}
                    step={1}
                    value={maxBranches}
                    onChange={(e) => setMaxBranches(Number(e.target.value))}
                    className="w-full accent-violet-500"
                  />
                </div>

                {/* 置信度阈值 */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                      {t.autoEvolutionConfidenceThreshold}
                    </label>
                    <span className="text-xs font-mono text-violet-600 dark:text-violet-400">
                      {confidenceThreshold.toFixed(2)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={confidenceThreshold}
                    onChange={(e) => setConfidenceThreshold(Number(e.target.value))}
                    className="w-full accent-violet-500"
                  />
                </div>
              </div>

              {/* 成本预估 */}
              <div className="p-3 bg-gradient-to-r from-violet-50 to-amber-50 rounded-lg border border-violet-100 dark:from-violet-900/30 dark:to-amber-900/30 dark:border-violet-800">
                <div className="text-[11px] font-semibold text-violet-700 dark:text-violet-300 uppercase tracking-wide mb-1.5">
                  {t.autoEvolutionCostEstimate}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
                  <span>
                    {t.autoEvolutionEstimatedCalls}：
                    <span className="font-mono font-semibold text-violet-600 dark:text-violet-400">
                      {tf('autoEvolutionCalls', { count: estimatedCalls })}
                    </span>
                  </span>
                  <span>
                    {t.autoEvolutionEstimatedTokens}：
                    <span className="font-mono font-semibold text-violet-600 dark:text-violet-400">
                      {tf('autoEvolutionTokens', { count: estimatedTokens })}
                    </span>
                  </span>
                </div>
              </div>

              {/* 启动按钮 */}
              <button
                onClick={() => void handleStart()}
                disabled={!selectedNodeId}
                className="w-full bg-gradient-to-r from-violet-600 to-amber-500 text-white rounded-lg py-2.5 px-3 hover:opacity-90 flex items-center justify-center gap-2 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Play size={16} />
                <span className="text-sm font-medium">{t.autoEvolutionStartBtn}</span>
              </button>
              {!selectedNodeId && (
                <div className="text-center text-[11px] text-slate-400 dark:text-slate-500">
                  {t.autoEvolutionSelectNodeFirst}
                </div>
              )}
            </>
          )}

          {/* 推演进度（运行中或已完成时显示） */}
          {(isRunning || isFinished) && (
            <div className="space-y-4">
              {/* 进度标题 */}
              <div className="flex items-center gap-2">
                {isRunning ? (
                  <Loader2 size={14} className="animate-spin text-violet-500" />
                ) : (
                  <Zap size={14} className="text-amber-500" />
                )}
                <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                  {isRunning
                    ? autoEvolutionState.status === 'paused'
                      ? t.autoEvolutionPaused
                      : t.autoEvolutionRunning
                    : autoEvolutionState.status === 'done'
                    ? t.autoEvolutionDone
                    : t.autoEvolutionStopped}
                </h3>
              </div>

              {/* 进度数据 */}
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-2.5 text-center">
                  <div className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wide">
                    {t.autoEvolutionCurrentStep}
                  </div>
                  <div className="text-base font-semibold text-slate-700 dark:text-slate-200 mt-0.5">
                    {tf('autoEvolutionStepN', {
                      step: autoEvolutionState.currentStep,
                      max: autoEvolutionState.maxSteps,
                    })}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-2.5 text-center">
                  <div className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wide">
                    {t.autoEvolutionActiveBranches}
                  </div>
                  <div className="text-base font-semibold text-slate-700 dark:text-slate-200 mt-0.5">
                    {autoEvolutionState.activeBranches}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-2.5 text-center">
                  <div className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wide">
                    {t.autoEvolutionProducedNodes}
                  </div>
                  <div className="text-base font-semibold text-slate-700 dark:text-slate-200 mt-0.5">
                    {producedNodeCount}
                  </div>
                </div>
              </div>

              {/* 视觉化进度条：step N/M 的横向进度 */}
              {isRunning && autoEvolutionState.maxSteps > 0 && (
                <div className="space-y-1">
                  <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-violet-500 to-amber-500 transition-all duration-500 ease-out"
                      style={{
                        width: `${Math.min(
                          100,
                          (autoEvolutionState.currentStep /
                            autoEvolutionState.maxSteps) *
                            100,
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              {/* 停止按钮（运行中显示） */}
              {isRunning && (
                <button
                  onClick={handleStop}
                  className="w-full bg-red-500 text-white rounded-lg py-2 px-3 hover:bg-red-600 flex items-center justify-center gap-2 transition-colors"
                >
                  <Square size={14} />
                  <span className="text-sm font-medium">{t.autoEvolutionStop}</span>
                </button>
              )}

              {/* 完成总结 */}
              {isFinished && (
                <div className="space-y-3">
                  {/* 总览 */}
                  <div className="p-3 rounded-lg border border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-700">
                    <div className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 uppercase tracking-wide mb-1.5">
                      {t.autoEvolutionDone}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
                      <span>
                        {t.autoEvolutionTotalNodes}：
                        <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                          {producedNodeCount}
                        </span>
                      </span>
                      <span>
                        {t.autoEvolutionTotalBranches}：
                        <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                          {branchSummaries.length}
                        </span>
                      </span>
                    </div>
                  </div>

                  {/* 各路详情 + 按路删除 */}
                  {branchSummaries.length > 1 && (
                    <div className="space-y-1.5">
                      {branchSummaries.map((b) => (
                        <div
                          key={b.startNodeId}
                          className="flex items-center justify-between p-2 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50"
                        >
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-slate-600 dark:text-slate-300">
                              {tf('autoEvolutionBranchNodes', { count: b.nodeCount })}
                            </span>
                            {b.converged && (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-[10px]">
                                {t.autoEvolutionConverged}
                              </span>
                            )}
                          </div>
                          <button
                            onClick={() => handleDeleteRun(b.startNodeId)}
                            className="inline-flex items-center gap-1 text-[11px] text-red-500 hover:text-red-700 dark:hover:text-red-400 px-1.5 py-0.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                          >
                            <Trash2 size={11} />
                            {t.autoEvolutionDeleteBranch}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 全部删除按钮 */}
                  <button
                    onClick={() => handleDeleteRun()}
                    className="w-full bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-red-600 dark:text-red-400 rounded-lg py-2 px-3 hover:bg-red-100 dark:hover:bg-red-900/30 flex items-center justify-center gap-2 transition-colors text-sm"
                  >
                    <Trash2 size={14} />
                    {t.autoEvolutionDeleteThisRun}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ========== 低置信度弹窗（叠加在对话框之上） ========== */}
        {lowConfidencePrompt && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center z-10 p-4">
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-[480px] overflow-hidden border border-amber-200 dark:border-amber-700">
              {/* 弹窗头部 */}
              <div className="px-4 py-3 border-b border-amber-100 dark:border-amber-700/50 bg-amber-50/50 dark:bg-amber-900/20">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={16} className="text-amber-500" />
                  <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                    {t.autoEvolutionLowConfidenceTitle}
                  </h3>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  {t.autoEvolutionLowConfidenceDesc}
                </p>
              </div>

              {/* 弹窗内容 */}
              <div className="p-4 space-y-3">
                {/* 当前节点摘要 */}
                <div className="space-y-1">
                  <div className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">
                    {t.autoEvolutionNodeSummary}
                  </div>
                  <div className="text-xs text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/50 rounded p-2 break-words max-h-[80px] overflow-y-auto">
                    {lowConfidenceNodeSummary || '—'}
                  </div>
                </div>

                {/* AI 不确定原因 */}
                <div className="space-y-1">
                  <div className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide">
                    {t.autoEvolutionReasoning}
                  </div>
                  <div className="text-xs text-slate-700 dark:text-slate-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-700/50 rounded p-2 break-words">
                    {lowConfidencePrompt.reasoning || '—'}
                  </div>
                </div>

                {/* 置信度 */}
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  {t.autoEvolutionConfidence}：
                  <span className="font-mono font-semibold text-amber-600 dark:text-amber-400 ml-1">
                    {lowConfidencePrompt.confidence.toFixed(2)}
                  </span>
                </div>

                {/* 换一个方向输入 */}
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                    <RefreshCw size={11} />
                    {t.autoEvolutionChangeDirection}
                  </div>
                  <div className="flex gap-1.5">
                    <textarea
                      ref={newDirectionRef}
                      value={newDirection}
                      onChange={(e) => setNewDirection(e.target.value)}
                      placeholder={t.autoEvolutionNewDirectionPlaceholder}
                      rows={2}
                      className="flex-1 resize-none text-xs px-2 py-1.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-violet-400"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleChangeDirection();
                        }
                      }}
                    />
                    <button
                      onClick={handleChangeDirection}
                      disabled={!newDirection.trim()}
                      className="self-stretch px-2.5 bg-violet-500 text-white rounded text-xs hover:bg-violet-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                      title={t.autoEvolutionChangeDirection}
                    >
                      <ArrowRight size={12} />
                    </button>
                  </div>
                </div>
              </div>

              {/* 弹窗底部操作 */}
              <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-700 flex items-center gap-2">
                <button
                  onClick={handleStopFromPrompt}
                  className="flex-1 inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded bg-red-500 text-white text-xs hover:bg-red-600"
                >
                  <Square size={12} />
                  {t.autoEvolutionStopRun}
                </button>
                <button
                  onClick={handleContinue}
                  className="flex-1 inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded bg-emerald-500 text-white text-xs hover:bg-emerald-600"
                >
                  <ArrowRight size={12} />
                  {t.autoEvolutionContinue}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default AutoEvolutionDialog;
