// ============================================================
// AI Debug — network-engine 单元测试
//
// 任务来源：H-17 测试覆盖（network-engine.ts 纯函数最关键）
//
// 覆盖：
//   1. collectContextPath：上下文路径收集（线性链/合并节点多路展开/防环）
//   2. buildLLMMessages：LLM 消息构造（基础/混合模式 pathSummary 压缩/多段分支标记）
// ============================================================
import { describe, it, expect } from 'vitest';
import type { Node } from 'reactflow';
import type { TurnNodeData, TurnStatus } from '@/components/node-flow/types';
import { collectContextPath, buildLLMMessages } from '../network-engine';

/** 构造测试用 TurnNode，简化样板代码 */
function makeNode(
  id: string,
  data: Partial<TurnNodeData> & { userMessage: string; parentId: string | null },
): Node<TurnNodeData> {
  return {
    id,
    type: 'turn',
    position: { x: 0, y: 0 },
    data: {
      userMessage: data.userMessage,
      assistantMessage: data.assistantMessage ?? '',
      suggestions: data.suggestions ?? [],
      status: data.status ?? ('success' as TurnStatus),
      parentId: data.parentId,
      createdAt: data.createdAt ?? 1,
      mergedFromIds: data.mergedFromIds,
      pathSummary: data.pathSummary,
    },
  };
}

// ----------------------------------------------------------------------
// collectContextPath
// ----------------------------------------------------------------------
describe('collectContextPath - 边界情况', () => {
  it('空节点列表 → 空数组', () => {
    expect(collectContextPath('any', [])).toEqual([]);
  });

  it('节点不存在 → 空数组', () => {
    const nodes = [makeNode('n1', { userMessage: 'a', parentId: null })];
    expect(collectContextPath('not-exist', nodes)).toEqual([]);
  });
});

describe('collectContextPath - 线性链', () => {
  it('根节点 → 单段含自身', () => {
    const nodes = [makeNode('root', { userMessage: '根问题', parentId: null })];
    const segments = collectContextPath('root', nodes);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toHaveLength(1);
    expect(segments[0][0].userMessage).toBe('根问题');
  });

  it('根 → 子 → 孙 三层链 → 单段含三个节点', () => {
    const nodes = [
      makeNode('root', { userMessage: '根', parentId: null }),
      makeNode('child', { userMessage: '子', parentId: 'root' }),
      makeNode('grand', { userMessage: '孙', parentId: 'child' }),
    ];
    const segments = collectContextPath('grand', nodes);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toHaveLength(3);
    expect(segments[0].map((i) => i.userMessage)).toEqual(['根', '子', '孙']);
  });

  it('路径条目含 assistantMessage / status / pathSummary 字段', () => {
    const nodes = [
      makeNode('root', {
        userMessage: '根问',
        parentId: null,
        assistantMessage: '根答',
        pathSummary: '根摘要',
      }),
    ];
    const segments = collectContextPath('root', nodes);
    expect(segments[0][0].assistantMessage).toBe('根答');
    expect(segments[0][0].pathSummary).toBe('根摘要');
    expect(segments[0][0].status).toBe('success');
  });
});

