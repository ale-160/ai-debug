// ============================================================
// AI Debug — 并发池 + 429 退避重试 + 取消传播
//
// 提供两个核心能力：
//   1. RequestPool.run：Promise 风格任务，含并发槽控制 + 429/5xx 指数退避重试
//   2. RequestPool.runStream：AsyncGenerator 风格任务，仅并发槽控制（不重试，
//      避免流式调用中途重试导致重复输出）
//
// 默认按 LLMProvider 分池（getRequestPool），单池 maxConcurrency=4。
// 重试触发条件：任务抛出的错误对象包含 status 字段且值为 429 或 5xx；
// 不可重试错误（4xx 非 429、网络错、超时）原样抛出；AbortError 原样抛出。
// 重试耗尽抛 RequestPoolError，含 attempts/lastStatus 供调用方区分"重试耗尽失败"。
//
// Retry-After 通过错误对象的 retryAfterMs 字段传递（调用方在抛错时填入）。
// ============================================================

import type { LLMProvider } from './llm-config';

/** 池配置 */
export interface RequestPoolOptions {
  /** 最大并发数，默认 4 */
  maxConcurrency?: number;
  /** 最大重试次数，默认 3（首次 + 3 次重试 = 4 次尝试） */
  maxRetries?: number;
  /** 退避基数（毫秒），默认 1000（序列 1s → 2s → 4s → 8s） */
  backoffBaseMs?: number;
  /** 退避上限（毫秒），默认 8000 */
  backoffMaxMs?: number;
}

/**
 * 重试耗尽错误。
 * 当任务抛出可重试错误（含 status 字段且为 429/5xx）且达到 maxRetries 时抛出。
 * 调用方可通过 instanceof RequestPoolError 区分"重试耗尽失败" vs "其他失败"。
 */
export class RequestPoolError extends Error {
  /** 总尝试次数（含首次） */
  readonly attempts: number;
  /** 最后一次错误的 HTTP status（无 status 时为 0） */
  readonly lastStatus: number;
  constructor(message: string, attempts: number, lastStatus: number) {
    super(message);
    this.name = 'RequestPoolError';
    this.attempts = attempts;
    this.lastStatus = lastStatus;
  }
}

