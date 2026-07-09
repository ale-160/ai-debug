// ============================================================
// AI Debug — project-storage 单元测试
//
// 任务来源：260707-T005 / 260707-009（localStorage 模拟）
//
// 覆盖：
//   1. 序列化/反序列化往返：save → load 一致
//   2. 损坏数据兜底：JSON 解析失败 / 非数组 → 返回 []
//   3. CRUD：create / update / delete / get
//   4. importProject：节点/边/视口正确写入
//   5. 容量超限 QuotaExceededError：saveProjects 静默忽略，不抛异常
// ============================================================
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  loadProjects,
  saveProjects,
  createProject,
  updateProject,
  deleteProject,
  getProject,
  importProject,
  PROJECTS_KEY,
} from '../project-storage';
import type { NetworkProject } from '@/components/node-flow/types';

beforeEach(() => {
  window.localStorage.clear();
});

describe('project-storage - 序列化往返', () => {
  it('save → load 数据一致', () => {
    const project: NetworkProject = {
      id: 'proj-1',
      name: '测试项目',
      nodes: [],
      edges: [],
      viewport: { x: 100, y: 200, zoom: 1.5 },
      createdAt: 1000,
      updatedAt: 2000,
      projectType: 'normal',
      memory: [{ id: 'mem-1', content: '记忆条目', createdAt: 3000, source: 'manual' }],
      turnCounter: 5,
    };
    saveProjects([project]);

    const loaded = loadProjects();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toEqual(project);
  });

  it('空数组往返', () => {
    saveProjects([]);
    expect(loadProjects()).toEqual([]);
  });

  it('多项目往返', () => {
    const projects: NetworkProject[] = [
      {
        id: 'p1',
        name: 'A',
        nodes: [],
        edges: [],
        viewport: null,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'p2',
        name: 'B',
        nodes: [],
        edges: [],
        viewport: null,
        createdAt: 2,
        updatedAt: 2,
      },
    ];
    saveProjects(projects);
    const loaded = loadProjects();
    expect(loaded.map((p) => p.id)).toEqual(['p1', 'p2']);
  });
});

describe('project-storage - 损坏数据兜底', () => {
  it('空 localStorage 返回空数组', () => {
    expect(window.localStorage.getItem(PROJECTS_KEY)).toBeNull();
    expect(loadProjects()).toEqual([]);
  });

  it('非 JSON 字符串返回空数组', () => {
    window.localStorage.setItem(PROJECTS_KEY, 'not-json{');
    expect(loadProjects()).toEqual([]);
  });

  it('JSON 但非数组返回空数组', () => {
    window.localStorage.setItem(PROJECTS_KEY, JSON.stringify({ id: 'x' }));
    expect(loadProjects()).toEqual([]);
  });

  it('JSON 数组但元素缺字段，仍按原样返回（projectType 兜底为 normal）', () => {
    // 模拟旧数据：无 projectType 字段
    window.localStorage.setItem(
      PROJECTS_KEY,
      JSON.stringify([
        { id: 'old', name: '旧', nodes: [], edges: [], viewport: null, createdAt: 1, updatedAt: 1 },
      ]),
    );
    const loaded = loadProjects();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].projectType).toBe('normal');
  });
});

