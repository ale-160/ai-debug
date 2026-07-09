// ============================================================
// AI Debug — LLM 调用客户端
// OpenAI 兼容 API 的非流式 / 流式（SSE）调用实现
// SSE 解析复用 ./streaming.ts，fetch + 错误归一化复用 ./request.ts
// 并发控制 + 429/5xx 退避重试复用 ./request-pool.ts
// ============================================================

import type { LLMConfig } from './llm-config';
import { RequestError } from './request';
import { openAICompatibleStream } from './streaming';
import { getRequestPool, parseRetryAfterMs, RequestPoolError } from './request-pool';

/** 消息类型（支持多模态文本与图片） */
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content:
    | string
    | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
}

/** 调用 LLM 的参数 */
export interface CallLLMOptions {
  config: LLMConfig;
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

/**
 * LLM HTTP 错误。携带 status 与可选 retryAfterMs（来自 Retry-After 头），
 * 供并发池识别可重试错误（429/5xx）与计算退避时间。
 */
export class LLMHttpError extends Error {
  readonly status: number;
  readonly retryAfterMs?: number;
  constructor(message: string, status: number, retryAfterMs?: number) {
    super(message);
    this.name = 'LLMHttpError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/** 从 LLM API 错误前缀提取可读 message（保持与原实现兼容） */
function llmApiErrorMessage(status: number, errorText: string): string {
  return `LLM API error: ${status} - ${errorText.slice(0, 500)}`;
}

/**
 * 拼接 chat completions 端点 URL，避免 baseUrl 末尾重复 /。
 * 例如 'https://api.openai.com/v1' -> 'https://api.openai.com/v1/chat/completions'
 */
function buildEndpoint(baseUrl: string): string {
  const normalized = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return `${normalized}/chat/completions`;
}

/**
 * 构造请求头。
 * OpenRouter 额外需要 HTTP-Referer 与 X-Title。
 */
function buildHeaders(config: LLMConfig): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.apiKey}`,
  };
  if (config.provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://ai-debug.local';
    headers['X-Title'] = 'Bug Hunter';
  }
  return headers;
}

/**
 * 构造请求体（不含 stream 字段，由调用方决定）。
 */
function buildBody(options: CallLLMOptions, stream: boolean): Record<string, unknown> {
  return {
    model: options.config.model,
    messages: options.messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 2048,
    stream,
  };
}

/**
 * 非流式调用 LLM，返回完整文本。
 *
 * 通过并发池 getRequestPool(provider) 接入：
 * - 并发上限 4（默认），超出时 FIFO 排队
 * - 429 / 5xx 错误按指数退避（1s→2s→4s→8s）重试，最多 3 次
 * - 读取 Retry-After 头作为退避下限
 * - 4xx 非 429（认证/参数错）立即抛出，不重试
 * - AbortError 原样抛出，保留取消能力
 * - 重试耗尽抛 RequestPoolError（含 attempts/lastStatus）
 *
 * HTTP 非 2xx 时抛 LLMHttpError（保留原有 "LLM API error:" 前缀文案）。
 */
export async function callLLM(options: CallLLMOptions): Promise<string> {
  const { config, signal } = options;
  const url = buildEndpoint(config.baseUrl);
  const headers = buildHeaders(config);
  const body = buildBody(options, false);
  const pool = getRequestPool(config.provider);

  let response: Response;
  try {
    response = await pool.run(
      async () => {
        // 直接 fetch（而非 request()），以便捕获 Retry-After 头
        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal,
        });
        if (!res.ok) {
          const errorText = await res.text().catch(() => '');
          const retryAfterMs = parseRetryAfterMs(res.headers.get('retry-after'));
          throw new LLMHttpError(
            llmApiErrorMessage(res.status, errorText),
            res.status,
            retryAfterMs,
          );
        }
        return res;
      },
      { signal },
    );
  } catch (err) {
    // 保留原有错误文案约定：HTTP 错误已包成 LLMHttpError；其他错误（网络/超时/取消）原样抛出
    if (err instanceof RequestPoolError) throw err;
    if (err instanceof LLMHttpError) throw err;
    // request.ts 风格的 RequestError（理论上不再触发，因为已绕过 request()）；
    // 保留兜底以防未来重构
    if (err instanceof RequestError && err.type === 'http') {
      throw new Error(`LLM API error: ${err.message}`);
    }
    throw err;
  }

  const json = await response.json();
  const content: string = json?.choices?.[0]?.message?.content ?? '';
  return content;
}

/**
 * 流式调用 LLM（SSE），逐块 yield 文本内容。
 *
 * 通过并发池 getRequestPool(provider) 的 runStream 接入并发控制：
 * - 并发上限 4（默认），超出时 FIFO 排队
 * - 不重试（流式一旦开始 yield 不能中途重试，避免重复输出）
 * - AbortError 原样抛出，保留取消能力
 * - HTTP 非 2xx 错误由 openAICompatibleStream 内部抛出
 *
 * 复用 streaming.ts 的 openAICompatibleStream 进行 SSE 解析。
 */
export async function* callLLMStream(options: CallLLMOptions): AsyncGenerator<string> {
  const { config, signal } = options;
  const url = buildEndpoint(config.baseUrl);
  const headers = buildHeaders(config);
  const body = buildBody(options, true);
  const pool = getRequestPool(config.provider);

  yield* pool.runStream(() => openAICompatibleStream({ url, headers, body, signal }), { signal });
}

/**
 * 测试 LLM 连接是否可用。
 * 发送一条最小消息 "ping"，验证返回 200。
 * 自动享受并发池与重试（通过 callLLM）。
 */
export async function testLLMConnection(
  config: LLMConfig,
): Promise<{ success: boolean; message: string }> {
  try {
    const text = await callLLM({
      config,
      messages: [{ role: 'user', content: 'ping' }],
      maxTokens: 16,
    });
    return {
      success: true,
      message: `连接成功${text ? `：${text.slice(0, 80)}` : ''}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, message };
  }
}

// 重新导出 RequestPoolError 供上层（network-engine）识别"重试耗尽失败"
export { RequestPoolError } from './request-pool';
