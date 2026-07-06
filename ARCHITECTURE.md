# ARCHITECTURE.md

> 给三个月后的自己看的架构地图。
> AGENTS.md 给 AI 工具看（简洁、规则化），本文件给人看（详尽、解释 why）。
> 文档中引用文件用相对路径，根目录为项目根（`apps/web/src/lib/...`）。

---

## 1. 技术栈

| 层 | 技术 | 版本 | 用途 |
|---|---|---|---|
| 框架 | Next.js (App Router) | 16 | 应用框架，`output: 'export'` 静态导出 |
| UI 库 | React | 18 | 视图渲染 |
| 语言 | TypeScript | 5 | 类型安全 |
| 画布 | React Flow | 11 | 蛛网节点画布、拖拽、缩放、连线 |
| 状态管理 | Zustand | 5 | 单一 store，所有状态集中 |
| 样式 | Tailwind CSS | 3 | 原子化 CSS + 深色模式（`dark:` 前缀） |
| 图标 | lucide-react | 0.468 | 图标库 |
| Markdown | react-markdown + remark-gfm | 9 / 4 | AI 回答渲染 |
| 通知 | sonner | 1.7 | toast 通知 |
| 持久化 | 浏览器 localStorage | — | **无后端**，所有数据本地化 |

> API Key 仅本地存储，不上传任何后端。详见 `apps/web/src/lib/llm-config.ts`。

---

## 2. 目录结构

```
ai-debug/
├── apps/web/
│   ├── package.json              # @ai-debug/web 包定义
│   ├── next.config.*
│   └── src/
│       ├── app/                  # Next.js App Router 入口
│       │   ├── globals.css       # 全局样式（含 .reactflow__attribution 位置调整）
│       │   └── page.tsx
│       ├── components/
│       │   ├── node-flow/        # 蛛网画布核心
│       │   │   ├── DebugFlowEditor.tsx   # 顶层壳：顶栏 + 侧边栏 + 画布 + Inspector
│       │   │   ├── NodeCanvas.tsx        # 画布主体 + 自动保存防抖（500ms/800ms）
│       │   │   ├── NodeInspector.tsx     # 右侧检查器 + runPostTurnSidecars 旁路
│       │   │   ├── NodeSidebar.tsx       # 左侧项目列表 + 三点菜单
│       │   │   ├── nodes/TurnNode.tsx    # Turn 节点渲染
│       │   │   ├── types.ts              # TurnNodeData / NetworkProject / AppSettings 类型
│       │   │   ├── node-definitions.ts   # createTurnNodeData 工厂
│       │   │   └── radial-layout.ts      # 增量径向布局
│       │   ├── SettingsModal.tsx         # API Key / 服务商配置
│       │   ├── StorageManager.tsx        # localStorage 容量监控 / 导入导出
│       │   ├── MemoryPanel.tsx           # 全局记忆面板
│       │   └── ThemeProvider.tsx
│       ├── hooks/
│       │   └── useDialogA11y.ts          # 对话框可访问性 hook
│       └── lib/
│           ├── debug-store.ts            # Zustand store（节点/项目/设置/记忆/viewport）
│           ├── network-engine.ts         # collectContextPath + streamTurnResponse
│           ├── llm-client.ts             # OpenAI 兼容客户端（fetch + SSE 流式）
│           ├── llm-config.ts             # 服务商预设（mimo/volcengine/deepseek…）
│           ├── llm-helpers.ts            # quickCallLLM / buildVisionMessage / generateSummary
│           ├── memory-engine.ts          # extractMemory + buildMemoryContext
│           ├── conflict-engine.ts        # detectConflicts 支线冲突检测
│           ├── network-pruner.ts         # AI 清理蛛网派生逻辑
│           ├── project-storage.ts        # 项目 localStorage CRUD
│           ├── settings-storage.ts       # 全局设置 / 全局记忆持久化
│           ├── theme.ts                  # 主题 key: ai-debug:theme
│           └── i18n-storage.ts           # 语言 key: ai-debug:user-lang
├── docs/
│   ├── push-checklist.md        # Push 前自检清单
│   └── ...
├── AGENTS.md                    # AI 工具协作上下文（保持简洁）
└── ARCHITECTURE.md              # 本文件
```

