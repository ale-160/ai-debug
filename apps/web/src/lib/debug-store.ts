// ============================================================
// AI Debug — 全局状态 Store（Zustand）
//
// 蛛网式对话网络：以单一 TurnNode 节点为基本单元，通过 parentId
// 组织成树形对话网络。集中管理画布数据、项目、UI 状态，并集成
// React Flow 的状态管理。
// ============================================================
import { create } from 'zustand';
import {
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
} from 'reactflow';
import type { TurnNodeData, Suggestion, NetworkProject, MemoryEntry, AppSettings, AutoEvolutionState } from '@/components/node-flow/types';
import { createTurnNodeData } from '@/components/node-flow/node-definitions';
import { mergeBranches } from './network-engine';
import { incrementalLayout } from '@/components/node-flow/radial-layout';
import {
  loadProjects,
  saveProjects,
  createProject as createProjectStorage,
  updateProject as updateProjectStorage,
  deleteProject as deleteProjectStorage,
  getProject,
} from './project-storage';
import { loadConfig, type LLMConfig } from './llm-config';
import {
  loadSettings,
  saveSettings,
  loadGlobalMemory,
  saveGlobalMemory,
  DEFAULT_SETTINGS,
} from './settings-storage';

/** 画布视口 */
export interface FlowViewport {
  x: number;
  y: number;
  zoom: number;
}

/**
 * 生成节点 ID。
 * 策略：`${prefix}-${Date.now()}-${6 位 base36 随机串}`，避免旧 node-utils 依赖。
 */
function generateNodeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

interface NetworkState {
  // ========== 画布数据（当前打开的项目） ==========
  nodes: Node<TurnNodeData>[];
  edges: Edge[];
  selectedNodeId: string | null;
  viewport: FlowViewport | null;
  /** 聚焦模式：开启后仅显示选中节点路径 + 子树，隐藏其他路径上的 abandoned 支线 */
  focusMode: boolean;

  // ========== 项目 ==========
  currentProjectId: string | null;
  /** 项目列表（用于左侧面板展示） */
  projects: NetworkProject[];
  isDirty: boolean;

  // ========== UI ==========
  showSettings: boolean;
  mobileSidebarOpen: boolean;
  /** 桌面端侧边栏收纳状态（true=已收纳隐藏，false=展开） */
  sidebarCollapsed: boolean;
  /** 自动推演对话框可见性（懒加载，由 NodeSidebar 入口按钮触发） */
  showAutoEvolution: boolean;
  llmConfig: LLMConfig | null;

  // ========== 设置 & 记忆 ==========
  /** 应用设置（记忆/冲突/规则开关与频率） */
  appSettings: AppSettings;
  /** 全局记忆条目（跨项目） */
  globalMemory: MemoryEntry[];
  /** 记忆面板可见性 */
  showMemoryPanel: boolean;
  /** 当前会话已完成的 AI 回答轮数（用于按频率决定是否提取记忆/检测冲突） */
  turnCounter: number;
  /** 节点显示模式：detailed 详细（默认，显示用户消息+AI回答摘要）/ compact 紧凑（仅摘要标题+状态） */
  nodeDisplayMode: 'detailed' | 'compact';

  // ========== React Flow 集成 ==========
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;

