// ============================================================
// AI Debug — LLM 调用客户端
// OpenAI 兼容 API 的非流式 / 流式（SSE）调用实现
// 参考 spark-flow 的 streaming.ts SSE 解析逻辑
// ============================================================

import type { LLMConfig } from './llm-config';

/** 消息类型（支持多模态文本与图片） */
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content:
    | string
    | Array<
        | { type: 'text'; text: string }
        | { type: 'image_url'; image_url: { url: string } }
      >;
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
 * 拼接 chat completions 端点 URL，避免 baseUrl 末尾重复 /。
 * 例如 'https://api.openai.com/v1' -> 'https://api.openai.com/v1/chat/completions'
 */
function buildEndpoint(baseUrl: string): string {
  const normalized = baseUrl.endsWith('/')
    ? baseUrl.slice(0, -1)
    : baseUrl;
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
function buildBody(
  options: CallLLMOptions,
  stream: boolean,
): Record<string, unknown> {
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
 * HTTP 非 2xx 时抛出带状态码与响应体的错误。
 */
export async function callLLM(options: CallLLMOptions): Promise<string> {
  const { config, signal } = options;
  const url = buildEndpoint(config.baseUrl);
  const headers = buildHeaders(config);
  const body = buildBody(options, false);

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(
      `LLM API error: ${response.status} - ${errorText.slice(0, 500)}`,
    );
  }

  const json = await response.json();
  const content: string = json?.choices?.[0]?.message?.content ?? '';
  return content;
}

/**
 * 流式调用 LLM（SSE），逐块 yield 文本内容。
 * 参考 spark-flow streaming.ts 的解析逻辑：
 * - 按 \n\n 分割事件
 * - 每行以 data: 开头
 * - [DONE] 表示流结束
 * - 解析 json.choices[0].delta.content
 */
export async function* callLLMStream(
  options: CallLLMOptions,
): AsyncGenerator<string> {
  const { config, signal } = options;
  const url = buildEndpoint(config.baseUrl);
  const headers = buildHeaders(config);
  const body = buildBody(options, true);

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(
      `LLM API stream error: ${response.status} - ${errorText.slice(0, 500)}`,
    );
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

/**
 * 测试 LLM 连接是否可用。
 * 发送一条最小消息 "ping"，验证返回 200。
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
