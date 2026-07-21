// ============================================================
// AI Debug — 统一错误分类与上报
//
// 提供 classifyError 把任意 unknown 错误归一化为已知分类；
// reportError 记录到 console.error 并返回分类结果，供调用方决策。
// 不引入 toast 通知（保持单一职责），由调用方根据分类结果决定如何提示用户。
// 不上报到外部服务（项目无后端）。
// ============================================================

/** 统一错误分类 */
export type ErrorType = 'NetworkError' | 'QuotaError' | 'AbortError' | 'UnknownError';

/** classifyError 返回的分类结果 */
export interface ClassifiedError {
  /** 错误分类 */
  type: ErrorType;
  /** 可读错误消息（已脱敏，调用方可直接展示） */
  message: string;
  /** 原始错误对象，调用方可用于进一步处理 */
  originalError?: unknown;
}

/**
 * 把任意错误归一化为已知分类。
 * - QuotaExceededError（localStorage 配额满）→ QuotaError
 * - AbortError（用户取消请求 / AbortController.abort()）→ AbortError
 * - 网络错误（"Failed to fetch" / "网络错误"）→ NetworkError
 * - 其他 → UnknownError
 */
export function classifyError(error: unknown): ClassifiedError {
  if (error instanceof Error) {
    const name = error.name;
    const msg = error.message || '';

    // QuotaExceededError：部分浏览器抛 DOMException（name='QuotaExceededError'）
    if (name === 'QuotaExceededError' || /quota/i.test(msg)) {
      return {
        type: 'QuotaError',
        message: msg || 'Storage quota exceeded',
        originalError: error,
      };
    }

    // AbortError：fetch 取消、AbortController.abort()
    if (name === 'AbortError') {
      return {
        type: 'AbortError',
        message: msg || 'Request aborted',
        originalError: error,
      };
    }

    // 网络层错误：fetch 跨域 / DNS 失败抛 TypeError "Failed to fetch"，
    // 自定义网络错误消息含 "网络错误"
    if (/Failed to fetch/i.test(msg) || /网络错误/.test(msg) || name === 'NetworkError') {
      return {
        type: 'NetworkError',
        message: msg || 'Network error',
        originalError: error,
      };
    }

    return {
      type: 'UnknownError',
      message: msg || 'Unknown error',
      originalError: error,
    };
  }

  // 非 Error 类型（字符串、null、undefined 等）
  const fallback = error == null ? 'Unknown error' : String(error);
  return { type: 'UnknownError', message: fallback, originalError: error };
}

/**
 * 上报错误：记录到 console.error 并返回分类结果。
 * 调用方根据返回的 type 决定是否 toast 提示用户（本函数不引入 toast）。
 *
 * @param error   任意错误对象
 * @param context 可选上下文标签（如 'saveProjects' / 'streamTurn'），便于日志检索
 */
export function reportError(error: unknown, context?: string): ClassifiedError {
  const classified = classifyError(error);
  const prefix = context ? `[${context}]` : '[error]';
  // 仅打印到本地 console，不上报到外部服务（项目无后端，API Key 仅本地存储）
  console.error(prefix, classified.type, classified.message, error);
  return classified;
}
