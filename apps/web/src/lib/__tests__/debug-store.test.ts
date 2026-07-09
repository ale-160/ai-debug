// ============================================================
// AI Debug — debug-store 单元测试
//
// 任务来源：260707-T005 / 260707-004（Zustand store 测试）
//
// 覆盖：
//   1. forkBranch（createTurnNode 子节点）/ mergeBranches（createMergedNode）的
//      pathSummary 继承所需的字段（parentId / mergedFromIds）—— store 不直接
//      生成 pathSummary（由 path-summary-engine 异步生成），但需正确写入
//      parentId / mergedFromIds 作为引擎输入
//   2. turnCounter 在项目切换时重置 / 恢复（持久化）
//   3. autoEvolution 生命周期：start / pause / stop / done / step / branches
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';

// 启用 zustand mock：包裹真实 create 以捕获初始状态，afterEach 自动重置
vi.mock('zustand', async () => {
  const { createZustandMockFactory } = await import('@/__mocks__/zustand');
  return createZustandMockFactory();
});

import { useDebugStore } from '../debug-store';

beforeEach(() => {
  // persist 接管后：store.projects 由 persist 管理，测试前清空 store.projects
  useDebugStore.setState({ projects: [], currentProjectId: null, turnCounter: 0 });
});

describe('createTurnNode / createMergedNode - pathSummary 继承字段', () => {
  it('createTurnNode 子节点正确写入 parentId，作为 pathSummary 继承链路的基础', () => {
    const store = useDebugStore.getState();
    const rootId = store.createTurnNode('根节点问题', null);
    const childId = store.createTurnNode('追问', rootId);

    const root = useDebugStore.getState().nodes.find((n) => n.id === rootId)!;
    const child = useDebugStore.getState().nodes.find((n) => n.id === childId)!;

    // pathSummary 引擎依赖 parentId 链路收集路径，子节点必须保留 parentId
    expect(root.data.parentId).toBeNull();
    expect(child.data.parentId).toBe(rootId);
    // 新建节点不带 pathSummary（由 path-summary-engine 异步回填）
    expect(root.data.pathSummary).toBeUndefined();
    expect(child.data.pathSummary).toBeUndefined();
  });

  it('createMergedNode 写入 mergedFromIds + parentId=null，作为合并 pathSummary 聚合的输入', () => {
    const store = useDebugStore.getState();
    const aId = store.createTurnNode('分支 A 问题', null);
    const bId = store.createTurnNode('分支 B 问题', null);
    const mergeId = store.createMergedNode([aId, bId], '结合 A 和 B 给出综合结论');

    const merged = useDebugStore.getState().nodes.find((n) => n.id === mergeId)!;

    // path-summary-engine.generatePathSummary 通过 mergedFromIds 收集各来源 pathSummary
    expect(merged.data.mergedFromIds).toEqual([aId, bId]);
    // 合并节点作为新支线根，parentId 必须为 null
    expect(merged.data.parentId).toBeNull();
    // userMessage 即合并意图
    expect(merged.data.userMessage).toBe('结合 A 和 B 给出综合结论');
    // 新建合并节点不带 pathSummary
    expect(merged.data.pathSummary).toBeUndefined();
  });

  it('父节点 pathSummary 经 updateTurnNode 写入后，子节点 pathSummary 仍为空（引擎异步回填）', () => {
    const store = useDebugStore.getState();
    const rootId = store.createTurnNode('根', null);
    const childId = store.createTurnNode('追问', rootId);

    // 模拟引擎给根节点生成 pathSummary 后通过 updateTurnNode 回填
    useDebugStore.getState().updateTurnNode(rootId, {
      pathSummary: '已确立：根结论 X',
      assistantMessage: '根回答',
      status: 'success',
    });

    const root = useDebugStore.getState().nodes.find((n) => n.id === rootId)!;
    const child = useDebugStore.getState().nodes.find((n) => n.id === childId)!;

    expect(root.data.pathSummary).toBe('已确立：根结论 X');
    // 子节点不会自动继承 pathSummary（store 不做这件事，是引擎职责）
    expect(child.data.pathSummary).toBeUndefined();
    // 但 parentId 链路保留，引擎可沿链路收集父 pathSummary
    expect(child.data.parentId).toBe(rootId);
  });
});