  // ========== 节点操作 ==========
  /** 创建一个 Turn 节点，返回新节点 id */
  createTurnNode: (userMessage: string, parentId: string | null) => string;
  /** 创建合并节点（多选节点合并为新支线根），返回新节点 id。LLM 调用由调用方触发 */
  createMergedNode: (sourceIds: string[], intent: string) => string;
  /** 更新节点 data 的部分字段 */
  updateTurnNode: (nodeId: string, partial: Partial<TurnNodeData>) => void;
  /** 流式追加 assistantMessage */
  appendAssistantChunk: (nodeId: string, delta: string) => void;
  /** 设置节点的 suggestions 列表 */
  setNodeSuggestions: (nodeId: string, suggestions: Suggestion[]) => void;
  /** 删除节点及其下游子树（递归通过 parentId 找子节点）+ 相关 edges */
  deleteNode: (nodeId: string) => void;
  /**
   * 删除本次推演产生的所有节点：遍历 nodes，删除所有 evolutionMeta.startNodeId
   * 等于 startNodeId 的节点（不含推演起点本身）+ 关联 edges。
   * 多路推演时支持按 startNodeId 单独删除某一路。
   * 删除后保留推演起点父节点，不强制清理失去子节点的节点。
   */
  deleteEvolutionNodes: (startNodeId: string) => void;

  // ========== 支线操作 ==========
  /** 标记节点及下游为 abandoned */
  abandonBranch: (nodeId: string) => void;
  /** 恢复支线（节点及下游 status 恢复为 idle/success） */
  reactivateBranch: (nodeId: string) => void;

  // ========== 忽略节点 ==========
  /** 标记单节点为 ignored（不级联子节点）：构建 LLM 上下文时跳过该节点 */
  ignoreNode: (nodeId: string) => void;
  /** 取消忽略（恢复为 success/idle，依据 assistantMessage 是否非空） */
  unignoreNode: (nodeId: string) => void;

  // ========== 选中 / 视口 ==========
  setSelectedNode: (nodeId: string | null) => void;
  setViewport: (viewport: FlowViewport) => void;
  /** 切换聚焦模式开关 */
  toggleFocusMode: () => void;

  // ========== 项目操作 ==========
  /** 创建并切换到新项目 */
  createProject: (name: string) => void;
  /** 进入新项目草稿态：清空画布 + currentProjectId 置空，等待首条消息后绑定项目 */
  startNewProject: () => void;
  /** 从 storage 加载项目到画布 */
  loadProject: (id: string) => void;
  /** 保存当前画布到 storage */
  saveProject: () => void;
  /** 切换/新建项目前，把当前项目的未保存改动立即落盘（避免防抖竞态丢失） */
  flushCurrentProject: () => void;
  /** 删除项目 */
  deleteProject: (id: string) => void;
  /** 从 storage 重新加载 projects 列表 */
  refreshProjects: () => void;

  // ========== 记忆操作 ==========
  /** 追加全局记忆条目（来源默认 manual） */
  addGlobalMemory: (content: string, source?: 'auto' | 'manual') => void;
  /** 更新全局记忆条目内容 */
  updateGlobalMemory: (id: string, content: string) => void;
  /** 删除全局记忆条目 */
  deleteGlobalMemory: (id: string) => void;
  /** 追加项目记忆条目到当前项目 */
  addProjectMemory: (content: string, source?: 'auto' | 'manual') => void;
  /** 更新当前项目的记忆条目内容 */
  updateProjectMemory: (id: string, content: string) => void;
  /** 删除当前项目的记忆条目 */
  deleteProjectMemory: (id: string) => void;
  /** 从 storage 重新加载全局记忆 */
  refreshGlobalMemory: () => void;
  /** 计数器 +1（每次 AI 回答成功后调用） */
  incrementTurnCounter: () => void;

  // ========== 设置操作 ==========
  /** 更新应用设置（合并传入字段）并持久化 */
  updateAppSettings: (partial: Partial<AppSettings>) => void;
  /** 从 storage 重新加载应用设置 */
  refreshAppSettings: () => void;

  // ========== UI 操作 ==========
  setShowSettings: (show: boolean) => void;
  /** 设置自动推演对话框可见性 */
  setShowAutoEvolution: (show: boolean) => void;
  toggleMobileSidebar: () => void;
  setMobileSidebarOpen: (open: boolean) => void;
  /** 切换桌面端侧边栏收纳/展开 */
  toggleSidebarCollapsed: () => void;
  /** 设置桌面端侧边栏收纳状态 */
  setSidebarCollapsed: (collapsed: boolean) => void;
  refreshLlmConfig: () => void;
  setShowMemoryPanel: (show: boolean) => void;

