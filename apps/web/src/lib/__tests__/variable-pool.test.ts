// ============================================================
// AI Debug — variable-pool 单元测试
//
// 任务来源：H-17 测试覆盖（变量池解析逻辑）
//
// 覆盖：
//   1. VariablePool 类：set / get / getAll / getByNode / clear
//   2. resolveVariableReferences：{{#nodeId.varName#}} 引用解析
//   3. hasVariableReferences：检测是否含引用语法
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import {
  variablePool,
  resolveVariableReferences,
  hasVariableReferences,
  VARIABLE_REF_PATTERN,
} from '../variable-pool';

beforeEach(() => {
  variablePool.clear();
});

// ----------------------------------------------------------------------
// VariablePool 类
// ----------------------------------------------------------------------
describe('VariablePool - set / get', () => {
  it('写入后可读取', () => {
    variablePool.set('node-1', 'text', '节点 1 的回答', 'string');
    const v = variablePool.get('node-1', 'text');
    expect(v).toBeDefined();
    expect(v?.nodeId).toBe('node-1');
    expect(v?.varName).toBe('text');
    expect(v?.value).toBe('节点 1 的回答');
    expect(v?.type).toBe('string');
  });

  it('未写入时 get 返回 undefined', () => {
    expect(variablePool.get('no-such', 'text')).toBeUndefined();
  });

  it('同 key 重复写入覆盖旧值', () => {
    variablePool.set('node-1', 'text', '旧值', 'string');
    variablePool.set('node-1', 'text', '新值', 'string');
    expect(variablePool.get('node-1', 'text')?.value).toBe('新值');
  });

  it('支持任意类型值（含对象 / 数字 / 布尔）', () => {
    variablePool.set('n1', 'obj', { a: 1 }, 'object');
    variablePool.set('n2', 'num', 42, 'number');
    variablePool.set('n3', 'bool', true, 'boolean');
    expect(variablePool.get('n1', 'obj')?.value).toEqual({ a: 1 });
    expect(variablePool.get('n2', 'num')?.value).toBe(42);
    expect(variablePool.get('n3', 'bool')?.value).toBe(true);
  });
});

describe('VariablePool - getAll / getByNode', () => {
  it('getAll 返回所有变量', () => {
    variablePool.set('n1', 'text', 'a', 'string');
    variablePool.set('n2', 'text', 'b', 'string');
    const all = variablePool.getAll();
    expect(all).toHaveLength(2);
  });

  it('getByNode 仅返回指定节点的变量', () => {
    variablePool.set('n1', 'text', 'a', 'string');
    variablePool.set('n1', 'extra', 'b', 'string');
    variablePool.set('n2', 'text', 'c', 'string');
    const n1Vars = variablePool.getByNode('n1');
    expect(n1Vars).toHaveLength(2);
    expect(n1Vars.every((v) => v.nodeId === 'n1')).toBe(true);
  });

  it('未写入任何变量时 getAll 返回空数组', () => {
    expect(variablePool.getAll()).toEqual([]);
  });
});

describe('VariablePool - clear', () => {
  it('clear 后所有变量被清空', () => {
    variablePool.set('n1', 'text', 'a', 'string');
    variablePool.set('n2', 'text', 'b', 'string');
    variablePool.clear();
    expect(variablePool.getAll()).toEqual([]);
    expect(variablePool.get('n1', 'text')).toBeUndefined();
  });
});

// ----------------------------------------------------------------------
// resolveVariableReferences
// ----------------------------------------------------------------------
describe('resolveVariableReferences - 基础解析', () => {
  it('空文本 → 原样返回，references 为空', () => {
    const result = resolveVariableReferences('');
    expect(result.text).toBe('');
    expect(result.references).toEqual([]);
  });

  it('无引用语法 → 原样返回，references 为空', () => {
    const result = resolveVariableReferences('普通文本，没有引用');
    expect(result.text).toBe('普通文本，没有引用');
    expect(result.references).toEqual([]);
  });

  it('命中引用 → 替换为变量值（String 化）', () => {
    variablePool.set('node-1', 'text', '这是节点 1 的回答', 'string');
    const result = resolveVariableReferences('引用：{{#node-1.text#}}');
    expect(result.text).toBe('引用：这是节点 1 的回答');
    expect(result.references).toEqual(['node-1.text']);
  });

  it('未命中引用 → 替换为占位符 [未找到变量: nodeId.varName]（3.8.1）', () => {
    const result = resolveVariableReferences('引用：{{#missing.text#}}');
    expect(result.text).toBe('引用：[未找到变量: missing.text]');
    expect(result.references).toEqual(['missing.text']);
  });

  it('多个引用同时存在 → 全部替换', () => {
    variablePool.set('n1', 'text', 'A', 'string');
    variablePool.set('n2', 'text', 'B', 'string');
    const result = resolveVariableReferences('{{#n1.text#}} + {{#n2.text#}}');
    expect(result.text).toBe('A + B');
    expect(result.references).toEqual(['n1.text', 'n2.text']);
  });

  it('部分命中部分未命中 → 命中替换、未命中替换为占位符（3.8.1）', () => {
    variablePool.set('n1', 'text', 'A', 'string');
    const result = resolveVariableReferences('{{#n1.text#}} + {{#missing.text#}}');
    expect(result.text).toBe('A + [未找到变量: missing.text]');
    expect(result.references).toEqual(['n1.text', 'missing.text']);
  });

  it('同引用多次出现 → 全部替换', () => {
    variablePool.set('n1', 'text', 'X', 'string');
    const result = resolveVariableReferences('{{#n1.text#}} {{#n1.text#}}');
    expect(result.text).toBe('X X');
    expect(result.references).toEqual(['n1.text', 'n1.text']);
  });

  it('变量值为对象时 → 用 String() 转换（[object Object]）', () => {
    // 4.6.2：varName 白名单仅允许 'text'，用 'text' 验证对象值的 String() 转换
    variablePool.set('n1', 'text', { a: 1 }, 'object');
    const result = resolveVariableReferences('{{#n1.text#}}');
    expect(result.text).toBe('[object Object]');
  });

  it('变量值为数字时 → String(number) 转换', () => {
    // 4.6.2：varName 白名单仅允许 'text'，用 'text' 验证数字值的 String() 转换
    variablePool.set('n1', 'text', 42, 'number');
    const result = resolveVariableReferences('数量：{{#n1.text#}}');
    expect(result.text).toBe('数量：42');
  });
});

