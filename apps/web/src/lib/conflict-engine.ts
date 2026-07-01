// ============================================================
// AI Debug — 冲突检测引擎
//
// 调用 LLM 分析当前支线（根→当前节点）是否存在前后矛盾的结论，
// 返回冲突节点 id + 标注文案。按需触发（手动按钮或自动频率）。
// 旁路逻辑：失败静默返回空数组，不抛异常。
// ============================================================
import type { Node } from 'reactflow';
import type { TurnNodeData } from '@/components/node-flow/types';
import { quickCallLLM } from './llm-helpers';
import type { LLMMessage } from './llm-client';

/** 冲突检测结果：单条冲突标注 */
export interface ConflictMark {
  /** 被标注冲突的节点 id */
  nodeId: string;
  /** 冲突说明文案（展示给用户） */
  note: string;
}

/** 冲突检测 System Prompt：约束输出 JSON 数组 */
const CONFLICT_SYSTEM_PROMPT = `你是一位对话冲突检测助手。用户会给你一条对话支线（从根问题到当前节点，按时间顺序），请分析其中是否存在前后矛盾的结论。

判断标准：
- 同一支线中，后续节点的结论与前面节点的结论直接矛盾（如"问题根因是 A" vs "问题根因是 B"）
- 仅标记产生矛盾陈述的节点，不标记补充或细化（补充细化不算冲突）
- 若无冲突，返回空数组

请输出严格的 JSON 数组（用 \`\`\`json 代码块包裹），每项包含 nodeId 和 note 字段：

\`\`\`json
[
  { "nodeId": "节点id", "note": "冲突说明（一句话）" }
]
\`\`\`

要求：
- nodeId 必须来自用户提供的节点列表
- note 简洁说明该节点与哪个前序节点冲突、冲突点是什么
- 只输出 JSON 代码块，不要其他内容`;

/** 从 LLM 响应中解析冲突标注数组 */
function parseConflictMarks(text: string): ConflictMark[] {
  const regex = /```json\s*([\s\S]*?)```/gi;
  const matches = Array.from(text.matchAll(regex));
  for (const match of matches) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (Array.isArray(parsed)) {
        const result: ConflictMark[] = [];
        for (const item of parsed) {
          if (
            item &&
            typeof item === 'object' &&
            typeof item.nodeId === 'string' &&
            typeof item.note === 'string'
          ) {
            result.push({ nodeId: item.nodeId, note: item.note });
          }
        }
        return result;
      }
    } catch {
      // 继续尝试下一个代码块
    }
  }
  return [];
}

/**
 * 检测指定节点所在支线的冲突。
 *
 * - 收集从根到当前节点的路径（单段，忽略 mergedFromIds 多路）
 * - 构造带节点 id 的上下文交给 LLM 分析
 * - 返回冲突标注数组（可能为空）
 * - 旁路逻辑：失败静默返回空数组，不抛异常
 *
 * @param nodeId 当前节点 id
 * @param nodes  全部节点
 */
export async function detectConflicts(
  nodeId: string,
  nodes: Node<TurnNodeData>[],
): Promise<ConflictMark[]> {
  try {
    const nodeMap = new Map<string, Node<TurnNodeData>>();
    for (const n of nodes) nodeMap.set(n.id, n);

    // 手动回溯收集从根到当前节点的路径 id（单段主干，与 buildLLMMessages 行为一致）
    const pathIds: string[] = [];
    const visited = new Set<string>();
    let cur: string | null = nodeId;
    while (cur !== null && !visited.has(cur)) {
      visited.add(cur);
      pathIds.push(cur);
      const n = nodeMap.get(cur);
      if (!n) break;
      cur = n.data.parentId;
    }
    pathIds.reverse();

    const contextLines = pathIds.map((id) => {
      const n = nodeMap.get(id);
      if (!n) return `- id:${id} (节点丢失)`;
      const user = n.data.userMessage.slice(0, 200);
      const assistant = n.data.assistantMessage.slice(0, 500);
      return `- id:${id}\n  用户: ${user}\n  AI: ${assistant}`;
    }).join('\n');

    const userPrompt = `以下是一条对话支线（从根到当前节点，按时间顺序），每个节点带 id：\n\n${contextLines}\n\n请分析其中是否存在前后矛盾的结论，按 System 约定的 JSON 格式输出。无冲突则输出空数组 []。`;

    const messages: LLMMessage[] = [
      { role: 'system', content: CONFLICT_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ];

    const result = await quickCallLLM(messages);
    const marks = parseConflictMarks(result);
    // 过滤：nodeId 必须在路径上
    const pathSet = new Set(pathIds);
    return marks.filter((m) => pathSet.has(m.nodeId));
  } catch {
    return [];
  }
}
