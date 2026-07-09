// ============================================================
// AI Debug (web) — Zustand 测试 mock 工厂
//
// 任务来源：260707-T005 / 260707-004（Zustand store 测试）
//
// 用法（测试文件顶部）：
//   import { vi } from 'vitest';
//   vi.mock('zustand', async () => {
//     const { createZustandMockFactory } = await import('@/__mocks__/zustand');
//     return createZustandMockFactory();
//   });
//
// 行为：
//   - 包裹真实 create（actualCreate），捕获每个 store 的初始状态
//   - 注册到 storeResetFns，由 setup.ts 的 afterEach 调用 resetAllStores 重置
//   - 避免测试间状态污染（store 是单例）
//
// 注：通过 vi.importActual 拿到真实 zustand，避免 mock 自指递归。
// 文件未放在 root `__mocks__/`（vitest 自动发现位置），故采用工厂显式注入。
// ============================================================
import { vi } from 'vitest';
import type {
  StoreApi,
  UseBoundStore,
  StateCreator,
  createStore as _CreateStoreType,
  useStore as _UseStoreType,
} from 'zustand';

/** 真实 zustand 模块的命名导出类型（用于扩展而不重写） */
type ZustandModule = {
  create: <T>(stateCreator: StateCreator<T>) => UseBoundStore<StoreApi<T>>;
  createStore: typeof _CreateStoreType;
  useStore: typeof _UseStoreType;
};

/** 已注册的 store 重置函数集合 */
const storeResetFns = new Set<() => void>();

/**
 * 重置所有已注册的 store 到初始状态。
 * setup.ts 的 afterEach 调用，确保下一用例从干净态开始。
 */
export function resetAllStores(): void {
  storeResetFns.forEach((resetFn) => resetFn());
  storeResetFns.clear();
}

/**
 * 构造 vi.mock('zustand') 工厂对象。
 * 返回的对象会替换真实 zustand 模块的所有命名导出。
 *
 * create 支持两种调用形式（与 zustand 5 真实 create 一致）：
 *   1. 直接调用：create<T>(stateCreator)
 *   2. curried（中间件场景）：create<T>()(stateCreator)
 * 两种形式都会捕获初始状态并注册重置函数。
 */
export async function createZustandMockFactory(): Promise<ZustandModule> {
  const actual = await vi.importActual<ZustandModule>('zustand');
  const actualCreate = actual.create;

  /** 内部工具：包裹 stateCreator，捕获初始状态并注册重置函数 */
  function makeStore<T>(stateCreator: StateCreator<T>): UseBoundStore<StoreApi<T>> {
    const store = actualCreate<T>(stateCreator);
    const initialState = store.getState();
    storeResetFns.add(() => {
      store.setState(initialState, true);
    });
    return store;
  }

  // 重载：支持 create<T>() 和 create<T>(stateCreator) 两种调用形式。
  // curried 形式 create<T>()(...args) 由 devtools 等中间件使用，
  // 中间件最终会调用内层 stateCreator，故 mock 仅需包裹最内层 stateCreator。
  function create<T>(): (stateCreator: StateCreator<T>) => UseBoundStore<StoreApi<T>>;
  function create<T>(stateCreator: StateCreator<T>): UseBoundStore<StoreApi<T>>;
  function create<T>(stateCreator?: StateCreator<T>) {
    if (stateCreator !== undefined) {
      return makeStore<T>(stateCreator);
    }
    // curried：返回一个函数，接收 stateCreator 并包裹
    return (sc: StateCreator<T>) => makeStore<T>(sc);
  }

  return {
    ...actual,
    create,
  };
}
