// ============================================================
// AI Debug — OpenAI 兼容 SSE 流式解析
// 参考 spark-flow 的 streaming.ts：按 \n\n 分隔事件、data: 前缀、
// [DONE] 结束、json.choices[0].delta.content 提取、心跳跳过。
// ============================================================

import { request, RequestError } from './request';

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
    response = await request(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...body, stream: true }),
      signal,
    });
  } catch (err) {
    // HTTP 非 2xx 错误补充 "LLM API stream error:" 前缀，保持原有错误文案
    if (err instanceof RequestError && err.type === 'http') {
      throw new Error(`LLM API stream error: ${err.message}`);
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
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) yield delta;
          } catch {
            // 跳过无法解析的行（心跳、注释等）
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
