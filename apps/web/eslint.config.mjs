// ============================================================
// AI Debug (web) — ESLint Flat Config
//
// 注：Next.js 16 已移除 `next lint` 子命令（next CLI 仅保留 build/dev/start
// 等），故 package.json 的 lint 脚本改为直接调用 `eslint .`，由本 flat config
// 驱动。基于 eslint-config-next@16 原生 flat config（含 core-web-vitals
// + TypeScript + react + react-hooks + jsx-a11y + import 规则），
// 叠加以下严格规则：
// - no-unused-vars：error（未使用变量必须移除或前缀 _）
// - consistent-type-imports：error（强制 type-only import）
// - no-console：error（仅允许 warn/error）
// - prefer-const / no-var / eqeqeq：error（eqeqeq 允许 != null 惯用模式）
// - react-hooks/rules-of-hooks：error（hooks 调用规则）
// - react-hooks/exhaustive-deps：warn（依赖完整性）
//
// 关闭的规则（代码库历史原因，精确化风险高或属合法模式）：
// - react-hooks/set-state-in-effect：合法 prop-sync 模式（节点切换清空缓存等）
// - react/no-array-index-key：静态列表 index 是合理 key
// ============================================================

import nextConfig from 'eslint-config-next';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

const eslintConfig = [
  ...nextConfig,
  {
    // 启用 typescript-eslint 的 type-aware linting（projectService），
    // 供 no-floating-promises 等需要类型信息的规则使用。
    // projectService 自动从最近的 tsconfig.json 构建程序，无需手动指定 project。
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      // ===== TypeScript 严格规则 =====
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        // disallowTypeAnnotations: false 允许 `typeof import('mod')` 类型注解，
        // 动态导入场景（dagre 等）需要此语法获取模块类型
        { prefer: 'type-imports', fixStyle: 'inline-type-imports', disallowTypeAnnotations: false },
      ],
      // 节点 config 为动态结构，历史代码大量使用 any；先 warn 不阻断，引导逐步消除
      '@typescript-eslint/no-explicit-any': 'warn',
      // 浮动 Promise（未 await/return/catch 的 Promise 调用）容易吞异常，先 warn
      '@typescript-eslint/no-floating-promises': 'warn',

      // ===== JS 通用严格规则 =====
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-var': 'error',
      'prefer-const': ['error', { destructuring: 'all' }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-debugger': 'error',
      'no-duplicate-imports': 'error',

      // ===== React 严格规则 =====
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // 合法 prop-sync 模式（节点切换清空缓存、加载前 setLoading 等），
      // react-hooks v7 此规则过于严格，关闭避免误报
      'react-hooks/set-state-in-effect': 'off',
      'react/jsx-key': 'error',
      // 静态列表（不会重排/插入/删除），index 是合理 key
      'react/no-array-index-key': 'off',
    },
  },
  {
    // 额外忽略构建产物与配置文件
    ignores: [
      '**/.next/**',
      '**/out/**',
      '**/node_modules/**',
      '**/*.config.js',
      '**/*.config.mts',
      '**/*.config.mjs',
    ],
  },
  // eslint-config-prettier：关闭与 Prettier 冲突的格式化规则（放最后，覆盖前面的格式规则）
  prettierConfig,
];

export default eslintConfig;
