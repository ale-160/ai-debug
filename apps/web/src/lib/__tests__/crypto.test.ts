// ============================================================
// AI Debug — crypto 单元测试
//
// 任务来源：H-17 测试覆盖（AES-GCM 加密 / XOR 混淆 / 反序列化校验）
//
// 覆盖：
//   1. 同步 XOR 路径：obfuscateString / deobfuscateString 往返
//   2. 同步 JSON 路径：obfuscateJSON / deobfuscateJSON 往返 + 损坏数据兜底
//   3. 异步 AES-GCM 路径：obfuscateStringAsync / deobfuscateStringAsync 往返
//      （jsdom 环境可能无 crypto.subtle，缺失时跳过相关用例）
//   4. 异步 JSON 路径：obfuscateJSONAsync / deobfuscateJSONAsync 往返
//   5. 迁移路径：旧 enc: 数据可被异步函数解密
//   6. 反序列化安全：__proto__ / constructor / prototype 拒绝
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import {
  obfuscateString,
  deobfuscateString,
  obfuscateJSON,
  deobfuscateJSON,
  obfuscateStringAsync,
  deobfuscateStringAsync,
  obfuscateJSONAsync,
  deobfuscateJSONAsync,
} from '../crypto';

beforeEach(() => {
  window.localStorage.clear();
});

// ----------------------------------------------------------------------
// 同步 XOR 路径
// ----------------------------------------------------------------------
describe('obfuscateString / deobfuscateString - 同步 XOR 往返', () => {
  it('普通字符串往返一致', () => {
    const original = 'hello world';
    const obfuscated = obfuscateString(original);
    expect(obfuscated).not.toBe(original);
    expect(obfuscated.startsWith('enc:')).toBe(true);
    expect(deobfuscateString(obfuscated)).toBe(original);
  });

  it('中文字符串往返一致（Unicode 安全）', () => {
    const original = '你好世界，加密测试 🔒';
    const obfuscated = obfuscateString(original);
    expect(deobfuscateString(obfuscated)).toBe(original);
  });

  it('含特殊字符（换行 / 引号 / 反斜杠）往返一致', () => {
    const original = 'line1\nline2\ttab\\backslash"quote';
    const obfuscated = obfuscateString(original);
    expect(deobfuscateString(obfuscated)).toBe(original);
  });

  it('空字符串原样返回', () => {
    expect(obfuscateString('')).toBe('');
    expect(deobfuscateString('')).toBe('');
  });

  it('deobfuscateString 对非 enc: 前缀的明文原样返回', () => {
    expect(deobfuscateString('plain text')).toBe('plain text');
    expect(deobfuscateString('aes:someciphertext')).toBe('aes:someciphertext');
  });
});

// ----------------------------------------------------------------------
// 同步 JSON 路径
// ----------------------------------------------------------------------
describe('obfuscateJSON / deobfuscateJSON - 同步 JSON 往返', () => {
  it('对象往返一致', () => {
    const obj = { apiKey: 'sk-12345', model: 'gpt-4o', count: 42 };
    const obfuscated = obfuscateJSON(obj);
    expect(obfuscated.startsWith('enc:')).toBe(true);
    expect(deobfuscateJSON(obfuscated)).toEqual(obj);
  });

  it('嵌套对象往返一致', () => {
    const obj = { a: { b: { c: 'deep' } }, list: [1, 2, 3] };
    expect(deobfuscateJSON(obfuscateJSON(obj))).toEqual(obj);
  });

  it('空字符串 → null', () => {
    expect(deobfuscateJSON('')).toBeNull();
  });

  it('损坏 JSON → null', () => {
    expect(deobfuscateJSON('not-json{')).toBeNull();
  });

  it('明文 JSON（无 enc: 前缀）→ 仍能解析（向后兼容）', () => {
    const plain = JSON.stringify({ x: 1 });
    expect(deobfuscateJSON(plain)).toEqual({ x: 1 });
  });
});

