// ============================================================
// AI Debug — agent-engine 单元测试
//
// 任务来源：H-17 测试覆盖（agent-engine.ts 纯函数最易测）
//
// 覆盖：
//   1. parseForwardedTexts：转发到节点解析（多次转发 + 分叉自引用）
//   2. parseNodeOperations：节点操作指令解析（弃用/忽略/合并）
//   3. sanitizeForwardedText：转发文本兜底清洗（角色前缀/代码块包裹）
//   4. parseForwardedText：单次转发兼容版兜底
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  parseForwardedTexts,
  parseNodeOperations,
  sanitizeForwardedText,
  parseForwardedText,
} from '../agent-engine';

// ----------------------------------------------------------------------
// parseForwardedTexts
// ----------------------------------------------------------------------
describe('parseForwardedTexts - 基础解析', () => {
  it('无标记时返回空数组', () => {
    expect(parseForwardedTexts('普通文本，没有转发标记')).toEqual([]);
  });

  it('空字符串返回空数组', () => {
    expect(parseForwardedTexts('')).toEqual([]);
  });

  it('单个"### 转发到节点"标记 → 一个 spec，forkFrom=null', () => {
    const text = '回答内容\n\n### 转发到节点\n这是新节点的提问内容';
    const result = parseForwardedTexts(text);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('这是新节点的提问内容');
    expect(result[0].forkFrom).toBeNull();
  });

  it('"### 创建节点" 别名同样有效', () => {
    const text = '### 创建节点\n用别名也能转发';
    const result = parseForwardedTexts(text);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('用别名也能转发');
  });

  it('标记后无内容（仅空白）时跳过该次转发', () => {
    const text = '### 转发到节点\n   \n\n';
    expect(parseForwardedTexts(text)).toEqual([]);
  });

  it('多次转发 → 多个 spec，按出现顺序', () => {
    const text = [
      '我先给两个分支：',
      '### 转发到节点',
      '分支 A 的内容',
      '### 转发到节点',
      '分支 B 的内容',
    ].join('\n');
    const result = parseForwardedTexts(text);
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('分支 A 的内容');
    expect(result[1].text).toBe('分支 B 的内容');
  });
});

describe('parseForwardedTexts - 分叉自引用解析', () => {
  it('"分叉自: 选中节点" → forkFrom="selected"', () => {
    const text = '### 转发到节点\n分叉自: 选中节点\n实际提问内容';
    const result = parseForwardedTexts(text);
    expect(result).toHaveLength(1);
    expect(result[0].forkFrom).toBe('selected');
    expect(result[0].text).toBe('实际提问内容');
  });

  it('"分叉自: 根节点" → forkFrom="root"', () => {
    const text = '### 转发到节点\n分叉自: 根节点\n开新支线问题';
    expect(parseForwardedTexts(text)[0].forkFrom).toBe('root');
  });

  it('"分叉自: 最近节点" → forkFrom="recent"', () => {
    const text = '### 转发到节点\n分叉自: 最近节点\n问题';
    expect(parseForwardedTexts(text)[0].forkFrom).toBe('recent');
  });

  it('"分叉自: #abc12345" → forkFrom="#abc12345"（id 前缀透传）', () => {
    const text = '### 转发到节点\n分叉自: #abc12345\n问题';
    expect(parseForwardedTexts(text)[0].forkFrom).toBe('#abc12345');
  });

  it('支持中文全角冒号"分叉自：选中节点"', () => {
    const text = '### 转发到节点\n分叉自：选中节点\n问题';
    expect(parseForwardedTexts(text)[0].forkFrom).toBe('selected');
  });

  it('未知引用 → forkFrom=null（引擎自动推断），文本仍剥离分叉自行', () => {
    const text = '### 转发到节点\n分叉自: 不存在的引用\n问题';
    const result = parseForwardedTexts(text);
    expect(result).toHaveLength(1);
    expect(result[0].forkFrom).toBeNull();
    expect(result[0].text).toBe('问题');
  });

  it('id 前缀短于 4 字符 → 视为未知引用，forkFrom=null', () => {
    const text = '### 转发到节点\n分叉自: #abc\n问题';
    const result = parseForwardedTexts(text);
    expect(result[0].forkFrom).toBeNull();
  });

  it('不写分叉自行 → forkFrom=null', () => {
    const text = '### 转发到节点\n直接给问题';
    expect(parseForwardedTexts(text)[0].forkFrom).toBeNull();
  });
});

