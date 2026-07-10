# Push 前自检清单

> 每次推送到远程前，逐项过一遍。目的：减少线上事故，培养工程习惯。
> 检查项分必查（P0）和建议查（P1）。P0 必须全部通过才能 push。
> 项目背景见根目录 `AGENTS.md` 与 `ARCHITECTURE.md`。

---

## P0 · 必查项（push 前必须全部通过）

### 1. 类型检查 & 构建

- [ ] `pnpm --filter @ai-debug/web exec tsc --noEmit` 通过（无报错）
- [ ] `pnpm --filter @ai-debug/web build` 通过（Next.js `output: 'export'` 静态导出能成功生成 `apps/web/out`）
- [ ] 没有引入未使用的新依赖到 `apps/web/package.json`

### 2. 依赖与锁文件一致性

- [ ] 本次改动有没有改 `apps/web/package.json`（增删依赖、改版本号）？
- [ ] 如果改了，是否同步更新了 `pnpm-lock.yaml`？（在根目录跑 `pnpm install` 自动更新）
- [ ] 本地跑 `pnpm install --frozen-lockfile` 通过（与 CI 行为一致，避免 `ERR_PNPM_OUTDATED_LOCKFILE`）
- [ ] `git status` 确认 `pnpm-lock.yaml` 和 `package.json` 一起被提交（不要只提交其中一个）

> **踩过的坑**：删了 `package.json` 里的依赖但没跑 `pnpm install`，lockfile 还保留旧依赖。
> 本地用 `--no-frozen-lockfile` 不报错，但 CI 默认 `frozen-lockfile` 严格校验，部署失败。

### 3. SSR 安全（Next.js 静态导出 + React 18）

- [ ] 依赖 `localStorage` 的值**不在** `useState` 初始值中（会触发 hydration mismatch）
  - 初始值用默认值 / `null` / `[]`，在 `useEffect` 中通过 `refresh*()`（如 `refreshProjects`、`refreshLlmConfig`、`refreshAppSettings`、`refreshGlobalMemory`）从 localStorage 覆盖
  - 检查 `apps/web/src/lib/debug-store.ts` 中所有 store 字段：`projects`、`llmConfig`、`appSettings`、`globalMemory` 初始都是空值/默认值，注释明确写了「SSR 安全」「SSR/CSR 一致」
- [ ] 没有在模块顶层或组件 render 阶段直接读 `window.localStorage`
- [ ] 所有存储层（`project-storage.ts` / `settings-storage.ts` / `llm-config.ts` / `theme.ts` / `i18n-storage.ts`）的读函数都用 `if (typeof window === 'undefined') return ...` 兜底

### 4. 防抖与自动保存配置未被破坏

- [ ] `apps/web/src/components/node-flow/NodeCanvas.tsx` 中 nodes/edges 自动保存仍是 **500ms** 防抖
- [ ] viewport 自动保存仍是 **800ms** 防抖
- [ ] **草稿态不保存**：两个防抖 effect 内都有 `if (!currentProjectId) return;` 守卫，`currentProjectId` 为空（草稿态）时不写 localStorage
- [ ] 切换项目前调用 `flushCurrentProject()` 立即落盘，避免防抖窗口内的改动丢失
- [ ] 防抖回调里二次校验 `state.currentProjectId !== currentProjectId` 时直接 `return`，避免异步竞态写错项目

### 5. 残留注释清理

- [ ] 没有 `// TODO`、`// 临时`、`// 后再说`、`// FIXME`、`// 待处理` 残留
  - 用 Grep 工具在 `apps/web/src` 搜索：`TODO|临时|后再说|FIXME|待处理`
- [ ] 没有 `console.log` 调试输出残留（保留 `console.error`）
- [ ] 删除的代码没有残留引用（全局搜索被删的函数名 / 变量名 / 组件名）

### 6. 敏感信息

- [ ] 全局搜索 `sk-`、`api_key=`、`apiKey`、`password`、硬编码的 token
- [ ] 没有把 `.env`、`.env.local`、`credentials.json` 提交到 git
- [ ] API Key 仅本地存储（`ai-debug:llm-config` localStorage key），不上传任何后端
- [ ] `.gitignore` 包含 `.env*`、`node_modules`、`.next`、`out`

---

## P1 · 建议查项（有空就过一遍）

### 7. 类型与代码卫生

- [ ] 类型检查无 `any` 滥用（AGENTS.md 明确「避免 `any`」）
  - 例外：`apps/web/src/components/node-flow/types.ts` 的 `isTurnNodeData` 守卫入参用 `any` 是合理的，新增函数不要再用 `any`
- [ ] 新增函数有简短中文注释说明用途（参考 `network-engine.ts` 的注释风格）
- [ ] 没有未使用的 import（TypeScript 会警告）
- [ ] 新增依赖真的被使用了吗？（跑 `pnpm --filter @ai-debug/web exec depcheck` 检查僵尸依赖，可选）