  // ========== 节点显示模式 ==========
  /** 切换节点显示模式（detailed/compact） */
  toggleNodeDisplayMode: () => void;
  /** 设置节点显示模式 */
  setNodeDisplayMode: (mode: 'detailed' | 'compact') => void;

  // ========== 自动推演 ==========
  /** 自动推演运行时状态（idle/running/paused/done + 进度计数） */
  autoEvolutionState: AutoEvolutionState;
  /** 启动推演：状态置 running，初始化进度计数 */
  startAutoEvolution: (maxSteps: number, activeBranches: number) => void;
  /** 暂停推演：状态置 paused（置信度低时由引擎触发） */
  pauseAutoEvolution: () => void;
  /** 恢复推演：状态置 running（用户确认继续时触发） */
  resumeAutoEvolution: () => void;
  /** 停止推演：状态置 idle，清空进度（用户主动停止或推演完成） */
  stopAutoEvolution: () => void;
  /** 推演完成：状态置 done，保留进度供 UI 展示总结 */
  doneAutoEvolution: () => void;
  /** 更新当前步数（引擎每完成一步后调用） */
  setAutoEvolutionStep: (step: number) => void;
  /** 更新活跃路数（多路推演中某路收敛/停止后递减） */
  setAutoEvolutionActiveBranches: (count: number) => void;
}

/**
 * 递归收集某节点的所有下游子节点 id（不含自身）。
 * 通过 node.data.parentId 构建父子关系。
 */
function collectDescendants(nodeId: string, nodes: Node<TurnNodeData>[]): Set<string> {
  const result = new Set<string>();
  const childrenMap = new Map<string, string[]>();
  for (const n of nodes) {
    if (n.data.parentId !== null) {
      const list = childrenMap.get(n.data.parentId) ?? [];
      list.push(n.id);
      childrenMap.set(n.data.parentId, list);
    }
  }
  const queue: string[] = childrenMap.get(nodeId) ?? [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (result.has(id)) continue; // 防止异常环引用导致死循环
    result.add(id);
    const children = childrenMap.get(id) ?? [];
    queue.push(...children);
  }
  return result;
}

