// ============================================================
// AI Debug — 全局状态 Store（Zustand）
//
// 蛛网式对话网络：以单一 TurnNode 节点为基本单元，通过 parentId
// 组织成树形对话网络。集中管理画布数据、项目、UI 状态，并集成
// React Flow 的状态管理。
// ============================================================
import { create } from 'zustand';
import { devtools, persist, createJSONStorage } from 'zustand/middleware';
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
import {
  applyPatches,
  enablePatches,
  isDraft,
  original,
  produceWithPatches,
  setAutoFreeze,
  type Patch,
} from 'immer';
import type {
  TurnNodeData,
  Suggestion,
  NetworkProject,
  MemoryEntry,
  AppSettings,
  AutoEvolutionState,
  NodeAttachment,
  Skill,
  AssistantMessage,
} from '@/components/node-flow/types';
import { createTurnNodeData } from '@/components/node-flow/node-definitions';
import { mergeBranches } from './network-engine';
import { incrementalLayout } from '@/components/node-flow/radial-layout';
import { loadConfig, type LLMConfig } from './llm-config';
import { createBuiltinSkills, shouldInjectBuiltinSkills } from './skill-seed';
import {
  loadSettings,
  saveSettings,
  loadGlobalMemory,
  saveGlobalMemory,
  DEFAULT_SETTINGS,
} from './settings-storage';
import {
  saveSnapshot as saveSnapshotToStore,
  getSnapshotById,
} from './canvas-snapshots-store';

// immer patches 全局初始化：
// - enablePatches：开启 patch 序列化能力（produceWithPatches 依赖）
// - setAutoFreeze(false)：draft 结果与 React Flow 的 node 对象共享引用，
//   冻结会导致 React Flow 内部就地更新报错，故关闭
enablePatches();
setAutoFreeze(false);

/** 画布视口 */
export interface FlowViewport {
  x: number;
  y: number;
  zoom: number;
}

// ============================================================
// P0-1：基于 immer patches 的增量撤销/重做
//
// 设计：
// - 历史栈维护在 store 内（_undoStack / _redoStack），不持久化、不进 React 视图
// - pushHistory 读取当前 nodes/edges，与 _lastHistoryState 做 produceWithPatches
//   生成 forward/backward patch，push 到 _undoStack 并清空 _redoStack
// - undo 应用 backward patch，redo 应用 forward patch
// - 历史栈上限 200 步，500ms 合并窗口（force=true 绕过）
// - 流式输出不入栈：检测到任意节点 status==='running' 时跳过
// - undoCount / redoCount 为响应式计数器，UI 据此显示 canUndo / canRedo
// ============================================================

/** 历史栈上限 */
const MAX_HISTORY = 200;
/** 合并窗口（毫秒）：500ms 内的连续变更合并为一条历史 */
const MERGE_WINDOW_MS = 500;

/** 单条历史条目：forward 用于 redo，backward 用于 undo */
interface HistoryEntry {
  forward: Patch[];
  backward: Patch[];
}

/** 历史快照状态：patch 计算的 base */
interface HistoryState {
  nodes: Node<TurnNodeData>[];
  edges: Edge[];
}

/**
 * 按 id 同步 draft 数组到 newArr，产生最小 patch：
 * - 移除：newArr 中不存在于 draft 的元素（splice）
 * - 更新：同 id 但引用变化（内容被替换）的元素就地替换
 * - 新增：newArr 中新增的元素 push 到末尾
 *
 * 假设：调用方不重排数组顺序。本项目内 setNodes/setEdges 均保持顺序
 * （filter/map/concat），故按 id 同步后顺序与 newArr 一致。
 *
 * 注：original() 在运行时按 proxy 标识识别 draft，与静态类型无关，
 * 此处用 `as unknown` 绕过 immer 复杂的 WritableDraft 嵌套类型，
 * 避免静态类型不兼容（Draft<T> vs WritableDraft<T>）。
 */