---

## 3. 数据流图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              用户交互                                    │
│   （输入消息 / 分叉 / 合并 / 建议方向 / 删除节点 / 切换项目）            │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
        ┌────────────────────────────────────────────────────┐
        │  组件层 (NodeCanvas.tsx / NodeInspector.tsx)        │
        │  - createChildAndStream(userMsg)                    │
        │  - 取消旧请求: abortRef.current?.abort()            │
        │  - new AbortController()                            │
        └──────────────┬─────────────────────────────────────┘
                       │ 1. createTurnNode(userMsg, parentId)
                       ▼
        ┌────────────────────────────────────────────────────┐
        │  Zustand store (debug-store.ts)                    │
        │  - nodes/edges 增量布局 (radial-layout.ts)         │
        │  - updateTurnNode(newId, {status: 'running'})      │
        └──────────────┬─────────────────────────────────────┘
                       │ 2. 取当前 nodes
                       ▼
        ┌────────────────────────────────────────────────────┐
        │  network-engine.ts                                  │
        │  collectContextPath(nodeId, nodes)                  │
        │    └─ 沿 parentId 链收集根→当前路径                 │
        │    └─ 合并节点: 按 mergedFromIds 展开多路路径       │
        │  buildLLMMessages(segments, extraContext)           │
        │    └─ 跳过 ignored 节点（路径断点）                 │
        │    └─ 段间插入 "--- 分支 N ---" 标记                │
        └──────────────┬─────────────────────────────────────┘
                       │ 3. LLM 流式调用
                       ▼
        ┌────────────────────────────────────────────────────┐
        │  llm-client.ts → OpenAI 兼容接口 (SSE)             │
        │  quickCallLLM(messages, onDelta, signal)           │
        │    └─ onDelta = (delta) => appendAssistantChunk    │
        └──────────────┬─────────────────────────────────────┘
                       │ 4. 流式 chunk 增量写回节点
                       ▼
        ┌────────────────────────────────────────────────────┐
        │  Zustand store (appendAssistantChunk)               │
        │  - nodes.map: data.assistantMessage += delta        │
        │  - status = 'running'                               │
        └──────────────┬─────────────────────────────────────┘
                       │ 5. 流式结束
                       ▼
        ┌────────────────────────────────────────────────────┐
        │  parseSuggestions(fullText)  → suggestions          │
        │  generateSummary(fullText)   → summary（旁路）      │
        │  updateTurnNode: {status:'success', suggestions,    │
        │                    summary}                          │
        │  runPostTurnSidecars (按频率):                       │
        │    ├─ extractMemory   → addGlobalMemory/addProjectMemory │
        │    └─ detectConflicts → updateTurnNode(conflictNote)│
        └──────────────┬─────────────────────────────────────┘
                       │ 6. isDirty = true
                       ▼
        ┌────────────────────────────────────────────────────┐
        │  自动保存防抖 (NodeCanvas.tsx useEffect)            │
        │  - nodes/edges 改动 → 500ms → saveProject()         │
        │  - viewport 改动   → 800ms → saveProject()          │
        │  - 草稿态(currentProjectId 为空)不保存              │
        │  - 切换项目前 flushCurrentProject() 立即落盘        │
        └──────────────┬─────────────────────────────────────┘
                       │ 7. updateProjectStorage
                       ▼
        ┌────────────────────────────────────────────────────┐
        │  localStorage                                       │
        │  key: ai-debug:network-projects                     │
        │  value: NetworkProject[] (含 nodes/edges/viewport/  │
        │         memory/turnCounter/projectType)             │
        └────────────────────────────────────────────────────┘
