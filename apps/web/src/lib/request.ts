// ============================================================
// AI Debug — 通用请求封装
// 统一 fetch + AbortSignal + 错误归一化：
//   网络 / 超时 / 非 2xx → RequestError（含 message / status / type）
//   用户取消（AbortError）原样抛出，保持取消能力。
// ============================================================

/** 归一化错误类型 */
export type RequestErrorType = 'http' | 'network' | 'timeout';

/**
 * 归一化请求错误，含可读 message / HTTP status / 类型标识。
 * - http: 非 2xx 响应（status 为 HTTP 状态码）
 * - network: 网络层错误（DNS、连接失败等，status=0）
 * - timeout: 请求超时（status=0）
 */
export class RequestError extends Error {
  readonly status: number;
  readonly type: RequestErrorType;
  constructor(message: string, status: number, type: RequestErrorType) {
    super(message);
    this.name = 'RequestError';
    this.status = status;
    this.type = type;
  }
}

/** 通用请求选项 */
export interface RequestOptions {
  /** HTTP 方法，默认 GET */
  method?: string;
  /** 请求头 */
  headers?: Record<string, string>;
  /** 请求体（已序列化的字符串） */
  body?: string;
  /** 可选 AbortSignal，可中止请求 */
  signal?: AbortSignal;
  /** fetch credentials 模式，默认 'omit'（避免 cookie / 桌面端凭据自动附加到 LLM 跨域请求） */
  credentials?: RequestCredentials;
}

/**
 * 通用 fetch 封装：透传 AbortSignal，非 2xx / 网络 / 超时错误统一为 RequestError。
 * 取消（AbortError）原样抛出，保持取消语义不变。
 *
 * @param url      请求 URL
 * @param options  method / headers / body / signal / credentials
 * @returns        原始 Response（已校验 ok）
 */
export async function request(url: string, options: RequestOptions = {}): Promise<Response> {
  const { method = 'GET', headers, body, signal, credentials = 'omit' } = options;
  try {
    const res = await fetch(url, { method, headers, body, signal, credentials });
    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      throw new RequestError(`${res.status} - ${errorText.slice(0, 500)}`, res.status, 'http');
    }
    return res;
  } catch (err) {
    if (err instanceof RequestError) throw err;
    // 超时（AbortSignal.timeout 触发的 TimeoutError）
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new RequestError(err.message || '请求超时', 0, 'timeout');
    }
    // 取消（AbortError）原样抛出，保持取消能力
    if (err instanceof Error && err.name === 'AbortError') {
      throw err;
    }
    // 其他网络错误（TypeError 等）—— 归一化为友好提示，避免暴露 fetch 原始错误
    // 保留原始错误到 console 便于排查
    console.error('[request] 网络错误：', err);
    throw new RequestError('网络错误，请检查连接', 0, 'network');
  }
}

/**
 * 把任意错误归一化为可读 message 字符串，供调用方 catch 使用。
 * 保留原 Error.message，非 Error 值转 String。
 */
export function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * 脱敏 LLM 错误响应中可能回显的敏感信息（apiKey / Authorization 头）。
 *
 * 某些服务商在错误响应体中会回显请求头，导致 Authorization: Bearer xxx 或 sk-xxx
 * 形式的 apiKey 被透传到 UI。本函数在拼接错误消息前进行正则替换：
 * - sk- 开头并跟随 20+ 位字符的 key → sk-***
 * - Bearer xxx（10+ 位）→ Bearer ***
 * - Authorization: ... 整行 → Authorization: ***
 * 最后截断到 500 字符。
 */
export function sanitizeLLMErrorText(text: string): string {
  if (!text) return '';
  let out = text;
  // 替换 OpenAI 风格的 sk- key
  out = out.replace(/sk-[A-Za-z0-9_-]{20,}/g, 'sk-***');
  // 替换 Bearer token
  out = out.replace(/Bearer\s+[A-Za-z0-9_-]{10,}/gi, 'Bearer ***');
  // 替换 Authorization 整行（覆盖大小写、空格差异）
  out = out.replace(/Authorization\s*:\s*[^\r\n]+/gi, 'Authorization: ***');
  return out.slice(0, 500);
}