function syncArrayById<T extends { id: string }>(draftArr: T[], newArr: T[]) {
  const newIds = new Set(newArr.map((n) => n.id));
  // 倒序 splice 移除已删除元素，避免索引错位
  for (let i = draftArr.length - 1; i >= 0; i--) {
    const item = draftArr[i];
    const orig = isDraft(item)
      ? (original(item as unknown) as { id: string } | undefined)
      : (item as { id: string });
    if (!orig || !newIds.has(orig.id)) {
      draftArr.splice(i, 1);
    }
  }
  // 构建 id → 当前索引映射（基于移除后的数组）
  const existingIdx = new Map<string, number>();
  draftArr.forEach((n, i) => {
    const orig = isDraft(n)
      ? (original(n as unknown) as { id: string } | undefined)
      : (n as { id: string });
    if (orig) existingIdx.set(orig.id, i);
  });
  // 更新已存在元素（仅引用变化时替换）或追加新增元素
  for (const item of newArr) {
    const idx = existingIdx.get(item.id);
    if (idx === undefined) {
      draftArr.push(item);
    } else {
      const draftItem = draftArr[idx];
      const origDraft = isDraft(draftItem)
        ? (original(draftItem as unknown) as { id: string } | undefined)
        : (draftItem as { id: string });
      if (origDraft !== item) {
        draftArr[idx] = item;
      }
    }
  }
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

  // ========== 路径回放高亮（UI 临时态，不持久化） ==========
  /** 当前高亮的路径节点 ID 列表（从根到目标节点的 parentId 链） */
  highlightedPathIds: string[];
  /** 设置高亮路径（点击面包屑时触发） */
  setHighlightedPath: (nodeIds: string[]) => void;
  /** 清除高亮（3 秒自动清除或切换项目时） */
  clearHighlightedPath: () => void;

  // ========== 分支切换器（UI 临时态，不持久化） ==========
  /** 记录每节点当前选中的子分支：key=父节点 id, value=当前选中的子节点 id */
  selectedChildIdMap: Record<string, string>;
  /** 切换某节点的选中子分支 */
  setSelectedChild: (parentId: string, childId: string) => void;

  // ========== React Flow 集成 ==========
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;

  // ========== 节点操作 ==========
  /**
   * 创建一个 Turn 节点，返回新节点 id。
   * @param userMessage  用户消息文本
   * @param parentId     父节点 ID（根节点为 null）
   * @param options      可选：images 图片 base64 列表 / attachments 多模态附件 / source 来源标记
   */
  createTurnNode: (
    userMessage: string,
    parentId: string | null,
    options?: {
      images?: string[];
      attachments?: NodeAttachment[];
      source?: 'manual' | 'assistant';
    },
  ) => string;
  /** 创建合并节点（多选节点合并为新支线根），返回新节点 id。LLM 调用由调用方触发 */
  createMergedNode: (sourceIds: string[], intent: string) => string;
  /** 更新节点 data 的部分字段 */
  updateTurnNode: (nodeId: string, partial: Partial<TurnNodeData>) => void;
  /** 流式追加 assistantMessage */
  appendAssistantChunk: (nodeId: string, delta: string) => void;
  /** 设置节点的 suggestions 列表 */
  setNodeSuggestions: (nodeId: string, suggestions: Suggestion[]) => void;
  /** 注册节点的 AbortController（调用方发起流式请求时注册，供 abortRunningTurn 取消） */
  registerAbortController: (nodeId: string, controller: AbortController) => void;
  /** 取消指定 running 节点的流式请求：abort + 标记 error 状态 */
  abortRunningTurn: (nodeId: string) => void;
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
  /** 创建并切换到新项目，返回新项目 id */
  createProject: (name: string) => string;
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
  /** 切换项目置顶状态（已置顶 → 取消；未置顶 → 标记当前时间戳） */
  togglePinProject: (id: string) => void;
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
  /** AbortController 注册表（运行时态，不持久化）：nodeId → controller */
  _abortControllers: Map<string, AbortController>;
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

  // ========== git 模式视图切换（UI 临时态） ==========
  /** 当前视图模式：'web' 蛛网模式（默认）/ 'git' git 风格模式 */
  viewMode: 'web' | 'git';
  /** 切换视图模式 */
  setViewMode: (mode: 'web' | 'git') => void;
  /** 给节点打标签 */
  addNodeTag: (nodeId: string, tag: string) => void;
  /** 移除节点标签 */
  removeNodeTag: (nodeId: string, tag: string) => void;
  /** 设置节点命名分支名 */
  setNodeBranchName: (nodeId: string, branchName: string) => void;

  // ========== 撤销 / 重做（P0-1：immer patches 增量历史） ==========
  /** 撤销栈计数器（响应式，UI 据此判断 canUndo）。不持久化 */
  undoCount: number;
  /** 重做栈计数器（响应式，UI 据此判断 canRedo）。不持久化 */
  redoCount: number;
  /** 撤销栈（运行时态，不持久化、不进 React 视图） */
  _undoStack: HistoryEntry[];
  /** 重做栈（运行时态，不持久化、不进 React 视图） */
  _redoStack: HistoryEntry[];
  /** 上次入栈时的完整状态（patch 计算的 base）。不持久化 */
  _lastHistoryState: HistoryState | null;
  /** undo/redo 进行中标记：避免 set nodes/edges 触发的订阅者再次入栈 */
  _isUndoRedoing: boolean;
  /** 上次 pushHistory 时间戳（500ms 合并窗口用）。不持久化 */
  _lastPushTime: number;
  /**
   * 推当前画布状态入历史栈。
   * - 读取当前 nodes/edges 与 _lastHistoryState 做 produceWithPatches 生成增量 patch
   * - 检测到任意节点 status==='running' 时跳过（流式输出不入栈）
   * - force=true 绕过 500ms 合并窗口（用于 create/delete/branch 等关键操作）
   */
  pushHistory: (force?: boolean) => void;
  /** 撤销：应用栈顶 backward patch 回滚到上一状态 */
  undo: () => void;
  /** 重做：应用栈顶 forward patch 重做到下一状态 */
  redo: () => void;
  /** 清空历史栈（切换项目 / 新建项目时调用） */
  clearHistory: () => void;

  // ========== 命名画布快照（P1-3） ==========
  /**
   * 保存当前画布为命名快照（剥离运行时字段）。
   * 草稿态（currentProjectId 为空）拒绝保存。
   * 流式请求中拒绝保存（避免捕获中间态）。
   * 返回新快照 id，失败返回 null。
   */
  saveSnapshot: (name: string) => string | null;
  /**
   * 恢复到指定快照：清空 undo/redo 栈 + 替换画布 + 重置历史 base。
   * 流式请求中拒绝恢复。
   * 快照不存在时静默返回 false。
   * 成功返回 true。
   */
  restoreSnapshot: (snapshotId: string) => boolean;

  // ========== 助手对话（PR-1：侧边栏 Agent 助手） ==========
  /** 助手消息列表：独立于节点对话，侧边栏助手面板用 */
  assistantMessages: AssistantMessage[];
  /** 助手面板可见性 */
  assistantPanelOpen: boolean;
  /** 助手当前激活的技能 ID（null 表示不使用技能） */
  activeSkillId: string | null;
  /** 助手流式请求的 AbortController（不持久化） */
  _assistantAbortController: AbortController | null;
  /** 添加助手消息 */
  addAssistantMessage: (message: AssistantMessage) => void;
  /** 更新助手消息的部分字段 */
  updateAssistantMessage: (id: string, partial: Partial<AssistantMessage>) => void;
  /** 流式追加助手消息内容 */
  appendAssistantMessageChunk: (id: string, delta: string) => void;
  /** 清空助手消息列表 */
  clearAssistantMessages: () => void;
  /** 设置助手面板可见性 */
  setAssistantPanelOpen: (open: boolean) => void;
  /** 设置当前激活的技能 ID */
  setActiveSkillId: (skillId: string | null) => void;
  /** 注册助手的 AbortController */
  registerAssistantAbortController: (controller: AbortController | null) => void;
  /** 中止助手正在进行的流式请求 */
  abortAssistantStream: () => void;

  // ========== Skill 技能体系（PR-1） ==========
  /** 技能列表 */
  skills: Skill[];
  /** 技能管理面板可见性 */
  skillManagerOpen: boolean;
  /** 添加技能 */
  addSkill: (skill: Skill) => void;
  /** 更新技能的部分字段 */
  updateSkill: (id: string, partial: Partial<Skill>) => void;
  /** 删除技能 */
  deleteSkill: (id: string) => void;
  /** 批量导入技能（覆盖式） */
  importSkills: (skills: Skill[]) => void;
  /** 设置技能管理面板可见性 */
  setSkillManagerOpen: (open: boolean) => void;
  /** 从 storage 重新加载技能列表 */
  refreshSkills: () => void;
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

/** persist localStorage key（新统一 key） */
export const STORE_PERSIST_KEY = 'ai-debug-store';
/** 旧项目数据 key（project-storage 历史使用） */
const LEGACY_PROJECTS_KEY = 'ai-debug:network-projects';
/** Skill 技能列表独立持久化 key（避免污染主 persist key） */
export const SKILLS_STORAGE_KEY = 'ai-debug:skills';

/**
 * 迁移旧 key `ai-debug:network-projects` 到新 persist key `ai-debug-store`。
 * 仅在旧 key 有数据且新 key 无数据时执行一次性迁移，迁移后保留旧 key 不删除
 * （等用户确认新版正常后再清理，避免数据丢失风险）。
 * 非浏览器环境（SSR）静默跳过。
 */
export function migrateLegacyProjectsKey(): void {
  if (typeof window === 'undefined') return;
  try {
    const oldRaw = window.localStorage.getItem(LEGACY_PROJECTS_KEY);
    const newRaw = window.localStorage.getItem(STORE_PERSIST_KEY);
    if (oldRaw && !newRaw) {
      const projects = JSON.parse(oldRaw);
      // 防御性校验：旧数据必须是数组，否则跳过迁移（persist 用默认空状态）
      if (!Array.isArray(projects)) return;
      // persist 存储格式：{ state: {...}, version: N }
      const migratedState = {
        state: { projects, currentProjectId: null as string | null },
        version: 1,
      };
      window.localStorage.setItem(STORE_PERSIST_KEY, JSON.stringify(migratedState));
    }
  } catch {
    // 旧数据损坏，静默跳过（persist 会用默认空状态）
  }
}

/**
 * 从 localStorage 加载技能列表。
 * 非浏览器环境（SSR）返回空数组。
 */
function loadSkillsFromStorage(): Skill[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(SKILLS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * 把技能列表持久化到 localStorage。
 * 非浏览器环境（SSR）静默跳过。
 */
function persistSkills(skills: Skill[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SKILLS_STORAGE_KEY, JSON.stringify(skills));
  } catch {
    // 容量超限或禁用，静默跳过
  }
}

export const useDebugStore = create<NetworkState>()(
  devtools(
    persist(
      (set, get) => ({
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

        // ========== 路径回放高亮 ==========
        // 默认空数组，不持久化，切换项目时清空
        highlightedPathIds: [],
        setHighlightedPath: (nodeIds) => set({ highlightedPathIds: nodeIds }),
        clearHighlightedPath: () => set({ highlightedPathIds: [] }),

        // ========== 分支切换器 ==========
        // 默认空对象，不持久化，切换项目时清空
        selectedChildIdMap: {},
        setSelectedChild: (parentId, childId) =>
          set((state) => ({
            selectedChildIdMap: { ...state.selectedChildIdMap, [parentId]: childId },
          })),

        // ========== 自动推演 ==========
        // 默认 idle，由引擎在 start/done 时切换
        autoEvolutionState: { status: 'idle', currentStep: 0, maxSteps: 0, activeBranches: 0 },

        // ========== AbortController 注册表 ==========
        // 调用方发起流式请求时注册，供 abortRunningTurn 取消。不持久化，不进 React 视图。
        _abortControllers: new Map<string, AbortController>(),

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
          get().pushHistory(true);
        },

        // ========== 节点操作 ==========
        createTurnNode: (userMessage, parentId, options) => {
          const id = generateNodeId('turn');
          const newNode: Node<TurnNodeData> = {
            id,
            type: 'turn',
            position: { x: 0, y: 0 },
            data: createTurnNodeData(userMessage, parentId, options),
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
          // 新建子分支时自动选中最新（分支切换器记录每节点当前选中子分支）
          if (parentId !== null) {
            get().setSelectedChild(parentId, id);
          }
          // 节点创建为离散操作：force=true 绕过合并窗口
          get().pushHistory(true);
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
              const avgX = sourceNodes.reduce((s, n) => s + n.position.x, 0) / sourceNodes.length;
              const avgY = sourceNodes.reduce((s, n) => s + n.position.y, 0) / sourceNodes.length;
              position = { x: avgX, y: avgY + 220 };
            }
            const positioned = newNodes.map((n) => (n.id === id ? { ...n, position } : n));
            return { nodes: positioned, isDirty: true };
          });
          get().pushHistory(true);
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

        // 注册节点的 AbortController：调用方发起流式请求时调用，覆盖旧 controller
        registerAbortController: (nodeId, controller) => {
          const state = get();
          const prev = state._abortControllers.get(nodeId);
          if (prev && !prev.signal.aborted) {
            // 覆盖前先 abort 旧的，避免悬挂请求
            prev.abort();
          }
          state._abortControllers.set(nodeId, controller);
          // 注册的 controller 不触发 set（不进 React 视图，避免无谓重渲染）
        },

        // 取消指定 running 节点的流式请求：abort controller + 标记节点 error 状态
        abortRunningTurn: (nodeId) => {
          const state = get();
          const controller = state._abortControllers.get(nodeId);
          if (controller && !controller.signal.aborted) {
            controller.abort();
          }
          state._abortControllers.delete(nodeId);
          set((s) => ({
            nodes: s.nodes.map((n) =>
              n.id === nodeId
                ? { ...n, data: { ...n.data, status: 'error', errorMessage: 'aborted' } }
                : n,
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
              edges: state.edges.filter((e) => !isDeleted(e.source) && !isDeleted(e.target)),
              selectedNodeId: isDeleted(state.selectedNodeId ?? '') ? null : state.selectedNodeId,
              isDirty: true,
            };
          });
          get().pushHistory(true);
        },

        // 删除本次推演产生的所有节点（按 evolutionMeta.startNodeId 匹配）。
        // 不删除推演起点本身（起点是用户节点，可能仍想保留）。
        // 删除后保留失去子节点的父节点（spec 约束：不强制清理）。
        deleteEvolutionNodes: (startNodeId) => {
          set((state) => {
            const toDelete = new Set<string>();
            for (const n of state.nodes) {
              if (n.data.evolutionMeta && n.data.evolutionMeta.startNodeId === startNodeId) {
                toDelete.add(n.id);
              }
            }
            if (toDelete.size === 0) return {};
            const isDeleted = (id: string) => toDelete.has(id);
            return {
              nodes: state.nodes.filter((n) => !isDeleted(n.id)),
              edges: state.edges.filter((e) => !isDeleted(e.source) && !isDeleted(e.target)),
              selectedNodeId: isDeleted(state.selectedNodeId ?? '') ? null : state.selectedNodeId,
              isDirty: true,
            };
          });
          get().pushHistory(true);
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
          get().pushHistory(true);
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
          get().pushHistory(true);
        },

        // 忽略节点：仅标记单节点，不级联子节点。子节点照常运行，但构建 LLM
        // 上下文时会跳过该节点（user+assistant 都不传），路径视为断点。
        ignoreNode: (nodeId) => {
          set((state) => ({
            nodes: state.nodes.map((n) =>
              n.id === nodeId ? { ...n, data: { ...n.data, status: 'ignored' as const } } : n,
            ),
            isDirty: true,
          }));
          get().pushHistory(true);
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
          get().pushHistory(true);
        },

        // ========== 选中 / 视口 ==========
        setSelectedNode: (nodeId) => set({ selectedNodeId: nodeId }),
        setViewport: (viewport) => set({ viewport, isDirty: true }),
        // 聚焦模式为 UI 开关，不改变项目数据，不计入 dirty
        toggleFocusMode: () => set((state) => ({ focusMode: !state.focusMode })),

        // ========== 项目操作 ==========
        // persist 接管后：projects 数组变化由 persist 中间件自动同步到 localStorage，
        // 不再手动调用 project-storage 的 createProjectStorage/updateProjectStorage/deleteProjectStorage。
        createProject: (name) => {
          // 切换前保存当前项目，避免防抖内的改动丢失
          get().flushCurrentProject();
          const now = Date.now();
          const project: NetworkProject = {
            id: `project-${now}-${Math.random().toString(36).slice(2, 8)}`,
            name: name.trim() || '未命名项目',
            nodes: [],
            edges: [],
            viewport: null,
            createdAt: now,
            updatedAt: now,
            projectType: 'normal',
          };
          set((state) => ({ projects: [...state.projects, project] }));
          get().loadProject(project.id);
          return project.id;
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
            // 清空路径高亮（UI 临时态不跨项目）
            highlightedPathIds: [],
            // 清空分支切换器选中状态（UI 临时态不跨项目）
            selectedChildIdMap: {},
          });
          // 切换项目清空历史栈（草稿态不入栈，等绑定项目后再记录 base）
          get().clearHistory();
        },

        loadProject: (id) => {
          // 切换到不同项目前，先把当前项目的未保存改动落盘
          if (get().currentProjectId !== id) {
            get().flushCurrentProject();
          }
          // persist 接管后从 store.projects 读（不再调 storage 层 getProject）
          const project = get().projects.find((p) => p.id === id);
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
            // 清空路径高亮（UI 临时态不跨项目）
            highlightedPathIds: [],
            // 清空分支切换器选中状态（UI 临时态不跨项目）
            selectedChildIdMap: {},
          });
          // 切换项目清空历史栈，并以新项目画布作为下次 push 的 base
          get().clearHistory();
        },

        // 立即保存当前项目的未保存改动（persist 接管后：更新 store.projects 中对应项目，
        // persist 中间件自动同步到 localStorage，不再调 storage 层 updateProjectStorage）
        flushCurrentProject: () => {
          const state = get();
          if (state.currentProjectId && state.isDirty) {
            get().saveProject();
          }
        },

        saveProject: () => {
          const id = get().currentProjectId;
          if (!id) return;
          const { nodes, edges, viewport, turnCounter } = get();
          // 更新 store.projects 中对应项目的画布数据 + 记忆 + 轮数计数器
          // persist 中间件监听 projects 变化自动同步到 localStorage
          set((state) => ({
            projects: state.projects.map((p) =>
              p.id === id
                ? {
                    ...p,
                    nodes,
                    edges,
                    viewport,
                    memory: p.memory,
                    turnCounter,
                    updatedAt: Date.now(),
                  }
                : p,
            ),
            isDirty: false,
          }));
        },

        deleteProject: (id) => {
          set((state) => ({
            projects: state.projects.filter((p) => p.id !== id),
            currentProjectId: state.currentProjectId === id ? null : state.currentProjectId,
          }));
        },

        // 切换项目置顶：已置顶（pinnedAt 非空）→ 置空；未置顶 → 标记当前时间戳。
        // persist 接管后直接更新 store.projects，自动同步到 localStorage。
        togglePinProject: (id) => {
          set((state) => ({
            projects: state.projects.map((p) =>
              p.id === id ? { ...p, pinnedAt: p.pinnedAt ? undefined : Date.now() } : p,
            ),
          }));
        },

        // persist 接管后：projects 由 persist 中间件自动从 localStorage rehydrate，
        // 此函数保留为 no-op 以兼容 EditorInner 的 refreshProjects() 调用（避免破坏接口）
        refreshProjects: () => {},

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

        // 项目记忆：写入当前项目的 memory 字段，persist 中间件自动同步到 localStorage
        addProjectMemory: (content, source = 'manual') => {
          const { currentProjectId, projects } = get();
          if (!currentProjectId) return;
          const entry: MemoryEntry = {
            id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            content: content.trim(),
            createdAt: Date.now(),
            source,
          };
          set({
            projects: projects.map((p) =>
              p.id === currentProjectId ? { ...p, memory: [...(p.memory ?? []), entry] } : p,
            ),
          });
        },

        updateProjectMemory: (id, content) => {
          const { currentProjectId, projects } = get();
          if (!currentProjectId) return;
          set({
            projects: projects.map((p) =>
              p.id === currentProjectId
                ? {
                    ...p,
                    memory: (p.memory ?? []).map((e) =>
                      e.id === id ? { ...e, content: content.trim() } : e,
                    ),
                  }
                : p,
            ),
          });
        },

        deleteProjectMemory: (id) => {
          const { currentProjectId, projects } = get();
          if (!currentProjectId) return;
          set({
            projects: projects.map((p) =>
              p.id === currentProjectId
                ? { ...p, memory: (p.memory ?? []).filter((e) => e.id !== id) }
                : p,
            ),
          });
        },

        refreshGlobalMemory: () => set({ globalMemory: loadGlobalMemory() }),

        incrementTurnCounter: () => set((state) => ({ turnCounter: state.turnCounter + 1 })),

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

        // ========== git 模式视图切换 ==========
        // 默认 'web' 蛛网模式，切换到 'git' 时由组件层接管布局
        viewMode: 'web',
        setViewMode: (mode) => set({ viewMode: mode }),
        // 给节点打标签：使用 Set 去重，避免重复标签
        addNodeTag: (nodeId, tag) => {
          set((state) => ({
            nodes: state.nodes.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      tags: [...new Set([...(n.data.tags ?? []), tag])],
                    },
                  }
                : n,
            ),
            isDirty: true,
          }));
          get().pushHistory(true);
        },
        // 移除节点标签：过滤掉目标 tag，空数组保留（与 undefined 等价处理）
        removeNodeTag: (nodeId, tag) => {
          set((state) => ({
            nodes: state.nodes.map((n) =>
              n.id === nodeId
                ? {
                    ...n,
                    data: {
                      ...n.data,
                      tags: (n.data.tags ?? []).filter((t) => t !== tag),
                    },
                  }
                : n,
            ),
            isDirty: true,
          }));
          get().pushHistory(true);
        },
        // 设置节点命名分支名：分支名挂在代表节点上（HEAD），空串等价于清除
        setNodeBranchName: (nodeId, branchName) => {
          set((state) => ({
            nodes: state.nodes.map((n) =>
              n.id === nodeId ? { ...n, data: { ...n.data, branchName } } : n,
            ),
            isDirty: true,
          }));
          get().pushHistory(true);
        },

        // ========== 撤销 / 重做（P0-1：immer patches 增量历史） ==========
        // 初始计数器为 0，挂载/切换项目时由 clearHistory 重置
        undoCount: 0,
        redoCount: 0,
        // 历史栈与 base state 不持久化、不进 React 视图（仅靠计数器触发响应式）
        _undoStack: [],
        _redoStack: [],
        _lastHistoryState: null,
        _isUndoRedoing: false,
        _lastPushTime: 0,

        /**
         * 推当前画布状态入历史栈。
         * 流式输出（任意节点 status==='running'）不入栈；
         * 500ms 合并窗口（force=true 绕过，用于 create/delete/branch 等关键操作）。
         */
        pushHistory: (force = false) => {
          const state = get();
          // undo/redo 进行中：避免 set nodes/edges 触发的订阅者再次入栈
          if (state._isUndoRedoing) return;
          // 流式输出不入栈（项目硬约束）
          if (state.nodes.some((n) => n.data.status === 'running')) return;
          // 500ms 合并窗口
          if (!force && Date.now() - state._lastPushTime < MERGE_WINDOW_MS) return;

          const base = state._lastHistoryState;
          // 首次入栈：仅记录 base，不产生 patch（无前序状态可对比）
          if (!base) {
            set({
              _lastHistoryState: { nodes: state.nodes, edges: state.edges },
              _lastPushTime: Date.now(),
            });
            return;
          }

          const currentNodes = state.nodes;
          const currentEdges = state.edges;
          // 计算 base → current 的增量 patch
          const [nextState, patches, inversePatches] = produceWithPatches(base, (draft) => {
            syncArrayById(draft.nodes, currentNodes);
            syncArrayById(draft.edges, currentEdges);
          });
          // 无变更则不入栈
          if (patches.length === 0) return;

          const newUndoStack = [...state._undoStack, { forward: patches, backward: inversePatches }];
          // 上限 200 步：超出时丢弃最早的历史
          if (newUndoStack.length > MAX_HISTORY) {
            newUndoStack.shift();
          }
          set({
            _undoStack: newUndoStack,
            _redoStack: [],
            _lastHistoryState: nextState,
            _lastPushTime: Date.now(),
            undoCount: newUndoStack.length,
            redoCount: 0,
          });
        },

        /** 撤销：弹出 _undoStack 栈顶，应用 backward patch 回滚 nodes/edges */
        undo: () => {
          const state = get();
          if (state._undoStack.length === 0 || state._isUndoRedoing) return;
          const entry = state._undoStack[state._undoStack.length - 1];
          const base = state._lastHistoryState;
          if (!base) return;
          // 应用 backward patch 回滚到上一个状态
          const reverted = applyPatches(base, entry.backward);
          set({
            _undoStack: state._undoStack.slice(0, -1),
            _redoStack: [...state._redoStack, entry],
            _lastHistoryState: reverted,
            _isUndoRedoing: true,
            nodes: reverted.nodes,
            edges: reverted.edges,
            isDirty: true,
            undoCount: state._undoStack.length - 1,
            redoCount: state._redoStack.length + 1,
          });
          // 同步释放标记：使用微任务确保本次 set 触发的订阅者跳过入栈
          Promise.resolve().then(() => {
            set({ _isUndoRedoing: false });
          });
        },

        /** 重做：弹出 _redoStack 栈顶，应用 forward patch 重做 nodes/edges */
        redo: () => {
          const state = get();
          if (state._redoStack.length === 0 || state._isUndoRedoing) return;
          const entry = state._redoStack[state._redoStack.length - 1];
          const base = state._lastHistoryState;
          if (!base) return;
          // 应用 forward patch 重做到下一个状态
          const applied = applyPatches(base, entry.forward);
          set({
            _redoStack: state._redoStack.slice(0, -1),
            _undoStack: [...state._undoStack, entry],
            _lastHistoryState: applied,
            _isUndoRedoing: true,
            nodes: applied.nodes,
            edges: applied.edges,
            isDirty: true,
            undoCount: state._undoStack.length + 1,
            redoCount: state._redoStack.length - 1,
          });
          Promise.resolve().then(() => {
            set({ _isUndoRedoing: false });
          });
        },

        /** 清空历史栈：切换项目 / 新建项目 / 加载项目时调用 */
        clearHistory: () => {
          const state = get();
          set({
            _undoStack: [],
            _redoStack: [],
            _lastHistoryState: state.currentProjectId
              ? { nodes: state.nodes, edges: state.edges }
              : null,
            _isUndoRedoing: false,
            _lastPushTime: 0,
            undoCount: 0,
            redoCount: 0,
          });
        },

        // ========== 命名画布快照（P1-3） ==========
        /**
         * 保存当前画布为命名快照。
         * - 草稿态（currentProjectId 为空）拒绝保存
         * - 流式请求中拒绝保存（避免捕获中间态）
         * - 剥离运行时字段 status/result/errorMessage，保证快照是干净状态
         */
        saveSnapshot: (name) => {
          const state = get();
          // 草稿态拒绝保存
          if (!state.currentProjectId) return null;
          // 流式请求中拒绝保存
          if (state.nodes.some((n) => n.data.status === 'running')) return null;

          // 剥离运行时字段，避免快照残留 running/success/result 等执行态
          const cleanNodes = state.nodes.map((n) => ({
            ...n,
            data: {
              ...n.data,
              status: 'idle' as const,
              errorMessage: undefined,
            },
          }));
          const cleanEdges = state.edges;

          const snap = saveSnapshotToStore({
            name: name.trim() || `快照 ${new Date().toLocaleString()}`,
            nodes: cleanNodes,
            edges: cleanEdges,
            viewport: state.viewport ?? undefined,
            projectId: state.currentProjectId,
            nodeCount: cleanNodes.length,
            edgeCount: cleanEdges.length,
          });
          return snap.id;
        },

        /**
         * 恢复到指定快照。
         * - 流式请求中拒绝恢复
         * - 快照不存在时静默返回 false
         * - 恢复时清空 undo/redo 栈（状态完全切换，无法逐步回退）
         * - 重置 _lastHistoryState 为快照状态，作为后续 push 的 base
         * - 使用 _isUndoRedoing 守卫避免替换过程中触发 pushHistory
         */
        restoreSnapshot: (snapshotId) => {
          const state = get();
          // 流式请求中拒绝恢复
          if (state.nodes.some((n) => n.data.status === 'running')) return false;

          const snap = getSnapshotById(snapshotId);
          if (!snap) return false;

          // 还原节点：剥离运行时字段，确保回滚后画布是干净状态
          const cleanNodes = snap.nodes.map((n) => ({
            ...n,
            data: {
              ...n.data,
              status: 'idle' as const,
              errorMessage: undefined,
            },
          }));
          const cleanEdges = snap.edges;

          set({
            nodes: cleanNodes,
            edges: cleanEdges,
            viewport: snap.viewport ?? null,
            selectedNodeId: null,
            isDirty: true,
            // 清空 undo/redo 栈（状态完全切换）
            _undoStack: [],
            _redoStack: [],
            _lastHistoryState: { nodes: cleanNodes, edges: cleanEdges },
            _isUndoRedoing: true,
            _lastPushTime: 0,
            undoCount: 0,
            redoCount: 0,
          });
          // 同步释放守卫：使用微任务确保本次 set 触发的订阅者跳过入栈
          Promise.resolve().then(() => {
            set({ _isUndoRedoing: false });
          });
          return true;
        },

        // ========== 助手对话（PR-1） ==========
        // 助手消息列表默认空数组，不持久化（切换项目/刷新即清空）
        assistantMessages: [],
        // 助手面板默认关闭
        assistantPanelOpen: false,
        // 默认不激活任何技能
        activeSkillId: null,
        // 流式 AbortController 不持久化
        _assistantAbortController: null,

        addAssistantMessage: (message) =>
          set((state) => ({ assistantMessages: [...state.assistantMessages, message] })),
        updateAssistantMessage: (id, partial) =>
          set((state) => ({
            assistantMessages: state.assistantMessages.map((m) =>
              m.id === id ? { ...m, ...partial } : m,
            ),
          })),
        // 流式追加：content += delta；同时兜底确保 status 为 streaming
        appendAssistantMessageChunk: (id, delta) =>
          set((state) => ({
            assistantMessages: state.assistantMessages.map((m) =>
              m.id === id
                ? {
                    ...m,
                    content: m.content + delta,
                    status: 'streaming' as const,
                  }
                : m,
            ),
          })),
        clearAssistantMessages: () => set({ assistantMessages: [] }),
        setAssistantPanelOpen: (open) => set({ assistantPanelOpen: open }),
        setActiveSkillId: (skillId) => set({ activeSkillId: skillId }),
        registerAssistantAbortController: (controller) => {
          const state = get();
          // 覆盖前先 abort 旧的，避免悬挂请求
          if (state._assistantAbortController && !state._assistantAbortController.signal.aborted) {
            state._assistantAbortController.abort();
          }
          // 不触发 set（不进 React 视图，避免无谓重渲染）
          state._assistantAbortController = controller;
        },
        abortAssistantStream: () => {
          const state = get();
          if (state._assistantAbortController && !state._assistantAbortController.signal.aborted) {
            state._assistantAbortController.abort();
          }
        },

        // ========== Skill 技能体系（PR-1） ==========
        // SSR 安全：初始为空数组，客户端挂载时由 refreshSkills() 从 localStorage 加载
        skills: [],
        skillManagerOpen: false,

        addSkill: (skill) => {
          set((state) => ({ skills: [...state.skills, skill] }));
          // 持久化到独立 storage（避免污染主 persist key）
          persistSkills(get().skills);
        },
        updateSkill: (id, partial) => {
          set((state) => ({
            skills: state.skills.map((s) =>
              s.id === id ? { ...s, ...partial, updatedAt: Date.now() } : s,
            ),
          }));
          persistSkills(get().skills);
        },
        deleteSkill: (id) => {
          set((state) => ({ skills: state.skills.filter((s) => s.id !== id) }));
          // 若删除的是当前激活技能，清空激活态
          if (get().activeSkillId === id) {
            set({ activeSkillId: null });
          }
          persistSkills(get().skills);
        },
        importSkills: (skills) => {
          set({ skills });
          persistSkills(skills);
        },
        setSkillManagerOpen: (open) => set({ skillManagerOpen: open }),
        refreshSkills: () => {
          const existing = loadSkillsFromStorage();
          // 首次启动（用户技能列表为空）自动注入内置技能
          if (shouldInjectBuiltinSkills(existing)) {
            const builtin = createBuiltinSkills();
            persistSkills(builtin);
            set({ skills: builtin });
          } else {
            set({ skills: existing });
          }
        },
      }),
      // persist 中间件配置：只持久化 projects + currentProjectId
      // 排除所有 UI 临时态：nodes/edges/selectedNodeId/viewport/focusMode/isDirty/
      // showSettings/mobileSidebarOpen/sidebarCollapsed/showAutoEvolution/llmConfig/
      // appSettings/globalMemory/showMemoryPanel/turnCounter/nodeDisplayMode/
      // highlightedPathIds/autoEvolutionState/_abortControllers/
      // selectedChildIdMap（T017 将新增，已预留排除）
      // viewMode（T026 git 模式视图切换，UI 临时态不持久化）
      // assistantMessages/assistantPanelOpen/activeSkillId/_assistantAbortController
      //   助手对话临时态不持久化，切换项目/刷新即清空
      // skills/skillManagerOpen 由 SKILLS_STORAGE_KEY 独立管理（refreshSkills 兼容）
      // appSettings/globalMemory 由 settings-storage 独立管理（保留 refresh* 兼容）
      {
        name: STORE_PERSIST_KEY,
        storage: createJSONStorage(() => localStorage),
        partialize: (state) => ({
          projects: state.projects,
          currentProjectId: state.currentProjectId,
        }),
        version: 1,
        // SSR 安全：跳过自动 hydration，由 DebugFlowEditorLoader useEffect 手动 rehydrate
        skipHydration: true,
      },
    ),
    // devtools 中间件配置：仅开发环境启用，生产构建 tree-shaking 移除
    {
      name: 'ai-debug-store',
      enabled: process.env.NODE_ENV !== 'production',
    },
  ),
);