```

**关键不变量**：
- 上下文路径只收集当前分支，不污染其他分支（`collectContextPath`）
- 流式增量写回，不在 `streamTurnResponse` 内整体覆盖
- 草稿态不落盘，防抖窗口内的改动由 `flushCurrentProject` 兜底

---

## 4. localStorage 命名空间

所有 key 统一用 `ai-debug:` 前缀，避免与其他站点冲突。

| Key | 类型 | 写入方 | 用途 |
|---|---|---|---|
| `ai-debug:network-projects` | `NetworkProject[]` | `project-storage.ts` | 全部项目（含 nodes/edges/viewport/memory/turnCounter） |
| `ai-debug:llm-config` | `LLMConfig` | `llm-config.ts` | API Key / 服务商 / 模型选择 |
| `ai-debug:app-settings` | `AppSettings` | `settings-storage.ts` | 记忆开关 / 频率 / 冲突开关 / globalRules |
| `ai-debug:global-memory` | `MemoryEntry[]` | `settings-storage.ts` | 跨项目的全局记忆条目 |
| `ai-debug:theme` | `'light' \| 'dark'` | `theme.ts` | 主题偏好 |
| `ai-debug:user-lang` | `'zh' \| 'en'` | `i18n-storage.ts` | 语言偏好 |
| ~~`ai-debug:workflows`~~ | — | — | **已废弃**，旧 key 数据不做自动迁移（见 `project-storage.ts` 注释） |

**容量管理**：`apps/web/src/components/StorageManager.tsx` 监控 `ai-debug:network-projects` 大小并提供容量提示。所有写入失败（隐私模式 / 配额满）走 `try/catch` 静默忽略。

---

## 5. Zustand store 结构

单一 store `useDebugStore`（`apps/web/src/lib/debug-store.ts`），按职责分 slice：

| Slice | 关键字段 | 说明 |
|---|---|---|
| **画布数据** | `nodes: Node<TurnNodeData>[]`<br>`edges: Edge[]`<br>`selectedNodeId: string \| null`<br>`viewport: FlowViewport \| null`<br>`focusMode: boolean` | 当前打开项目的画布状态。`focusMode` 开启后仅显示选中节点路径 + 子树 |
| **项目** | `currentProjectId: string \| null`<br>`projects: NetworkProject[]`<br>`isDirty: boolean` | `currentProjectId` 为 null 即草稿态（不保存）。`isDirty` 由节点操作置 true、`saveProject` 置 false |
| **UI** | `showSettings: boolean`<br>`mobileSidebarOpen: boolean`<br>`llmConfig: LLMConfig \| null`<br>`showMemoryPanel: boolean`<br>`nodeDisplayMode: 'detailed' \| 'compact'` | UI 开关。`llmConfig` 初始 null（SSR 安全），客户端 `refreshLlmConfig()` 加载 |
| **设置 & 记忆** | `appSettings: AppSettings`<br>`globalMemory: MemoryEntry[]`<br>`turnCounter: number` | `turnCounter` 每轮 AI 回答 +1，决定记忆提取 / 冲突检测频率 |
| **React Flow 集成** | `onNodesChange`<br>`onEdgesChange`<br>`onConnect` | 用 `applyNodeChanges` / `applyEdgeChanges` / `addEdge` 接入 RF。选中变化不算 dirty |
| **节点操作** | `createTurnNode`<br>`createMergedNode`<br>`updateTurnNode`<br>`appendAssistantChunk`<br>`setNodeSuggestions`<br>`deleteNode` | 节点 CRUD。`deleteNode` 递归收集子树（`collectDescendants`）一并删除 |
| **支线操作** | `abandonBranch`<br>`reactivateBranch` | 标记 / 恢复支线（级联子节点） |
| **忽略节点** | `ignoreNode`<br>`unignoreNode` | 仅标记单节点（不级联），构建 LLM 上下文时跳过 |
| **项目操作** | `createProject`<br>`startNewProject`<br>`loadProject`<br>`saveProject`<br>`flushCurrentProject`<br>`deleteProject`<br>`refreshProjects` | `flushCurrentProject` 切换项目前同步落盘，避免防抖竞态丢失 |
| **记忆操作** | `addGlobalMemory`<br>`updateGlobalMemory`<br>`deleteGlobalMemory`<br>`addProjectMemory`<br>`updateProjectMemory`<br>`deleteProjectMemory`<br>`refreshGlobalMemory`<br>`incrementTurnCounter` | 全局记忆直接读写 localStorage；项目记忆写入 `NetworkProject.memory` |
| **设置操作** | `updateAppSettings`<br>`refreshAppSettings` | 合并传入字段并持久化 |

**SSR 安全约定**：`projects`、`llmConfig`、`appSettings`、`globalMemory` 初始都用空值/默认值，客户端在 `EditorInner` 挂载时通过 `refresh*()` 从 localStorage 覆盖。

---

## 6. 节点类型契约

核心类型定义在 `apps/web/src/components/node-flow/types.ts`。

### TurnNodeData

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `parentId` | `string \| null` | ✅ | 父节点 ID。根节点 / 合并节点为 `null` |
| `userMessage` | `string` | ✅ | 用户消息（根节点为初始问题，合并节点为合并意图） |
| `assistantMessage` | `string` | ✅ | AI 回答。流式生成中可为空字符串 |
| `suggestions` | `Suggestion[]` | ✅ | AI 给出的建议方向列表（`{title, description}`） |
| `status` | `TurnStatus` | ✅ | 节点状态：`idle` / `running` / `success` / `error` / `abandoned` / `ignored` |
| `errorMessage` | `string` | — | 错误信息（status 为 error 时） |
| `summary` | `string` | — | 摘要标题（commit message）：流式完成后由 LLM 生成 ≤20 字 |
| `mergedFromIds` | `string[]` | — | 合并来源节点 ID 列表。**非空表示此节点为合并节点**（parentId 必为 null） |
| `images` | `string[]` | — | 图片附件 base64 列表（多模态） |
| `conflictNote` | `string` | — | 支线冲突标注（由 `detectConflicts` 写入） |
| `createdAt` | `number` | ✅ | 创建时间戳 |

### TurnStatus 状态机

```
                createTurnNode
                      │
                      ▼
                ┌─── idle ───┐
                │            │
        (start stream)   (ignoreNode)
                │            │
                ▼            ▼
             running      ignored
                │            │
       ┌────────┴────────┐   │ (unignoreNode)
       │                 │   │ → idle/success
    success            error │
       │                 │   │
   (abandonBranch)    (重试) │
       │                 │   │
       ▼                 └───┘
   abandoned
       │
   (reactivateBranch)
       │
       ▼
   idle / success   ← 依据 assistantMessage 是否非空