/** 排队等待者 */
interface QueueWaiter {
  resolve: () => void;
  reject: (err: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

export class RequestPool {
  private activeCount = 0;
  private readonly queue: QueueWaiter[] = [];
  private readonly maxConcurrency: number;
  private readonly maxRetries: number;
  private readonly backoffBaseMs: number;
  private readonly backoffMaxMs: number;

  constructor(options: RequestPoolOptions = {}) {
    this.maxConcurrency = options.maxConcurrency ?? 4;
    this.maxRetries = options.maxRetries ?? 3;
    this.backoffBaseMs = options.backoffBaseMs ?? 1000;
    this.backoffMaxMs = options.backoffMaxMs ?? 8000;
  }

  /**
   * 运行 Promise 风格任务，含并发槽控制 + 429/5xx 指数退避重试。
   *
   * - 任务抛 AbortError → 立即原样抛出（取消语义不变）
   * - 任务抛可重试错误（status=429 或 5xx）→ 按指数退避重试，最多 maxRetries 次
   * - 任务抛不可重试错误 → 立即原样抛出
   * - 重试耗尽 → 抛 RequestPoolError（含 attempts/lastStatus）
   * - 排队等待期间被 signal 取消 → 抛 AbortError
   *
   * @param task     任务函数（应抛含 status 字段的对象以触发重试）
   * @param options  signal 可选
   */
  async run<T>(task: () => Promise<T>, options: { signal?: AbortSignal } = {}): Promise<T> {
    const signal = options.signal;

    // 1. 等待并发槽
    await this.waitForSlot(signal);

    // 2. 占槽执行 + 重试循环
    this.activeCount++;
    try {
      let attempt = 0;
      while (true) {
        try {
          return await task();
        } catch (err) {
          // AbortError 原样抛出
          if (isAbortError(err)) throw err;

          const retryable = isRetryableError(err);
          if (!retryable || attempt >= this.maxRetries) {
            if (retryable) {
              // 可重试但耗尽：抛 RequestPoolError 包装
              throw new RequestPoolError(
                err instanceof Error ? err.message : String(err),
                attempt + 1,
                getErrorStatus(err),
              );
            }
            // 不可重试错误原样抛出（保留原始错误类型与字段）
            throw err;
          }
          // 可重试且未耗尽：退避等待后重试
          const delay = computeBackoff(attempt, err, this.backoffBaseMs, this.backoffMaxMs);
          await sleep(delay, signal);
          attempt++;
        }
      }
    } finally {
      this.activeCount--;
      this.dequeue();
    }
  }

  /**
   * 运行 AsyncGenerator 风格任务，仅并发槽控制（不重试）。
   *
   * 流式调用一旦开始 yield 就不能重试（中途重试会导致重复输出），
   * 因此本方法只提供并发 throttling，错误原样抛出。
   *
   * @param genFactory  生成器工厂（每次调用返回新生成器）
   * @param options     signal 可选
   */
  async *runStream<T>(
    genFactory: () => AsyncGenerator<T>,
    options: { signal?: AbortSignal } = {},
  ): AsyncGenerator<T> {
    // 1. 等待并发槽
    await this.waitForSlot(options.signal);

    // 2. 占槽迭代（不重试，错误原样抛出）
    this.activeCount++;
    try {
      for await (const chunk of genFactory()) {
        yield chunk;
      }
    } finally {
      this.activeCount--;
      this.dequeue();
    }
  }

  /**
   * 等待并发槽。槽满时入队 FIFO 等待；排队期间被 signal 取消时抛 AbortError。
   */
  private waitForSlot(signal?: AbortSignal): Promise<void> {
    if (this.activeCount < this.maxConcurrency) {
      if (signal?.aborted) {
        return Promise.reject(createAbortError());
      }
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const waiter: QueueWaiter = { resolve, reject, signal };
      this.queue.push(waiter);

      if (signal) {
        const onAbort = () => {
          const idx = this.queue.indexOf(waiter);
          if (idx >= 0) {
            this.queue.splice(idx, 1);
            reject(createAbortError());
          }
        };
        waiter.onAbort = onAbort;
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  /** 唤醒队首等待者 */
  private dequeue(): void {
    const next = this.queue.shift();
    if (next) {
      if (next.signal && next.onAbort) {
        next.signal.removeEventListener('abort', next.onAbort);
      }
      next.resolve();
    }
  }
}

// ---------- 工具函数 ----------

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

function createAbortError(): Error {
  const err = new Error('Aborted');
  err.name = 'AbortError';
  return err;
}

/**
 * 判断错误是否可重试。约定：错误对象含 status 字段且值为 429 或 5xx。
 * 网络错（无 status）与超时不可重试，避免雪崩。
 */
function isRetryableError(err: unknown): boolean {
  if (err && typeof err === 'object' && 'status' in err) {
    const status = (err as { status: unknown }).status;
    if (typeof status === 'number') {
      return status === 429 || (status >= 500 && status < 600);
    }
  }
  return false;
}

function getErrorStatus(err: unknown): number {
  if (err && typeof err === 'object' && 'status' in err) {
    const status = (err as { status: unknown }).status;
    if (typeof status === 'number') return status;
  }
  return 0;
}

/**
 * 计算退避时间。基数 × 2^attempt，上限 backoffMaxMs。
 * 若错误对象含 retryAfterMs（来自 Retry-After 头），取 max(计算值, retryAfterMs)。
 */
function computeBackoff(attempt: number, err: unknown, baseMs: number, maxMs: number): number {
  let delay = baseMs * Math.pow(2, attempt);
  if (err && typeof err === 'object' && 'retryAfterMs' in err) {
    const v = (err as { retryAfterMs?: unknown }).retryAfterMs;
    if (typeof v === 'number' && v > 0) {
      delay = Math.max(delay, v);
    }
  }
  return Math.min(delay, maxMs);
}

/**
 * 可取消的 sleep。signal 触发时立即 reject AbortError。
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(createAbortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// ---------- Per-Provider 池单例 ----------

const poolCache = new Map<LLMProvider, RequestPool>();

/**
 * 获取指定 provider 的并发池单例。
 * 不同 provider 使用独立池，避免一个服务商的限流影响另一个。
 */
export function getRequestPool(provider: LLMProvider): RequestPool {
  let pool = poolCache.get(provider);
  if (!pool) {
    pool = new RequestPool();
    poolCache.set(provider, pool);
  }
  return pool;
}

/**
 * 解析 Retry-After 响应头为毫秒数。
 * - 数字字符串：视为秒，返回 × 1000
 * - HTTP date：返回与当前时间的差值
 * - 其他/无效：返回 undefined
 */
export function parseRetryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();

  // 数字（秒）
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return seconds > 0 ? seconds * 1000 : undefined;
  }

  // HTTP date
  const date = Date.parse(trimmed);
  if (!Number.isNaN(date)) {
    const ms = date - Date.now();
    return ms > 0 ? ms : 0;
  }

  return undefined;
}
