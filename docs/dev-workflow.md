# 开发工作流规范

> **v7.0 PR 驱动制** — 用 GitHub 原生能力替代手工协作机制。

## 核心原则：分支隔离 + 权限收敛

### 执行岗（AI）权限边界
- ✅ 创建新分支（feat/fix/chore 等前缀）
- ✅ 在本地提交代码（Commit）
- ✅ 推送到开发分支（Push to Feature Branch）
- ✅ 自动创建 Pull Request
- ✅ CI 失败后自动修复（最多 3 次）
- ❌ 禁止直接推送到 main
- ❌ 禁止自动合并 PR
- ❌ 禁止触发生产环境部署

### 秘书长（AI）权限边界
- ✅ 审查 PR 代码差异（Diff Review）
- ✅ 合并代码到主分支（gh pr merge）
- ✅ 拆解任务、写任务书
- ❌ 不写产品代码

### 总经理（人）权限边界
- ✅ 提需求、最终决策
- ✅ 验收
- ✅ 手动中断自动修复循环

### 文档更新例外
- **纯文档更改**（`*.md` 文件）无需走 PR 流程，可直接提交到 main
- 包括：README.md、docs/ 下的文档、collab/ 下的协作文件、代码注释
- 前提：不涉及代码逻辑、配置、依赖变更

---

## 分支命名规范

| 前缀 | 用途 | 示例 |
|------|------|------|
| `feat/` | 新功能开发 | `feat/batch-toolbar`, `feat/auto-evolve` |
| `fix/` | Bug 修复 | `fix/streaming-error-chunk`, `fix/type-error` |
| `chore/` | 构建/工具/依赖更新 | `chore/update-deps`, `chore/ci-config` |
| `refactor/` | 代码重构（无功能变更） | `refactor/debug-store` |
| `docs/` | 文档更新 | `docs/update-readme` |
| `test/` | 测试相关 | `test/add-unit-tests` |
| `perf/` | 性能优化 | `perf/reduce-bundle-size` |

### 命名规则
- 使用 kebab-case（短横线分隔）
- 全部小写
- 简洁描述变更内容，不超过 50 字符
- 禁止使用 `main`、`master`、`production` 等保留名

---

## 自动化工作流

### 一键推送 + 创建 PR

```bash
# 标准用法
pnpm push:feature feat/fix-streaming "修复 GLM 流式错误 chunk"

# 跳过本地预检
SKIP_CHECK=1 pnpm push:feature fix/type-error

# 仅推送不创建 PR
NO_PR=1 pnpm push:feature chore/update-deps
```

### 脚本自动完成
1. 校验分支名前缀是否合法
2. 从最新 main 创建新分支
3. git add + commit
4. 本地预检（lint + format:check + type-check）
5. push 到远端 origin
6. 自动创建 PR（安装了 gh CLI 时）

---

## CI/CD 流程

### Pull Request 触发
1. **质量检查（quality job）**
   - pnpm install --frozen-lockfile
   - pnpm lint
   - pnpm format:check
   - pnpm type-check
   - pnpm test（vitest run）
   - pnpm build

2. **PR 评论通知（pr-comment job）**
   - CI 通过 → ✅ 绿色评论，等待审查
   - CI 失败 → ❌ 红色评论，附错误摘要和完整日志 Artifact
   - 自动追踪修复重试次数（最多 3 次）

### 合并到 main 触发
1. 质量检查（同上）
2. Cloudflare Pages 自动部署

---

## 自动修复闭环

```
开发分支推送 → CI 运行 → 失败
     ↑                        ↓
     └──  执行岗拉取错误日志  PR 评论（第 N/3 次）
              ↓
         本地修复代码
              ↓
         再次推送分支 ──── CI 重新运行
```

### 安全护栏
- **最多重试 3 次**：超过后在 PR 评论标记「请人工介入」
- **仅修改源码**：自动修复仅修改 `apps/` 下的代码
- **不碰配置文件**：禁止自动修改 CI 配置、部署配置等基础设施
- **禁止 force push**：只能追加提交，不能改写历史

---

## 代码审查清单（秘书长用）

合并 PR 前检查：
- [ ] CI 全部通过（绿色 ✅）
- [ ] Diff 范围符合预期，没有意外变更
- [ ] 没有硬编码的密钥/Token
- [ ] 类型安全，没有新增 `any`
- [ ] 关键逻辑有合理的注释
- [ ] 不包含破坏性变更（如有，是否已标记）
- [ ] SSR 安全（localStorage/navigator 在 useEffect 中）
- [ ] 流式请求接入 AbortController

---

## 常用命令速查

```bash
# 本地开发
pnpm dev              # 开发模式

# 质量检查（与 CI 一致）
pnpm lint             # ESLint
pnpm format:check     # Prettier 格式校验
pnpm type-check       # TypeScript 类型检查
pnpm test             # vitest 单元测试
pnpm build            # 生产构建

# 格式化代码
pnpm format           # Prettier 格式化

# 推送开发分支 + 创建 PR
pnpm push:feature feat/xxx "描述"
```

---

## 自动化经验总结

### 1. PR 创建前确保从最新 main 创建分支

```bash
git checkout main
git pull
git checkout -b feat/xxx
```

`push-feature.mjs` 脚本已自动处理此步骤。

### 2. gh CLI 路径问题

Trae IDE 终端可能未继承最新的系统 PATH，导致 `gh` 命令找不到。

**解决方案**：
- 用完整路径调用：`& "C:\Program Files\GitHub CLI\gh.exe" pr create ...`
- 或重启 IDE 让终端重新加载 PATH

### 3. PR 创建后应等待 CI 完成

```bash
# 创建 PR
gh pr create --base main --head <branch> --title "..." --body "..."
# 等待 CI 完成
gh pr checks <PR编号> --watch
# CI 全绿后再通知秘书长合并
```

### 4. PowerShell commit message

PowerShell 不支持 heredoc，commit message 用多个 `-m` 参数传递：
```bash
git commit -m "feat: 标题" -m "描述行1" -m "描述行2"
```