```

### 关键规则

- **`parentId` 与 `mergedFromIds` 互斥**：合并节点 `parentId` 必为 `null`，`mergedFromIds` 非空
- **`collectContextPath` 行为**：
  - 普通节点 → 单段 `[[根...当前]]`
  - 合并节点 → 多段，按 `mergedFromIds` 顺序展开各来源路径，末尾追加自身
- **`ignored` 节点**：构建 LLM 上下文时跳过（user/assistant 都不传），路径视为断点，子节点照常进入上下文

---

## 7. 关键设计决策

> 从 AGENTS.md「关键设计决策」搬过来并扩展。

### 7.1 上下文路径：单路径喂给 LLM

`collectContextPath`（`apps/web/src/lib/network-engine.ts`）从根沿 `parentId` 链收集，**只把当前路径喂给 LLM**，不污染其他分支。这是蛛网结构相对线性对话的核心价值：分支间上下文隔离，避免 A 分支的结论干扰 B 分支的推理。

### 7.2 合并节点：多路上下文 + 主干冲突检测

`mergedFromIds` 字段支持多路上下文：合并节点的 `collectContextPath` 按 `mergedFromIds` 顺序展开各来源的完整路径，段间插入 `--- 分支 N ---` 标记。**已知限制**：冲突检测（`conflict-engine.ts`）仅分析主干路径，不跨合并来源比对——这是后续优化方向。

### 7.3 AI 清理蛛网：派生而非删除

`network-pruner.ts` 不删除原项目，派生新项目（`projectType: 'derived-pruned'`），保留 `originalProjectId`。这样用户可以对比原蛛网与精简版，回退成本低。

### 7.4 记忆默认关闭

`DEFAULT_SETTINGS` 中 `enableGlobalMemory` / `enableProjectMemory` / `enableConflictAutoCheck` 全部默认 `false`。原因：
- 记忆提取会额外调用 LLM，默认关闭避免无意识消耗 API 配额
- 用户对「AI 自动总结」有预期门槛，需手动开启

### 7.5 数据本地化

所有数据存 localStorage，无后端，API Key 仅本地存储（`ai-debug:llm-config`）。这是产品定位（隐私优先、零部署成本）的硬约束。

### 7.6 草稿态：首条消息后才绑定项目

`startNewProject` 不立即在 storage 创建项目，而是清空画布 + `currentProjectId` 置空（草稿态）。等用户在初始输入界面提交首条消息后，由 `EmptyStateInput` 调用 `createProject` 绑定真实项目。**好处**：避免用户点「新建」却放弃，留下空项目污染列表。

### 7.7 流式 + AbortController

所有 `streamTurnResponse` 调用接入 `AbortController`（`abortRef`），发起新请求前 `abortRef.current?.abort()`。原因：用户快速连点追问 / 建议方向时，旧请求的 chunk 会写错节点。

### 7.8 旁路钩子：失败静默

`runPostTurnSidecars`（记忆提取 / 冲突检测）、`generateSummary` 都是旁路逻辑，**失败静默**，不阻塞主流程、不抛异常。原因：这些是锦上添花，不能因为它们失败导致主回答流程报错。

---

## 8. 工程约定

### 8.1 不可变更新（P2-4）

Zustand store 更新**禁止直接 mutate**，必须返回新对象。

**❌ 错误**：
```ts
set((state) => {
  state.nodes.push(newNode); // 直接 mutate，React 不会重渲染
  return state;
});
```

**✅ 正确**（参考 `debug-store.ts` 的 `createTurnNode` / `updateTurnNode` / `appendAssistantChunk`）：
```ts
set((state) => ({
  nodes: state.nodes.concat(newNode),          // 返回新数组
  edges: state.edges.concat(newEdge),
  isDirty: true,
}));

