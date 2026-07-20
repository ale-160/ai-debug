// ============================================================
// AI Debug — 助手对话引擎（PR-1）
//
// 助手对话独立于节点对话，不挂载在 parentId 链上，避免污染节点上下文。
// 助手收到用户消息后调用 LLM 流式响应；回答完成后可选地转发到节点。
// 转发通过 onForwarded 回调让 UI 层处理（不在引擎内直接修改 store）。
// ============================================================

import type { AssistantMessage, NodeAttachment, Skill } from '@/components/node-flow/types';
import { quickCallLLM } from './llm-helpers';
import { type LLMMessage } from './llm-client';
import { describeError } from './request';

/**
 * 助手系统提示词：说明助手职责与转发到节点的协议。
 * 当助手回答中包含 `### 转发到节点` 或 `### 创建节点` 标记时，
 * 引擎会自动解析其后的内容并调用 onForwarded 回调。
 *
 * v2 增强：融入 ai-debug 画布概念（分支/合并/上下文路径/草稿态），
 * 让助手能主动建议用户何时该分叉、何时该合并、何时该开新项目。
 */
export const ASSISTANT_SYSTEM_PROMPT = `你是「蛛网 · AI Debug」的内置助手，服务于一个蛛网式 AI 对话上下文管理工具。
你的核心职责：帮助用户梳理思路、整理问题、规划节点结构，并在合适时机把内容转发到画布。

## 画布概念（你必须理解并主动运用）

- **节点（Turn）**：每条用户消息 + AI 回答构成一个节点，类似 git commit
- **分支**：从任意节点可以分叉出新支线，独立维护自己的上下文路径
- **合并节点**：把多条支线汇合成一个新根，合并意图作为根的用户消息
- **上下文路径**：从根沿 parentId 链收集，只把当前路径喂给 LLM，不污染其他分支
- **草稿态**：currentProjectId 为空时，首条消息会自动派生项目名并绑定画布
- **ignored 节点**：构建上下文时跳过，子节点照常运行（路径视为断点）
- **pathSummary**：路径过长时前段压缩为摘要，后段保留完整内容

## 你的工作原则

1. **先理解意图再回答**：用户的话可能是探索性的、模糊的，先复述你的理解再给建议
2. **主动建议节点结构**：
   - 当用户的问题有多个独立子方向 → 建议分叉多个分支并行探索
   - 当用户的多个分支得出互补结论 → 建议合并节点汇总结论
   - 当用户开始全新话题 → 建议开新项目（草稿态）
   - 当用户想对比两种方案 → 建议从同一父节点分叉两个分支
3. **简明扼要**：不堆砌背景，必要时给 2-3 个简短方向选项
4. **专家化**：若激活了技能，优先按技能的 systemPrompt 风格回答

## 转发到节点协议

当用户希望你把某段内容作为新节点落到画布时，在回答中追加：

### 转发到节点
<这里写要作为用户消息发送给节点的完整文本>

引擎会自动识别该标记并创建新节点（异步执行，不阻塞助手对话）。转发文本应该是**完整的、可直接作为用户提问的内容**，不要带元说明。无需在标记前额外说明。

**支持多次转发**：你可以在一次回答中创建多个节点，只需多次使用 \`### 转发到节点\` 标记。例如用户要求对比 A 和 B，你可以分别创建两个分支节点：

### 转发到节点
<分支 A 的完整提问内容>

### 转发到节点
<分支 B 的完整提问内容>

## 必须主动转发的场景

当用户提问中包含以下关键词时，你**必须**主动触发转发（不需要用户额外确认）：
- 「创建节点」「新建分支」「画到画布」「放到画布」「建一个节点」「加到画布」
- 「帮我创建」「帮我新建」「帮我分叉」

在这些场景下，你应先给出 2-3 句简短建议或确认，然后追加 \`### 转发到节点\` 把整理好的内容转发。转发文本应该是结构化的、可直接作为节点 userMessage 的内容。

## 隐含建图意图的探索性问题

如果用户问的是探索性问题但隐含建图意图（如「我想对比 A 和 B」「帮我分析这几个方向的优劣」「A 和 B 哪个更好」），你应该：
1. 先给简短分析（2-3 句）
2. 主动建议分叉两个（或多个）分支并行探索
3. 为每个方向各追加一个 \`### 转发到节点\`，把该方向的完整提问内容转发

## 何时不要转发

- 用户只是在和你讨论思路、还没想清楚
- 用户的问题还在探索阶段、需要你先帮他收敛
- 用户明确表示只是聊天不需要建图`;

/**
 * 转发到节点的标记正则。
 * 匹配 "### 转发到节点" 或 "### 创建节点" 标题及其后的内容（直到文末或下一个 ### 标题）。
 * 捕获组 1：要转发到节点的文本（已 trim）。
 */