describe('turnCounter - 项目切换重置 / 恢复', () => {
  it('incrementTurnCounter 累加计数', () => {
    expect(useDebugStore.getState().turnCounter).toBe(0);
    useDebugStore.getState().incrementTurnCounter();
    useDebugStore.getState().incrementTurnCounter();
    expect(useDebugStore.getState().turnCounter).toBe(2);
  });

  it('切换到已有项目时，恢复该项目持久化的 turnCounter', () => {
    // persist 接管后：用 store.createProject 创建项目（直接写入 store.projects）
    const projectAId = useDebugStore.getState().createProject('项目 A');
    useDebugStore.getState().incrementTurnCounter();
    useDebugStore.getState().incrementTurnCounter();
    useDebugStore.getState().incrementTurnCounter();
    expect(useDebugStore.getState().turnCounter).toBe(3);
    useDebugStore.getState().saveProject(); // 持久化 turnCounter 到 store.projects

    // 切换到项目 B（新建）→ turnCounter 应回到 0
    useDebugStore.getState().createProject('项目 B');
    expect(useDebugStore.getState().turnCounter).toBe(0);

    // 切换回项目 A → turnCounter 应恢复为 3
    useDebugStore.getState().loadProject(projectAId);
    expect(useDebugStore.getState().turnCounter).toBe(3);
  });

  it('startNewProject 进入草稿态时，turnCounter 归零', () => {
    useDebugStore.getState().createProject('某项目');
    useDebugStore.getState().incrementTurnCounter();
    useDebugStore.getState().incrementTurnCounter();
    expect(useDebugStore.getState().turnCounter).toBe(2);

    useDebugStore.getState().startNewProject();
    expect(useDebugStore.getState().turnCounter).toBe(0);
    expect(useDebugStore.getState().currentProjectId).toBeNull();
  });

  it('loadProject 持久化字段缺失时回退到 0', () => {
    // persist 接管后：手动构造无 turnCounter 字段的项目写入 store.projects
    useDebugStore.getState().createProject('老项目');
    const currentId = useDebugStore.getState().currentProjectId!;
    // 模拟旧数据未持久化 turnCounter：直接修改 store.projects 中项目的字段
    useDebugStore.setState((state) => ({
      projects: state.projects.map((p) =>
        p.id === currentId ? { ...p, turnCounter: undefined } : p,
      ),
    }));
    // 切走再切回，验证 turnCounter 缺失时回退到 0
    useDebugStore.getState().startNewProject();
    useDebugStore.getState().loadProject(currentId);
    expect(useDebugStore.getState().turnCounter).toBe(0);
  });
});

describe('autoEvolution - 生命周期', () => {
  it('startAutoEvolution 设置 running + 初始化进度', () => {
    useDebugStore.getState().startAutoEvolution(10, 3);
    const state = useDebugStore.getState().autoEvolutionState;
    expect(state.status).toBe('running');
    expect(state.maxSteps).toBe(10);
    expect(state.activeBranches).toBe(3);
    expect(state.currentStep).toBe(0);
  });

  it('pauseAutoEvolution 切换为 paused，保留进度', () => {
    useDebugStore.getState().startAutoEvolution(10, 3);
    useDebugStore.getState().setAutoEvolutionStep(5);
    useDebugStore.getState().pauseAutoEvolution();

    const state = useDebugStore.getState().autoEvolutionState;
    expect(state.status).toBe('paused');
    // 进度保留
    expect(state.currentStep).toBe(5);
    expect(state.maxSteps).toBe(10);
    expect(state.activeBranches).toBe(3);
  });

  it('resumeAutoEvolution 从 paused 回到 running', () => {
    useDebugStore.getState().startAutoEvolution(10, 3);
    useDebugStore.getState().pauseAutoEvolution();
    useDebugStore.getState().resumeAutoEvolution();
    expect(useDebugStore.getState().autoEvolutionState.status).toBe('running');
  });

  it('stopAutoEvolution 归零到 idle，清空进度', () => {
    useDebugStore.getState().startAutoEvolution(10, 3);
    useDebugStore.getState().setAutoEvolutionStep(7);
    useDebugStore.getState().stopAutoEvolution();

    const state = useDebugStore.getState().autoEvolutionState;
    expect(state.status).toBe('idle');
    expect(state.currentStep).toBe(0);
    expect(state.maxSteps).toBe(0);
    expect(state.activeBranches).toBe(0);
  });

  it('doneAutoEvolution 切换为 done，保留进度供 UI 展示总结', () => {
    useDebugStore.getState().startAutoEvolution(10, 3);
    useDebugStore.getState().setAutoEvolutionStep(10);
    useDebugStore.getState().doneAutoEvolution();

    const state = useDebugStore.getState().autoEvolutionState;
    expect(state.status).toBe('done');
    expect(state.currentStep).toBe(10);
    expect(state.maxSteps).toBe(10);
  });

  it('setAutoEvolutionActiveBranches 递减活跃路数', () => {
    useDebugStore.getState().startAutoEvolution(10, 3);
    useDebugStore.getState().setAutoEvolutionActiveBranches(2);
    expect(useDebugStore.getState().autoEvolutionState.activeBranches).toBe(2);
    useDebugStore.getState().setAutoEvolutionActiveBranches(0);
    expect(useDebugStore.getState().autoEvolutionState.activeBranches).toBe(0);
  });

  it('setAutoEvolutionStep 更新当前步数', () => {
    useDebugStore.getState().startAutoEvolution(10, 3);
    for (let i = 1; i <= 5; i++) {
      useDebugStore.getState().setAutoEvolutionStep(i);
    }
    expect(useDebugStore.getState().autoEvolutionState.currentStep).toBe(5);
  });
});