set((state) => ({
  nodes: state.nodes.map((n) =>
    n.id === nodeId ? { ...n, data: { ...n.data, ...partial } } : n,
  ),
  isDirty: true,
}));
```

**要点**：
- 数组用 `concat` / `map` / `filter`，不用 `push` / `splice`
- 对象用展开 `{ ...n, data: { ...n.data, ...partial } }`
- React Flow 的 `applyNodeChanges` / `applyEdgeChanges` 内部已返回新数组，可直接用

### 8.2 字段废弃规范（P2-6）

重构数据结构时**保留旧字段 + 标 `@deprecated` + 新字段并存**，平滑迁移。

**示例**（参考 `project-storage.ts` 的 `projectType` 兼容逻辑）：
```ts
export interface NetworkProject {
  id: string;
  name: string;
  // ...其他字段

  /** @deprecated 改用 projectType + originalProjectId 区分普通/派生项目。保留旧字段读取旧数据，新代码请用 projectType */
  legacyType?: string;

  /** 项目类型：normal 普通项目 / derived-pruned 由 AI 清理派生的精简项目 */
  projectType?: 'normal' | 'derived-pruned';

  /** 派生项目的来源项目 ID（仅 projectType === 'derived-pruned' 时有值） */
  originalProjectId?: string;
}
```

**读取时兜底**（`loadProjects` 内）：
```ts
return parsed.map((p) => ({
  ...p,
  projectType: p.projectType ?? 'normal', // 旧数据无此字段，默认 normal
}));
```

**流程**：
1. 新增字段，旧字段保留并标 `@deprecated`
2. 读取时用 `??` / 默认值兜底旧数据
3. 写入时只写新字段（旧字段不再写入，但读取兼容）
4. 经过 1-2 个 release 周期，确认无旧数据后再删旧字段

### 8.3 关键修复注释规范（P0-5）

修复 bug 时用 `// 关键修复:` 前缀沉淀踩坑，便于 `grep` 回溯。

