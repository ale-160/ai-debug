'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  MousePointer2,
  Hand,
  AlignJustify,
  Rows3,
} from 'lucide-react';
import { nodeTypes } from './nodes';
import type { TurnNodeData, TurnStatus } from './types';
import { useDebugStore } from '@/lib/debug-store';
import { streamTurnResponse } from '@/lib/network-engine';
import { isConfigured } from '@/lib/llm-config';
import { updateProject } from '@/lib/project-storage';

// 默认边样式：smoothstep + 灰色
const defaultEdgeOptions = {
  type: 'smoothstep',
  animated: false,
  style: { stroke: '#94a3b8', strokeWidth: 2 },
};

// MiniMap 节点颜色：按 TurnStatus 映射
const statusColorMap: Record<TurnStatus, string> = {
  running: '#3b82f6',
  success: '#10b981',
  error: '#ef4444',
  abandoned: '#94a3b8',
  ignored: '#f59e0b',
  idle: '#ffffff',
};

/**
 * 收集选中节点的完整路径（根 → 当前）+ 路径上所有节点的全部子树节点 id。
 * 用于聚焦模式下决定哪些节点需要显示。
 * - 先沿 parentId 向上回溯，得到根 → 当前路径上的全部节点 id
 * - 再沿父子关系向下 BFS，把路径上每个节点的所有子树节点也纳入可见集合
 * 返回 null 表示无选中节点，调用方应显示全部节点。
 */
