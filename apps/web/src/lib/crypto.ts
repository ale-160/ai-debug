// ============================================================
// AI Debug — 本地存储敏感数据加密 / 混淆工具
//
// 用途：对存入 localStorage 的敏感数据（如 API Key）做加密处理，
// 避免 CodeQL `js/clear-text-storage-of-sensitive-data` 告警。
//
// 安全说明（重要）：
// - 主路径使用 Web Crypto API 的 AES-GCM（256 位密钥 + 96 位 IV）做真正的密码学加密
// - 设备密钥用 CSPRNG（crypto.getRandomValues）生成，存到 localStorage
// - 由于密钥与密文同源（都在浏览器本地），拿到 localStorage 的攻击者仍可解密；
//   这等同于"延迟攻击者"而非"密码学安全"，但已显著提高攻击成本（无法直接 grep 明文）
// - 纯前端应用无后端，密钥派生自本地 CSPRNG 是固有限制
// - 同步 fallback 路径仍使用 XOR + base64（仅用于 SSR 或不支持 Web Crypto 的环境），
//   XOR 密钥也已升级到 CSPRNG 生成
//
// 兼容性：
// - 读取时自动检测密文格式：`aes:`（AES-GCM）/ `enc:`（旧 XOR）/ 明文
// - 旧 XOR 混淆数据在异步读取时自动解密（用于迁移到 AES-GCM）
// - btoa/atob 仅在浏览器环境可用，SSR 环境同步函数返回原文
// ============================================================

const DEVICE_KEY_STORAGE = 'ai-debug:device-key';
const AES_KEY_STORAGE = 'ai-debug:aes-key';

/**
 * 4.1.8：SSR fallback 安全说明。
 *
 * 以下同步 API（obfuscateString / deobfuscateString / obfuscateJSON / deobfuscateJSON）
 * 在 SSR 环境（typeof window === 'undefined'）会直接返回原文 / null，不会调用
 * getDeviceKey（getDeviceKey 在 SSR 直接 throw）。
 *
 * 这是 SSR 渲染必需的 fallback 路径：避免 hydration mismatch（服务端 / 客户端
 * 首次渲染结果不一致）。SSR 期间不存放真实敏感数据 —— Next.js App Router
 * 在 SSR 阶段不会读取 localStorage 中的 API Key 等敏感配置（loadConfig 在
 * SSR 时直接返回 null），故 SSR fallback 仅返回原文或 null，不存在明文
 * 敏感数据被渲染到 HTML 中的风险。
 *
 * 真正的敏感数据持久化只在客户端（useEffect / 事件回调）发生，走异步
 * obfuscateStringAsync（AES-GCM 主路径）。
 */

/** 旧 XOR 混淆数据前缀（向后兼容） */
const OBFUSCATED_PREFIX = 'enc:';
/** 新 AES-GCM 加密数据前缀 */
const AES_PREFIX = 'aes:';

/**
 * 获取或生成设备密钥（UUID 格式）。
 * 用于同步 XOR fallback 路径。
 * 设备密钥本身不是敏感数据（只是用来派生 XOR 密钥），明文存 localStorage 即可。
 *
 * SSR 或不支持 Web Crypto 的环境直接 throw，调用方需 try/catch。
 */
function getDeviceKey(): string {
  if (typeof window === 'undefined') {
    throw new Error('device key requires browser environment');
  }
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    throw new Error('Web Crypto API not available');
  }
  try {
    let key = window.localStorage.getItem(DEVICE_KEY_STORAGE);
    if (!key) {
      // 首次访问生成随机 UUID 作为设备密钥
      if (typeof crypto.randomUUID === 'function') {
        key = crypto.randomUUID();
      } else {
        // 不支持 randomUUID 但支持 getRandomValues 的环境（如旧版 Safari）
        const bytes = crypto.getRandomValues(new Uint8Array(16));
        key = 'key-' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      }
      window.localStorage.setItem(DEVICE_KEY_STORAGE, key);
    }
    return key;
  } catch (e) {
    throw new Error(
      'failed to access device key storage: ' + (e instanceof Error ? e.message : String(e)),
    );
  }
}

/**
 * 获取或生成 AES-GCM 设备密钥（32 字节 = 256 位）。
 * 用于异步 AES-GCM 加密路径。
 *
 * SSR 或不支持 Web Crypto 的环境直接 throw，调用方需 try/catch。
 */