describe('project-storage - CRUD', () => {
  it('createProject 创建空项目并写入 storage', () => {
    const project = createProject('新项目');
    expect(project.name).toBe('新项目');
    expect(project.nodes).toEqual([]);
    expect(project.edges).toEqual([]);
    expect(project.projectType).toBe('normal');

    const loaded = loadProjects();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe(project.id);
  });

  it('createProject 名称空白时回退为"未命名项目"', () => {
    const project = createProject('   ');
    expect(project.name).toBe('未命名项目');
  });

  it('createProject 支持 derived-pruned 类型 + originalProjectId', () => {
    const project = createProject('派生', {
      projectType: 'derived-pruned',
      originalProjectId: 'orig-1',
    });
    expect(project.projectType).toBe('derived-pruned');
    expect(project.originalProjectId).toBe('orig-1');
  });

  it('updateProject 合并字段并更新 updatedAt', () => {
    const project = createProject('原');
    const beforeTs = project.updatedAt;
    // 避免时间精度问题，手动 sleep
    const fakeNow = beforeTs + 5000;
    const spy = vi.spyOn(Date, 'now').mockReturnValue(fakeNow);
    updateProject(project.id, { name: '改后', turnCounter: 7 });
    spy.mockRestore();

    const loaded = getProject(project.id)!;
    expect(loaded.name).toBe('改后');
    expect(loaded.turnCounter).toBe(7);
    expect(loaded.updatedAt).toBe(fakeNow);
    // id 不可覆盖
    expect(loaded.id).toBe(project.id);
  });

  it('updateProject 不存在的 id 静默跳过', () => {
    expect(() => updateProject('no-such', { name: 'x' })).not.toThrow();
    expect(getProject('no-such')).toBeNull();
  });

  it('deleteProject 删除指定项目', () => {
    const a = createProject('A');
    const b = createProject('B');
    deleteProject(a.id);
    const loaded = loadProjects();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe(b.id);
  });

  it('deleteProject 不存在的 id 静默跳过', () => {
    createProject('A');
    expect(() => deleteProject('no-such')).not.toThrow();
    expect(loadProjects()).toHaveLength(1);
  });

  it('getProject 返回指定项目，不存在返回 null', () => {
    const a = createProject('A');
    expect(getProject(a.id)?.name).toBe('A');
    expect(getProject('no-such')).toBeNull();
  });
});

describe('project-storage - importProject', () => {
  it('导入节点/边/视口并写入 storage', () => {
    const nodes = [
      {
        id: 'n1',
        type: 'turn',
        position: { x: 0, y: 0 },
        data: {
          parentId: null,
          userMessage: '根',
          assistantMessage: '回答',
          suggestions: [],
          status: 'success' as const,
          createdAt: 1,
        },
      },
    ];
    const edges = [{ id: 'e1', source: 'n1', target: 'n1' }];
    const viewport = { x: 10, y: 20, zoom: 1 };

    const project = importProject('导入', nodes, edges, viewport);
    expect(project.name).toBe('导入');
    expect(project.nodes).toEqual(nodes);
    expect(project.edges).toEqual(edges);
    expect(project.viewport).toEqual(viewport);
    expect(project.projectType).toBe('normal');

    const loaded = getProject(project.id)!;
    expect(loaded.nodes).toEqual(nodes);
  });

  it('导入空名称回退为"导入的项目"', () => {
    const project = importProject('', [], [], null);
    expect(project.name).toBe('导入的项目');
  });

  it('导入时附带项目级 memory', () => {
    const memory = [{ id: 'mem-1', content: '记忆', createdAt: 1, source: 'manual' as const }];
    const project = importProject('含记忆', [], [], null, memory);
    expect(project.memory).toEqual(memory);
    expect(getProject(project.id)?.memory).toEqual(memory);
  });
});

describe('project-storage - 容量超限 QuotaExceededError', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('saveProjects 在 setItem 抛 QuotaExceededError 时静默忽略，不抛异常', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      const err = new DOMException('quota exceeded', 'QuotaExceededError');
      throw err;
    });

    expect(() =>
      saveProjects([
        { id: 'x', name: 'x', nodes: [], edges: [], viewport: null, createdAt: 1, updatedAt: 1 },
      ]),
    ).not.toThrow();
    spy.mockRestore();
  });

  it('saveSettings 同样吞 QuotaExceededError（验证 settings-storage 容错模式一致）', async () => {
    const { saveSettings } = await import('../settings-storage');
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    });
    expect(() =>
      saveSettings({
        enableGlobalMemory: false,
        enableProjectMemory: false,
        memoryFrequency: 1,
        enableConflictAutoCheck: false,
        conflictCheckFrequency: 1,
        globalRules: '',
        hoverShowPathSummary: false,
      }),
    ).not.toThrow();
    spy.mockRestore();
  });
});