function collectVisibleNodeIds(
  selectedNodeId: string | null,
  nodes: Node<TurnNodeData>[],
): Set<string> | null {
  if (!selectedNodeId) return null;
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  // 1. 向上回溯收集 根 → 当前 的路径
  const pathIds = new Set<string>();
  let currentId: string | null = selectedNodeId;
  while (currentId) {
    if (pathIds.has(currentId)) break; // 防御异常环引用导致死循环
    pathIds.add(currentId);
    const node = nodeMap.get(currentId);
    currentId = node?.data.parentId ?? null;
  }
  // 2. 构建 父 → 子 映射
  const childrenMap = new Map<string, string[]>();
  for (const n of nodes) {
    if (n.data.parentId) {
      const list = childrenMap.get(n.data.parentId) ?? [];
      list.push(n.id);
      childrenMap.set(n.data.parentId, list);
    }
  }
  // 3. 向下 BFS 收集路径上每个节点的全部子树
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
  // 画布数据
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

  // 项目数据
  const currentProjectId = useDebugStore((s) => s.currentProjectId);
  const projects = useDebugStore((s) => s.projects);
  const saveProject = useDebugStore((s) => s.saveProject);
  const refreshProjects = useDebugStore((s) => s.refreshProjects);
  const currentProject = projects.find((p) => p.id === currentProjectId);

  // React Flow 实例方法
  const { zoomIn, zoomOut, fitView, setViewport: rfSetViewport } = useReactFlow();

  // 当前流式请求的 AbortController：用于在发起新请求前取消旧请求
  const abortRef = useRef<AbortController | null>(null);

  // ========== 项目名编辑（受控 input + 本地 state，blur 保存） ==========
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
    // store 未提供 rename 方法，直接调用 project-storage 更新，再刷新列表
    updateProject(id, { name: trimmed });
    refreshProjects();
  }, [nameDraft, refreshProjects]);

  // ========== 节点交互 ==========
  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      setSelectedNode(node.id);
    },
    [setSelectedNode],
  );

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
  }, [setSelectedNode]);

  const onMove = useCallback(
    (_: unknown, vp: Viewport) => {
      setViewport(vp);
    },
    [setViewport],
  );

  // ========== 交互模式：select（选择/框选） / hand（抓手平移） ==========
  const [interactionMode, setInteractionMode] = useState<'select' | 'hand'>('select');
  // 空格键是否按住（临时切换抓手）
  const [spacePressed, setSpacePressed] = useState(false);
  // 当前是否真的处于抓手模式（用户选的模式 or 空格键临时）
  const isHandMode = interactionMode === 'hand' || spacePressed;

  // viewport 单独订阅（用于自动保存，避免与 nodes/edges 防抖混在一起）
  const viewport = useDebugStore((s) => s.viewport);

  // ========== 自动保存（防抖 500ms） ==========
  // 监听 nodes/edges 变化，若有改动且已绑定项目则自动保存。
  // 草稿态（currentProjectId 为空）不保存，等首条消息提交后绑定项目再启用。
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isInitialLoadRef = useRef(true);

  useEffect(() => {
    if (!currentProjectId) return;
    // 跳过项目切换后的首次加载（loadProject 已设 isDirty=false）
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

  // viewport 单独防抖保存（拖动/缩放时避免频繁写入）
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

  // ========== 项目切换时恢复视口 ==========
  useEffect(() => {
    isInitialLoadRef.current = true; // 切换项目后跳过首次自动保存
    const vp = useDebugStore.getState().viewport;
    if (vp) {
      rfSetViewport(vp);
    } else if (useDebugStore.getState().nodes.length > 0) {
      setTimeout(() => fitView({ padding: 0.2 }), 50);
    }
    // 仅在 currentProjectId 变化时触发，避免 onMove 引发的 viewport 更新造成循环
  }, [currentProjectId, rfSetViewport, fitView]);

  // ========== 键盘快捷键 ==========
  // Delete/Backspace 删除选中节点（连带下游子树）和边
  const handleDelete = useCallback(() => {
    const state = useDebugStore.getState();
    const selectedNodes = state.nodes.filter((n) => n.selected);
    const selectedEdges = state.edges.filter((e) => e.selected);
    if (selectedNodes.length === 0 && selectedEdges.length === 0) return;

    if (selectedNodes.length > 0) {
      const ok = confirm('确定删除此节点及其所有下游节点？');
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
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      // 输入框 / textarea / contenteditable 内不触发画布快捷键
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      const isCtrl = e.ctrlKey || e.metaKey;

      // Delete/Backspace 删除
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        handleDelete();
        return;
      }

      // F 适应视图
      if ((e.key === 'f' || e.key === 'F') && !isCtrl && !e.repeat) {
        e.preventDefault();
        fitView({ padding: 0.2 });
        return;
      }

      // 空格按下 → 临时抓手
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        setSpacePressed(true);
        return;
      }

      // V 选择模式
      if (e.key === 'v' || e.key === 'V') {
        setInteractionMode('select');
        return;
      }

      // H 抓手模式
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

    // 窗口失焦时重置空格状态，避免松开事件丢失
    const handleBlur = () => setSpacePressed(false);

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [handleDelete, fitView]);

  // ========== 工具栏按钮 ==========
  const handleFitView = useCallback(() => {
    fitView({ padding: 0.2 });
  }, [fitView]);

  // ========== 多选合并 ==========
  // ReactFlow 的 selection 通过 node.selected 反映（Shift+点击多选）。
  const selectedNodes = useMemo(() => nodes.filter((n) => n.selected), [nodes]);
  const canMerge = selectedNodes.length >= 2;

  // 合并选中节点：弹窗确认 + 输入合并意图 -> 创建合并节点 -> 流式生成回答
  const handleMerge = useCallback(async () => {
    const state = useDebugStore.getState();
    const picked = state.nodes.filter((n) => n.selected);
    if (picked.length < 2) return;
    const ids = picked.map((n) => n.id);

    // 弹窗确认 + 输入合并意图（如"结合 A 和 B 的结论给出下一步"）
    const intent = window.prompt(
      `合并 ${ids.length} 个分支为新节点，请输入合并意图：`,
      '结合这些分支的结论给出下一步',
    );
    if (!intent || !intent.trim()) return;

    if (!isConfigured()) {
      alert('请先配置 API Key');
      return;
    }

    const newId = createMergedNode(ids, intent.trim());
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
    );
    if (result.success) {
      updateTurnNode(newId, {
        status: 'success',
        suggestions: result.suggestions ?? [],
      });
    } else {
      updateTurnNode(newId, { status: 'error', errorMessage: result.error });
    }
  }, [createMergedNode, setSelectedNode, updateTurnNode, appendAssistantChunk]);

  // ========== 聚焦模式：过滤显示节点 ==========
  // 聚焦模式开启且有选中节点时，仅显示选中节点路径 + 路径子树；
  // 其他路径上的 abandoned 节点隐藏，非 abandoned 节点仍显示。
  const { displayNodes, displayEdges } = useMemo(() => {
    if (!focusMode || !selectedNodeId) {
      return { displayNodes: nodes, displayEdges: edges };
    }
    const visibleIds = collectVisibleNodeIds(selectedNodeId, nodes);
    if (!visibleIds) {
      return { displayNodes: nodes, displayEdges: edges };
    }
    // 路径上的节点全部显示；不在路径上的节点仅在非 abandoned 时显示
    const displayNodes = nodes.filter(
      (n) => visibleIds.has(n.id) || n.data.status !== 'abandoned',
    );
    const displayedNodeIds = new Set(displayNodes.map((n) => n.id));
    // 过滤掉连接到隐藏节点的边，避免出现悬空边
    const displayEdges = edges.filter(
      (e) => displayedNodeIds.has(e.source) && displayedNodeIds.has(e.target),
    );
    return { displayNodes, displayEdges };
  }, [nodes, edges, selectedNodeId, focusMode]);

  // 节点较多且未开启聚焦时，显示提示条
  const showFocusHint = nodes.length > 20 && !focusMode;

  const isEmpty = nodes.length === 0;
  const hasProject = !!currentProjectId;

  return (
    <div className="flex-1 h-full flex flex-col bg-slate-50">
      {/* 顶部工具栏：仅保留项目名编辑 + 聚焦模式 + 缩放控件 */}
      <div className="h-12 px-4 bg-white border-b border-slate-200 flex items-center justify-between shrink-0">
        {/* 左：项目名编辑（点击进入编辑态，blur/Enter 保存） */}
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
              className="px-2 py-1 text-sm border border-sky-300 rounded focus:outline-none focus:ring-1 focus:ring-sky-400 w-48"
              placeholder="项目名"
            />
          ) : (
            <button
              onClick={startEditName}
              disabled={!hasProject}
              className="px-2 py-1 text-sm font-medium text-slate-700 hover:text-sky-600 hover:bg-sky-50 rounded transition-colors max-w-[200px] truncate disabled:opacity-50 disabled:cursor-not-allowed"
              title={hasProject ? '点击编辑项目名' : '未打开项目'}
            >
              {currentProject?.name ?? '未打开项目'}
            </button>
          )}
        </div>

        {/* 右：聚焦模式切换（缩放控件在左下角工具栏） */}
        <div className="flex items-center gap-1">
          <button
            onClick={toggleFocusMode}
            disabled={isEmpty}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              focusMode
                ? 'text-sky-600 bg-sky-50 hover:bg-sky-100'
                : 'text-slate-600 hover:text-sky-600 hover:bg-sky-50'
            }`}
            title={
              focusMode
                ? '当前为聚焦模式，点击显示全部节点'
                : '开启聚焦模式：仅显示选中路径与子树'
            }
          >
            {focusMode ? '显示全部' : '聚焦当前'}
          </button>
        </div>
      </div>

      {/* 画布区域 */}
      <div className="flex-1 relative">
        <ReactFlow
          nodes={displayNodes}
          edges={displayEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          onMove={onMove}
          nodeTypes={nodeTypes}
          fitView
          defaultEdgeOptions={defaultEdgeOptions}
          deleteKeyCode={null}
          // 抓手/选择模式：抓手时左键拖拽平移，选择时左键框选
          selectionOnDrag={!isHandMode}
          panOnDrag={isHandMode}
          // Shift+点击启用多选（用于合并分支）
          multiSelectionKeyCode={['Shift']}
          minZoom={0.1}
          maxZoom={4}
          className={isHandMode ? 'cursor-grab active:cursor-grabbing' : ''}
        >
          <Background color="#e2e8f0" gap={20} />

          <MiniMap
            nodeColor={(n) => {
              const data = n.data as TurnNodeData | undefined;
              if (!data?.status) return '#ffffff';
              return statusColorMap[data.status] ?? '#ffffff';
            }}
            nodeStrokeColor="#94a3b8"
            className="!bg-white !border-slate-200"
          />
        </ReactFlow>

        {/* 聚焦模式提示条：节点数 > 20 且未开启聚焦时显示在画布顶部居中 */}
        {showFocusHint && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 px-4 py-2 bg-slate-900/80 text-white text-sm rounded-full shadow-lg backdrop-blur-sm">
            <span>节点较多（{nodes.length} 个），建议开启聚焦模式</span>
            <button
              onClick={toggleFocusMode}
              className="px-2 py-0.5 bg-sky-500 hover:bg-sky-600 rounded text-xs font-medium transition-colors"
            >
              开启
            </button>
          </div>
        )}

        {/* 多选合并浮动按钮：Shift+多选 2+ 节点时显示在画布顶部居中。
            提示条显示时下移避免重叠。 */}
        {canMerge && (
          <button
            onClick={handleMerge}
            className={`absolute left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-4 py-2 bg-violet-600 text-white text-sm rounded-full shadow-lg hover:bg-violet-700 transition-colors ${
              showFocusHint ? 'top-20' : 'top-4'
            }`}
            title={`合并选中的 ${selectedNodes.length} 个节点为新支线根`}
          >
            <GitMerge size={14} />
            合并分支（{selectedNodes.length}）
          </button>
        )}

        {/* 空状态提示：主输入框由父组件 NetworkEditor 提供 */}
        {isEmpty && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="text-center">
              <div className="text-slate-400 text-base">输入问题开始排查</div>
            </div>
          </div>
        )}

        {/* 左下角工具栏：选择/抓手模式切换 + 缩放控制 */}
        <div className="absolute bottom-4 left-4 z-10 flex flex-col gap-1 bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
          {/* 模式切换 */}
          <div className="flex border-b border-slate-100">
            <button
              onClick={() => setInteractionMode('select')}
              className={`flex flex-col items-center justify-center w-10 h-10 transition-colors ${
                interactionMode === 'select' && !spacePressed
                  ? 'bg-violet-50 text-violet-600'
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
              }`}
              title="选择工具 (V)"
            >
              <MousePointer2 size={15} />
              <span className="text-[9px] mt-0.5">V</span>
            </button>
            <button
              onClick={() => setInteractionMode('hand')}
              className={`flex flex-col items-center justify-center w-10 h-10 border-l border-slate-100 transition-colors ${
                interactionMode === 'hand' || spacePressed
                  ? 'bg-violet-50 text-violet-600'
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
              }`}
              title="抓手工具 (H / 按住空格)"
            >
              <Hand size={15} />
              <span className="text-[9px] mt-0.5">H</span>
            </button>
          </div>
          {/* 缩放控制 */}
          <div className="flex flex-col">
            <button
              onClick={() => zoomIn()}
              className="flex items-center justify-center w-10 h-8 text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors border-b border-slate-100"
              title="放大 (Ctrl + 滚轮)"
            >
              <ZoomIn size={15} />
            </button>
            <button
              onClick={() => zoomOut()}
              className="flex items-center justify-center w-10 h-8 text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors border-b border-slate-100"
              title="缩小 (Ctrl + 滚轮)"
            >
              <ZoomOut size={15} />
            </button>
            <button
              onClick={handleFitView}
              className="flex items-center justify-center w-10 h-8 text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors"
              title="适应视图 (F)"
            >
              <Maximize2 size={15} />
            </button>
          </div>
          {/* 节点显示模式切换：详细 / 紧凑 */}
          <NodeDisplayModeToggle />
        </div>
      </div>
    </div>
  );
}

/** 节点显示模式切换按钮：详细（完整内容）/ 紧凑（仅摘要标题） */
function NodeDisplayModeToggle() {
  const nodeDisplayMode = useDebugStore((s) => s.nodeDisplayMode);
  const toggleNodeDisplayMode = useDebugStore((s) => s.toggleNodeDisplayMode);
  const isCompact = nodeDisplayMode === 'compact';
  return (
    <button
      onClick={toggleNodeDisplayMode}
      className={`flex items-center justify-center w-10 h-9 border-t border-slate-100 transition-colors ${
        isCompact
          ? 'bg-violet-50 text-violet-600'
          : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
      }`}
      title={isCompact ? '切换到详细模式' : '切换到紧凑模式'}
    >
      {isCompact ? <Rows3 size={15} /> : <AlignJustify size={15} />}
    </button>
  );
}
