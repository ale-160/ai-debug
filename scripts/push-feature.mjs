#!/usr/bin/env node
// ============================================================
// push-feature.mjs — 一键推送开发分支 + 创建 PR
//
// 用法：
//   node scripts/push-feature.mjs <branch-name> [commit-message]
//   node scripts/push-feature.mjs feat/fix-streaming "修复 GLM 流式错误 chunk"
//
// 环境变量：
//   SKIP_CHECK=1  跳过本地预检
//   NO_PR=1       仅推送不创建 PR
//
// 功能：
//   1. 校验分支名前缀（feat/ fix/ chore/ refactor/ docs/ test/ perf/）
//   2. 从 main 创建新分支（或切换到已有分支）
//   3. git add + commit
//   4. 本地预检（lint + format:check + type-check）
//   5. git push -u origin
//   6. gh pr create（自动生成 PR 描述）
// ============================================================

import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';

const BRANCH_PREFIXES = ['feat/', 'fix/', 'chore/', 'refactor/', 'docs/', 'test/', 'perf/'];
const PROTECTED_BRANCHES = ['main', 'master'];

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, {
      encoding: 'utf-8',
      stdio: opts.silent ? 'pipe' : 'inherit',
      ...opts,
    }).trim();
  } catch (e) {
    if (opts.ignoreError) return '';
    process.exit(1);
  }
}

function getCurrentBranch() {
  return run('git rev-parse --abbrev-ref HEAD', { silent: true });
}

function getDefaultBranch() {
  try {
    const out = run('git remote show origin', { silent: true });
    const match = out.match(/HEAD branch:\s+(\S+)/);
    return match ? match[1] : 'main';
  } catch {
    return 'main';
  }
}

function validateBranchName(name) {
  if (PROTECTED_BRANCHES.includes(name)) {
    console.error(`❌ 禁止推送到受保护分支: ${name}`);
    process.exit(1);
  }
  const hasValidPrefix = BRANCH_PREFIXES.some((p) => name.startsWith(p));
  if (!hasValidPrefix) {
    console.error(`❌ 分支名必须以以下前缀开头: ${BRANCH_PREFIXES.join(', ')}`);
    console.error('   例如: feat/fix-streaming, fix/type-error');
    process.exit(1);
  }
}