describe('collectContextPath - 合并节点多路展开', () => {
  it('合并节点 → 多段路径（每个来源独立一段）+ 末尾追加合并节点自身', () => {
    // 结构：rootA → leafA，rootB → leafB，merge 节点合并自 [leafA, leafB]
    const nodes = [
      makeNode('rootA', { userMessage: '根 A', parentId: null }),
      makeNode('leafA', { userMessage: '叶 A', parentId: 'rootA' }),
      makeNode('rootB', { userMessage: '根 B', parentId: null }),
      makeNode('leafB', { userMessage: '叶 B', parentId: 'rootB' }),
      makeNode('merge', {
        userMessage: '合并意图',
        parentId: null,
        mergedFromIds: ['leafA', 'leafB'],
      }),
    ];
    const segments = collectContextPath('merge', nodes);
    // 期望：3 段 = [根A, 叶A] + [根B, 叶B] + [merge]
    expect(segments).toHaveLength(3);
    expect(segments[0].map((i) => i.userMessage)).toEqual(['根 A', '叶 A']);
    expect(segments[1].map((i) => i.userMessage)).toEqual(['根 B', '叶 B']);
    expect(segments[2].map((i) => i.userMessage)).toEqual(['合并意图']);
  });

  it('合并节点支持公共祖先在多分支中重复出现', () => {
    // 结构：root → branchA → leafA，root → branchB → leafB，merge 合并自 [leafA, leafB]
    // root 应在两个分支路径中都出现
    const nodes = [
      makeNode('root', { userMessage: '公共根', parentId: null }),
      makeNode('branchA', { userMessage: '分支 A', parentId: 'root' }),
      makeNode('leafA', { userMessage: '叶 A', parentId: 'branchA' }),
      makeNode('branchB', { userMessage: '分支 B', parentId: 'root' }),
      makeNode('leafB', { userMessage: '叶 B', parentId: 'branchB' }),
      makeNode('merge', {
        userMessage: '合并',
        parentId: null,
        mergedFromIds: ['leafA', 'leafB'],
      }),
    ];
    const segments = collectContextPath('merge', nodes);
    expect(segments).toHaveLength(3);
    // 第一段含 root（公共祖先）
    expect(segments[0].map((i) => i.userMessage)).toEqual(['公共根', '分支 A', '叶 A']);
    // 第二段也含 root（公共祖先允许重复）
    expect(segments[1].map((i) => i.userMessage)).toEqual(['公共根', '分支 B', '叶 B']);
  });

  it('合并节点的子节点回溯到合并节点时自动展开多路', () => {
    // 结构：merge 合并自 [a, b]，merge 的子节点 child 回溯到 merge
    const nodes = [
      makeNode('a', { userMessage: 'A', parentId: null }),
      makeNode('b', { userMessage: 'B', parentId: null }),
      makeNode('merge', {
        userMessage: '合并',
        parentId: null,
        mergedFromIds: ['a', 'b'],
      }),
      makeNode('child', { userMessage: '子', parentId: 'merge' }),
    ];
    const segments = collectContextPath('child', nodes);
    // 期望：3 段 = [A] + [B] + [merge, child]（child 追加到 merge 所在的最后一段末尾）
    expect(segments).toHaveLength(3);
    expect(segments[2].map((i) => i.userMessage)).toEqual(['合并', '子']);
  });

  it('合并来源 id 不存在 → 该来源产生空段，但合并节点自身段仍存在', () => {
    const nodes = [
      makeNode('merge', {
        userMessage: '合并',
        parentId: null,
        mergedFromIds: ['non-existent'],
      }),
    ];
    const segments = collectContextPath('merge', nodes);
    // 仅合并节点自身一段
    expect(segments).toHaveLength(1);
    expect(segments[0].map((i) => i.userMessage)).toEqual(['合并']);
  });
});

describe('collectContextPath - 防环', () => {
  it('parentId 形成环时不会无限递归', () => {
    // a → b → a（环）
    const nodes = [
      makeNode('a', { userMessage: 'A', parentId: 'b' }),
      makeNode('b', { userMessage: 'B', parentId: 'a' }),
    ];
    // 应正常返回，不卡死
    const segments = collectContextPath('a', nodes);
    expect(segments.length).toBeGreaterThan(0);
  });

  it('自引用 parentId = 自己时不会无限递归', () => {
    const nodes = [makeNode('self', { userMessage: '自', parentId: 'self' })];
    const segments = collectContextPath('self', nodes);
    // 仅含自身一段
    expect(segments).toHaveLength(1);
    expect(segments[0]).toHaveLength(1);
    expect(segments[0][0].userMessage).toBe('自');
  });
});

describe('collectContextPath - 父节点不存在', () => {
  it('父节点 id 不存在时，当前节点作为单段返回', () => {
    const nodes = [
      makeNode('orphan', { userMessage: '孤儿', parentId: 'missing-parent' }),
    ];
    const segments = collectContextPath('orphan', nodes);
    expect(segments).toHaveLength(1);
    expect(segments[0].map((i) => i.userMessage)).toEqual(['孤儿']);
  });
});