**示例**：
```ts
// 关键修复: 防抖 effect 内必须二次校验 currentProjectId，
// 否则异步回调返回时用户已切换项目，会把改动写入错的项目。
useEffect(() => {
  if (!currentProjectId) return;
  // ...
  setTimeout(() => {
    const state = useDebugStore.getState();
    if (state.currentProjectId !== currentProjectId) return; // 二次校验
    if (!state.isDirty) return;
    state.saveProject();
  }, 500);
}, [nodes, edges, currentProjectId]);
```

**约定**：
- 前缀固定为 `// 关键修复:`（冒号后空格），便于 `grep "关键修复:"` 全局检索
- 注释说明**症状 + 根因 + 修复点**，三要素缺一不可
- 不强制每个 bug 都加，仅在「非显而易见、容易复发」的修复上加（如异步竞态、SSR、防抖）

### 8.4 其他约定

- **状态管理**：统一走 Zustand store，不直接读 localStorage（存储层 `*-storage.ts` 除外）
- **SSR 安全**：依赖 localStorage 的值必须在 `useEffect` 中加载，不能作为 `useState` 初始值
- **流式请求**：所有 `streamTurnResponse` 调用接入 `AbortController`，发起新请求前取消旧请求
- **TypeScript**：避免 `any`，新增函数需有简短注释说明用途
- **自动保存**：nodes/edges 防抖 500ms，viewport 防抖 800ms，草稿态（`currentProjectId` 为空）不保存
- **React Flow 水印**：MIT 协议要求保留 attribution，`globals.css` 中 `.reactflow__attribution` 仅调整位置，**不要** `display: none`

---

## 9. 踩坑记录表

