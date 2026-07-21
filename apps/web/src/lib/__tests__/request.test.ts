// ============================================================
// AI Debug — request 单元测试
//
// 任务来源：H-17 测试覆盖（sanitizeLLMErrorText / describeError / RequestError）
//
// 覆盖：
//   1. sanitizeLLMErrorText：敏感信息脱敏（sk-key / Bearer / Authorization 行）
//   2. describeError：错误归一化为可读 message
//   3. RequestError：错误类型字段与 name 标识
// ============================================================
import { describe, it, expect } from 'vitest';
import { sanitizeLLMErrorText, describeError, RequestError } from '../request';

// ----------------------------------------------------------------------
// sanitizeLLMErrorText
// ----------------------------------------------------------------------
describe('sanitizeLLMErrorText - 空值与无敏感信息', () => {
  it('空字符串 → 空字符串', () => {
    expect(sanitizeLLMErrorText('')).toBe('');
  });

  it('普通文本不变', () => {
    const text = 'Error: something went wrong';
    expect(sanitizeLLMErrorText(text)).toBe(text);
  });

  it('不含 sk- / Bearer / Authorization 的错误信息原样返回', () => {
    const text = 'HTTP 429 Too Many Requests';
    expect(sanitizeLLMErrorText(text)).toBe(text);
  });
});

describe('sanitizeLLMErrorText - sk- key 脱敏', () => {
  it('sk- + 20+ 字符 → sk-***', () => {
    const text = 'Error: invalid key sk-abcdefghijklmnopqrstuvwxyz';
    const result = sanitizeLLMErrorText(text);
    expect(result).not.toContain('abcdefghijklmnopqrstuvwxyz');
    expect(result).toContain('sk-***');
  });

  it('多个 sk- key 同时脱敏', () => {
    const text = 'keys: sk-aaaabbbbccccddddeeee and sk-11112222333344445555';
    const result = sanitizeLLMErrorText(text);
    expect(result).not.toContain('aaaabbbbccccddddeeee');
    expect(result).not.toContain('11112222333344445555');
    expect(result.match(/sk-\*\*\*/g)).toHaveLength(2);
  });

  it('短 sk- key（< 20 字符）→ 不脱敏（保守策略）', () => {
    // sk-abc 仅 3 字符，不符合 {20,} 量词
    const text = 'short key: sk-abc';
    const result = sanitizeLLMErrorText(text);
    expect(result).toBe(text);
  });

  it('sk- 含下划线 / 连字符 / 数字 → 脱敏', () => {
    const text = 'sk-abc_def-1234567890xyz';
    const result = sanitizeLLMErrorText(text);
    expect(result).toContain('sk-***');
    expect(result).not.toContain('abc_def-1234567890xyz');
  });
});

describe('sanitizeLLMErrorText - Bearer token 脱敏', () => {
  it('Bearer + 10+ 字符 → Bearer ***', () => {
    const text = 'Authorization: Bearer abcdefghijk';
    const result = sanitizeLLMErrorText(text);
    // 注意：Authorization 整行替换优先级最高（先匹配）
    expect(result).not.toContain('abcdefghijk');
  });

  it('独立 Bearer token（不在 Authorization 行中）→ 脱敏', () => {
    const text = 'token: Bearer abcdefghijk';
    const result = sanitizeLLMErrorText(text);
    expect(result).toContain('Bearer ***');
    expect(result).not.toContain('abcdefghijk');
  });

  it('大小写不敏感（bearer / BEARER）→ 脱敏', () => {
    const text = 'bearer ABCDEFGHIJK';
    const result = sanitizeLLMErrorText(text);
    expect(result).toContain('Bearer ***');
  });

  it('短 Bearer token（< 10 字符）→ 不脱敏', () => {
    const text = 'Bearer short';
    const result = sanitizeLLMErrorText(text);
    // 'short' 仅 5 字符，不符合 {10,} 量词
    expect(result).toBe(text);
  });
});

describe('sanitizeLLMErrorText - Authorization 行脱敏', () => {
  it('Authorization: Bearer xxx → 整行替换为 Authorization: ***', () => {
    const text = 'Authorization: Bearer sk-abcdefghijklmnopqrstuvwxyz';
    const result = sanitizeLLMErrorText(text);
    expect(result).toBe('Authorization: ***');
  });

  it('Authorization 行大小写不敏感', () => {
    const text = 'authorization: Bearer sometoken';
    const result = sanitizeLLMErrorText(text);
    expect(result).toBe('Authorization: ***');
  });

  it('Authorization 行可含空格（冒号后空格）→ 整行替换', () => {
    const text = 'Authorization:   some-key-value';
    const result = sanitizeLLMErrorText(text);
    expect(result).toBe('Authorization: ***');
  });
});

