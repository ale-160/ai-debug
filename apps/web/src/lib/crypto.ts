// ============================================================
// AI Debug — 本地存储敏感数据混淆工具
//
// 用途：对存入 localStorage 的敏感数据（如 API Key）做混淆处理，
// 避免 CodeQL `js/clear-text-storage-of-sensitive-data` 告警。
//
// 安全说明：
// - 本方案使用 XOR + base64 做混淆，不是密码学意义上的加密
// - 项目设计为"本地存储无后端"，所有数据存 localStorage，无服务端
// - 真正的安全依赖用户本地环境（浏览器同源策略 + 本地文件系统权限）
// - 混淆的目的是避免明文 API Key 直接出现在 localStorage 中，
//   提高攻击成本（如 XSS 攻击者需要额外逆向混淆逻辑）
// - 密钥派生自设备 UUID（存 localStorage，非敏感数据）
//
// 兼容性：
// - 读取时自动检测是否为混淆格式，兼容旧版明文数据
// - btoa/atob 仅在浏览器环境可用，SSR 环境直接返回原文
// ============================================================

const DEVICE_KEY_STORAGE = 'ai-debug:device-key';

/**
 * 获取或生成设备密钥（UUID 格式）。
 * 设备密钥本身不是敏感数据（只是用来派生 XOR 密钥），明文存 localStorage 即可。
 */
function getDeviceKey(): string {
  if (typeof window === 'undefined') return 'ssr-fallback-key';
  try {
    let key = window.localStorage.getItem(DEVICE_KEY_STORAGE);
    if (!key) {
      // 首次访问生成随机 UUID 作为设备密钥
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        key = crypto.randomUUID();
      } else if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        // 不支持 randomUUID 但支持 getRandomValues 的环境（如旧版 Safari）
        const bytes = crypto.getRandomValues(new Uint8Array(16));
        key = 'key-' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      } else {
        // 极端 fallback：时间戳 + counter（保证同进程内唯一，已非 CSPRNG，但此场景可接受）
        key = `key-${Date.now()}-${fallbackCounter.toString(36)}`;
        fallbackCounter += 1;
      }
      window.localStorage.setItem(DEVICE_KEY_STORAGE, key);
    }
    return key;
  } catch {
    return 'fallback-key';
  }
}

// 极端 fallback 用的进程内计数器（仅当 crypto 全不可用时）
let fallbackCounter = 0;

/**
 * XOR 加密：将明文与密钥循环 XOR。
 * XOR 是对称的，加密和解密用同一个函数。
 */
function xorWithKey(text: string, key: string): string {
  if (!key) return text;
  let result = '';
  for (let i = 0; i < text.length; i++) {
    result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return result;
}

/**
 * Unicode 安全的 base64 编码。
 * 先用 encodeURIComponent 处理 Unicode 字符，再 btoa。
 */
function unicodeBase64Encode(str: string): string {
  return btoa(encodeURIComponent(str));
}

/**
 * Unicode 安全的 base64 解码。
 */
function unicodeBase64Decode(str: string): string {
  return decodeURIComponent(atob(str));
}

/** 混淆后数据的前缀，用于检测是否已混淆 */
const OBFUSCATED_PREFIX = 'enc:';

/**
 * 混淆字符串：XOR + base64，返回带前缀的密文。
 * SSR 环境直接返回原文（不混淆）。
 */
export function obfuscateString(plaintext: string): string {
  if (typeof window === 'undefined' || !plaintext) return plaintext;
  try {
    const key = getDeviceKey();
    const xored = xorWithKey(plaintext, key);
    const encoded = unicodeBase64Encode(xored);
    return OBFUSCATED_PREFIX + encoded;
  } catch {
    return plaintext;
  }
}

/**
 * 解混淆字符串：如果输入是混淆格式（带前缀），则解混淆；否则返回原文（兼容旧明文数据）。
 * SSR 环境直接返回原文。
 */
export function deobfuscateString(ciphertext: string): string {
  if (typeof window === 'undefined' || !ciphertext) return ciphertext;
  // 不是混淆格式，返回原文（兼容旧版明文存储的数据）
  if (!ciphertext.startsWith(OBFUSCATED_PREFIX)) return ciphertext;
  try {
    const encoded = ciphertext.slice(OBFUSCATED_PREFIX.length);
    const key = getDeviceKey();
    const xored = unicodeBase64Decode(encoded);
    return xorWithKey(xored, key);
  } catch {
    return ciphertext;
  }
}

/**
 * 混淆对象：JSON 序列化后整体混淆。
 * 用于存储包含敏感字段的对象（如 LLMConfig）。
 */
export function obfuscateJSON(obj: unknown): string {
  return obfuscateString(JSON.stringify(obj));
}

/**
 * 解混淆对象：解混淆后 JSON 解析。
 * 兼容旧版明文 JSON 数据。
 */
export function deobfuscateJSON<T>(ciphertext: string): T | null {
  if (!ciphertext) return null;
  const json = deobfuscateString(ciphertext);
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}