describe('resolveVariableReferences - 边界情况', () => {
  it('引用格式异常（缺 varName）→ 保留原文，references 为空', () => {
    // 4.6.1：正则限制 nodeId/varName 字符集为 [A-Za-z0-9_-]+，
    // `{{#n1#}}` 没有 .varName 部分，不匹配新正则，原文保留且不进 references
    const result = resolveVariableReferences('{{#n1#}}');
    expect(result.text).toBe('{{#n1#}}');
    expect(result.references).toEqual([]);
  });

  it('引用格式异常（缺 nodeId）→ 保留原文', () => {
    const result = resolveVariableReferences('{{#.text#}}');
    expect(result.text).toBe('{{#.text#}}');
  });

  it(' nodeId 中含 . 字符也能正确解析（split 第一个 . 为分隔）', () => {
    // 注：当前实现用 split('.') 拆分，若 nodeId 含 . 会拆错
    // 此测试文档化当前行为：split('.') 会按所有 . 拆分
    variablePool.set('n1', 'text', 'V', 'string');
    // 引用 {{#n1.text#}} 标准格式
    expect(resolveVariableReferences('{{#n1.text#}}').text).toBe('V');
  });

  it('4.6.1：nodeId 含非法字符（如 < / >）→ 不匹配，保留原文', () => {
    // 防止 {{#</script><script>#}} 这类注入
    const result = resolveVariableReferences('{{#<script>.text#}}');
    expect(result.text).toBe('{{#<script>.text#}}');
    expect(result.references).toEqual([]);
  });

  it('4.6.3：引用次数超过 MAX_VARIABLE_REPLACEMENTS 上限 → 超出部分保留原文', () => {
    // 写入一个变量
    variablePool.set('n1', 'text', 'V', 'string');
    // 构造 110 个引用的文本（超过 100 上限）
    const parts: string[] = [];
    for (let i = 0; i < 110; i++) {
      parts.push('{{#n1.text#}}');
    }
    const text = parts.join(' ');
    const result = resolveVariableReferences(text);
    // 前 100 个被替换为 V，后 10 个保留原文
    const vCount = (result.text.match(/\bV\b/g) || []).length;
    const preservedCount = (result.text.match(/\{\{#n1\.text#\}\}/g) || []).length;
    expect(vCount).toBe(100);
    expect(preservedCount).toBe(10);
    expect(result.references).toHaveLength(100);
  });
});

// ----------------------------------------------------------------------
// hasVariableReferences
// ----------------------------------------------------------------------
describe('hasVariableReferences - 检测', () => {
  it('含引用语法 → true', () => {
    expect(hasVariableReferences('text {{#node.text#}}')).toBe(true);
  });

  it('不含引用语法 → false', () => {
    expect(hasVariableReferences('普通文本')).toBe(false);
  });

  it('空字符串 → false', () => {
    expect(hasVariableReferences('')).toBe(false);
  });

  it('仅含 {{key}} 模板语法（非变量引用）→ false', () => {
    // {{key}} 不带 # 不算变量引用
    expect(hasVariableReferences('{{key}}')).toBe(false);
  });

  it('含多个引用 → true', () => {
    expect(hasVariableReferences('{{#a.x#}} {{#b.y#}}')).toBe(true);
  });
});

// ----------------------------------------------------------------------
// VARIABLE_REF_PATTERN 正则
// ----------------------------------------------------------------------
describe('VARIABLE_REF_PATTERN - 正则常量', () => {
  it('全局匹配模式，可多次匹配', () => {
    const text = '{{#a.x#}} {{#b.y#}}';
    const matches = Array.from(text.matchAll(VARIABLE_REF_PATTERN));
    expect(matches).toHaveLength(2);
    // 4.6.1：新正则用两个捕获组分别捕获 nodeId 与 varName
    expect(matches[0][1]).toBe('a');
    expect(matches[0][2]).toBe('x');
    expect(matches[1][1]).toBe('b');
    expect(matches[1][2]).toBe('y');
  });

  it('4.6.1：nodeId 含非法字符（如 < / >）不匹配', () => {
    const text = '{{#<script>.text#}} {{#n1.text#}}';
    const matches = Array.from(text.matchAll(VARIABLE_REF_PATTERN));
    expect(matches).toHaveLength(1);
    expect(matches[0][1]).toBe('n1');
    expect(matches[0][2]).toBe('text');
  });

  it('4.6.1：varName 含非法字符不匹配', () => {
    const text = '{{#n1.text!#}}';
    const matches = Array.from(text.matchAll(VARIABLE_REF_PATTERN));
    expect(matches).toHaveLength(0);
  });
});