const FORWARD_NODE_REGEX = /###\s*(?:转发到节点|创建节点)[ \t]*\r?\n([\s\S]*?)(?=###\s|$)/i;

/** 助手对话历史条目（用于拼接到下次 LLM 调用） */
interface AssistantHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

/** streamAssistantResponse 的可选参数 */
export interface StreamAssistantOptions {
  /** 用户消息可携带的附件列表（PR-2 用，当前仅记录元信息） */
  attachments?: NodeAttachment[];
  /** 当前激活的技能 ID（用于加载技能 systemPrompt 拼接） */
  skillId?: string | null;
  /** 技能列表（由 UI 层从 store 传入，引擎不直接读 store） */
  skills?: Skill[];
  /** 历史对话消息（用于多轮上下文） */
  history?: AssistantHistoryItem[];
  /** AbortSignal */
  signal?: AbortSignal;
  /** 流式回调，每收到一块文本即触发 */
  onDelta?: (text: string) => void;
  /** 转发到节点回调（助手回答中含转发标记时触发，异步执行；多次转发时按顺序触发） */
  onForwarded?: (text: string) => void;
}

/** streamAssistantResponse 的返回结构 */
export interface StreamAssistantResult {
  status: 'success' | 'error' | 'aborted';
  /** 完整的回答文本（success 时有值） */
  text?: string;
  /** 错误信息（error 时有值） */
  errorMessage?: string;
  /** 转发到节点的文本列表（如未触发转发则为空数组） */
  forwardedTexts: string[];
}

/**
 * 替换 Skill systemPrompt 中的 {{input}} 变量占位为用户输入。
 * 无占位符则原样返回。
 */
function substituteInput(skillPrompt: string, userInput: string): string {
  return skillPrompt.replace(/\{\{\s*input\s*\}\}/g, userInput);
}

/**
 * 构造助手对话的 LLM 消息数组。
 *
 * - 基础 system：ASSISTANT_SYSTEM_PROMPT
 * - 若 skillId 非空且能匹配到技能，将技能 systemPrompt（替换 {{input}} 后）
 *   拼接到基础 system 之前，使助手"专家化"。
 * - 历史对话按 role 顺序拼接（保持多轮上下文）。
 * - 当前用户消息放在最后。
 */
function buildAssistantMessages(
  userText: string,
  history: AssistantHistoryItem[] | undefined,
  skill: Skill | undefined,
): LLMMessage[] {
  let systemContent = ASSISTANT_SYSTEM_PROMPT;
  if (skill) {
    const skillPrompt = substituteInput(skill.systemPrompt, userText);
    systemContent = `${skillPrompt}\n\n${ASSISTANT_SYSTEM_PROMPT}`;
  }
  const messages: LLMMessage[] = [{ role: 'system', content: systemContent }];
  if (history) {
    for (const item of history) {
      messages.push({ role: item.role, content: item.content });
    }
  }
  messages.push({ role: 'user', content: userText });
  return messages;
}

/**
 * 全局匹配正则：扫描文本中所有 "### 转发到节点" / "### 创建节点" 标记，
 * 支持多次转发。捕获组 1 为每次转发的文本（已 trim）。
 */
const FORWARD_NODE_GLOBAL_REGEX =
  /###\s*(?:转发到节点|创建节点)[ \t]*\r?\n([\s\S]*?)(?=###\s|$)/gi;

/**
 * 从助手回答中解析所有转发到节点的文本（支持多次转发）。
 * 返回数组（已对每段文本做 sanitizeForwardedText 清洗）。
 * 数组为空表示未触发转发。
 */
export function parseForwardedTexts(assistantText: string): string[] {
  const results: string[] = [];
  // 重置 lastIndex（全局正则复用时需要）
  FORWARD_NODE_GLOBAL_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FORWARD_NODE_GLOBAL_REGEX.exec(assistantText)) !== null) {
    const raw = match[1].trim();
    if (raw.length > 0) {
      results.push(sanitizeForwardedText(raw));
    }
  }
  return results;
}

/**
 * 从助手回答中解析转发到节点的文本（单次转发兼容版）。
 * 返回 undefined 表示未触发转发。
 * @deprecated 优先使用 parseForwardedTexts 支持多次转发
 */
export function parseForwardedText(assistantText: string): string | undefined {
  const match = assistantText.match(FORWARD_NODE_REGEX);
  if (!match) return undefined;
  const text = match[1].trim();
  return text.length > 0 ? text : undefined;
}