describe('parseForwardedTexts - 文本清洗', () => {
  it('代码块包裹的内容被剥离 ```', () => {
    const text = '### 转发到节点\n```\n代码块内的提问\n```';
    expect(parseForwardedTexts(text)[0].text).toBe('代码块内的提问');
  });

  it('带语言标识的代码块同样剥离', () => {
    const text = '### 转发到节点\n```markdown\n# 标题\n内容\n```';
    expect(parseForwardedTexts(text)[0].text).toBe('# 标题\n内容');
  });

  it('"用户:" 前缀被剥离', () => {
    const text = '### 转发到节点\n用户: 真正的问题';
    expect(parseForwardedTexts(text)[0].text).toBe('真正的问题');
  });

  it('"用户消息:" 前缀被剥离', () => {
    const text = '### 转发到节点\n用户消息: 真正的问题';
    expect(parseForwardedTexts(text)[0].text).toBe('真正的问题');
  });

  it('"User:" / "Question:" 英文前缀被剥离', () => {
    expect(parseForwardedTexts('### 转发到节点\nUser: hello')[0].text).toBe('hello');
    expect(parseForwardedTexts('### 转发到节点\nQuestion: hello')[0].text).toBe('hello');
  });

  it('多行内容 + 首行角色前缀 → 剥离首行前缀保留其余', () => {
    const text = '### 转发到节点\n用户: 首行问题\n第二行补充';
    expect(parseForwardedTexts(text)[0].text).toBe('首行问题\n第二行补充');
  });
});

// ----------------------------------------------------------------------
// parseForwardedText（旧 API 兜底）
// ----------------------------------------------------------------------
describe('parseForwardedText - 旧 API 兼容', () => {
  it('无转发时返回 undefined', () => {
    expect(parseForwardedText('普通文本')).toBeUndefined();
  });

  it('有转发时返回首个 spec 的 text', () => {
    expect(parseForwardedText('### 转发到节点\n第一个\n### 转发到节点\n第二个')).toBe('第一个');
  });
});

// ----------------------------------------------------------------------
// parseNodeOperations
// ----------------------------------------------------------------------
describe('parseNodeOperations - 弃用节点', () => {
  it('单个 id', () => {
    const result = parseNodeOperations('### 弃用节点: #abc12345');
    expect(result).toEqual([{ type: 'abandon', targetIds: ['abc12345'] }]);
  });

  it('多个 id（逗号分隔）', () => {
    const result = parseNodeOperations('### 弃用节点: #abc12345, #def67890');
    expect(result).toEqual([{ type: 'abandon', targetIds: ['abc12345', 'def67890'] }]);
  });

  it('中文逗号 / 分号分隔符同样支持', () => {
    const result = parseNodeOperations('### 弃用节点: #abc12345，#def67890；#xyz99999');
    expect(result[0].targetIds).toEqual(['abc12345', 'def67890', 'xyz99999']);
  });

  it('支持中文全角冒号', () => {
    const result = parseNodeOperations('### 弃用节点：#abc12345');
    expect(result).toEqual([{ type: 'abandon', targetIds: ['abc12345'] }]);
  });

  it('无有效 id 时跳过', () => {
    expect(parseNodeOperations('### 弃用节点: 无效')).toEqual([]);
  });

  it('id 短于 4 字符被过滤', () => {
    // #abc 仅 3 字符，不符合 [a-zA-Z0-9_-]{4,}，应被过滤 → 空 targetIds → 跳过
    expect(parseNodeOperations('### 弃用节点: #abc')).toEqual([]);
  });
});

describe('parseNodeOperations - 忽略节点', () => {
  it('单个 id → type=ignore', () => {
    const result = parseNodeOperations('### 忽略节点: #abc12345');
    expect(result).toEqual([{ type: 'ignore', targetIds: ['abc12345'] }]);
  });

  it('多个 id 同样支持', () => {
    const result = parseNodeOperations('### 忽略节点: #abc12345, #def67890');
    expect(result[0].type).toBe('ignore');
    expect(result[0].targetIds).toEqual(['abc12345', 'def67890']);
  });
});