### 8. 流式请求

- [ ] 所有 `streamTurnResponse` 调用都接入了 `AbortController`
  - 参考 `apps/web/src/components/node-flow/NodeCanvas.tsx` 的 `abortRef` 与 `apps/web/src/components/node-flow/NodeInspector.tsx` 的 `createChildAndStream`
- [ ] 发起新请求前**先** `abortRef.current?.abort()` 取消旧请求，再 `new AbortController()`
- [ ] 流式过程中用户切换项目 / 关闭页面时旧请求被取消（依赖 abortRef + 切换项目时的清空逻辑）
- [ ] 流式 chunk 通过 `appendAssistantChunk` 增量更新，不要在 `streamTurnResponse` 内整体覆盖 `assistantMessage`

### 9. 移动端 & 可访问性

- [ ] 移动端 hover-only 按钮可见性：三点菜单在移动端始终可见、桌面端仅 hover 显示
  - 当前实现（`apps/web/src/components/node-flow/NodeSidebar.tsx`）：`md:opacity-0 md:group-hover:opacity-100`
  - 修改时不要把 `md:opacity-0` 改成全屏 `opacity-0`，否则移动端用户找不到菜单
- [ ] 三点菜单按钮颜色保持 `text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200`
  - 不要改成强对比色（会喧宾夺主，干扰项目名浏览）
- [ ] 移动端侧边栏通过 `mobileSidebarOpen` 控制，桌面端不受影响
- [ ] 重型组件（依赖 `reactflow`）用 `next/dynamic` 异步加载，避免阻塞首屏

### 10. React Flow 水印 & 合规

- [ ] **显示 React Flow 水印**：MIT 协议要求保留 attribution
  - `apps/web/src/app/globals.css` 中 `.reactflow__attribution` 仅调整位置（上移避免被遮挡），**不要**设置 `display: none`
- [ ] 项目 README / 部署页保留仓库链接与作者署名 `ale-160`

### 11. 数据存储

- [ ] 新增的 localStorage key 有 `ai-debug:` 命名空间前缀（避免与其他站点冲突）
  - 已有：`ai-debug:network-projects`、`ai-debug:app-settings`、`ai-debug:global-memory`、`ai-debug:llm-config`、`ai-debug:theme`、`ai-debug:user-lang`
- [ ] localStorage 写入失败（隐私模式 / 配额满）走 `try/catch` 静默忽略，不抛异常
- [ ] 大数据量场景考虑 quota 限制（参考 `StorageManager.tsx` 的容量提示）

### 12. Git 规范

- [ ] commit message 清晰：`feat: 新功能` / `fix: 修复XX` / `docs: 文档` / `refactor: 重构`
- [ ] 一个 commit 只做一件事（不要把不相关的改动混在一起）
- [ ] PR 描述里说明了改动范围与回归点

---

## 常见踩坑记录（引以为戒）

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

## 快速验证命令

```bash
# TypeScript 类型检查
pnpm --filter @ai-debug/web exec tsc --noEmit

# 前端构建验证（Next.js 静态导出）
pnpm --filter @ai-debug/web build

# 锁文件一致性验证（改过 package.json 必跑）
pnpm install --frozen-lockfile

# 检查僵尸依赖（可选）
pnpm --filter @ai-debug/web exec depcheck

# 搜索残留注释 / 调试输出（在项目根目录用 Grep 工具搜索）
#   模式 1：TODO|临时|后再说|FIXME|待处理
#   模式 2：console.log
#   模式 3：sk-|api_key=|password|hardcoded_token
```

---

## 部署后冒烟测试清单

push 并部署到 <https://ai-debug.ale160.com> 后，做一次冒烟测试：

- [ ] 访问首页能正常加载，无 console 报错、无 hydration mismatch 警告
- [ ] 首次进入显示「开始你的 Debug」初始输入界面（草稿态）
- [ ] 输入第一条消息后能自动创建项目并绑定 `currentProjectId`（侧边栏出现新项目）
- [ ] 配置 API Key 后，能流式生成 AI 回答，节点状态从 `running` → `success`
- [ ] 点击「建议方向」能创建子节点并继续追问
- [ ] 多选节点 → 合并，能生成合并节点，LLM 上下文包含多路来源
- [ ] 切换项目后，画布数据正确切换，原项目防抖改动已落盘（`flushCurrentProject`）
- [ ] 关闭浏览器再打开，项目列表与节点数据完整（localStorage 持久化生效）
- [ ] 深色 / 浅色主题切换正常，刷新后保持
- [ ] 中文 / 英文切换正常，刷新后保持
- [ ] 移动端（窄屏）侧边栏可开关，三点菜单可见可点
- [ ] React Flow 水印在画布右下角可见（合规要求）
- [ ] 隐私模式 / localStorage 满：写入静默失败不崩溃，控制台无 unhandled rejection
- [ ] AI 清理蛛网：派生新项目 `projectType: 'derived-pruned'`，原项目保留不变
