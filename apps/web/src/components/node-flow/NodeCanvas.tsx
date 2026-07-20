'use client';

import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  MiniMap,
  useReactFlow,
  type Node,
  type Viewport,
} from 'reactflow';
import 'reactflow/dist/style.css';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  GitMerge,
  GitBranch,
  GitCompare,
  Network,
  MousePointer2,
  Hand,
  AlignJustify,
  Rows3,
  Ban,
  RotateCcw,
  EyeOff,
  Eye,
  Trash2,
  X,
  Tag,
  Copy,
  CornerDownRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { nodeTypes } from './nodes';
import { getStatusColor } from './nodes/node-utils';
import { layoutRadial } from './radial-layout';
import { layoutGit } from './git-layout';
import type { TurnNodeData } from './types';
import { useDebugStore } from '@/lib/debug-store';
import { streamTurnResponse } from '@/lib/network-engine';
import { isConfigured } from '@/lib/llm-config';
import { updateProject } from '@/lib/project-storage';
import { useTranslation } from '@/components/I18nProvider';

// diff 视图懒加载：react-diff-viewer-continued 较大，用户点击"对比"后才加载
const DiffViewer = lazy(() => import('./DiffViewer'));

const defaultEdgeOptions = {
  type: 'smoothstep',
  animated: false,
  style: { stroke: '#94a3b8', strokeWidth: 2 },
};

function collectVisibleNodeIds(
  selectedNodeId: string | null,
  nodes: Node<TurnNodeData>[],
): Set<string> | null {
  if (!selectedNodeId) return null;
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const pathIds = new Set<string>();
  let currentId: string | null = selectedNodeId;
  while (currentId) {
    if (pathIds.has(currentId)) break;
    pathIds.add(currentId);
    const node = nodeMap.get(currentId);
    currentId = node?.data.parentId ?? null;
  }
  const childrenMap = new Map<string, string[]>();
  for (const n of nodes) {
    if (n.data.parentId) {
      const list = childrenMap.get(n.data.parentId) ?? [];
      list.push(n.id);
      childrenMap.set(n.data.parentId, list);
    }
  }
  const allVisible = new Set<string>(pathIds);
  const queue: string[] = [...pathIds];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const children = childrenMap.get(id) ?? [];
    for (const childId of children) {
      if (!allVisible.has(childId)) {
        allVisible.add(childId);
        queue.push(childId);
      }
    }
  }
  return allVisible;
}

