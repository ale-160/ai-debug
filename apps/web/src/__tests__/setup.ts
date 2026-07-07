// ============================================================
// AI Debug (web) — Vitest 全局 setup
//
// - beforeEach：清空 localStorage，避免测试间残留污染
// - afterEach：重置所有 Zustand store（通过 __mocks__/zustand.ts 注册的 resetFns）
//
// 注：jsdom 默认提供 window.localStorage，无需手动 polyfill。
// ============================================================
import { afterEach, beforeEach } from 'vitest';
import { resetAllStores } from '@/__mocks__/zustand';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  resetAllStores();
});