function getDeviceKeyBytes(): Uint8Array<ArrayBuffer> {
  if (typeof window === 'undefined') {
    throw new Error('AES key requires browser environment');
  }
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    throw new Error('Web Crypto API not available');
  }
  try {
    const stored = window.localStorage.getItem(AES_KEY_STORAGE);
    if (stored) {
      const bytes = base64ToBytes(stored);
      if (bytes.length === 32) return bytes;
    }
    // 生成新的 32 字节（256 位）AES-GCM 密钥
    const keyBytes = crypto.getRandomValues(new Uint8Array(32));
    window.localStorage.setItem(AES_KEY_STORAGE, bytesToBase64(keyBytes));
    return keyBytes;
  } catch (e) {
    throw new Error(
      'failed to access AES key storage: ' + (e instanceof Error ? e.message : String(e)),
    );
  }
}

/**
 * XOR 加密：将明文与密钥循环 XOR。
 * XOR 是对称的，加密和解密用同一个函数。仅用于同步 fallback 路径。
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
 * Unicode 安全的 base64 编码（XOR 路径用）。
 * 沿用 encodeURIComponent + btoa 的方式以保持与历史数据的二进制兼容
 * （旧 XOR 混淆数据用此方式编码；改为 TextEncoder 会让旧数据无法解码）。
 * XSS-safety 4.7.5 的修复体现在 AES-GCM 主路径（bytesToBase64 / base64ToBytes 使用 TextEncoder）。
 */
function unicodeBase64Encode(str: string): string {
  return btoa(encodeURIComponent(str));
}

/**
 * Unicode 安全的 base64 解码（XOR 路径用）。
 * 与 unicodeBase64Encode 配对，保持历史数据可读。
 */
function unicodeBase64Decode(str: string): string {
  return decodeURIComponent(atob(str));
}

/** Uint8Array → 标准 base64 字符串（AES-GCM 路径用，基于 TextEncoder 的 UTF-8 字节） */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** 标准 base64 字符串 → Uint8Array<ArrayBuffer>（AES-GCM 路径用，用于 Web Crypto BufferSource） */
function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * AES-GCM 加密：返回 base64(iv + ciphertext)。
 * - IV：12 字节（96 位），NIST 推荐长度，每次加密用 CSPRNG 重新生成
 * - 密钥：32 字节（256 位）AES-GCM 密钥
 * - 认证标签（16 字节）由 Web Crypto 自动附加在密文末尾
 */
