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
  /**
   * 4.8.1：熔断阈值（连续失败次数），默认 5。
   * 连续达到此次数的失败后熔断 circuitBreakerMs 毫秒。
   */
  circuitBreakerThreshold?: number;
  /**
   * 4.8.1：熔断时长（毫秒），默认 60000（60s）。
   * 熔断期间所有新任务直接抛 CircuitBreakerError，不发起请求。
   */
  circuitBreakerMs?: number;
  /**
   * 4.8.3：排队超时（毫秒），默认 30000（30s）。
   * 任务在并发池队列中等待超过此时间则抛 TimeoutError，避免长队列下
   * 用户长时间无响应（如服务端持续 429 限流，任务排队等待槽位但永远拿不到）。
   * 30s 是平衡值：覆盖正常退避重试占用槽位的时间（最大 8s 退避 × 几次重试），
   * 又不让用户等太久。设为 0 / 负数禁用排队超时。
   */
  queueTimeoutMs?: number;
}

/**
 * 4.8.1：熔断错误。
 * 连续失败次数达到 circuitBreakerThreshold 后，熔断期间新任务抛此错误。
 * 调用方可据此区分"服务端持续异常，应停止重试" vs "单次失败可重试"。
 */
export class CircuitBreakerError extends Error {
  /** 熔断恢复时间戳（Date.now() + circuitBreakerMs） */
  readonly retryAfterMs: number;
  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = 'CircuitBreakerError';
    this.retryAfterMs = retryAfterMs;
  }
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

/**
 * 4.8.3：排队超时错误。
 * 任务在并发池队列中等待超过 queueTimeoutMs 时抛出。
 * 调用方可通过 instanceof QueueTimeoutError 区分"排队超时" vs "请求本身失败"，
 * 据此给出更友好的提示（如"系统繁忙，请稍后重试"而非"网络错误"）。
 */
export class QueueTimeoutError extends Error {
  /** 排队等待时长（毫秒） */
  readonly waitedMs: number;
  constructor(message: string, waitedMs: number) {
    super(message);
    this.name = 'QueueTimeoutError';
    this.waitedMs = waitedMs;
  }
}

/** 排队等待者 */
interface QueueWaiter {
  resolve: () => void;
  reject: (err: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
  /** 4.8.3：排队超时定时器句柄，用于在拿到槽位或被 abort 时清除 */
  timeoutTimer?: ReturnType<typeof setTimeout>;
  /** 4.8.3：入队时间戳，超时时用于计算 waitedMs */
  enqueuedAt: number;
}

export class RequestPool {
  private activeCount = 0;
  private readonly queue: QueueWaiter[] = [];
  private readonly maxConcurrency: number;
  private readonly maxRetries: number;
  private readonly backoffBaseMs: number;
  private readonly backoffMaxMs: number;
  /**
   * 4.8.1：连续失败计数器。任务成功时重置为 0。
   * 任务失败（不可重试错误或重试耗尽 RequestPoolError）时 +1。
   * 注意：AbortError（用户主动取消）不计入失败。
   */
  private consecutiveFailures = 0;
  /**
   * 4.8.1：熔断恢复时间戳（Date.now() + circuitBreakerMs）。
   * 0 表示未熔断；> Date.now() 表示熔断中。
   */
  private circuitBreakerUntil = 0;
  private readonly circuitBreakerThreshold: number;
  private readonly circuitBreakerMs: number;
  /** 4.8.3：排队超时（毫秒），0 或负数表示禁用 */
  private readonly queueTimeoutMs: number;

  constructor(options: RequestPoolOptions = {}) {
    this.maxConcurrency = options.maxConcurrency ?? 4;
    this.maxRetries = options.maxRetries ?? 3;
    this.backoffBaseMs = options.backoffBaseMs ?? 1000;
    this.backoffMaxMs = options.backoffMaxMs ?? 8000;
    this.circuitBreakerThreshold = options.circuitBreakerThreshold ?? 5;
    this.circuitBreakerMs = options.circuitBreakerMs ?? 60000;
    this.queueTimeoutMs = options.queueTimeoutMs ?? 30000;
  }

  /**
   * 4.8.1：检查熔断状态。熔断中时抛 CircuitBreakerError。
   * 调用方应在发起任务前调用此方法。
   */
  private checkCircuitBreaker(): void {
    if (this.circuitBreakerUntil === 0) return;
    const now = Date.now();
    if (now < this.circuitBreakerUntil) {
      const remainingMs = this.circuitBreakerUntil - now;
      throw new CircuitBreakerError(
        `circuit breaker open, retry after ${(remainingMs / 1000).toFixed(1)}s`,
        remainingMs,
      );
    }
    // 熔断已过期，重置（半开状态允许下一次任务尝试）
    this.circuitBreakerUntil = 0;
    this.consecutiveFailures = 0;
  }

