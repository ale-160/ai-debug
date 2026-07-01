# AGENTS.md

本文件为 AI 协作工具（如 Trae、Cursor、Copilot 等）提供项目协作上下文。

## 项目简介

蛛网 · AI Debug —— 蛛网式 AI 对话上下文管理工具。把 AI 对话从线性列表变成 git 仓库式的蛛网结构，每个分支独立维护自己的上下文路径。

- 在线体验：<https://ai-debug.ale160.com>
- 仓库：<https://github.com/ale-160/ai-debug>

## 技术栈

- Next.js 16 (App Router, `output: 'export'`) + React 18 + TypeScript 5
- React Flow 11（画布与节点）
- Zustand 5（状态管理，单一数据源）
- Tailwind CSS 3（样式 + 深色模式）
- 浏览器 localStorage（无后端依赖）

## 项目结构

```
apps/web/src/
├── app/                 # Next.js App Router 入口
├── components/
│   ├── node-flow/       # 蛛网画布核心（DebugFlowEditor / NodeCanvas / NodeInspector / NodeSidebar）
│   ├── SettingsModal.tsx
│   ├── StorageManager.tsx
│   ├── MemoryPanel.tsx
│   └── ThemeProvider.tsx
└── lib/
    ├── debug-store.ts       # Zustand store（节点 / 项目 / 设置 / 记忆）
    ├── network-engine.ts    # 流式调用 + 上下文路径收集（collectContextPath）
    ├── llm-client.ts         # OpenAI 兼容客户端
    ├── llm-config.ts         # 服务商预设（mimo / volcengine / deepseek …）
    ├── llm-helpers.ts        # 摘要生成 + 建议方向解析
    ├── memory-engine.ts      # 记忆提取 + 上下文构建
    ├── conflict-engine.ts    # 支线冲突检测
    ├── network-pruner.ts     # AI 清理蛛网派生逻辑
    ├── project-storage.ts    # 项目 localStorage 持久化
    └── settings-storage.ts   # 全局设置 / 记忆持久化
```

## 开发约定

- **状态管理**：统一走 Zustand store，不直接读 localStorage（存储层除外）
- **SSR 安全**：依赖 localStorage 的值必须在 `useEffect` 中加载，不能作为 useState 初始值（会触发 hydration mismatch）
- **流式请求**：所有 `streamTurnResponse` 调用应接入 AbortController，发起新请求前取消旧请求
- **TypeScript**：避免 `any`，新增函数需有简短注释说明用途
- **自动保存**：nodes/edges 防抖 500ms，viewport 防抖 800ms，草稿态（currentProjectId 为空）不保存

## 常用命令

```bash
# 安装依赖
pnpm install

# 开发（必须进入 apps/web）
cd apps/web && pnpm dev

# 类型检查
pnpm --filter @ai-debug/web exec tsc --noEmit

# 构建
pnpm --filter @ai-debug/web build
```

## 关键设计决策

1. **上下文路径**：`collectContextPath` 从根沿 `parentId` 链收集，只把当前路径喂给 LLM，不污染其他分支
2. **合并节点**：`mergedFromIds` 字段支持多路上下文，但冲突检测仅分析主干路径（已知限制）
3. **AI 清理蛛网**：不删除原项目，派生新项目（`projectType: 'derived-pruned'`），保留 `originalProjectId`
4. **记忆默认关闭**：需在设置中手动开启全局/项目记忆
5. **数据本地化**：所有数据存 localStorage，无后端，API Key 仅本地存储

## 联系方式

- 邮箱：ale160@126.com
