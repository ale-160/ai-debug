// ============================================================
// AI Debug — OpenAI 兼容 SSE 流式解析
// 参考 spark-flow 的 streaming.ts：按 \n\n 分隔事件、data: 前缀、
// [DONE] 结束、json.choices[0].delta.content 提取、心跳跳过。
// ============================================================

import { request, RequestError, sanitizeLLMErrorText } from './request';

/**
 * 流式响应中检测到 error chunk 时抛出的错误（如 GLM-4.7-flash 内容审核 / 限流 / token 超限）。
 * 服务商在流中返回 {"error":{"code":"1301","message":"..."}} 时，
 * JSON.parse 成功但 json.choices 为 undefined，原实现会静默吞掉错误。
 * 此处用自定义 Error 子类显式标记，方便上层 catch 区分 in-stream error 与 SSE 解析失败。
 */
export class InStreamError extends Error {
  /** 服务商原始错误码（如 "1301"），可能为 undefined */
  readonly code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'InStreamError';
    this.code = code;
  }
}

/** 流式调用选项 */
export interface OpenAICompatibleStreamOptions {
  /** API 端点 URL */
  url: string;
  /** 请求头（含 Authorization 等） */
  headers: Record<string, string>;
  /** 请求体（不含 stream 字段，会自动补 stream: true） */
  body: Record<string, unknown>;
  /** 可选 AbortSignal，可中止底层 HTTP 请求 */
  signal?: AbortSignal;
}

/**
 * 3.2.3：buffer 上限（1MB）。超过此值说明服务商未按 \n\n 分隔事件，
 * 可能是异常响应（如无限流式错误重试），抛错避免内存膨胀。
 */
const MAX_BUFFER_BYTES = 1024 * 1024;

/**
 * 解析 OpenAI 兼容的 SSE 流式响应，逐块 yield 文本内容。
 * - 按 \n\n 分割事件，每行以 data: 开头
 * - [DONE] 表示流结束
 * - 解析 json.choices[0].delta.content
 * - 跳过无法解析的行（心跳、注释等）
 * - 非 2xx 响应抛出 "LLM API stream error: ..." 错误
 *
 * @param options  url / headers / body / signal
 */
export async function* openAICompatibleStream(
  options: OpenAICompatibleStreamOptions,
): AsyncGenerator<string> {
  const { url, headers, body, signal } = options;

  let response: Response;
  try {
    // 显式 credentials: 'omit'，避免同源 cookie / 桌面端凭据自动附加
    response = await request(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...body, stream: true }),
      signal,
      credentials: 'omit',
    });
  } catch (err) {
    // HTTP 非 2xx 错误补充 "LLM API stream error:" 前缀，保持原有错误文案
    // 对错误消息做脱敏（防止 apiKey 回显）+ 长度限制 200 字符
    // 3.2.2：保留 status 字段，供 request-pool.runStream 识别 429/5xx 可重试错误
    if (err instanceof RequestError && err.type === 'http') {
      throw new RequestError(
        `LLM API stream error: ${sanitizeLLMErrorText(err.message).slice(0, 200)}`,
        err.status,
        'http',
      );
    }
    throw err;
  }

  if (!response.body) {
    throw new Error('LLM API stream: response.body 为空');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // 3.2.3：buffer 上限检查。服务商异常时可能持续输出无 \n\n 分隔的内容，
      // 导致 buffer 无限增长。超过 1MB 抛错，避免内存膨胀。
      if (buffer.length > MAX_BUFFER_BYTES) {
        throw new Error(
          `LLM API stream: buffer 超过 ${MAX_BUFFER_BYTES} 字节上限，可能服务商未按 SSE 协议输出`,
        );
      }

      // SSE 以 \n\n 分隔事件，每行以 data: 开头
      const events = buffer.split('\n\n');
      buffer = events.pop() || ''; // 保留最后不完整的事件

      for (const event of events) {
        for (const line of event.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;

          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') return; // 流结束

          try {
            const json = JSON.parse(data);
            // 检测 in-stream error chunk（GLM 内容审核/限流/token 超限等）
            // 服务商在流中返回 {"error":{"code":"1301","message":"..."}} 时，
            // JSON.parse 成功但 json.choices 为 undefined，错误会被静默吞掉。
            // 此处显式检测 json.error 并抛 InStreamError，让错误冒泡到用户界面。
            // 对错误消息做脱敏（防止 apiKey 回显）+ 长度限制 200 字符
            if (json.error) {
              const rawErrMsg = json.error.message || json.error.code || JSON.stringify(json.error);
              const errMsg = sanitizeLLMErrorText(String(rawErrMsg)).slice(0, 200);
              const errCode = json.error.code != null ? String(json.error.code) : undefined;
              throw new InStreamError(`LLM API in-stream error: ${errMsg}`, errCode);
            }
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) yield delta;
          } catch (e) {
            // 区分：InStreamError 向上抛出（让用户看到错误），
            // JSON.parse 失败（SyntaxError）仍静默跳过（心跳、注释等正常 SSE 行）
            if (e instanceof InStreamError) {
              throw e;
            }
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