/**
 * P0-3：转发文本兜底清洗。
 *
 * 背景（参考 spark-flow 的 relocateInputTextByNodeType）：
 * spark-flow 通过 OpenAI tool_call 协议创建节点，LLM 偶尔会把"提示词/描述"类
 * 内容误塞到 inputText 字段，需要按节点类型迁移到正确的 config 字段。
 *
 * ai-debug 走纯文本协议（### 转发到节点 + 用户消息文本），不存在字段位置错误问题，
 * 但 LLM 仍可能误加以下格式包裹，需在转发到节点前清洗：
 *   1. 开头的 "用户:" / "用户消息:" / "User:" / "提问:" 等角色前缀
 *   2. 整体被 ``` ... ``` 代码块包裹（LLM 倾向把多行内容用代码块装起来）
 *   3. 多余的开头/结尾空行
 *
 * 清洗原则：保守，只剥离明显误加的格式，保留原文语义。
 *
 * @param raw 解析出的原始转发文本
 * @returns 清洗后可直接作为用户消息的文本
 */
export function sanitizeForwardedText(raw: string): string {
  let text = raw.trim();
  if (!text) return text;

  // 1. 剥离开头的角色前缀：如 "用户:" / "用户消息:" / "User:" / "提问:" / "Question:"
  //    仅在第一行匹配且后续有内容时才剥离，避免误伤以这些词开头的正常提问
  const rolePrefixRegex = /^(?:用户消息|用户|提问|User|Question)\s*[:：]\s*/;
  const firstNewline = text.indexOf('\n');
  const firstLine = firstNewline === -1 ? text : text.slice(0, firstNewline);
  const rest = firstNewline === -1 ? '' : text.slice(firstNewline + 1);
  if (rolePrefixRegex.test(firstLine) && (rest.trim() || firstLine.replace(rolePrefixRegex, '').trim())) {
    const cleanedFirstLine = firstLine.replace(rolePrefixRegex, '');
    text = rest ? `${cleanedFirstLine}\n${rest}` : cleanedFirstLine;
    text = text.trim();
  }

  // 2. 剥离整体代码块包裹：```(可选语言标识)\n...\n```
  //    仅在文本以 ``` 开头并以 ``` 结尾时才剥离，避免误伤代码片段
  const fenceMatch = text.match(/^```[a-zA-Z]*\s*\n([\s\S]*?)\n```\s*$/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  return text;
}

/**
 * 流式调用助手对话。
 *
 * 流程：
 * 1. 根据激活技能拼接 system prompt
 * 2. 拼接历史消息 + 当前用户消息
 * 3. 调用 quickCallLLM 流式获取回答（透传 signal）
 * 4. 流式完成后扫描转发标记，触发 onForwarded 回调（异步，不阻塞返回）
 *
 * 错误处理：
 * - API Key 未配置：quickCallLLM 抛 Error('请先配置 LLM API Key')
 * - 网络错误：通过 describeError 归一化
 * - 用户取消（AbortError）：status='aborted'
 * - 重试耗尽（RequestPoolError）：status='error'
 *
 * 不直接修改 store，所有副作用通过回调让 UI 层处理。
 */
export async function streamAssistantResponse(
  userText: string,
  options: StreamAssistantOptions = {},
): Promise<StreamAssistantResult> {
  const {
    skillId,
    skills,
    history,
    signal,
    onDelta,
    onForwarded,
  } = options;

  // 查找激活的技能
  const skill = skillId ? skills?.find((s) => s.id === skillId) : undefined;

  try {
    const messages = buildAssistantMessages(userText, history, skill);
    const fullText = await quickCallLLM(messages, onDelta, signal);

    // 扫描转发标记（支持多次转发，按顺序异步触发，不阻塞返回）
    // P0-3：parseForwardedTexts 内部已对每段文本做兜底清洗
    const forwardedTexts = parseForwardedTexts(fullText);
    if (forwardedTexts.length > 0 && onForwarded) {
      // 按顺序异步触发每个转发：用 async IIFE 串行执行避免并发竞争
      void (async () => {
        for (const text of forwardedTexts) {
          onForwarded(text);
          // 让出一个微任务，避免阻塞渲染
          await Promise.resolve();
        }
      })();
    }

    return {
      status: 'success',
      text: fullText,
      forwardedTexts,
    };
  } catch (err) {
    // 用户主动取消（AbortError）
    if (err instanceof Error && err.name === 'AbortError') {
      return { status: 'aborted', forwardedTexts: [] };
    }
    // 重试耗尽（RequestPoolError）或其他错误，统一归一化为可读 message
    return {
      status: 'error',
      errorMessage: describeError(err),
      forwardedTexts: [],
    };
  }
}

/**
 * 把 AssistantMessage[] 转换为 LLM 历史消息（用于多轮对话上下文）。
 * 跳过 status='error' 的消息，避免把错误内容喂回模型。
 * 跳过 status='pending' 的消息（尚未完成）。
 */
export function messagesToHistory(
  messages: AssistantMessage[],
): AssistantHistoryItem[] {
  const result: AssistantHistoryItem[] = [];
  for (const m of messages) {
    if (m.status === 'error' || m.status === 'pending') continue;
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    if (!m.content.trim()) continue;
    result.push({ role: m.role, content: m.content });
  }
  return result;
}