describe('parseNodeOperations - 合并节点', () => {
  it('两个 id + 合并意图 → type=merge 含 mergeIntent', () => {
    const text = '### 合并节点: #abc12345, #def67890\n结合 A 和 B 给出综合结论';
    const result = parseNodeOperations(text);
    expect(result).toEqual([
      {
        type: 'merge',
        targetIds: ['abc12345', 'def67890'],
        mergeIntent: '结合 A 和 B 给出综合结论',
      },
    ]);
  });

  it('合并意图支持多行（直到下一个 ### 标记或文末）', () => {
    const text = '### 合并节点: #abc12345, #def67890\n第一行意图\n第二行意图';
    const result = parseNodeOperations(text);
    expect(result[0].mergeIntent).toContain('第一行意图');
    expect(result[0].mergeIntent).toContain('第二行意图');
  });

  it('仅 1 个 id 时跳过（合并至少需要 2 个来源）', () => {
    const text = '### 合并节点: #abc12345\n单一来源不能合并';
    expect(parseNodeOperations(text)).toEqual([]);
  });

  it('合并意图为空时跳过', () => {
    const text = '### 合并节点: #abc12345, #def67890\n   \n';
    expect(parseNodeOperations(text)).toEqual([]);
  });

  it('中文全角冒号同样支持', () => {
    const text = '### 合并节点：#abc12345, #def67890\n合并意图';
    expect(parseNodeOperations(text)[0].type).toBe('merge');
  });
});

describe('parseNodeOperations - 混合指令', () => {
  it('一段文本中可包含多种指令，按顺序返回', () => {
    const text = [
      '先弃用一些节点：',
      '### 弃用节点: #aaa11111, #bbb22222',
      '再忽略一个节点：',
      '### 忽略节点: #ccc33333',
      '最后合并：',
      '### 合并节点: #ddd44444, #eee55555\n合并意图',
    ].join('\n');
    const result = parseNodeOperations(text);
    expect(result).toHaveLength(3);
    expect(result[0].type).toBe('abandon');
    expect(result[1].type).toBe('ignore');
    expect(result[2].type).toBe('merge');
  });

  it('无任何指令 → 空数组', () => {
    expect(parseNodeOperations('普通文本')).toEqual([]);
  });

  it('空字符串 → 空数组', () => {
    expect(parseNodeOperations('')).toEqual([]);
  });
});

// ----------------------------------------------------------------------
// sanitizeForwardedText（导出函数直接测试）
// ----------------------------------------------------------------------
describe('sanitizeForwardedText - 直接测试清洗逻辑', () => {
  it('空字符串原样返回', () => {
    expect(sanitizeForwardedText('')).toBe('');
  });

  it('纯文本不变', () => {
    expect(sanitizeForwardedText('正常文本')).toBe('正常文本');
  });

  it('剥离 "用户:" 前缀', () => {
    expect(sanitizeForwardedText('用户: 真正问题')).toBe('真正问题');
  });

  it('剥离 "用户消息:" 前缀', () => {
    expect(sanitizeForwardedText('用户消息: 真正问题')).toBe('真正问题');
  });

  it('剥离 "提问:" 前缀', () => {
    expect(sanitizeForwardedText('提问: 真正问题')).toBe('真正问题');
  });

  it('剥离 "User:" / "Question:" 英文前缀', () => {
    expect(sanitizeForwardedText('User: hello')).toBe('hello');
    expect(sanitizeForwardedText('Question: hello')).toBe('hello');
  });

  it('多行文本：仅剥离首行前缀，保留其余行', () => {
    expect(sanitizeForwardedText('用户: 首行\n第二行\n第三行')).toBe('首行\n第二行\n第三行');
  });

  it('代码块包裹剥离（无语言标识）', () => {
    expect(sanitizeForwardedText('```\n纯文本\n```')).toBe('纯文本');
  });

  it('代码块包裹剥离（带语言标识）', () => {
    expect(sanitizeForwardedText('```markdown\n# 标题\n正文\n```')).toBe('# 标题\n正文');
  });

  it('非代码块格式（不以 ``` 开头）不被剥离', () => {
    expect(sanitizeForwardedText('```\n只有开头的代码块')).toBe('```\n只有开头的代码块');
  });

  it('前缀 + 代码块同时存在：先剥离前缀再剥离代码块', () => {
    expect(sanitizeForwardedText('用户: ```\n真正内容\n```')).toBe('真正内容');
  });
});