| 踩过的坑 | 根因 | 预防方法 |
|---------|------|---------|
| hydration mismatch 报错 / 首屏闪烁 | `useState` 初始值直接读了 `localStorage`，SSR 阶段拿不到值与客户端不一致 | 初始值用默认值/`null`，在 `useEffect` 中 `refresh*()` 加载；存储层读函数加 `typeof window === 'undefined'` 兜底 |
| 自动保存覆盖用户视角（viewport 被重置 / fitView 抢镜） | 防抖 effect 依赖了 `reactFlowInstance`，触发 `fitView` 覆盖用户当前视角 | 用 `useRef` 跟踪 `isInitialLoad`，初次加载跳过自动保存；viewport 防抖与 nodes/edges 防抖分开（800ms vs 500ms） |
| 流式请求未取消旧请求，回答串到错误节点 | 没有 `AbortController`，旧请求的 chunk 还在写新节点 | 维护 `abortRef`，发起新请求前 `abortRef.current?.abort()`，参考 `NodeCanvas.tsx` |
| localStorage 容量有限（5~10MB），写大项目报 QuotaExceededError | 节点 assistantMessage 累积过大，`JSON.stringify` 全量序列化爆掉 | `StorageManager.tsx` 提供容量监控；导出/清理旧项目；写入失败 `try/catch` 静默 |
| 原生 `alert/confirm/prompt` 弹窗体验差、样式割裂 | 直接用了浏览器原生 API | 优先用 `sonner` toast / 自定义 Modal；仅在非阻塞提示场景保留原生 |
| 草稿态保存污染（未绑定项目的节点被写入上一个项目） | `currentProjectId` 为空时仍触发保存 | 防抖 effect 内加 `if (!currentProjectId) return;`；`saveProject` 内二次校验 `if (!id) return;` |
| `runPostTurnSidecars` 竞态（记忆/冲突写入错项目） | 异步回调返回时用户已切换项目 | 调用前捕获 `projectIdAtCall`，回调内校验 `useDebugStore.getState().currentProjectId === projectIdAtCall`，不一致则跳过项目级写入 |
| 合并节点定位与原根节点重叠 | `incrementalLayout` 对根节点强制定位 `(0,0)` | `createMergedNode` 改为取来源节点中心下方偏移 `{x: avgX, y: avgY + 220}`，见 `debug-store.ts` |
| Next.js 静态导出在 `output: 'export'` 模式下报「dynamic server usage」 | 误用了服务端 API（`cookies`、`headers`、`fs`）或动态路由 | 全部数据走客户端 localStorage，不要引入服务端逻辑；构建前跑 `pnpm --filter @ai-debug/web build` 验证 |

---

## 10. 后续优化方向

> 列出 spec 中 P3 未执行项作为未来方向（按优先级）。

### 10.1 合并节点冲突检测

**现状**：`conflict-engine.ts` 仅分析主干路径，不跨合并来源比对。
**方向**：扩展 `detectConflicts`，对 `mergedFromIds` 各来源路径两两比对，标注合并点的潜在冲突。
**难点**：合并来源可能跨项目（派生项目），需处理节点 id 命名空间。

### 10.2 localStorage 容量治理

**现状**：节点 `assistantMessage` 全量序列化，大项目容易触顶。
**方向**：
- 按项目分 key 存储（`ai-debug:project:{id}`），单项目独立配额
- 老节点的 `assistantMessage` 截断 / 压缩（保留摘要 + 折叠原文）
- 提供「归档」操作，把不活跃项目移到IndexedDB

### 10.3 协作与同步

**现状**：纯本地，无协作能力。
**方向**：项目 JSON 导出 / 导入已有，可扩展为可分享链接（base64 编码项目数据放进 URL hash，无需后端）。

### 10.4 节点搜索与全文检索

**现状**：项目多了只能手动翻侧边栏。
**方向**：跨项目搜索 `userMessage` / `assistantMessage` / `summary`，命中后跳转并高亮节点。

### 10.5 流式请求的断点续传

**现状**：网络中断后流式回答丢失，需手动重试。
**方向**：缓存已生成的 chunk 到节点 `assistantMessage`，重试时从断点续传（依赖 LLM API 的 `prompt_cache` 或自建缓存）。

### 10.6 移动端体验

**现状**：三点菜单已适配移动端，但画布拖拽 / 缩放在小屏体验一般。
**方向**：移动端专用手势（双指缩放、长按拖拽节点），简化节点卡片在窄屏的展示。

### 10.7 测试覆盖

**现状**：无自动化测试。
**方向**：对 `collectContextPath` / `buildLLMMessages` / `parseSuggestions` 等纯函数加单测；对 store 操作加集成测试（Vitest + jsdom）。

---

## 附录：常用命令

```bash
# 安装依赖
pnpm install

# 开发（必须进入 apps/web）
cd apps/web && pnpm dev

# 类型检查
pnpm --filter @ai-debug/web exec tsc --noEmit

# 构建（静态导出）
pnpm --filter @ai-debug/web build

# 锁文件一致性验证
pnpm install --frozen-lockfile
```

详见 `docs/push-checklist.md` 了解 push 前自检流程。
