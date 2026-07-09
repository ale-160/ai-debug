'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  MiniMap,
  useReactFlow,
  type Node,
  type Edge,
  type Viewport,
} from 'reactflow';
import 'reactflow/dist/style.css';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  GitMerge,
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
} from 'lucide-react';
import { nodeTypes } from './nodes';
import { getStatusColor } from './nodes/node-utils';
import type { TurnNodeData } from './types';
import { useDebugStore } from '@/lib/debug-store';
import { streamTurnResponse } from '@/lib/network-engine';
import { isConfigured } from '@/lib/llm-config';
import { updateProject } from '@/lib/project-storage';
import { useTranslation } from '@/components/I18nProvider';

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
  const updateTurnNode = useDebugStore((s) => s.updateTurnNode);
  const appendAssistantChunk = useDebugStore((s) => s.appendAssistantChunk);
  const selectedNodeId = useDebugStore((s) => s.selectedNodeId);
  const focusMode = useDebugStore((s) => s.focusMode);
  const toggleFocusMode = useDebugStore((s) => s.toggleFocusMode);

  // 批量操作 actions（T024 浮动工具条 + 右键菜单）
  const abandonBranch = useDebugStore((s) => s.abandonBranch);
  const reactivateBranch = useDebugStore((s) => s.reactivateBranch);
  const ignoreNode = useDebugStore((s) => s.ignoreNode);
  const unignoreNode = useDebugStore((s) => s.unignoreNode);
  const deleteNode = useDebugStore((s) => s.deleteNode);
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

  // 撤销/重做历史栈（50 步上限，存 nodes/edges 快照）
  const historyRef = useRef<{ nodes: Node<TurnNodeData>[]; edges: Edge[] }[]>([]);
  const redoStackRef = useRef<{ nodes: Node<TurnNodeData>[]; edges: Edge[] }[]>([]);
  const isUndoRedoRef = useRef(false);
  const prevSnapshotRef = useRef<{ nodes: Node<TurnNodeData>[]; edges: Edge[] } | null>(null);
  const lastProjectIdRef = useRef<string | null>(null);
  const lastPushTimeRef = useRef(0);

  // 快捷键回调 refs（避免 useEffect 频繁重绑 keydown 监听器）
  const undoRef = useRef<() => void>(() => {});
  const redoRef = useRef<() => void>(() => {});
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

  // 撤销/重做：在 nodes/edges 变化时自动把上一快照推入历史栈
  // 合并 500ms 内的快速变更（如流式输出），避免历史栈被中间状态填满
  useEffect(() => {
    // 项目切换：重置历史栈并记录初始快照
    if (lastProjectIdRef.current !== currentProjectId) {
      lastProjectIdRef.current = currentProjectId;
      historyRef.current = [];
      redoStackRef.current = [];
      prevSnapshotRef.current = currentProjectId ? { nodes, edges } : null;
      isUndoRedoRef.current = false;
      lastPushTimeRef.current = 0;
      return;
    }

    // 草稿态（currentProjectId 为空）不入栈，避免无意义入栈
    if (!currentProjectId) {
      prevSnapshotRef.current = null;
      return;
    }

    // 撤销/重做触发的变更：仅更新快照引用，不入栈
    if (isUndoRedoRef.current) {
      prevSnapshotRef.current = { nodes, edges };
      isUndoRedoRef.current = false;
      return;
    }

    if (!prevSnapshotRef.current) {
      prevSnapshotRef.current = { nodes, edges };
      return;
    }

    // 合并 500ms 内的快速变更（如流式输出），避免历史栈被中间状态填满
    const now = Date.now();
    if (now - lastPushTimeRef.current < 500) {
      return;
    }

    historyRef.current.push({
      nodes: prevSnapshotRef.current.nodes.map((n) => ({ ...n, data: { ...n.data } })),
      edges: prevSnapshotRef.current.edges.map((e) => ({ ...e })),
    });
    if (historyRef.current.length > 50) {
      historyRef.current.shift();
    }
    redoStackRef.current = [];
    lastPushTimeRef.current = now;
    prevSnapshotRef.current = { nodes, edges };
  }, [nodes, edges, currentProjectId]);

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
    }
  }, [t.confirmPruneNode]);

  // 撤销：弹出历史栈顶快照并恢复，当前状态推入重做栈
  const handleUndo = useCallback(() => {
    if (historyRef.current.length === 0) return;
    const state = useDebugStore.getState();
    // 当前状态推入重做栈（深拷贝避免引用共享）
    const currentSnapshot = {
      nodes: state.nodes.map((n) => ({ ...n, data: { ...n.data } })),
      edges: state.edges.map((e) => ({ ...e })),
    };
    redoStackRef.current.push(currentSnapshot);

    // 弹出历史快照并恢复到 store
    const prev = historyRef.current.pop()!;
    isUndoRedoRef.current = true;
    useDebugStore.setState({
      nodes: prev.nodes.map((n) => ({ ...n, data: { ...n.data } })),
      edges: prev.edges.map((e) => ({ ...e })),
      isDirty: true,
    });
  }, []);

  // 重做：弹出重做栈顶快照并恢复，当前状态推入历史栈
  const handleRedo = useCallback(() => {
    if (redoStackRef.current.length === 0) return;
    const state = useDebugStore.getState();
    // 当前状态推入历史栈（深拷贝避免引用共享）
    const currentSnapshot = {
      nodes: state.nodes.map((n) => ({ ...n, data: { ...n.data } })),
      edges: state.edges.map((e) => ({ ...e })),
    };
    historyRef.current.push(currentSnapshot);

    // 弹出重做快照并恢复到 store
    const next = redoStackRef.current.pop()!;
    isUndoRedoRef.current = true;
    useDebugStore.setState({
      nodes: next.nodes.map((n) => ({ ...n, data: { ...n.data } })),
      edges: next.edges.map((e) => ({ ...e })),
      isDirty: true,
    });
  }, []);

  // 同步快捷键回调到 ref（每次渲染更新，确保回调内读到最新值）
  useEffect(() => {
    undoRef.current = handleUndo;
    redoRef.current = handleRedo;
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
      const isShift = e.shiftKey;

      // Esc 关闭右键菜单（T024，不检查 contextMenu 避免闭包旧值问题）
      if (e.key === 'Escape') {
        setContextMenu(null);
      }

      // Ctrl+Z 撤销
      if (isCtrl && !isShift && (e.key === 'z' || e.key === 'Z') && !e.repeat) {
        e.preventDefault();
        undoRef.current();
        return;
      }

      // Ctrl+Y 或 Ctrl+Shift+Z 重做
      if (
        (isCtrl && (e.key === 'y' || e.key === 'Y')) ||
        (isCtrl && isShift && (e.key === 'z' || e.key === 'Z'))
      ) {
        if (!e.repeat) {
          e.preventDefault();
          redoRef.current();
        }
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        handleDeleteRef.current();
        return;
      }

      if ((e.key === 'f' || e.key === 'F') && !isCtrl && !e.repeat) {
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
        {(appSettings.nodeActionsStyle === 'toolbar' ||
          appSettings.nodeActionsStyle === 'both') &&
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
        {(appSettings.nodeActionsStyle === 'context' ||
          appSettings.nodeActionsStyle === 'both') &&
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
