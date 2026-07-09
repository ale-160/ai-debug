// ============================================================
// AI Debug — LLM 便捷调用封装
// 基于 localStorage 配置的快捷调用与多模态消息构造
// ============================================================

import { loadConfig } from './llm-config';
import { callLLM, callLLMStream, type LLMMessage } from './llm-client';

/**
 * 从 localStorage 加载配置并发起调用（便捷函数）。
 *
 * - 若未配置 API Key，抛出 Error('请先配置 LLM API Key')
 * - 若传入 onDelta，使用 callLLMStream 流式调用，逐块回调并累加返回完整文本
 * - 否则使用 callLLM 非流式调用
 * - signal 会透传给底层 fetch，可真正中止 HTTP 请求
 *
 * @param prompt   文本 prompt 或完整消息数组（支持多模态）
 * @param onDelta  可选的流式回调，每收到一块文本即触发
 * @param signal   可选的 AbortSignal，可中止底层 HTTP 请求
 * @returns        完整的 LLM 响应文本
 */
export async function quickCallLLM(
  prompt: string | LLMMessage[],
  onDelta?: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const config = loadConfig();
  if (!config || !config.apiKey) {
    throw new Error('请先配置 LLM API Key');
  }

  // 字符串则包装为单条 user 消息，数组则直接使用
  const messages: LLMMessage[] = Array.isArray(prompt)
    ? prompt
    : [{ role: 'user', content: prompt }];

  // 传入 onDelta 时走流式调用，并把 signal 透传给底层 fetch
  if (onDelta) {
    let accumulated = '';
    for await (const chunk of callLLMStream({ config, messages, signal })) {
      accumulated += chunk;
      onDelta(chunk);
    }
    return accumulated;
  }

  // 否则走非流式调用，同样透传 signal
  return callLLM({ config, messages, signal });
}

/**
 * 构造带图片的多模态消息（user role）。
 *
 * content 为数组：先放文本，再为每个 base64 图片放 image_url。
 * 图片 base64 不含前缀时自动补上 `data:image/png;base64,`。
 *
 * @param text             文本内容
 * @param imageBase64List  base64 编码的图片列表（可含或不含 data: 前缀）
 * @returns                包含一条多模态 user 消息的数组
 */
export function buildVisionMessage(text: string, imageBase64List: string[]): LLMMessage[] {
  const content: Array<
    { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
  > = [{ type: 'text', text }];

  for (const base64 of imageBase64List) {
    // 已含 data: 前缀则直接使用，否则补上 png 前缀
    const url = base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}`;
    content.push({ type: 'image_url', image_url: { url } });
  }

  return [{ role: 'user', content }];
}