export const useDebugStore = create<NetworkState>((set, get) => ({
  // ========== 画布数据 ==========
  nodes: [],
  edges: [],
  selectedNodeId: null,
  viewport: null,
  // 聚焦模式默认关闭
  focusMode: false,

  // ========== 项目 ==========
  currentProjectId: null,
  // 初始为空以保证 SSR/CSR 一致，客户端在 EditorInner 挂载时通过 refreshProjects() 加载
  projects: [],
  isDirty: false,

  // ========== UI ==========
  showSettings: false,
  mobileSidebarOpen: false,
  // 桌面端侧边栏默认展开
  sidebarCollapsed: false,
  // 自动推演对话框默认关闭，由 NodeSidebar 入口按钮触发
  showAutoEvolution: false,
  // 初始为 null 以保证 SSR/CSR 一致，客户端在 EditorInner 挂载时通过 refreshLlmConfig() 加载
  llmConfig: null,

  // ========== 设置 & 记忆 ==========
  // SSR 安全：用默认值初始化，客户端挂载时由 refresh* 从 localStorage 覆盖
  appSettings: { ...DEFAULT_SETTINGS },
  globalMemory: [],
  showMemoryPanel: false,
  turnCounter: 0,
  nodeDisplayMode: 'detailed',

  // ========== 自动推演 ==========
  // 默认 idle，由引擎在 start/done 时切换
  autoEvolutionState: { status: 'idle', currentStep: 0, maxSteps: 0, activeBranches: 0 },

  // ========== React Flow 集成 ==========
  // 选中变化不算 dirty，避免无谓的自动保存。
  onNodesChange: (changes) => {
    const hasNonSelectionChanges = changes.some((c) => c.type !== 'select');
    set((state) => ({
      nodes: applyNodeChanges(changes, state.nodes),
      isDirty: hasNonSelectionChanges ? true : state.isDirty,
    }));
  },

  onEdgesChange: (changes) => {
    set((state) => ({
      edges: applyEdgeChanges(changes, state.edges),
      isDirty: true,
    }));
  },

  onConnect: (connection) => {
    set((state) => ({
      edges: addEdge({ ...connection, animated: false }, state.edges),
      isDirty: true,
    }));
  },

  // ========== 节点操作 ==========
  createTurnNode: (userMessage, parentId) => {
    const id = generateNodeId('turn');
    const newNode: Node<TurnNodeData> = {
      id,
      type: 'turn',
      position: { x: 0, y: 0 },
      data: createTurnNodeData(userMessage, parentId),
    };
    // 先 append 节点，再视情况补 edge，最后增量布局
    set((state) => {
      const newNodes = state.nodes.concat(newNode);
      let newEdges = state.edges;
      if (parentId !== null) {
        newEdges = state.edges.concat({
          id: `edge-${parentId}-${id}`,
          source: parentId,
          target: id,
          animated: false,
        });
      }
      // 增量布局仅重算新节点（及兄弟）位置
      const laidOut = incrementalLayout(id, newNodes, newEdges);
      return {
        nodes: laidOut,
        edges: newEdges,
        isDirty: true,
      };
    });
    return id;
  },

  // 合并节点：parentId 为 null（新支线根），mergedFromIds 记录来源。
  // 注意：incrementalLayout 对根节点强制定位 (0,0) 会与原根重叠，故改为
  // 取来源节点中心下方偏移定位，视觉上让合并节点靠近其来源分支。
  createMergedNode: (sourceIds, intent) => {
    const id = generateNodeId('merge');
    const newNode: Node<TurnNodeData> = {
      id,
      type: 'turn',
      position: { x: 0, y: 0 },
      data: mergeBranches(sourceIds, intent),
    };
    set((state) => {
      const newNodes = state.nodes.concat(newNode);
      const sourceNodes = state.nodes.filter((n) => sourceIds.includes(n.id));
      let position = { x: 0, y: 0 };
      if (sourceNodes.length > 0) {
        const avgX =
          sourceNodes.reduce((s, n) => s + n.position.x, 0) /
          sourceNodes.length;
        const avgY =
          sourceNodes.reduce((s, n) => s + n.position.y, 0) /
          sourceNodes.length;
        position = { x: avgX, y: avgY + 220 };
      }
      const positioned = newNodes.map((n) =>
        n.id === id ? { ...n, position } : n,
      );
      return { nodes: positioned, isDirty: true };
    });
    return id;
  },

  updateTurnNode: (nodeId, partial) => {
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, ...partial } } : n,
      ),
      isDirty: true,
    }));
  },

  // 流式追加：assistantMessage += delta；同时兜底确保 status 为 running
  // （流式开始时调用方一般会先设 running，此处仅作保险）。
  appendAssistantChunk: (nodeId, delta) => {
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId
          ? {
              ...n,
              data: {
                ...n.data,
                assistantMessage: n.data.assistantMessage + delta,
                status: 'running' as const,
              },
            }
          : n,
      ),
      isDirty: true,
    }));
  },

  setNodeSuggestions: (nodeId, suggestions) => {
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, suggestions } } : n,
      ),
      isDirty: true,
    }));
  },

  // 删除节点 + 其所有下游子节点（递归通过 parentId 找子节点）+ 相关 edges
  deleteNode: (nodeId) => {
    set((state) => {
      const toDelete = collectDescendants(nodeId, state.nodes);
      toDelete.add(nodeId);
      const isDeleted = (id: string) => toDelete.has(id);
      return {
        nodes: state.nodes.filter((n) => !isDeleted(n.id)),
        edges: state.edges.filter(
          (e) => !isDeleted(e.source) && !isDeleted(e.target),
        ),
        selectedNodeId: isDeleted(state.selectedNodeId ?? '')
          ? null
          : state.selectedNodeId,
        isDirty: true,
      };
    });
  },

  // 删除本次推演产生的所有节点（按 evolutionMeta.startNodeId 匹配）。
  // 不删除推演起点本身（起点是用户节点，可能仍想保留）。
  // 删除后保留失去子节点的父节点（spec 约束：不强制清理）。
  deleteEvolutionNodes: (startNodeId) => {
    set((state) => {
      const toDelete = new Set<string>();
      for (const n of state.nodes) {
        if (
          n.data.evolutionMeta &&
          n.data.evolutionMeta.startNodeId === startNodeId
        ) {
          toDelete.add(n.id);
        }
      }
      if (toDelete.size === 0) return {};
      const isDeleted = (id: string) => toDelete.has(id);
      return {
        nodes: state.nodes.filter((n) => !isDeleted(n.id)),
        edges: state.edges.filter(
          (e) => !isDeleted(e.source) && !isDeleted(e.target),
        ),
        selectedNodeId: isDeleted(state.selectedNodeId ?? '')
          ? null
          : state.selectedNodeId,
        isDirty: true,
      };
    });
  },

  // ========== 支线操作 ==========
  abandonBranch: (nodeId) => {
    set((state) => {
      const toAbandon = collectDescendants(nodeId, state.nodes);
      toAbandon.add(nodeId);
      return {
        nodes: state.nodes.map((n) =>
          toAbandon.has(n.id)
            ? { ...n, data: { ...n.data, status: 'abandoned' as const } }
            : n,
        ),
        isDirty: true,
      };
    });
  },

  reactivateBranch: (nodeId) => {
    set((state) => {
      const toReactivate = collectDescendants(nodeId, state.nodes);
      toReactivate.add(nodeId);
      return {
        nodes: state.nodes.map((n) =>
          toReactivate.has(n.id)
            ? {
                ...n,
                data: {
                  ...n.data,
                  // 若 assistantMessage 非空则 'success'，否则 'idle'
                  status: n.data.assistantMessage.trim() !== '' ? 'success' : 'idle',
                },
              }
            : n,
        ),
        isDirty: true,
      };
    });
  },

  // 忽略节点：仅标记单节点，不级联子节点。子节点照常运行，但构建 LLM
  // 上下文时会跳过该节点（user+assistant 都不传），路径视为断点。
  ignoreNode: (nodeId) => {
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, status: 'ignored' as const } }
          : n,
      ),
      isDirty: true,
    }));
  },

  // 取消忽略：依据 assistantMessage 是否非空恢复为 success/idle
  unignoreNode: (nodeId) => {
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId
          ? {
              ...n,
              data: {
                ...n.data,
                status:
                  n.data.assistantMessage.trim() !== ''
                    ? ('success' as const)
                    : ('idle' as const),
              },
            }
          : n,
      ),
      isDirty: true,
    }));
  },

  // ========== 选中 / 视口 ==========
  setSelectedNode: (nodeId) => set({ selectedNodeId: nodeId }),
  setViewport: (viewport) => set({ viewport, isDirty: true }),
  // 聚焦模式为 UI 开关，不改变项目数据，不计入 dirty
  toggleFocusMode: () => set((state) => ({ focusMode: !state.focusMode })),

  // ========== 项目操作 ==========
  createProject: (name) => {
    // 切换前保存当前项目，避免防抖内的改动丢失
    get().flushCurrentProject();
    const project = createProjectStorage(name);
    set({ projects: loadProjects() });
    get().loadProject(project.id);
  },

  // 进入新项目草稿态：清空画布数据并解除当前项目绑定。
  // 不立即在 storage 中创建项目，等用户在初始输入界面提交首条消息后
  // 再由 EmptyStateInput 调用 createProject 绑定真实项目。
  startNewProject: () => {
    // 切换前保存当前项目，避免防抖内的改动丢失
    get().flushCurrentProject();
    set({
      nodes: [],
      edges: [],
      viewport: null,
      currentProjectId: null,
      selectedNodeId: null,
      isDirty: false,
      // 新建草稿态：计数器归零
      turnCounter: 0,
    });
  },

  loadProject: (id) => {
    // 切换到不同项目前，先把当前项目的未保存改动落盘
    if (get().currentProjectId !== id) {
      get().flushCurrentProject();
    }
    const project = getProject(id);
    if (!project) return;
    set({
      nodes: project.nodes,
      edges: project.edges,
      viewport: project.viewport,
      currentProjectId: project.id,
      selectedNodeId: null,
      isDirty: false,
      // 切换项目：恢复该项目的轮数计数器（未持久化时回退到 0）
      turnCounter: project.turnCounter ?? 0,
    });
  },

  // 立即保存当前项目的未保存改动（同步落盘，用于切换项目前的兜底）
  flushCurrentProject: () => {
    const state = get();
    if (state.currentProjectId && state.isDirty) {
      get().saveProject();
    }
  },

  saveProject: () => {
    const id = get().currentProjectId;
    if (!id) return;
    const { nodes, edges, viewport, projects, turnCounter } = get();
    // 保留当前项目的 memory 字段（项目级记忆独立于 nodes/edges 存储）
    const current = projects.find((p) => p.id === id);
    const memory = current?.memory;
    updateProjectStorage(id, { nodes, edges, viewport, memory, turnCounter });
    // 同步刷新本地 projects 列表（保持左侧面板数据一致）
    set({ projects: loadProjects(), isDirty: false });
  },

  deleteProject: (id) => {
    deleteProjectStorage(id);
    set((state) => ({
      projects: loadProjects(),
      currentProjectId:
        state.currentProjectId === id ? null : state.currentProjectId,
    }));
  },

  refreshProjects: () => set({ projects: loadProjects() }),

  // ========== 记忆操作 ==========
  // 全局记忆：直接读写 localStorage，再同步到 store
  addGlobalMemory: (content, source = 'manual') => {
    const entry: MemoryEntry = {
      id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      content: content.trim(),
      createdAt: Date.now(),
      source,
    };
    const list = [...get().globalMemory, entry];
    saveGlobalMemory(list);
    set({ globalMemory: list });
  },

  updateGlobalMemory: (id, content) => {
    const list = get().globalMemory.map((e) =>
      e.id === id ? { ...e, content: content.trim() } : e,
    );
    saveGlobalMemory(list);
    set({ globalMemory: list });
  },

  deleteGlobalMemory: (id) => {
    const list = get().globalMemory.filter((e) => e.id !== id);
    saveGlobalMemory(list);
    set({ globalMemory: list });
  },

  // 项目记忆：写入当前项目的 memory 字段并持久化
  addProjectMemory: (content, source = 'manual') => {
    const { currentProjectId, projects } = get();
    if (!currentProjectId) return;
    const entry: MemoryEntry = {
      id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      content: content.trim(),
      createdAt: Date.now(),
      source,
    };
    const updatedProjects = projects.map((p) =>
      p.id === currentProjectId
        ? { ...p, memory: [...(p.memory ?? []), entry] }
        : p,
    );
    saveProjects(updatedProjects);
    set({ projects: updatedProjects });
  },

  updateProjectMemory: (id, content) => {
    const { currentProjectId, projects } = get();
    if (!currentProjectId) return;
    const updatedProjects = projects.map((p) =>
      p.id === currentProjectId
        ? {
            ...p,
            memory: (p.memory ?? []).map((e) =>
              e.id === id ? { ...e, content: content.trim() } : e,
            ),
          }
        : p,
    );
    saveProjects(updatedProjects);
    set({ projects: updatedProjects });
  },

  deleteProjectMemory: (id) => {
    const { currentProjectId, projects } = get();
    if (!currentProjectId) return;
    const updatedProjects = projects.map((p) =>
      p.id === currentProjectId
        ? { ...p, memory: (p.memory ?? []).filter((e) => e.id !== id) }
        : p,
    );
    saveProjects(updatedProjects);
    set({ projects: updatedProjects });
  },

  refreshGlobalMemory: () => set({ globalMemory: loadGlobalMemory() }),

  incrementTurnCounter: () =>
    set((state) => ({ turnCounter: state.turnCounter + 1 })),

  // ========== 设置操作 ==========
  updateAppSettings: (partial) => {
    const next = { ...get().appSettings, ...partial };
    saveSettings(next);
    set({ appSettings: next });
  },

  refreshAppSettings: () => set({ appSettings: loadSettings() }),

  // ========== UI 操作 ==========
  setShowSettings: (show) => set({ showSettings: show }),

  // 自动推演对话框可见性切换（UI 开关，不改变项目数据，不计入 dirty）
  setShowAutoEvolution: (show) => set({ showAutoEvolution: show }),

  toggleMobileSidebar: () =>
    set((state) => ({ mobileSidebarOpen: !state.mobileSidebarOpen })),

  setMobileSidebarOpen: (open) => set({ mobileSidebarOpen: open }),

  // 桌面端侧边栏收纳切换（不改变项目数据，不计入 dirty）
  toggleSidebarCollapsed: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

  refreshLlmConfig: () => set({ llmConfig: loadConfig() }),

  setShowMemoryPanel: (show) => set({ showMemoryPanel: show }),

  // ========== 节点显示模式 ==========
  toggleNodeDisplayMode: () =>
    set((state) => ({
      nodeDisplayMode: state.nodeDisplayMode === 'detailed' ? 'compact' : 'detailed',
    })),

  setNodeDisplayMode: (mode) => set({ nodeDisplayMode: mode }),

  // ========== 自动推演 ==========
  // 启动推演：状态置 running，初始化 maxSteps 与 activeBranches，步数从 0 起
  startAutoEvolution: (maxSteps, activeBranches) =>
    set({
      autoEvolutionState: {
        status: 'running',
        currentStep: 0,
        maxSteps,
        activeBranches,
      },
    }),

  // 暂停推演：仅切换状态，保留进度
  pauseAutoEvolution: () =>
    set((state) => ({
      autoEvolutionState: { ...state.autoEvolutionState, status: 'paused' },
    })),

  // 恢复推演：状态置 running，保留进度
  resumeAutoEvolution: () =>
    set((state) => ({
      autoEvolutionState: { ...state.autoEvolutionState, status: 'running' },
    })),

  // 停止推演：状态归零到 idle（用户主动停止或完成清理时调用）
  stopAutoEvolution: () =>
    set({
      autoEvolutionState: {
        status: 'idle',
        currentStep: 0,
        maxSteps: 0,
        activeBranches: 0,
      },
    }),

  // 推演完成：状态置 done，保留进度供 UI 展示总结
  doneAutoEvolution: () =>
    set((state) => ({
      autoEvolutionState: { ...state.autoEvolutionState, status: 'done' },
    })),

  // 更新当前步数
  setAutoEvolutionStep: (step) =>
    set((state) => ({
      autoEvolutionState: { ...state.autoEvolutionState, currentStep: step },
    })),

  // 更新活跃路数（多路推演中某路收敛/停止后递减）
  setAutoEvolutionActiveBranches: (count) =>
    set((state) => ({
      autoEvolutionState: {
        ...state.autoEvolutionState,
        activeBranches: count,
      },
    })),
}));