describe('sanitizeLLMErrorText - 截断到 500 字符', () => {
  it('超长文本被截断到 500 字符', () => {
    const longText = 'a'.repeat(1000);
    const result = sanitizeLLMErrorText(longText);
    expect(result.length).toBe(500);
  });

  it('500 字符以内的文本不被截断', () => {
    const text = 'a'.repeat(500);
    expect(sanitizeLLMErrorText(text).length).toBe(500);
  });

  it('501 字符的文本被截断到 500', () => {
    const text = 'a'.repeat(501);
    expect(sanitizeLLMErrorText(text).length).toBe(500);
  });

  it('含敏感信息的超长文本先脱敏再截断', () => {
    const text = `Error: key sk-abcdefghijklmnopqrstuvwxyz ${'a'.repeat(600)}`;
    const result = sanitizeLLMErrorText(text);
    expect(result.length).toBe(500);
    expect(result).not.toContain('abcdefghijklmnopqrstuvwxyz');
  });
});

describe('sanitizeLLMErrorText - 综合场景', () => {
  it('同时含 sk-key + Bearer + Authorization → 全部脱敏', () => {
    const text = [
      'Request failed:',
      'sk-aaaabbbbccccddddeeee',
      'Authorization: Bearer xxxxxxyyyyzzzz',
      'see also: Bearer token12345',
    ].join('\n');
    const result = sanitizeLLMErrorText(text);
    expect(result).not.toContain('aaaabbbbccccddddeeee');
    expect(result).not.toContain('xxxxxxyyyyzzzz');
    expect(result).not.toContain('token12345');
  });

  it('JSON 格式错误信息中的敏感字段脱敏', () => {
    const text = JSON.stringify({
      error: 'auth failed',
      key: 'sk-abcdefghijklmnopqrstuvwxyz',
    });
    const result = sanitizeLLMErrorText(text);
    expect(result).toContain('sk-***');
    expect(result).not.toContain('abcdefghijklmnopqrstuvwxyz');
  });
});

// ----------------------------------------------------------------------
// describeError
// ----------------------------------------------------------------------
describe('describeError - 错误归一化', () => {
  it('Error 实例 → 返回 message', () => {
    const err = new Error('something failed');
    expect(describeError(err)).toBe('something failed');
  });

  it('Error 子类 → 返回 message', () => {
    const err = new TypeError('invalid type');
    expect(describeError(err)).toBe('invalid type');
  });

  it('字符串 → String(value) 原样返回', () => {
    expect(describeError('plain string')).toBe('plain string');
  });

  it('数字 → 转为字符串', () => {
    expect(describeError(42)).toBe('42');
  });

  it('null → "null"', () => {
    expect(describeError(null)).toBe('null');
  });

  it('undefined → "undefined"', () => {
    expect(describeError(undefined)).toBe('undefined');
  });

  it('对象 → "[object Object]"', () => {
    expect(describeError({ a: 1 })).toBe('[object Object]');
  });

  it('RequestError → 返回 message', () => {
    const err = new RequestError('http error', 500, 'http');
    expect(describeError(err)).toBe('http error');
  });
});

// ----------------------------------------------------------------------
// RequestError 类
// ----------------------------------------------------------------------
describe('RequestError - 类字段', () => {
  it('构造函数设置 message / status / type', () => {
    const err = new RequestError('not found', 404, 'http');
    expect(err.message).toBe('not found');
    expect(err.status).toBe(404);
    expect(err.type).toBe('http');
  });

  it('name 字段为 "RequestError"', () => {
    const err = new RequestError('err', 0, 'network');
    expect(err.name).toBe('RequestError');
  });

  it('继承自 Error', () => {
    const err = new RequestError('err', 0, 'network');
    expect(err).toBeInstanceOf(Error);
  });

  it('支持网络错误类型', () => {
    const err = new RequestError('网络错误', 0, 'network');
    expect(err.type).toBe('network');
    expect(err.status).toBe(0);
  });

  it('支持超时错误类型', () => {
    const err = new RequestError('请求超时', 0, 'timeout');
    expect(err.type).toBe('timeout');
    expect(err.status).toBe(0);
  });

  it('支持 HTTP 错误类型（含状态码）', () => {
    const err = new RequestError('500 - Internal Server Error', 500, 'http');
    expect(err.type).toBe('http');
    expect(err.status).toBe(500);
  });
});
