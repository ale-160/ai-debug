# 贡献指南

感谢你对 蛛网 · AI Debug 的关注！欢迎任何形式的贡献。

## 快速贡献

### 报告问题

- 在 [GitHub Issues](https://github.com/ale-160/ai-debug/issues) 提交 issue
- 请描述：复现步骤、预期行为、实际行为、浏览器/系统版本
- 若有报错截图或控制台日志，请一并附上

### 提交 Pull Request

1. Fork 仓库并克隆到本地
2. 创建分支：`git checkout -b feat/your-feature` 或 `fix/your-bugfix`
3. 在 `apps/web` 目录下开发
4. 提交前请确保：
   - `pnpm --filter @ai-debug/web exec tsc --noEmit` 无报错
   - `pnpm --filter @ai-debug/web lint` 无严重警告
5. 提交清晰的 commit message（中英文均可）
6. 发起 PR，描述改动内容和动机

## 基本规范

### 代码风格

- TypeScript 优先，避免 any
- 新增函数需有简短注释说明用途
- React 组件使用函数式 + Hooks
- 状态管理统一走 Zustand store，不直接读 localStorage（存储层除外）

### 提交信息

格式不强制，但建议清晰：

- `feat: 新增 xxx 功能`
- `fix: 修复 xxx 问题`
- `docs: 更新文档`
- `refactor: 重构 xxx`

### 分支命名

- 功能：`feat/xxx`
- 修复：`fix/xxx`
- 文档：`docs/xxx`

## 开发环境

- Node.js ≥ 22
- pnpm ≥ 9

```bash
pnpm install
cd apps/web
pnpm dev
```

## 项目结构概览

详见 [README.md](./README.md) 的「项目结构」章节。核心代码在 `apps/web/src/`，分为 `components/`（UI 组件）和 `lib/`（业务逻辑）两层。

## 行为准则

- 保持友善和尊重
- 对新手友好，耐心解答
- 聚焦问题本身，不对人

再次感谢你的贡献！
