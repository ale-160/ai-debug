// ============================================================
// AI Debug (web) — Vitest 配置
//
// environment: jsdom 提供 localStorage / window 等 DOM API
// setupFiles: 注册全局 beforeEach（清空 localStorage）等
// ============================================================
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/__tests__/**/*.test.ts'],
    // 默认 globals: false，显式 import { describe, it, expect } from 'vitest'
    globals: false,
  },
});