// ----------------------------------------------------------------------
// buildLLMMessages
// ----------------------------------------------------------------------
describe('buildLLMMessages - 基础构造', () => {
  it('空段 → 仅 system 消息', () => {
    const result = buildLLMMessages([]);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('system');
    expect(result.estimatedTokens).toBeGreaterThan(0);
    expect(result.compressedCount).toBe(0);
    expect(result.totalNodes).toBe(0);
  });

  it('单段单节点 → system + user + assistant', () => {
    const segments = [
      [
        {
          userMessage: '用户问',
          assistantMessage: 'AI 答',
          status: 'success' as TurnStatus,
        },
      ],
    ];
    const result = buildLLMMessages(segments);
    expect(result.messages).toHaveLength(3);
    expect(result.messages[0].role).toBe('system');
    expect(result.messages[1]).toEqual({ role: 'user', content: '用户问' });
    expect(result.messages[2]).toEqual({ role: 'assistant', content: 'AI 答' });
  });

  it('assistantMessage 为空 → 只产生 user 消息', () => {
    const segments = [
      [
        {
          userMessage: '问',
          assistantMessage: '',
          status: 'success' as TurnStatus,
        },
      ],
    ];
    const result = buildLLMMessages(segments);
    expect(result.messages).toHaveLength(2); // system + user
  });

  it('extraContext 拼接到 system 消息', () => {
    const segments = [
      [
        {
          userMessage: '问',
          assistantMessage: '答',
          status: 'success' as TurnStatus,
        },
      ],
    ];
    const result = buildLLMMessages(segments, '额外上下文 X');
    expect(result.messages[0].content).toContain('额外上下文 X');
  });
});

describe('buildLLMMessages - ignored 节点', () => {
  it('ignored 节点跳过 user + assistant（路径视为断点）', () => {
    const segments = [
      [
        {
          userMessage: '正常问',
          assistantMessage: '正常答',
          status: 'success' as TurnStatus,
        },
        {
          userMessage: '被忽略问',
          assistantMessage: '被忽略答',
          status: 'ignored' as TurnStatus,
        },
        {
          userMessage: '后续问',
          assistantMessage: '后续答',
          status: 'success' as TurnStatus,
        },
      ],
    ];
    const result = buildLLMMessages(segments);
    // system + 正常 user/assistant + 后续 user/assistant（ignored 跳过）
    expect(result.messages).toHaveLength(5);
    const contents = result.messages.map((m) => (typeof m.content === 'string' ? m.content : ''));
    expect(contents.some((c) => c.includes('被忽略问'))).toBe(false);
    expect(contents.some((c) => c.includes('后续问'))).toBe(true);
  });
});

describe('buildLLMMessages - 多段路径分支标记', () => {
  it('多段时插入"--- 分支 N ---"分隔标记', () => {
    const segments = [
      [{ userMessage: 'A1', assistantMessage: 'A2', status: 'success' as TurnStatus }],
      [{ userMessage: 'B1', assistantMessage: 'B2', status: 'success' as TurnStatus }],
    ];
    const result = buildLLMMessages(segments);
    // system + A1 + A2 + 分支2标记 + B1 + B2 = 6
    expect(result.messages).toHaveLength(6);
    expect(result.messages[3]).toEqual({ role: 'system', content: '--- 分支 2 ---' });
  });

  it('单段时不插入分支标记（与原行为一致）', () => {
    const segments = [
      [{ userMessage: 'A1', assistantMessage: 'A2', status: 'success' as TurnStatus }],
    ];
    const result = buildLLMMessages(segments);
    expect(result.messages.some((m) => typeof m.content === 'string' && m.content.startsWith('--- 分支'))).toBe(false);
  });
});