  /**
   * 4.8.1：记录任务失败。连续失败次数达到阈值时触发熔断。
   * 注意：AbortError 不计入失败（用户主动取消不应触发熔断）。
   */
  private recordFailure(): void {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.circuitBreakerThreshold) {
      this.circuitBreakerUntil = Date.now() + this.circuitBreakerMs;
      // 上报到 console 便于运维感知
      console.error(
        `[request-pool] circuit breaker opened: ${this.consecutiveFailures} consecutive failures, ` +
          `will retry after ${this.circuitBreakerMs / 1000}s`,
      );
    }
  }

  /** 4.8.1：记录任务成功，重置连续失败计数 */
  private recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.circuitBreakerUntil = 0;
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

    // 4.8.1：熔断检测（在排队前检查，熔断中直接抛错不占用槽位）
    this.checkCircuitBreaker();

    // 1. 等待并发槽
    await this.waitForSlot(signal);

    // 2. 占槽执行 + 重试循环
    this.activeCount++;
    try {
      let attempt = 0;
      while (true) {
        try {
          const result = await task();
          // 4.8.1：任务成功，重置失败计数
          this.recordSuccess();
          return result;
        } catch (err) {
          // AbortError 原样抛出（不计入熔断失败计数）
          if (isAbortError(err)) throw err;

          const retryable = isRetryableError(err);
          if (!retryable || attempt >= this.maxRetries) {
            // 4.8.1：任务失败（重试耗尽或不可重试），记录失败计数
            this.recordFailure();
            if (retryable) {
              // 可重试但耗尽：抛 RequestPoolError 包装
              throw new RequestPoolError(
                err instanceof Error ? err.message : String(err),
                attempt + 1,
                getErrorStatus(err),
              );
            }
            // 网络错误（fetch 抛出的 TypeError 等）归一化为友好提示，
            // 避免暴露原始 fetch 错误原文；保留原始错误到 console 便于排查
            if (isNetworkError(err)) {
              console.error('[request-pool] 网络错误：', err);
              throw new Error('网络错误，请检查连接');
            }
            // 其他不可重试错误原样抛出（保留原始错误类型与字段）
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
   * 运行 AsyncGenerator 风格任务，并发槽控制 + yield 前错误重试。
   *
   * 3.2.2：区分"yield 前错误"和"yield 中错误"：
   * - yield 前错误（如 429/5xx 在建立流连接时返回）：按指数退避重试，避免瞬时限流直接失败
   * - yield 中错误（已开始输出后中途断流）：原样抛出，不重试（避免重复输出）
   * - AbortError 永远原样抛出
   * - 重试耗尽抛 RequestPoolError（含 attempts/lastStatus）
   *
   * @param genFactory  生成器工厂（每次调用返回新生成器）
   * @param options     signal 可选
   */
  async *runStream<T>(
    genFactory: () => AsyncGenerator<T>,
    options: { signal?: AbortSignal } = {},
  ): AsyncGenerator<T> {
    const signal = options.signal;

    // 4.8.1：熔断检测（在排队前检查，熔断中直接抛错不占用槽位）
    this.checkCircuitBreaker();

    // 1. 等待并发槽
    await this.waitForSlot(signal);

    // 2. 占槽迭代 + yield 前错误重试
    this.activeCount++;
    try {
      let attempt = 0;
      // hasYielded 标记是否已开始输出。已输出后的错误不重试。
      let hasYielded = false;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const gen = genFactory();
        try {
          for await (const chunk of gen) {
            hasYielded = true;
            yield chunk;
          }
          // 4.8.1：流式任务成功结束，重置失败计数
          this.recordSuccess();
          return; // 正常结束
        } catch (err) {
          // AbortError 原样抛出（取消语义不变）
          if (isAbortError(err)) throw err;
          // 已开始 yield 后的错误：原样抛出（避免重复输出）
          // 4.8.1：流式中断也视为任务失败，记录失败计数
          if (hasYielded) {
            this.recordFailure();
            throw err;
          }
          // yield 前错误：判断是否可重试
          const retryable = isRetryableError(err);
          if (!retryable || attempt >= this.maxRetries) {
            // 4.8.1：任务失败（重试耗尽或不可重试），记录失败计数
            this.recordFailure();
            if (retryable) {
              throw new RequestPoolError(
                err instanceof Error ? err.message : String(err),
                attempt + 1,
                getErrorStatus(err),
              );
            }
            if (isNetworkError(err)) {
              console.error('[request-pool] 网络错误：', err);
              throw new Error('网络错误，请检查连接');
            }
            throw err;
          }
          // 可重试且未耗尽：退避等待后重试（重新调用 genFactory 建立新连接）
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
   * 等待并发槽。槽满时入队 FIFO 等待；排队期间被 signal 取消时抛 AbortError。
   *
   * 4.8.3：增加排队超时（queueTimeoutMs，默认 30s）。任务在队列中等待超过
   * 此时间则抛 QueueTimeoutError，避免长队列下用户长时间无响应。
   * 超时任务会从队列中移除（dequeue 时跳过已 reject 的 waiter）。
   */
  private waitForSlot(signal?: AbortSignal): Promise<void> {
    if (this.activeCount < this.maxConcurrency) {
      if (signal?.aborted) {
        return Promise.reject(createAbortError());
      }
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const enqueuedAt = Date.now();
      const waiter: QueueWaiter = { resolve, reject, signal, enqueuedAt };
      this.queue.push(waiter);

      // 4.8.3：排队超时定时器
      if (this.queueTimeoutMs > 0) {
        waiter.timeoutTimer = setTimeout(() => {
          const idx = this.queue.indexOf(waiter);
          if (idx >= 0) {
            this.queue.splice(idx, 1);
          }
          // 清理 abort 监听器（若已注册）
          if (waiter.signal && waiter.onAbort) {
            waiter.signal.removeEventListener('abort', waiter.onAbort);
          }
          const waitedMs = Date.now() - enqueuedAt;
          reject(
            new QueueTimeoutError(
              `queue timeout after ${waitedMs}ms (concurrency=${this.maxConcurrency}, queue=${this.queue.length})`,
              waitedMs,
            ),
          );
        }, this.queueTimeoutMs);
      }

      if (signal) {
        const onAbort = () => {
          // abort 时清除超时定时器
          if (waiter.timeoutTimer) clearTimeout(waiter.timeoutTimer);
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
    // 4.8.3：循环跳过已超时 / 已 abort 的 waiter（其 resolve/reject 已调用过）
    while (this.queue.length > 0) {
      const next = this.queue.shift()!;
      // 清除超时定时器（拿到槽位后不再计时）
      if (next.timeoutTimer) clearTimeout(next.timeoutTimer);
      if (next.signal && next.onAbort) {
        next.signal.removeEventListener('abort', next.onAbort);
      }
      // 若 signal 已 abort（在拿到槽位前被取消），跳过此 waiter
      if (next.signal?.aborted) {
        // 已 reject 过，继续找下一个
        continue;
      }
      next.resolve();
      return;
    }
  }
}

// ---------- 工具函数 ----------

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

/**
 * 判断错误是否为网络层错误（fetch 抛出的 TypeError 等）。
 *
 * fetch 在 DNS 解析失败、连接被拒绝、CORS 阻断、网络中断等场景下抛 TypeError，
 * 消息通常含 "Failed to fetch" / "NetworkError" / "Load failed"。
 * 此处仅识别这类错误，便于上层归一化为友好提示，避免暴露原始错误原文。
 */
function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // TypeError 是 fetch 网络错误的典型类型
  if (err.constructor.name === 'TypeError') return true;
  const msg = err.message || '';
  return (
    /Failed to fetch/i.test(msg) ||
    /NetworkError/i.test(msg) ||
    /Load failed/i.test(msg) ||
    /network/i.test(msg)
  );
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
 * 4.8.2：Retry-After 解析后的上限（毫秒，60 秒）。
 * 防止恶意服务端返回超大的 Retry-After（如 86400 秒 = 24 小时）导致客户端长时间不重试。
 */
const MAX_RETRY_AFTER_MS = 60_000;

/**
 * 解析 Retry-After 响应头为毫秒数。
 * - 数字字符串：视为秒，返回 × 1000
 * - HTTP date：返回与当前时间的差值
 * - 其他/无效：返回 undefined
 *
 * 4.8.2：对返回值加上限 MAX_RETRY_AFTER_MS（60s）。
 * 恶意或异常服务端可能返回超大的 Retry-After（如 86400 秒 = 24 小时），
 * 若不加限制会导致客户端长时间不重试、UI 长时间卡住。
 * 60s 上限足够尊重正常限流场景，又能避免异常值。
 */
export function parseRetryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();

  // 数字（秒）
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (seconds <= 0) return undefined;
    // 4.8.2：上限 60s
    return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  }

  // HTTP date
  const date = Date.parse(trimmed);
  if (!Number.isNaN(date)) {
    const ms = date - Date.now();
    if (ms <= 0) return 0;
    // 4.8.2：上限 60s
    return Math.min(ms, MAX_RETRY_AFTER_MS);
  }

  return undefined;
}
