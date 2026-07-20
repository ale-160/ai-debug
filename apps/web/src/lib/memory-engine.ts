// ============================================================
// AI Debug — 记忆引擎
//
// 调用 LLM 从一次 AI 回答中提取关键事实/规则，写入全局或项目记忆。
// 旁路逻辑：失败静默返回空数组，不阻塞主流程。
// ============================================================
import { quickCallLLM } from './llm-helpers';
import type { LLMMessage } from './llm-client';
import type { MemoryEntry } from '@/components/node-flow/types';
import { generateId } from '@/lib/id';

/** 提取记忆的 System Prompt：约束输出 JSON 数组 */
const EXTRACT_MEMORY_PROMPT = `你是一位记忆提取助手。用户会给你一段对话（用户问题 + AI 回答），请从中提取值得长期记忆的关键事实、规则或结论，供未来对话参考。

只提取"具有长期价值"的信息，例如：
- 已确认的技术结论（如"问题 X 的根因是 Y"）
- 用户偏好或约束（如"用户使用 Cloudflare 部署，避免依赖 Node.js 运行时"）
- 已被否决的方案（如"方案 A 因性能问题被否决"）

不要提取：
- 临时性、过程性的描述
- 仅对当前节点有意义、无复用价值的信息
- 推测性、不确定的内容

请输出严格的 JSON 数组（用 \`\`\`json 代码块包裹），每项为一个字符串（一条记忆）。若无值得提取的内容，输出空数组 []。

\`\`\`json
["记忆1", "记忆2"]
\`\`\`

只输出 JSON 代码块，不要其他内容。`;

/** 从 LLM 响应中解析 JSON 字符串数组 */
function parseMemoryList(text: string): string[] {
  const regex = /```json\s*([\s\S]*?)```/gi;
  const matches = Array.from(text.matchAll(regex));
  for (const match of matches) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (Array.isArray(parsed)) {
        return parsed
          .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
          .map((x) => x.trim());
      }
    } catch {
      // 继续尝试下一个代码块
    }
  }
  // 兜底：尝试整段直接解析
  try {
    const parsed = JSON.parse(text.trim());
    if (Array.isArray(parsed)) {
      return parsed
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .map((x) => x.trim());
    }
  } catch {
    // 忽略
  }
  return [];
}

/**
 * 从一次 AI 回答中提取记忆条目内容（字符串数组）。
 * 旁路逻辑：失败静默返回空数组，不抛异常。
 *
 * @param userMessage      本次用户问题
 * @param assistantMessage 本次 AI 回答
 * @returns                提取出的记忆内容字符串数组（可能为空）
 */
export async function extractMemory(
  userMessage: string,
  assistantMessage: string,
): Promise<string[]> {
  try {
    const userPrompt = `用户问题：\n${userMessage}\n\nAI 回答：\n${assistantMessage}\n\n请提取值得长期记忆的关键事实/规则/结论，按 System 约定的 JSON 数组格式输出。`;
    const messages: LLMMessage[] = [
      { role: 'system', content: EXTRACT_MEMORY_PROMPT },
      { role: 'user', content: userPrompt },
    ];
    const result = await quickCallLLM(messages);
    return parseMemoryList(result);
  } catch {
    return [];
  }
}

/**
 * 将字符串内容数组转换为 MemoryEntry 数组（自动生成 id/createdAt/source=auto）。
 */
export function toMemoryEntries(contents: string[]): MemoryEntry[] {
  return contents.map((content) => ({
    id: generateId('mem'),
    content,
    createdAt: Date.now(),
    source: 'auto' as const,
  }));
}

/**
 * 构建注入到 system prompt 的记忆文本。
 *
 * 拼接规则：
 * - 用户自定义规则（globalRules）→ "用户规则"段落
 * - 全局记忆条目 → "全局记忆"段落
 * - 项目记忆条目 → "项目记忆"段落
 *
 * 任一段落为空则跳过；全部为空返回空字符串（调用方据此判断是否注入）。
 *
 * @param globalRules   用户自定义规则文本
 * @param globalMemory  全局记忆条目
 * @param projectMemory 项目记忆条目
 * @returns             拼接后的记忆文本（可能为空）
 */
export function buildMemoryContext(
  globalRules: string,
  globalMemory: MemoryEntry[],
  projectMemory: MemoryEntry[],
): string {
  const sections: string[] = [];

  const rules = globalRules.trim();
  if (rules) {
    sections.push(`【用户规则】\n${rules}`);
  }

  if (globalMemory.length > 0) {
    const lines = globalMemory.map((m, i) => `${i + 1}. ${m.content}`).join('\n');
    sections.push(`【全局记忆】\n${lines}`);
  }

  if (projectMemory.length > 0) {
    const lines = projectMemory.map((m, i) => `${i + 1}. ${m.content}`).join('\n');
    sections.push(`【项目记忆】\n${lines}`);
  }

  if (sections.length === 0) return '';

  return `以下是用户提供的长期上下文信息，请在回答时参考：\n\n${sections.join('\n\n')}`;
}