describe('buildLLMMessages - 混合模式 pathSummary 压缩', () => {
  // SUMMARY_THRESHOLD = 6，构造 8 个节点的段触发混合模式
  function buildLongSegment(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      userMessage: `问${i}`,
      assistantMessage: `答${i}`,
      status: 'success' as TurnStatus,
    }));
  }

  it('pathLength 超阈值且提供 pathSummary → 前段压缩为单条摘要 system 消息', () => {
    const segments = [buildLongSegment(8)];
    const result = buildLLMMessages(segments, undefined, {
      pathSummary: '已确立的摘要',
      recentKeep: 3,
    });
    // system + 摘要 system + 后 3 个节点(user+assistant 各 1) = 1 + 1 + 6 = 8
    expect(result.messages).toHaveLength(8);
    // 第二条是摘要 system
    expect(result.messages[1].role).toBe('system');
    expect(result.messages[1].content).toContain('已确立的摘要');
    expect(result.compressedCount).toBe(5); // 前 5 个被压缩
    expect(result.totalNodes).toBe(8);
  });

  it('pathSummary 为空字符串 → 不触发混合模式，全部节点传完整内容', () => {
    const segments = [buildLongSegment(8)];
    const result = buildLLMMessages(segments, undefined, {
      pathSummary: '',
      recentKeep: 3,
    });
    // system + 8 个 user + 8 个 assistant = 17
    expect(result.messages).toHaveLength(17);
    expect(result.compressedCount).toBe(0);
  });

  it('pathLength 未超阈值 → 即使有 pathSummary 也不启用混合模式', () => {
    const segments = [buildLongSegment(3)];
    const result = buildLLMMessages(segments, undefined, {
      pathSummary: '摘要',
      recentKeep: 2,
    });
    // system + 3 user + 3 assistant = 7（不压缩）
    expect(result.messages).toHaveLength(7);
    expect(result.compressedCount).toBe(0);
  });

  it('混合模式：段长度 ≤ recentKeep 时该段不压缩', () => {
    const segments = [buildLongSegment(2)];
    const result = buildLLMMessages(segments, undefined, {
      pathSummary: '摘要',
      recentKeep: 4, // 段长度 2 < recentKeep 4 → 不压缩
    });
    expect(result.compressedCount).toBe(0);
  });

  it('混合模式：多段每段独立应用压缩规则', () => {
    const segments = [buildLongSegment(8), buildLongSegment(8)];
    const result = buildLLMMessages(segments, undefined, {
      pathSummary: '总摘要',
      recentKeep: 2,
    });
    // system + 摘要 + 分支2标记 + 段1后2(user+assistant) + 段2后2(user+assistant)
    // = 1 + 1 + 1 + 4 + 4 = 11
    expect(result.messages).toHaveLength(11);
    // 每段压缩 8 - 2 = 6，两段共 12
    expect(result.compressedCount).toBe(12);
    expect(result.totalNodes).toBe(16);
  });
});

describe('buildLLMMessages - 前段回退（无 options.pathSummary 时取前段节点 pathSummary）', () => {
  it('段超阈值且前段节点有 pathSummary → 自动取最近一个作为摘要源', () => {
    // SUMMARY_THRESHOLD = 6，构造 8 个节点，第 3 个有 pathSummary
    const segment = Array.from({ length: 8 }, (_, i) => ({
      userMessage: `问${i}`,
      assistantMessage: `答${i}`,
      status: 'success' as TurnStatus,
      pathSummary: i === 2 ? '前段摘要内容' : undefined,
    }));
    const segments = [segment];
    const result = buildLLMMessages(segments);
    // 应包含一条摘要 system 消息
    const summaryMessages = result.messages.filter(
      (m) => typeof m.content === 'string' && m.content.includes('前段摘要内容'),
    );
    expect(summaryMessages).toHaveLength(1);
    expect(summaryMessages[0].content).toContain('【前序路径摘要】');
    // compressedCount = 索引 0..2 共 3 个被摘要替代
    expect(result.compressedCount).toBe(3);
  });

  it('前段无 pathSummary 节点 → 该段保持原行为（全发完整内容）', () => {
    const segment = Array.from({ length: 8 }, (_, i) => ({
      userMessage: `问${i}`,
      assistantMessage: `答${i}`,
      status: 'success' as TurnStatus,
    }));
    const segments = [segment];
    const result = buildLLMMessages(segments);
    // system + 8 user + 8 assistant = 17
    expect(result.messages).toHaveLength(17);
    expect(result.compressedCount).toBe(0);
  });
});

describe('buildLLMMessages - estimatedTokens 估算', () => {
  it('估算 token 数为正数且与字符数正相关', () => {
    const shortSegments = [
      [{ userMessage: '短', assistantMessage: '答', status: 'success' as TurnStatus }],
    ];
    const longSegments = [
      [
        {
          userMessage: '这是一个比较长的用户问题'.repeat(10),
          assistantMessage: '这是一个比较长的 AI 回答'.repeat(10),
          status: 'success' as TurnStatus,
        },
      ],
    ];
    const shortResult = buildLLMMessages(shortSegments);
    const longResult = buildLLMMessages(longSegments);
    expect(shortResult.estimatedTokens).toBeGreaterThan(0);
    expect(longResult.estimatedTokens).toBeGreaterThan(shortResult.estimatedTokens);
  });
});