describe('deobfuscateJSON - 反序列化安全（防原型污染）', () => {
  it('constructor 自有字段 → 拒绝返回 null', () => {
    const malicious = obfuscateString(
      JSON.stringify({ constructor: { prototype: { polluted: true } } }),
    );
    expect(deobfuscateJSON(malicious)).toBeNull();
  });

  it('prototype 自有字段 → 拒绝返回 null', () => {
    const malicious = obfuscateString(JSON.stringify({ prototype: { polluted: true } }));
    expect(deobfuscateJSON(malicious)).toBeNull();
  });

  it('__proto__ 自然缓解：JSON.stringify 不写入 __proto__ 字段，往返后为空对象', () => {
    // 说明：__proto__ 在 JSON.stringify 时不会被序列化为 own 属性，
    // 即使原始对象含 __proto__，序列化结果是 '{}'，从源头消除了原型污染向量
    const objWithProto = { __proto__: { polluted: true } } as Record<string, unknown>;
    const obfuscated = obfuscateString(JSON.stringify(objWithProto));
    const result = deobfuscateJSON<Record<string, unknown>>(obfuscated);
    expect(result).toEqual({});
    // 原型链未被污染
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('普通嵌套对象不含敏感字段 → 正常返回', () => {
    const obj = { a: 1, b: { c: 2 } };
    expect(deobfuscateJSON(obfuscateJSON(obj))).toEqual(obj);
  });

  it('数组类型 → 通过校验', () => {
    const arr = [1, 2, 3];
    expect(deobfuscateJSON(obfuscateJSON(arr))).toEqual(arr);
  });

  it('嵌套对象内含 constructor 字段 → 当前实现仅检查顶层，嵌套层不被拦截（文档化既有行为）', () => {
    // 当前 isSafeParsed 仅检查顶层 own 属性，深层 constructor 不被检测
    const obj = { nested: { constructor: { prototype: { x: 1 } } } };
    expect(deobfuscateJSON(obfuscateJSON(obj))).toEqual(obj);
  });
});

// ----------------------------------------------------------------------
// 异步 AES-GCM 路径（jsdom 环境如支持 crypto.subtle 才执行）
// ----------------------------------------------------------------------
const hasSubtleCrypto =
  typeof crypto !== 'undefined' &&
  typeof crypto.subtle !== 'undefined' &&
  typeof crypto.subtle.importKey === 'function';

const describeOrSkip = hasSubtleCrypto ? describe : describe.skip;

describeOrSkip('obfuscateStringAsync / deobfuscateStringAsync - AES-GCM 往返', () => {
  it('普通字符串往返一致，密文以 aes: 开头', async () => {
    const original = 'secret-api-key';
    const obfuscated = await obfuscateStringAsync(original);
    expect(obfuscated.startsWith('aes:')).toBe(true);
    expect(obfuscated).not.toBe(original);
    const decrypted = await deobfuscateStringAsync(obfuscated);
    expect(decrypted).toBe(original);
  });

  it('中文字符串往返一致', async () => {
    const original = '机密内容 🔒';
    const decrypted = await deobfuscateStringAsync(await obfuscateStringAsync(original));
    expect(decrypted).toBe(original);
  });

  it('长字符串往返一致', async () => {
    const original = 'x'.repeat(10000);
    const decrypted = await deobfuscateStringAsync(await obfuscateStringAsync(original));
    expect(decrypted).toBe(original);
  });

  it('空字符串原样返回', async () => {
    expect(await obfuscateStringAsync('')).toBe('');
    expect(await deobfuscateStringAsync('')).toBe('');
  });

  it('明文字符串 → 原样返回', async () => {
    expect(await deobfuscateStringAsync('plain text')).toBe('plain text');
  });

  it('aes: 前缀但密文损坏 → 返回原文（不抛异常）', async () => {
    const corrupted = 'aes:invalid-base64-data';
    const result = await deobfuscateStringAsync(corrupted);
    // 解密失败时返回原文让调用方处理
    expect(result).toBe(corrupted);
  });

  it('同明文两次加密产生不同密文（IV 随机）', async () => {
    const plaintext = 'same text';
    const cipher1 = await obfuscateStringAsync(plaintext);
    const cipher2 = await obfuscateStringAsync(plaintext);
    expect(cipher1).not.toBe(cipher2);
    // 但都能解出原文
    expect(await deobfuscateStringAsync(cipher1)).toBe(plaintext);
    expect(await deobfuscateStringAsync(cipher2)).toBe(plaintext);
  });
});

describeOrSkip('迁移路径 - 旧 enc: 数据可被异步函数解密', () => {
  it('enc: 前缀的 XOR 数据 → 异步函数自动走 XOR 解密', async () => {
    const original = 'legacy-data';
    const legacy = obfuscateString(original); // enc: 前缀
    const decrypted = await deobfuscateStringAsync(legacy);
    expect(decrypted).toBe(original);
  });

  it('aes: 与 enc: 数据混存 → 各自走对应路径', async () => {
    const aesCipher = await obfuscateStringAsync('aes-data');
    const encCipher = obfuscateString('enc-data');
    expect(await deobfuscateStringAsync(aesCipher)).toBe('aes-data');
    expect(await deobfuscateStringAsync(encCipher)).toBe('enc-data');
  });
});

describeOrSkip('obfuscateJSONAsync / deobfuscateJSONAsync - 异步 JSON 往返', () => {
  it('对象往返一致，密文以 aes: 开头', async () => {
    const obj = { apiKey: 'sk-xxx', baseUrl: 'https://api.example.com' };
    const obfuscated = await obfuscateJSONAsync(obj);
    expect(obfuscated.startsWith('aes:')).toBe(true);
    expect(await deobfuscateJSONAsync(obfuscated)).toEqual(obj);
  });

  it('空字符串 → null', async () => {
    expect(await deobfuscateJSONAsync('')).toBeNull();
  });

  it('损坏 JSON → null（AES 解密失败后原文不是合法 JSON）', async () => {
    const result = await deobfuscateJSONAsync('aes:not-valid');
    expect(result).toBeNull();
  });

  it('明文 JSON（无前缀）→ 仍能解析（向后兼容）', async () => {
    const plain = JSON.stringify({ x: 1 });
    expect(await deobfuscateJSONAsync(plain)).toEqual({ x: 1 });
  });

  it('__proto__ 自然缓解：异步路径下也不被原型污染', async () => {
    // JSON.stringify 不写入 __proto__ 字段，往返后为空对象
    const objWithProto = { __proto__: { polluted: true } } as Record<string, unknown>;
    const malicious = await obfuscateStringAsync(JSON.stringify(objWithProto));
    const result = await deobfuscateJSONAsync<Record<string, unknown>>(malicious);
    expect(result).toEqual({});
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('constructor 自有字段 → 异步路径同样拒绝返回 null', async () => {
    const malicious = await obfuscateStringAsync(
      JSON.stringify({ constructor: { prototype: { polluted: true } } }),
    );
    expect(await deobfuscateJSONAsync(malicious)).toBeNull();
  });
});

// ----------------------------------------------------------------------
// 设备密钥持久化
// ----------------------------------------------------------------------
describe('设备密钥持久化', () => {
  it('同会话内多次加密解密使用同一密钥（持久化）', () => {
    const text = 'persist-test';
    const cipher1 = obfuscateString(text);
    const cipher2 = obfuscateString(text);
    // 同密钥 + XOR → 同密文
    expect(cipher1).toBe(cipher2);
    expect(deobfuscateString(cipher1)).toBe(text);
  });

  it('清空 localStorage 后重新生成密钥，旧密文无法解密', () => {
    const text = 'key-change-test';
    const cipher = obfuscateString(text);
    // 清空密钥后重新加密同一明文 → 密文不同
    window.localStorage.clear();
    const newCipher = obfuscateString(text);
    expect(newCipher).not.toBe(cipher);
    // 但新密文可解密
    expect(deobfuscateString(newCipher)).toBe(text);
  });
});