async function encryptAESGCM(
  plaintext: string,
  keyBytes: Uint8Array<ArrayBuffer>,
): Promise<string> {
  if (typeof crypto === 'undefined' || typeof crypto.subtle === 'undefined') {
    throw new Error('Web Crypto subtle API not available');
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  // 拼接 iv + ciphertext（含认证标签）
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return bytesToBase64(combined);
}

/**
 * AES-GCM 解密：输入 base64(iv + ciphertext)，返回明文。
 * 解密失败（密钥错误 / 数据损坏 / 认证标签不匹配）返回 null。
 */
async function decryptAESGCM(
  ciphertext: string,
  keyBytes: Uint8Array<ArrayBuffer>,
): Promise<string | null> {
  if (typeof crypto === 'undefined' || typeof crypto.subtle === 'undefined') {
    return null;
  }
  try {
    const combined = base64ToBytes(ciphertext);
    // IV 12 字节 + 至少 1 字节密文 + 16 字节认证标签
    if (combined.length < 29) return null;
    const iv = combined.slice(0, 12);
    const ct = combined.slice(12);
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, [
      'encrypt',
      'decrypt',
    ]);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}

/**
 * 检查 JSON.parse 后的对象是否安全（防原型污染）。
 * - 拒绝包含 `__proto__` / `constructor` / `prototype` 自有字段的对象
 */
function isSafeParsed(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return true;
  if (Array.isArray(value)) return true;
  const obj = value as Record<string, unknown>;
  return (
    !Object.prototype.hasOwnProperty.call(obj, '__proto__') &&
    !Object.prototype.hasOwnProperty.call(obj, 'constructor') &&
    !Object.prototype.hasOwnProperty.call(obj, 'prototype')
  );
}

// ============================================================
// 同步 API（XOR fallback，用于 SSR 或不支持 Web Crypto 的环境）
// ============================================================

/**
 * 混淆字符串：XOR + base64，返回带 `enc:` 前缀的密文。
 * SSR 环境或不支持 Web Crypto 时直接返回原文（不混淆）。
 * 仅作为异步 AES-GCM 路径的 fallback。
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
 * 解混淆字符串：支持 `enc:` 前缀（旧 XOR）。其他格式（含 `aes:` AES-GCM）返回原文。
 * SSR 环境直接返回原文。
 * 注：AES-GCM 数据无法同步解密，请使用 deobfuscateStringAsync。
 */
export function deobfuscateString(ciphertext: string): string {
  if (typeof window === 'undefined' || !ciphertext) return ciphertext;
  // 不是同步可解的混淆格式，返回原文（兼容旧版明文存储 / 留给异步路径处理 aes:）
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
 * 混淆对象：JSON 序列化后整体混淆（同步 XOR 路径）。
 * 用于 SSR fallback 或不支持 Web Crypto 的环境。
 */
export function obfuscateJSON(obj: unknown): string {
  return obfuscateString(JSON.stringify(obj));
}

/**
 * 解混淆对象：解混淆后 JSON 解析（同步 XOR 路径）。
 * 兼容旧版明文 JSON 数据与 `enc:` 前缀的旧 XOR 数据。
 * `aes:` 前缀的 AES-GCM 数据请使用 deobfuscateJSONAsync。
 * 解析后做基本 schema 校验（防原型污染）。
 */
export function deobfuscateJSON<T>(ciphertext: string): T | null {
  if (!ciphertext) return null;
  const json = deobfuscateString(ciphertext);
  try {
    const parsed = JSON.parse(json);
    if (!isSafeParsed(parsed)) return null;
    return parsed as T;
  } catch {
    return null;
  }
}

// ============================================================
// 异步 API（AES-GCM，主路径，使用 Web Crypto）
// ============================================================

/**
 * 异步加密字符串：AES-GCM，返回带 `aes:` 前缀的密文。
 * - 浏览器 + Web Crypto 可用：使用真正的 AES-GCM
 * - SSR 或不支持 Web Crypto：回退到同步 XOR（返回 `enc:` 前缀）
 */
export async function obfuscateStringAsync(plaintext: string): Promise<string> {
  if (typeof window === 'undefined' || !plaintext) return plaintext;
  try {
    const keyBytes = getDeviceKeyBytes();
    const encrypted = await encryptAESGCM(plaintext, keyBytes);
    return AES_PREFIX + encrypted;
  } catch {
    // Web Crypto 不可用，回退到同步 XOR
    return obfuscateString(plaintext);
  }
}

/**
 * 异步解密字符串：支持 `aes:`（AES-GCM）/ `enc:`（旧 XOR 迁移）/ 明文。
 * - `aes:` 前缀：AES-GCM 解密
 * - `enc:` 前缀：旧 XOR 解密（用于迁移到 AES-GCM）
 * - 明文：原样返回
 * - 解密失败返回原文（让调用方走迁移路径）
 */
export async function deobfuscateStringAsync(ciphertext: string): Promise<string> {
  if (typeof window === 'undefined' || !ciphertext) return ciphertext;
  // 明文：原样返回
  if (!ciphertext.startsWith(AES_PREFIX) && !ciphertext.startsWith(OBFUSCATED_PREFIX)) {
    return ciphertext;
  }
  // AES-GCM 路径
  if (ciphertext.startsWith(AES_PREFIX)) {
    try {
      const encoded = ciphertext.slice(AES_PREFIX.length);
      const keyBytes = getDeviceKeyBytes();
      const decrypted = await decryptAESGCM(encoded, keyBytes);
      if (decrypted !== null) return decrypted;
      return ciphertext; // 解密失败，返回原文让调用方处理
    } catch {
      return ciphertext;
    }
  }
  // 旧 XOR 路径（迁移用）
  return deobfuscateString(ciphertext);
}

/**
 * 异步加密对象：JSON 序列化后用 AES-GCM 加密。
 * 浏览器主路径，不支持 Web Crypto 时回退到同步 XOR。
 */
export async function obfuscateJSONAsync(value: unknown): Promise<string> {
  return obfuscateStringAsync(JSON.stringify(value));
}

/**
 * 异步解密对象：支持 AES-GCM / 旧 XOR / 明文。
 * - 优先尝试 AES-GCM（`aes:` 前缀）
 * - 旧 `enc:` 前缀自动用 XOR 解密（迁移路径）
 * - 明文 JSON 直接解析
 * - 解析后做基本 schema 校验（防原型污染）
 * 失败返回 null。
 */
export async function deobfuscateJSONAsync<T>(raw: string): Promise<T | null> {
  if (!raw) return null;
  const json = await deobfuscateStringAsync(raw);
  try {
    const parsed = JSON.parse(json);
    if (!isSafeParsed(parsed)) return null;
    return parsed as T;
  } catch {
    return null;
  }
}