function hasGhCli() {
  try {
    execSync('gh --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function generatePrDescription(baseBranch) {
  const commitMsg = run('git log -1 --pretty=%B', { silent: true }).trim();
  const changedFiles = run(`git diff --name-only ${baseBranch}...HEAD`, { silent: true })
    .trim()
    .split('\n')
    .filter(Boolean);

  let fileSummary = '';
  if (changedFiles.length <= 20) {
    fileSummary = changedFiles.map((f) => `- ${f}`).join('\n');
  } else {
    fileSummary =
      changedFiles
        .slice(0, 20)
        .map((f) => `- ${f}`)
        .join('\n') + `\n... 还有 ${changedFiles.length - 20} 个文件`;
  }

  return `## 变更说明

${commitMsg || '（待填写）'}

## 变更文件

${fileSummary}

## 自检清单

- [ ] 本地 type-check 通过
- [ ] 本地 lint 通过
- [ ] 相关测试通过
- [ ] 不包含任何密钥或敏感信息
`;
}

function main() {
  const args = process.argv.slice(2);
  const branchName = args[0];
  const commitMsg = args[1] || '';
  const skipCheck = process.env.SKIP_CHECK === '1';
  const noPr = process.env.NO_PR === '1';

  if (!branchName) {
    console.log('用法: node scripts/push-feature.mjs <branch-name> [commit-message]');
    console.log('');
    console.log('示例:');
    console.log('  node scripts/push-feature.mjs feat/fix-streaming "修复 GLM 流式错误 chunk"');
    console.log('  SKIP_CHECK=1 node scripts/push-feature.mjs fix/type-error');
    console.log('  NO_PR=1 node scripts/push-feature.mjs chore/update-deps');
    process.exit(1);
  }

  validateBranchName(branchName);

  const defaultBranch = getDefaultBranch();
  const currentBranch = getCurrentBranch();

  console.log(`📋 当前分支: ${currentBranch}`);
  console.log(`🎯 目标分支: ${branchName}`);
  console.log(`📌 基础分支: ${defaultBranch}`);
  console.log('');

  const hasChanges = run('git status --porcelain', { silent: true }).length > 0;
  if (!hasChanges && currentBranch === branchName) {
    console.log('⚠️  没有检测到变更，且已经在目标分支上。无需操作。');
    process.exit(0);
  }

  // 从最新 main 创建分支
  if (currentBranch !== branchName) {
    const exists =
      run(`git rev-parse --verify ${branchName}`, { silent: true, ignoreError: true }).length > 0;
    if (exists) {
      console.log(`🔄 切换到已有分支: ${branchName}`);
      run(`git checkout ${branchName}`);
    } else {
      console.log(`🌱 从 ${defaultBranch} 创建新分支: ${branchName}`);
      run(`git checkout ${defaultBranch}`);
      run('git pull');
      run(`git checkout -b ${branchName}`);
    }
  }

  if (hasChanges || commitMsg) {
    console.log('');
    console.log('📦 暂存所有变更...');
    run('git add -A');

    const msg = commitMsg || `feat: ${branchName.replace(/^feat\//, '').replace(/-/g, ' ')}`;
    console.log(`✍️  提交: ${msg}`);
    run(`git commit -m "${msg.replace(/"/g, '\\"')}"`);
  }

  if (!skipCheck) {
    console.log('');
    console.log('🔍 运行本地预检（与 CI 一致）...');

    const checks = [
      { name: 'Lint', cmd: 'pnpm lint' },
      { name: 'Format check', cmd: 'pnpm format:check' },
      { name: 'Type check', cmd: 'pnpm type-check' },
    ];

    for (const { name, cmd } of checks) {
      console.log(`  ▸ ${name}...`);
      try {
        execSync(cmd, { stdio: 'inherit' });
      } catch (e) {
        console.error(`❌ ${name} 失败！请先修复错误再推送。`);
        console.error('   跳过检查: SKIP_CHECK=1 node scripts/push-feature.mjs ...');
        process.exit(1);
      }
    }
    console.log('✅ 本地预检全部通过');
  } else {
    console.log('⚠️  已跳过本地预检');
  }

  console.log('');
  console.log('🚀 推送到远端...');
  run(`git push -u origin ${branchName}`);

  if (noPr) {
    console.log('');
    console.log('✅ 推送完成（未创建 PR）');
    process.exit(0);
  }

  console.log('');
  if (hasGhCli()) {
    console.log('📝 自动创建 Pull Request...');
    const prDesc = generatePrDescription(defaultBranch);
    const tmpFile = '.tmp-pr-body.md';
    writeFileSync(tmpFile, prDesc);
    try {
      const title = commitMsg || branchName;
      run(
        `gh pr create --base ${defaultBranch} --head ${branchName} --title "${title.replace(/"/g, '\\"')}" --body-file ${tmpFile}`,
      );
      console.log('✅ PR 创建成功！');
    } catch (e) {
      console.warn('⚠️  PR 创建失败，请手动创建');
    } finally {
      try {
        unlinkSync(tmpFile);
      } catch {}
    }
  } else {
    const repoUrl = run('git remote get-url origin', { silent: true }).replace(/\.git$/, '');
    console.log('💡 提示: 安装 GitHub CLI 可自动创建 PR: https://cli.github.com/');
    console.log('');
    console.log(`手动创建 PR: ${repoUrl}/pull/new/${defaultBranch}...${branchName}`);
  }

  console.log('');
  console.log('🎉 完成！等待 CI 运行结果...');
}

main();