export default function NodeCanvas() {
  const { t, tf } = useTranslation();

  const nodes = useDebugStore((s) => s.nodes);
  const edges = useDebugStore((s) => s.edges);
  const onNodesChange = useDebugStore((s) => s.onNodesChange);
  const onEdgesChange = useDebugStore((s) => s.onEdgesChange);
  const onConnect = useDebugStore((s) => s.onConnect);
  const setSelectedNode = useDebugStore((s) => s.setSelectedNode);
  const setViewport = useDebugStore((s) => s.setViewport);
  const createMergedNode = useDebugStore((s) => s.createMergedNode);
  const createTurnNode = useDebugStore((s) => s.createTurnNode);
  const updateTurnNode = useDebugStore((s) => s.updateTurnNode);
  const appendAssistantChunk = useDebugStore((s) => s.appendAssistantChunk);
  const pushHistory = useDebugStore((s) => s.pushHistory);
  const selectedNodeId = useDebugStore((s) => s.selectedNodeId);
  const focusMode = useDebugStore((s) => s.focusMode);
  const toggleFocusMode = useDebugStore((s) => s.toggleFocusMode);
  // 视图模式切换（T027）：web 蛛网模式 / git git 风格模式
  const viewMode = useDebugStore((s) => s.viewMode);
  const setViewMode = useDebugStore((s) => s.setViewMode);

  // 批量操作 actions（T024 浮动工具条 + 右键菜单）
  const abandonBranch = useDebugStore((s) => s.abandonBranch);
  const reactivateBranch = useDebugStore((s) => s.reactivateBranch);
  const ignoreNode = useDebugStore((s) => s.ignoreNode);
  const unignoreNode = useDebugStore((s) => s.unignoreNode);
  const deleteNode = useDebugStore((s) => s.deleteNode);
  // 标签与分支管理 actions（T028）
  const addNodeTag = useDebugStore((s) => s.addNodeTag);
  const setNodeBranchName = useDebugStore((s) => s.setNodeBranchName);
  const appSettings = useDebugStore((s) => s.appSettings);

  const currentProjectId = useDebugStore((s) => s.currentProjectId);
  const projects = useDebugStore((s) => s.projects);
  const refreshProjects = useDebugStore((s) => s.refreshProjects);
  const currentProject = projects.find((p) => p.id === currentProjectId);

  const { zoomIn, zoomOut, fitView, setViewport: rfSetViewport, getViewport } = useReactFlow();

  const abortRef = useRef<AbortController | null>(null);
  const registerAbortController = useDebugStore((s) => s.registerAbortController);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  const startEditName = useCallback(() => {
    if (!currentProjectId) return;
    setNameDraft(currentProject?.name ?? '');
    setEditingName(true);
  }, [currentProjectId, currentProject?.name]);

  const commitName = useCallback(() => {
    setEditingName(false);
    const state = useDebugStore.getState();
    const id = state.currentProjectId;
    if (!id) return;
    const trimmed = nameDraft.trim();
    const current = state.projects.find((p) => p.id === id);
    if (!trimmed || trimmed === current?.name) return;
    updateProject(id, { name: trimmed });
    refreshProjects();
  }, [nameDraft, refreshProjects]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      setSelectedNode(node.id);
    },
    [setSelectedNode],
  );

  // 右键菜单 state（T024）：记录右键的节点 id 和菜单位置（声明在 onPaneClick 之前，避免 use-before-declare）
  const [contextMenu, setContextMenu] = useState<{ nodeId: string; x: number; y: number } | null>(
    null,
  );

  // diff 视图状态（T029）：对比两个节点的 assistantMessage，组件内 state 不入 store
  const [diffNodeAId, setDiffNodeAId] = useState<string | null>(null);
  const [diffNodeBId, setDiffNodeBId] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);

  // cherry-pick 状态（T031）：源节点 id，设置后右键其他节点可"移植到此处"
  const [cherryPickSource, setCherryPickSource] = useState<string | null>(null);

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
    setContextMenu(null);
  }, [setSelectedNode]);

  // 右键节点时记录位置并显示菜单（T024）
  const onNodeContextMenu = useCallback((e: React.MouseEvent, node: Node) => {
    e.preventDefault();
    setContextMenu({ nodeId: node.id, x: e.clientX, y: e.clientY });
  }, []);

  const onMove = useCallback(
    (_: unknown, vp: Viewport) => {
      setViewport(vp);
    },
    [setViewport],
  );

  const [interactionMode, setInteractionMode] = useState<'select' | 'hand'>('select');
  const [spacePressed, setSpacePressed] = useState(false);
  const isHandMode = interactionMode === 'hand' || spacePressed;

  const viewport = useDebugStore((s) => s.viewport);

  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isInitialLoadRef = useRef(true);

  // 撤销/重做已迁移至 store（P0-1：immer patches 增量历史），
  // 组件层只需在节点拖动结束时调用 pushHistory()，快捷键由 DebugFlowEditor 监听。

  // 快捷键回调 refs（避免 useEffect 频繁重绑 keydown 监听器）
  const handleDeleteRef = useRef<() => void>(() => {});
  const fitViewRef = useRef<() => void>(() => {});

  // 自定义滚轮 rAF 引用（合并连续 wheel 事件，平滑应用）
  const wheelRafRef = useRef<number | null>(null);
  const pendingWheelRef = useRef<{
    deltaX: number;
    deltaY: number;
    clientX: number;
    clientY: number;
    isZoom: boolean;
  } | null>(null);

  useEffect(() => {
    if (!currentProjectId) return;
    if (isInitialLoadRef.current) {
      isInitialLoadRef.current = false;
      return;
    }
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      const state = useDebugStore.getState();
      if (state.currentProjectId !== currentProjectId) return;
      if (!state.isDirty) return;
      state.saveProject();
    }, 500);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [nodes, edges, currentProjectId]);

  const viewportSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!currentProjectId) return;
    if (isInitialLoadRef.current) return;
    if (viewportSaveTimerRef.current) clearTimeout(viewportSaveTimerRef.current);
    viewportSaveTimerRef.current = setTimeout(() => {
      const state = useDebugStore.getState();
      if (state.currentProjectId !== currentProjectId) return;
      if (!state.isDirty) return;
      state.saveProject();
    }, 800);
    return () => {
      if (viewportSaveTimerRef.current) clearTimeout(viewportSaveTimerRef.current);
    };
  }, [viewport, currentProjectId]);

  useEffect(() => {
    isInitialLoadRef.current = true;
    const vp = useDebugStore.getState().viewport;
    if (vp) {
      rfSetViewport(vp);
    } else if (useDebugStore.getState().nodes.length > 0) {
      setTimeout(() => fitView({ padding: 0.2 }), 50);
    }
  }, [currentProjectId, rfSetViewport, fitView]);

  // 视图模式切换（T027）：viewMode 变化时用对应布局算法重算节点位置并 fitView。
  // 仅 viewMode 变化时触发，避免 nodes/edges 变化时反复重排。
  useEffect(() => {
    if (nodes.length === 0) return;
    const laidOut = viewMode === 'git' ? layoutGit(nodes, edges) : layoutRadial(nodes, edges);
    useDebugStore.setState({ nodes: laidOut });
    setTimeout(() => fitView({ padding: 0.2 }), 100);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);

  // 撤销/重做历史已迁移至 store（P0-1），组件层无需自动追踪 nodes/edges 变化。
  // 关键操作（create/delete/branch）在 store action 内部调用 pushHistory(true)，
  // 节点拖动则通过 onNodeDragStop 事件触发 pushHistory()。

  const handleDelete = useCallback(() => {
    const state = useDebugStore.getState();
    const selectedNodes = state.nodes.filter((n) => n.selected);
    const selectedEdges = state.edges.filter((e) => e.selected);
    if (selectedNodes.length === 0 && selectedEdges.length === 0) return;

    if (selectedNodes.length > 0) {
      const ok = confirm(t.confirmPruneNode);
      if (!ok) return;
      selectedNodes.forEach((n) => state.deleteNode(n.id));
      state.setSelectedNode(null);
    }

    if (selectedEdges.length > 0) {
      const ids = new Set(selectedEdges.map((e) => e.id));
      useDebugStore.setState((s) => ({
        edges: s.edges.filter((e) => !ids.has(e.id)),
        isDirty: true,
      }));
      // 边删除走 setState 不经 store action，需手动入栈
      useDebugStore.getState().pushHistory(true);
    }
  }, [t.confirmPruneNode]);

  // 节点拖动结束：将拖动产生的新位置入栈（默认 500ms 合并窗口）
  const handleNodeDragStop = useCallback(() => {
    pushHistory();
  }, [pushHistory]);

  // 同步快捷键回调到 ref（每次渲染更新，确保回调内读到最新值）
  // 撤销/重做（Ctrl+Z/Y/Shift+Z）由 DebugFlowEditor 统一监听，调用 store.undo()/redo()
  useEffect(() => {
    handleDeleteRef.current = handleDelete;
    fitViewRef.current = () => fitView({ padding: 0.2 });
  });

  // 键盘快捷键（ref 模式：useEffect 依赖空数组，只绑一次监听器，回调内读 ref.current）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      const isCtrl = e.ctrlKey || e.metaKey;
      // Ctrl 组合键交给 DebugFlowEditor 处理（撤销/重做），此处跳过避免重复触发
      if (isCtrl) return;

      // Esc 关闭右键菜单（T024，不检查 contextMenu 避免闭包旧值问题）
      if (e.key === 'Escape') {
        setContextMenu(null);
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        handleDeleteRef.current();
        return;
      }

      if ((e.key === 'f' || e.key === 'F') && !e.repeat) {
        e.preventDefault();
        fitViewRef.current();
        return;
      }

      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        setSpacePressed(true);
        return;
      }

      if (e.key === 'v' || e.key === 'V') {
        setInteractionMode('select');
        return;
      }

      if (e.key === 'h' || e.key === 'H') {
        setInteractionMode('hand');
        return;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        setSpacePressed(false);
      }
    };

    const handleBlur = () => setSpacePressed(false);

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, []); // 空依赖：只绑一次监听器

  // 自定义滚轮（Figma 式）：默认滚轮平移画布，Ctrl/Cmd+滚轮以鼠标为中心缩放
  // 用 requestAnimationFrame 合并连续 wheel 事件，平滑应用
  useEffect(() => {
    const el = reactFlowWrapper.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const isZoom = e.ctrlKey || e.metaKey;

      // 累积增量到 pendingWheelRef（合并同一帧内的多次 wheel 事件）
      if (pendingWheelRef.current) {
        pendingWheelRef.current.deltaX += e.deltaX;
        pendingWheelRef.current.deltaY += e.deltaY;
        pendingWheelRef.current.isZoom = pendingWheelRef.current.isZoom || isZoom;
      } else {
        pendingWheelRef.current = {
          deltaX: e.deltaX,
          deltaY: e.deltaY,
          clientX: e.clientX,
          clientY: e.clientY,
          isZoom,
        };
      }

      // 用 requestAnimationFrame 平滑应用
      if (wheelRafRef.current !== null) return;
      wheelRafRef.current = requestAnimationFrame(() => {
        wheelRafRef.current = null;
        const pending = pendingWheelRef.current;
        pendingWheelRef.current = null;
        if (!pending) return;

        const vp = getViewport();
        if (pending.isZoom) {
          // 缩放模式：以鼠标位置为中心缩放
          const zoomFactor = pending.deltaY > 0 ? 0.9 : 1.1;
          const newZoom = Math.min(4, Math.max(0.1, vp.zoom * zoomFactor));
          const rect = el.getBoundingClientRect();
          const centerX = pending.clientX - rect.left;
          const centerY = pending.clientY - rect.top;
          const newX = centerX - (centerX - vp.x) * (newZoom / vp.zoom);
          const newY = centerY - (centerY - vp.y) * (newZoom / vp.zoom);
          rfSetViewport({ x: newX, y: newY, zoom: newZoom });
        } else {
          // 平移模式：滚轮上下/左右平移画布
          rfSetViewport({
            x: vp.x - pending.deltaX,
            y: vp.y - pending.deltaY,
            zoom: vp.zoom,
          });
        }
      });
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', handleWheel);
      if (wheelRafRef.current !== null) {
        cancelAnimationFrame(wheelRafRef.current);
        wheelRafRef.current = null;
      }
    };
  }, [getViewport, rfSetViewport]);

  const handleFitView = useCallback(() => {
    fitView({ padding: 0.2 });
  }, [fitView]);

  const selectedNodes = useMemo(() => nodes.filter((n) => n.selected), [nodes]);
  const canMerge = selectedNodes.length >= 2;

  const handleMerge = useCallback(async () => {
    const state = useDebugStore.getState();
    const picked = state.nodes.filter((n) => n.selected);
    if (picked.length < 2) return;
    const ids = picked.map((n) => n.id);

    const intent = window.prompt(tf('mergePrompt', { n: ids.length }), t.mergeDefaultIntent);
    if (!intent || !intent.trim()) return;

    if (!isConfigured()) {
      alert(t.pleaseConfigureApiKey);
      return;
    }

    const newId = createMergedNode(ids, intent.trim());
    setSelectedNode(newId);
    updateTurnNode(newId, { status: 'running' });
    const currentNodes = useDebugStore.getState().nodes;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    // 注册到 store 供 ExecutionStatusBar 取消
    registerAbortController(newId, controller);
    const result = await streamTurnResponse(
      newId,
      currentNodes,
      (delta) => appendAssistantChunk(newId, delta),
      controller.signal,
      (summary) => updateTurnNode(newId, { summary }),
      undefined,
      // 旁路回调：合并节点回答完成后生成多路聚合路径摘要
      (pathSummary) => updateTurnNode(newId, { pathSummary }),
    );
    if (result.success) {
      updateTurnNode(newId, {
        status: 'success',
        suggestions: result.suggestions ?? [],
      });
    } else {
      updateTurnNode(newId, { status: 'error', errorMessage: result.error });
    }
  }, [
    createMergedNode,
    setSelectedNode,
    updateTurnNode,
    appendAssistantChunk,
    registerAbortController,
    tf,
    t,
  ]);

  /**
   * 执行 cherry-pick（T031）：以源节点的 assistantMessage 为参考，在目标节点下创建
   * 子节点并调 LLM 流式生成。不纯复制回答，而是以"参考以下回答"作为 userMessage，
   * 在目标分支的上下文下重新生成，语义对齐 git cherry-pick 的"应用到另一分支"。
   * 流式调用接入 AbortController，发起新请求前取消旧请求（项目约定）。
   */
  const handleCherryPick = useCallback(
    async (targetNodeId: string) => {
      if (!cherryPickSource) return;
      if (!isConfigured()) {
        alert(t.pleaseConfigureApiKey);
        setCherryPickSource(null);
        return;
      }
      const sourceNode = nodes.find((n) => n.id === cherryPickSource);
      const targetNode = nodes.find((n) => n.id === targetNodeId);
      if (!sourceNode || !targetNode) {
        setCherryPickSource(null);
        return;
      }

      // 构造 cherry-pick 的 userMessage：以源节点回答为参考上下文
      const sourceAnswer = sourceNode.data.assistantMessage;
      const cherryPickMessage = `${t.cherryPickConfirm}\n\n${sourceAnswer}`;

      // 在目标节点下创建子节点
      const newNodeId = createTurnNode(cherryPickMessage, targetNodeId);

      // 选中新节点 + 清除 cherry-pick 状态
      setSelectedNode(newNodeId);
      setCherryPickSource(null);

      // 标记 running 并发起流式请求（复用 handleMerge 的 AbortController 模式）
      updateTurnNode(newNodeId, { status: 'running' });
      const currentNodes = useDebugStore.getState().nodes;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      // 注册到 store 供 ExecutionStatusBar 取消
      registerAbortController(newNodeId, controller);

      toast(t.cherryPickStarted);

      const result = await streamTurnResponse(
        newNodeId,
        currentNodes,
        (delta) => appendAssistantChunk(newNodeId, delta),
        controller.signal,
        (summary) => updateTurnNode(newNodeId, { summary }),
        undefined,
        // 旁路回调：cherry-pick 回答完成后生成路径摘要
        (pathSummary) => updateTurnNode(newNodeId, { pathSummary }),
      );
      if (result.success) {
        updateTurnNode(newNodeId, {
          status: 'success',
          suggestions: result.suggestions ?? [],
        });
      } else {
        updateTurnNode(newNodeId, { status: 'error', errorMessage: result.error });
      }
    },
    [
      cherryPickSource,
      nodes,
      createTurnNode,
      setSelectedNode,
      updateTurnNode,
      appendAssistantChunk,
      registerAbortController,
      t,
    ],
  );

  const { displayNodes, displayEdges } = useMemo(() => {
    if (!focusMode || !selectedNodeId) {
      return { displayNodes: nodes, displayEdges: edges };
    }
    const visibleIds = collectVisibleNodeIds(selectedNodeId, nodes);
    if (!visibleIds) {
      return { displayNodes: nodes, displayEdges: edges };
    }
    const displayNodes = nodes.filter((n) => visibleIds.has(n.id) || n.data.status !== 'abandoned');
    const displayedNodeIds = new Set(displayNodes.map((n) => n.id));
    const displayEdges = edges.filter(
      (e) => displayedNodeIds.has(e.source) && displayedNodeIds.has(e.target),
    );
    return { displayNodes, displayEdges };
  }, [nodes, edges, selectedNodeId, focusMode]);

  const showFocusHint = nodes.length > 20 && !focusMode;

  const isEmpty = nodes.length === 0;
  const hasProject = !!currentProjectId;

  return (
    <div
      className="flex-1 h-full flex flex-col bg-slate-50 dark:bg-slate-900"
      role="main"
      aria-label={t.projectName}
    >
      <div className="h-12 px-4 bg-white border-b border-slate-200 dark:bg-slate-900 dark:border-slate-700 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {editingName ? (
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitName();
                if (e.key === 'Escape') setEditingName(false);
              }}
              className="px-2 py-1 text-sm border border-sky-300 rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-400 w-48 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
              placeholder={t.projectName}
              aria-label={t.projectName}
            />
          ) : (
            <button
              onClick={startEditName}
              disabled={!hasProject}
              className="px-2 py-1 text-sm font-medium text-slate-700 hover:text-sky-600 hover:bg-sky-50 rounded transition-colors max-w-[200px] truncate disabled:opacity-50 disabled:cursor-not-allowed dark:text-slate-200 dark:hover:text-sky-400 dark:hover:bg-sky-900/30"
              title={hasProject ? t.clickToEditProjectName : t.noProjectSelected}
            >
              {currentProject?.name ?? t.noProjectSelected}
            </button>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={toggleFocusMode}
            disabled={isEmpty}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              focusMode
                ? 'text-sky-600 bg-sky-50 hover:bg-sky-100 dark:text-sky-400 dark:bg-sky-900/30 dark:hover:bg-sky-900/50'
                : 'text-slate-600 hover:text-sky-600 hover:bg-sky-50 dark:text-slate-300 dark:hover:text-sky-400 dark:hover:bg-sky-900/30'
            }`}
            title={focusMode ? t.focusModeOnHint : t.focusModeOffHint}
            aria-pressed={focusMode}
          >
            {focusMode ? t.showAll : t.focusCurrent}
          </button>
        </div>
      </div>

      <div ref={reactFlowWrapper} className="flex-1 relative">
        <ReactFlow
          nodes={displayNodes}
          edges={displayEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          onNodeContextMenu={onNodeContextMenu}
          onNodeDragStop={handleNodeDragStop}
          onMove={onMove}
          nodeTypes={nodeTypes}
          fitView
          defaultEdgeOptions={defaultEdgeOptions}
          deleteKeyCode={null}
          zoomOnScroll={false}
          panOnScroll={false}
          selectionOnDrag={!isHandMode}
          panOnDrag={isHandMode}
          multiSelectionKeyCode={['Shift']}
          minZoom={0.1}
          maxZoom={4}
          className={isHandMode ? 'cursor-grab active:cursor-grabbing' : ''}
        >
          <Background color="#e2e8f0" gap={20} />

          <MiniMap
            pannable
            zoomable
            ariaLabel={t.minimapLabel}
            nodeColor={(n) => {
              const data = n.data as TurnNodeData | undefined;
              if (!data?.status) return '#ffffff';
              return getStatusColor(data.status);
            }}
            nodeStrokeColor="#94a3b8"
            className="!bg-white !border-slate-200 dark:!bg-slate-800 dark:!border-slate-700"
          />
        </ReactFlow>

        {/* 视图模式切换（T027）：蛛网 ↔ git，左上角浮动 toggle */}
        <div className="absolute top-4 left-4 z-10 flex items-center gap-0.5 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm p-0.5">
          <button
            onClick={() => setViewMode('web')}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              viewMode === 'web'
                ? 'bg-blue-500 text-white'
                : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700'
            }`}
            title={t.webMode}
          >
            <Network size={14} className="inline mr-1" />
            {t.webMode}
          </button>
          <button
            onClick={() => setViewMode('git')}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              viewMode === 'git'
                ? 'bg-blue-500 text-white'
                : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700'
            }`}
            title={t.gitMode}
          >
            <GitBranch size={14} className="inline mr-1" />
            {t.gitMode}
          </button>
        </div>

        {/* cherry-pick 模式提示（T031）：已选源节点后浮动提示，点 × 取消 */}
        {cherryPickSource && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-3 py-1.5 bg-green-500 text-white text-xs rounded-lg shadow-lg">
            <Copy size={12} />
            <span>{t.cherryPickSourceSelected}</span>
            <button
              onClick={() => setCherryPickSource(null)}
              className="ml-2 hover:bg-green-600 rounded p-0.5"
              aria-label={t.cancelSelection}
            >
              <X size={12} />
            </button>
          </div>
        )}

        {showFocusHint && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 px-4 py-2 bg-slate-900/80 text-white text-sm rounded-full shadow-lg backdrop-blur-sm">
            <span>{tf('focusHint', { n: nodes.length })}</span>
            <button
              onClick={toggleFocusMode}
              className="px-2 py-0.5 bg-sky-500 hover:bg-sky-600 rounded text-xs font-medium transition-colors"
            >
              {t.enable}
            </button>
          </div>
        )}

        {canMerge && (
          <button
            onClick={handleMerge}
            className={`absolute left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-4 py-2 bg-violet-600 text-white text-sm rounded-full shadow-lg hover:bg-violet-700 transition-colors ${
              showFocusHint ? 'top-20' : 'top-4'
            }`}
            title={tf('mergeBranchesTitle', { n: selectedNodes.length })}
            aria-label={tf('mergeBranchesTitle', { n: selectedNodes.length })}
          >
            <GitMerge size={14} />
            {tf('mergeBranches', { n: selectedNodes.length })}
          </button>
        )}

        {isEmpty && (
          <div
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
            role="status"
            aria-live="polite"
          >
            <div className="text-center">
              <div className="text-slate-400 text-base">{t.inputPlaceholder}</div>
            </div>
          </div>
        )}

        <div className="absolute bottom-4 left-4 z-10 flex flex-col gap-1 bg-white border border-slate-200 dark:bg-slate-800 dark:border-slate-700 rounded-lg shadow-sm overflow-hidden">
          <div className="flex border-b border-slate-100 dark:border-slate-700">
            <button
              onClick={() => setInteractionMode('select')}
              className={`flex flex-col items-center justify-center w-10 h-10 transition-colors ${
                interactionMode === 'select' && !spacePressed
                  ? 'bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400'
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200'
              }`}
              title={t.selectTool}
              aria-label={t.selectTool}
            >
              <MousePointer2 size={15} />
              <span className="text-[9px] mt-0.5">V</span>
            </button>
            <button
              onClick={() => setInteractionMode('hand')}
              className={`flex flex-col items-center justify-center w-10 h-10 border-l border-slate-100 dark:border-slate-700 transition-colors ${
                interactionMode === 'hand' || spacePressed
                  ? 'bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400'
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200'
              }`}
              title={t.handTool}
              aria-label={t.handTool}
            >
              <Hand size={15} />
              <span className="text-[9px] mt-0.5">H</span>
            </button>
          </div>
          <div className="flex flex-col">
            <button
              onClick={() => zoomIn()}
              className="flex items-center justify-center w-10 h-8 text-slate-500 hover:bg-slate-50 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200 transition-colors border-b border-slate-100 dark:border-slate-700"
              title={t.zoomIn}
              aria-label={t.zoomIn}
            >
              <ZoomIn size={15} />
            </button>
            <button
              onClick={() => zoomOut()}
              className="flex items-center justify-center w-10 h-8 text-slate-500 hover:bg-slate-50 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200 transition-colors border-b border-slate-100 dark:border-slate-700"
              title={t.zoomOut}
              aria-label={t.zoomOut}
            >
              <ZoomOut size={15} />
            </button>
            <button
              onClick={handleFitView}
              className="flex items-center justify-center w-10 h-8 text-slate-500 hover:bg-slate-50 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200 transition-colors"
              title={t.fitView}
              aria-label={t.fitView}
            >
              <Maximize2 size={15} />
            </button>
          </div>
          <NodeDisplayModeToggle />
        </div>

        {/* 浮动工具条（T024）：至少 1 个节点选中时显示在画布底部居中 */}
        {(appSettings.nodeActionsStyle === 'toolbar' || appSettings.nodeActionsStyle === 'both') &&
          selectedNodes.length >= 1 && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 px-3 py-2 bg-white border border-slate-200 dark:bg-slate-800 dark:border-slate-700 rounded-lg shadow-lg max-w-[90%] overflow-x-auto">
              <span className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap mr-1">
                {tf('batchSelectedCount', { n: selectedNodes.length })}
              </span>
              {selectedNodes.some((n) => n.data.status !== 'abandoned') && (
                <button
                  onClick={() => selectedNodes.forEach((n) => abandonBranch(n.id))}
                  className="flex items-center gap-1 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700 rounded transition-colors whitespace-nowrap"
                >
                  <Ban size={12} />
                  {t.abandonBranch}
                </button>
              )}
              {selectedNodes.some((n) => n.data.status === 'abandoned') && (
                <button
                  onClick={() => selectedNodes.forEach((n) => reactivateBranch(n.id))}
                  className="flex items-center gap-1 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700 rounded transition-colors whitespace-nowrap"
                >
                  <RotateCcw size={12} />
                  {t.restoreBranch}
                </button>
              )}
              {selectedNodes.some((n) => n.data.status !== 'ignored') && (
                <button
                  onClick={() => selectedNodes.forEach((n) => ignoreNode(n.id))}
                  className="flex items-center gap-1 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700 rounded transition-colors whitespace-nowrap"
                >
                  <EyeOff size={12} />
                  {t.ignoreNode}
                </button>
              )}
              {selectedNodes.some((n) => n.data.status === 'ignored') && (
                <button
                  onClick={() => selectedNodes.forEach((n) => unignoreNode(n.id))}
                  className="flex items-center gap-1 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700 rounded transition-colors whitespace-nowrap"
                >
                  <Eye size={12} />
                  {t.unignore}
                </button>
              )}
              {selectedNodes.length === 1 && (
                <button
                  onClick={() => {
                    const node = selectedNodes[0];
                    const tag = window.prompt(t.addTag + ':', '');
                    if (tag && tag.trim()) {
                      addNodeTag(node.id, tag.trim());
                    }
                  }}
                  className="flex items-center gap-1 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700 rounded transition-colors whitespace-nowrap"
                >
                  <Tag size={12} />
                  {t.addTag}
                </button>
              )}
              {/* diff 对比（T029）：选中 2 个节点时浮动工具条显示"对比"按钮 */}
              {selectedNodes.length === 2 && (
                <button
                  onClick={() => {
                    setDiffNodeAId(selectedNodes[0].id);
                    setDiffNodeBId(selectedNodes[1].id);
                    setShowDiff(true);
                  }}
                  className="flex items-center gap-1 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700 rounded transition-colors whitespace-nowrap"
                >
                  <GitCompare size={12} />
                  {t.compareNodes}
                </button>
              )}
              <button
                onClick={handleDelete}
                className="flex items-center gap-1 px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30 rounded transition-colors whitespace-nowrap"
              >
                <Trash2 size={12} />
                {t.delete}
              </button>
              <button
                onClick={() => {
                  useDebugStore.setState((s) => ({
                    nodes: s.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)),
                  }));
                }}
                className="flex items-center gap-1 px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700 rounded transition-colors whitespace-nowrap"
                aria-label={t.cancelSelection}
              >
                <X size={12} />
                {t.cancelSelection}
              </button>
            </div>
          )}

        {/* 右键菜单（T024）：右键节点时在鼠标位置显示 */}
        {(appSettings.nodeActionsStyle === 'context' || appSettings.nodeActionsStyle === 'both') &&
          contextMenu && (
            <div
              className="fixed z-50 min-w-[160px] py-1 bg-white border border-slate-200 dark:bg-slate-800 dark:border-slate-700 rounded-lg shadow-lg"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              role="menu"
            >
              {(() => {
                const node = nodes.find((n) => n.id === contextMenu.nodeId);
                if (!node) return null;
                const isAbandoned = node.data.status === 'abandoned';
                const isIgnored = node.data.status === 'ignored';
                return (
                  <>
                    <button
                      onClick={() => {
                        if (isAbandoned) reactivateBranch(node.id);
                        else abandonBranch(node.id);
                        setContextMenu(null);
                      }}
                      className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700 transition-colors text-left"
                      role="menuitem"
                    >
                      {isAbandoned ? <RotateCcw size={12} /> : <Ban size={12} />}
                      {isAbandoned ? t.contextMenuReactivate : t.contextMenuAbandon}
                    </button>
                    <button
                      onClick={() => {
                        if (isIgnored) unignoreNode(node.id);
                        else ignoreNode(node.id);
                        setContextMenu(null);
                      }}
                      className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700 transition-colors text-left"
                      role="menuitem"
                    >
                      {isIgnored ? <Eye size={12} /> : <EyeOff size={12} />}
                      {isIgnored ? t.contextMenuUnignore : t.contextMenuIgnore}
                    </button>
                    <button
                      onClick={() => {
                        const tag = window.prompt(t.addTag + ':', '');
                        if (tag && tag.trim()) {
                          addNodeTag(node.id, tag.trim());
                        }
                        setContextMenu(null);
                      }}
                      className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700 transition-colors text-left"
                      role="menuitem"
                    >
                      <Tag size={12} />
                      {t.addTag}
                    </button>
                    <button
                      onClick={() => {
                        const name = window.prompt(
                          t.setBranchName + ':',
                          node.data.branchName ?? '',
                        );
                        if (name !== null) {
                          setNodeBranchName(node.id, name.trim());
                        }
                        setContextMenu(null);
                      }}
                      className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700 transition-colors text-left"
                      role="menuitem"
                    >
                      <GitBranch size={12} />
                      {t.setBranchName}
                    </button>
                    {/* cherry-pick（T031）：移植此回答到其他分支。仅已有 AI 回答的节点可作为源 */}
                    {node.data.assistantMessage.trim() !== '' && (
                      <button
                        onClick={() => {
                          setCherryPickSource(node.id);
                          setContextMenu(null);
                          toast(t.cherryPickSourceSelected);
                        }}
                        className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700 transition-colors text-left"
                        role="menuitem"
                      >
                        <Copy size={12} />
                        {t.cherryPick}
                      </button>
                    )}
                    {/* cherry-pick 目标（T031）：已选源节点后，右键另一节点显示"移植到此处" */}
                    {cherryPickSource && cherryPickSource !== node.id && (
                      <button
                        onClick={() => {
                          handleCherryPick(node.id);
                          setContextMenu(null);
                        }}
                        className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-green-600 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-900/30 transition-colors text-left"
                        role="menuitem"
                      >
                        <CornerDownRight size={12} />
                        {t.cherryPickTarget}
                      </button>
                    )}
                    {/* diff 对比（T029）：右键节点设为对比 A，再右键另一节点进行对比 */}
                    <button
                      onClick={() => {
                        if (diffNodeAId === null) {
                          setDiffNodeAId(node.id);
                          toast(t.diffNodeASet);
                        } else if (diffNodeAId !== node.id) {
                          setDiffNodeBId(node.id);
                          setShowDiff(true);
                        }
                        setContextMenu(null);
                      }}
                      className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700 transition-colors text-left"
                      role="menuitem"
                    >
                      <GitCompare size={12} />
                      {diffNodeAId === null ? t.diffSetNodeA : t.diffCompareWith}
                    </button>
                    <div className="my-1 border-t border-slate-100 dark:border-slate-700" />
                    <button
                      onClick={() => {
                        if (confirm(t.confirmPruneNode)) {
                          deleteNode(node.id);
                          setSelectedNode(null);
                        }
                        setContextMenu(null);
                      }}
                      className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30 transition-colors text-left"
                      role="menuitem"
                    >
                      <Trash2 size={12} />
                      {t.contextMenuDelete}
                    </button>
                  </>
                );
              })()}
            </div>
          )}
      </div>

      {/* diff 视图抽屉（T029）：懒加载，用户点击"对比"后渲染 */}
      {showDiff && (
        <Suspense fallback={null}>
          <DiffViewer
            nodeAId={diffNodeAId}
            nodeBId={diffNodeBId}
            onClose={() => {
              setShowDiff(false);
              setDiffNodeAId(null);
              setDiffNodeBId(null);
            }}
          />
        </Suspense>
      )}
    </div>
  );
}

function NodeDisplayModeToggle() {
  const { t } = useTranslation();
  const nodeDisplayMode = useDebugStore((s) => s.nodeDisplayMode);
  const toggleNodeDisplayMode = useDebugStore((s) => s.toggleNodeDisplayMode);
  const isCompact = nodeDisplayMode === 'compact';
  return (
    <button
      onClick={toggleNodeDisplayMode}
      className={`flex items-center justify-center w-10 h-9 border-t border-slate-100 dark:border-slate-700 transition-colors ${
        isCompact
          ? 'bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400'
          : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200'
      }`}
      title={isCompact ? t.detailedMode : t.compactMode}
      aria-label={isCompact ? t.detailedMode : t.compactMode}
    >
      {isCompact ? <Rows3 size={15} /> : <AlignJustify size={15} />}
    </button>
  );
}
