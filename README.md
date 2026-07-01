# 蛛网 · AI Debug

[English](./README.en.md) | 中文

> 把 AI 对话从线性列表变成 git 仓库式的蛛网结构。

[![Deploy](https://img.shields.io/badge/Next.js-16.2.6-black)](https://nextjs.org)
[![Stack](https://img.shields.io/badge/React-18-blue)](https://react.dev)
[![Canvas](https://img.shields.io/badge/React%20Flow-11-orange)](https://reactflow.dev)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

**在线体验**：<https://ai-debug.ale160.com>

## 这是什么

一个**蛛网式的 AI 对话上下文管理工具**。

所有 LLM 产品的对话都是线性的：聊天记录像一盘磁带，只能"播放"和"清空"。当问题变复杂时（比如 Bug 排查），历史会越积越臃肿，模型不得不在无关的噪音里找答案，精度不可避免地下降。

`蛛网` 把对话组织成一张可交互的拓扑图：每个分支独立维护自己的上下文路径，可以随时回退、分叉、合并、放弃、恢复。**推理时只把当前这条路径上的"干净上下文"喂给模型**，让每一次提问都只继承必须知道的前置条件。

这不是"更好的聊天界面"，而是把 LLM 的上下文窗口从黑箱变成用户可操作的工作区。

## 核心理念：对话的 Git 仓库

| Git 概念 | 蛛网对应 | 用户价值 |
| --- | --- | --- |
| `branch` | 从任意节点分叉新支线 | 探索不同方向，互不干扰 |
| `commit` | 每个 TurnNode 一次对话回合 | 每次交互都有完整记录 |
| `log` | 根 → 当前节点的上下文路径 | 每条支线的来龙去脉清晰可见 |
| `checkout` | 点击任意节点，在右侧面板查看/继续 | 随时回退到任意"提交"继续工作 |
| `revert` / `reset` | 放弃此支线（abandoned） | 放弃错误方向，但保留记录 |
| `merge` | 合并多路分支为新节点 | 汇聚不同支线的结论 |
| `diff` | 冲突检测 | 评估同条路径前后是否矛盾 |

## 核心功能

### 蛛网画布
- 基于辐射布局自动展开节点，分支清晰可见
- 选择模式 / 抓手模式两种交互（`V` / `H` 切换，`Space` 临时抓手）
- 快捷键：`F` 适应视图、`Delete` 删除选中、输入框内不触发画布快捷键
- 自动保存：节点 / 边变化防抖 500ms，视口变化防抖 800ms
- 草稿态不保存，首条消息绑定项目后才启用自动保存

### 节点与分支
- **建议方向卡片**：AI 回答后给出下一步方向，点击不直接发起，填入输入框后由用户点击"继续追问"触发
- **继续追问**：沿当前节点向下追问，生成新子节点
- **重新生成**：对当前回答不满意时，可补充内容后重新生成（自动取消前一次流式请求，避免新旧内容交错）
- **分叉支线**：从任意节点新起支线，换方向继续
- **合并分支**：选中多个节点合并为新节点，构建多路上下文（已知限制：冲突检测仅分析主干路径）
- **放弃 / 恢复**：标记支线为 abandoned，视觉降级但保留记录，可随时恢复
- **忽略节点**：构建上下文时跳过该节点，子节点照常运行

### 上下文路径
- `collectContextPath`：从根沿 `parentId` 链收集到当前节点的完整上下文
- 推理时只注入当前路径，不污染其他分支
- 支持合并节点的多路上下文（`mergedFromIds`）

### 记忆与规则（Beta）
- **全局规则**：用户可编辑的元提示词片段，注入到每个 system prompt
- **全局记忆**：跨项目共享的长期记忆条目
- **项目记忆**：单项目内的记忆条目
- **按频率自动提取**：每 N 轮（可配置）自动从对话中提取记忆条目
- **冲突自动检测**：每 N 轮自动检测当前支线前后矛盾
- 记忆默认关闭，需在设置中手动开启

### AI 清理蛛网
- 当节点 ≥ 10 时，侧边栏出现"AI 清理蛛网"按钮
- AI 分析整张蛛网，识别重复 / 死胡同支线
- **不直接删除**原项目，而是派生一个精简版新项目（`projectType: derived-pruned`），保留 `originalProjectId` 链接
- 完美复刻 Git 的"工作区 / 历史记录"分离思想：把修剪变成派生，把删除变成存档

### 双模式开关
- 详细模式：完整渲染 Markdown 回答 + 建议方向卡片
- 紧凑模式：极简节点，适合大画布浏览

## 技术栈

- **前端**：Next.js 16（Turbopack）+ React 18 + TypeScript 5
- **画布**：React Flow 11（辐射布局 + DAG 节点）
- **状态**：Zustand 5（单一数据源，避免 localStorage 直读）
- **样式**：Tailwind CSS 3 + 深色模式
- **存储**：浏览器 localStorage（无后端依赖，开箱即用）
- **流式**：OpenAI 兼容 SSE，支持 AbortController 取消

## 项目结构

```
ai-debug/
├── apps/
│   └── web/                         # Next.js 应用
│       └── src/
│           ├── app/                 # App Router 入口
│           ├── components/
│           │   ├── node-flow/       # 蛛网画布核心
│           │   │   ├── DebugFlowEditor.tsx   # 顶层容器 + TopNav + EmptyStateInput
│           │   │   ├── NodeCanvas.tsx        # 画布 + 自动保存 + 合并分支
│           │   │   ├── NodeInspector.tsx     # 右侧节点详情面板
│           │   │   ├── NodeSidebar.tsx       # 左侧项目列表 + 三点菜单 + 导入
│           │   │   ├── nodes/TurnNode.tsx   # 单节点渲染
│           │   │   ├── radial-layout.ts     # 辐射布局算法
│           │   │   └── types.ts             # TurnNode / NetworkProject 类型
│           │   ├── SettingsModal.tsx # 设置模态框（API / 记忆 & 规则）
│           │   └── MemoryPanel.tsx   # 记忆管理面板
│           └── lib/
│               ├── debug-store.ts       # Zustand store（节点 / 项目 / 设置）
│               ├── network-engine.ts    # 流式调用 + 上下文路径收集
│               ├── llm-client.ts        # OpenAI 兼容客户端
│               ├── llm-config.ts        # 服务商预设（mimo / 火山 / DeepSeek…）
│               ├── llm-helpers.ts        # 摘要生成 + 建议方向解析
│               ├── memory-engine.ts      # 记忆提取 + 上下文构建
│               ├── conflict-engine.ts    # 支线冲突检测
│               ├── network-pruner.ts     # AI 清理蛛网派生逻辑
│               ├── project-storage.ts    # 项目 localStorage 持久化
│               └── settings-storage.ts   # 全局设置 / 记忆持久化
└── package.json                      # pnpm workspace 根
```

## 快速开始

### 环境要求
- Node.js ≥ 22
- pnpm ≥ 9

### 安装与运行

```bash
# 在仓库根目录
pnpm install

# 启动开发服务器（根目录或 apps/web 下均可）
pnpm dev
```

打开 [http://localhost:3000](http://localhost:3000)。

> ⚠️ 根目录的 `pnpm dev` 会通过 `pnpm --filter @ai-debug/web dev` 转发到 `apps/web`。若提示端口被占用，用 `taskkill /PID <pid> /F` 结束占用进程，或直接 `cd apps/web && pnpm dev`。

### 配置 API Key

首次打开会提示未配置。点击右上角"未配置"或设置按钮，选择服务商：

| 服务商 | 默认模型 | 获取方式 |
| --- | --- | --- |
| Xiaomi MiMo | mimo-v2.5 | [platform.xiaomimimo.com](https://platform.xiaomimimo.com?ref=HVJJGY)（含邀请码，可获 ¥10 体验金） |
| 火山方舟 | doubao-seed-2.0 | [volcengine.com](https://volcengine.com/L/uH3ewWuCZDw/)（邀请码 K42LBHZY，订阅叠加 9.5 折） |
| OpenRouter | nvidia/nemotron-3-ultra-550b-a55b:free | [openrouter.ai/keys](https://openrouter.ai/keys) |
| DeepSeek | deepseek-v4-flash | [platform.deepseek.com](https://platform.deepseek.com/api_keys) |
| OpenAI | gpt-4o-mini | [platform.openai.com](https://platform.openai.com/api-keys) |
| 自定义 | — | 任意 OpenAI 兼容端点 |

API Key 仅存储在浏览器 `localStorage`，不经过任何服务器。

## 使用流程

1. **新建项目**：侧边栏"新建项目"进入草稿态画布 → 输入首条问题 → 自动绑定项目
2. **追问 / 分叉**：点击节点 → 右侧面板 → 输入框或点击建议方向卡片 → "继续追问"
3. **放弃支线**：选中节点 → "放弃此支线" → 视觉降级但保留
4. **合并分支**：Shift+点击选中多个节点 → "合并分支" → 输入意图 → AI 综合多路上下文
5. **清理蛛网**：节点 ≥ 10 时侧边栏出现"AI 清理蛛网"按钮 → 派生精简版新项目

## 部署

纯静态前端，可部署到任意支持 Next.js 的平台：

```bash
cd apps/web
pnpm build
```

推荐 [Cloudflare Pages](https://pages.cloudflare.com) 或 [Vercel](https://vercel.com)。

## 已知限制

- **冲突检测不展开合并节点多路**：合并节点的冲突检测仅分析 `parentId` 主干路径，不展开 `mergedFromIds` 多路（UI 已提示）
- **流式摘要可能丢失**：摘要生成是旁路调用，若用户在摘要完成前切换项目，摘要会丢失（设计上接受的 tradeoff）
- **localStorage 容量**：所有数据存储在浏览器本地，单项目过大可能触发配额限制

## 隐私声明

本项目高度重视您的隐私，所有数据均存储在您本地的浏览器中。

### 数据存储

- **所有数据均存储在浏览器 localStorage 中**：项目、节点、记忆、设置等全部保留在本地，不会上传到任何服务器
- **API Key 仅存于本地**：您配置的 LLM 服务商 API Key 仅保存在浏览器 localStorage，不会经过本项目的任何后端（本项目无后端）
- **数据可控**：您可以随时在「设置 → 数据管理」中查看存储占用、按分类清理或清空全部数据

### 数据流向

- **您输入的对话内容**会直接发送给您配置的 LLM 服务商（如 Xiaomi MiMo、火山方舟、DeepSeek 等），用于生成 AI 回答
- **流式请求**通过浏览器直接发往服务商 API，不经过任何中间代理
- **本项目的 GitHub 仓库与部署站点**不收集、不存储、不分析您的对话内容

### 第三方服务

- 您选择的 LLM 服务商将接收您的对话内容用于推理，其数据处理受该服务商隐私政策约束
- 部署站点（如 Cloudflare Pages）仅托管静态资源，不涉及动态数据收集

如对隐私有疑问，请联系：[ale160@126.com](mailto:ale160@126.com)

## 设计哲学

这个项目不解决 LLM 的幻觉，解决的是**上下文混乱**。

当用户面对复杂问题时，传统的线性对话逼迫模型在无关的历史噪音中寻找答案。而蛛网让每一个新的提问，都只继承"必须知道的前置条件"，把被浪费的上下文窗口重新还给核心逻辑。

这不是聊天，是对 LLM 算力的精确调度。

## License

MIT

> **PS**：本项目采用 MIT 协议开源，不设强制约束。如基于本项目二次开发或部署，建议保留出处（仓库链接 <https://github.com/ale-160/ai-debug> 与作者署名 `ale-160`），让更多人知道这个"蛛网式对话"的想法能走多远。君子自重，感谢理解。

## 联系方式

如有问题、建议或反馈，欢迎通过以下方式联系我们：

- 📧 邮箱：[ale160@126.com](mailto:ale160@126.com)

---

## 支持与赞助 💖

如需支持本项目的持续开发，请前往统一赞赏页面：

👉 [https://ale160.com/sponsor](https://ale160.com/sponsor)


---

## 贡献

欢迎贡献！请随时提交 Pull Request。
