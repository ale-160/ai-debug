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

## 智能分叉协议（关键能力）

每个 \`### 转发到节点\` 标记后可以追加一行 \`分叉自: <节点引用>\` 指定父节点。

**节点引用语法**：
- \`分叉自: 选中节点\` — 从当前选中节点分叉（最常用）
- \`分叉自: 根节点\` — 从根节点重新开始（开新支线）
- \`分叉自: 最近节点\` — 从最近一个节点分叉（默认行为，可省略）
- \`分叉自: #abc12345\` — 从指定 id 前缀的节点分叉（画布快照中节点 id 显示前 8 位）
- 不写 \`分叉自:\` — 引擎按以下规则推断：
  1. 若选中节点存在 → 从选中节点分叉
  2. 否则若画布已有节点 → 从最近一个非 ignored 节点分叉
  3. 否则（画布空）→ 作为根节点

**示例：用户想对比方案 A 和方案 B**
你应该创建两个分支，都从选中节点（或根节点）分叉：

### 转发到节点
分叉自: 选中节点
<方案 A 的完整提问内容>

### 转发到节点
分叉自: 选中节点
<方案 B 的完整提问内容>

**示例：用户想继续深入当前方向**
直接转发，不写分叉自，引擎会自动从选中/最近节点分叉。

**示例：用户想开全新话题**
显式写 \`分叉自: 根节点\` 或提示用户开新项目。

## 节点操作协议（合并/弃用/忽略）

除了创建节点，你还可以通过协议操作现有节点。**删除操作不在你的权限内，仅用户可删除**。

### 弃用节点
\`### 弃用节点: #abc12345, #def67890\`
- 标记节点及其下游为 abandoned（默认隐藏）
- 适用：某条支线已确认走偏，不再需要继续探索

### 忽略节点
\`### 忽略节点: #abc12345\`
- 标记单个节点为 ignored（不级联子节点）
- 构建上下文路径时跳过该节点，但子节点照常运行
- 适用：某节点内容偏离主题但不希望删除整条支线

### 合并节点
\`### 合并节点: #abc12345, #def67890\`
<合并意图：用一句话说明为什么要把这些支线合并>

- 把多个支线汇合成新根节点，合并意图作为新根的用户消息
- 适用：多个分支得出互补结论，需要汇总
- 引擎会调用 createMergedNode，合并后用户可在新节点继续深入

## 必须主动转发的场景

当用户提问中包含以下关键词时，你**必须**主动触发转发（不需要用户额外确认）：
- 「创建节点」「新建分支」「画到画布」「放到画布」「建一个节点」「加到画布」
- 「帮我创建」「帮我新建」「帮我分叉」

在这些场景下，你应先给出 2-3 句简短建议或确认，然后追加 \`### 转发到节点\` 把整理好的内容转发。转发文本应该是结构化的、可直接作为节点 userMessage 的内容。

## 隐含建图意图的探索性问题

如果用户问的是探索性问题但隐含建图意图（如「我想对比 A 和 B」「帮我分析这几个方向的优劣」「A 和 B 哪个更好」），你应该：
1. 先给简短分析（2-3 句）
2. 主动建议分叉两个（或多个）分支并行探索
3. 为每个方向各追加一个 \`### 转发到节点\`，**显式指定相同的父节点**（如 \`分叉自: 选中节点\`），形成分叉结构

## 智能判断分叉的信号

当用户的最近 2-3 个问题明显围绕同一观点的不同选择、不同方案、不同角度时，
你应该：
1. 指出这种模式（"你在对比 X 的不同方案"）
2. 建议把每个方案分叉成独立分支
3. 用 \`分叉自: 选中节点\` 让新节点从同一父节点分叉，形成对比结构

## 何时不要转发

- 用户只是在和你讨论思路、还没想清楚
- 用户的问题还在探索阶段、需要你先帮他收敛
- 用户明确表示只是聊天不需要建图

## 当前画布状态（运行时注入）

下方"## 当前画布"段落由系统在每次调用前注入。默认只展示**主分支**（从根到选中节点的路径），其他分支仅在用户引用时才注入，避免上下文膨胀。请基于该状态给出针对性建议：
- 画布为空 → 引导用户从零开始
- 已有节点 → 引用具体节点内容（用 #id 前缀），避免重复提问
- 选中了某节点 → 默认从该节点分叉（除非用户另有要求）
- 节点过多（路径长度 > 8）→ 主动建议合并、开新项目或弃用偏离支线
- 路径已启用 pathSummary 混合模式 → 前段自动压缩为摘要，你不需要重复总结`;

/**
 * 转发到节点的标记正则（单次匹配兼容版，已被 FORWARD_NODE_GLOBAL_REGEX 取代）。
 * 保留此常量定义供 parseForwardedText 旧 API 兜底，但实际不再使用。
 */
// const FORWARD_NODE_REGEX = /###\s*(?:转发到节点|创建节点)[ \t]*\r?\n([\s\S]*?)(?=###\s|$)/i;

/** 助手对话历史条目（用于拼接到下次 LLM 调用） */
interface AssistantHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * 画布上下文快照：由 UI 层从 store 抽取后传入，引擎不直接读 store。
 * 用于注入到 system prompt，让助手感知当前画布状态。
 *
 * v3 增强：分支隔离 + 上下文膨胀防护
 * - mainBranchPath：主分支路径（从根到选中节点），优先注入；无选中则用最长路径
 * - pathLength / pathSummaryEnabled：让助手感知路径规模与压缩状态
 * - otherBranchNodes：其他分支的关键节点（仅前 3 个），供助手引用
 */
export interface CanvasContextSnapshot {
  /** 当前项目名（草稿态为 null） */
  projectName: string | null;
  /** 当前项目 id（草稿态为 null） */
  projectId: string | null;
  /** 当前项目节点总数 */
  nodeCount: number;
  /** 当前选中节点 id（无选中为 null） */
  selectedNodeId: string | null;
  /** 最近节点预览（最多 5 个，按 createdAt 倒序） */
  recentNodes: Array<{
    id: string;
    /** userMessage 前 120 字预览 */
    userMessagePreview: string;
    parentId: string | null;
    status: string;
  }>;
  /** 选中节点的路径摘要（从根到选中节点，每项含 id + userMessage 前 80 字） */
  selectedPathPreview: Array<{
    id: string;
    userMessagePreview: string;
  }>;
  /** 主分支路径长度（= selectedPathPreview.length 或最长路径长度） */
  mainBranchPathLength: number;
  /** 是否已启用 pathSummary 混合模式（路径长度 > SUMMARY_THRESHOLD 时为 true） */
  pathSummaryEnabled: boolean;
  /** 其他分支的关键节点预览（最多 3 个，按 createdAt 倒序，排除主分支节点） */
  otherBranchNodes: Array<{
    id: string;
    userMessagePreview: string;
    parentId: string | null;
  }>;
}

/**
 * 把画布快照格式化为注入 system prompt 的文本段落。
 * - 项目为空（草稿态）→ 提示引导用户从零开始
 * - 有项目无节点 → 提示首条消息将派生项目名
 * - 有节点 → 主分支优先展示（从根到选中节点），其他分支仅列前 3 个供引用
 *
 * v3 增强：默认仅注入主分支上下文，避免节点过多导致上下文膨胀。
 * 路径长度超过阈值时提示已启用 pathSummary 混合模式。
 */
export function buildCanvasContextText(snapshot: CanvasContextSnapshot): string {
  const lines: string[] = ['## 当前画布'];

  if (!snapshot.projectId) {
    lines.push('- 状态：草稿态（尚未绑定项目）');
    lines.push('- 提示：用户下一条消息将自动派生项目名并绑定画布');
    return lines.join('\n');
  }

  lines.push(`- 项目：${snapshot.projectName ?? '未命名'}（共 ${snapshot.nodeCount} 个节点）`);

  // 主分支路径长度与 pathSummary 状态
  if (snapshot.mainBranchPathLength > 0) {
    lines.push(`- 主分支路径长度：${snapshot.mainBranchPathLength} 节点`);
    if (snapshot.pathSummaryEnabled) {
      lines.push('- 上下文模式：已启用 pathSummary 混合模式（前段自动压缩为摘要）');
    }
  }

  if (snapshot.selectedNodeId) {
    lines.push(`- 选中节点：#${snapshot.selectedNodeId.slice(0, 8)}`);
    if (snapshot.selectedPathPreview.length > 0) {
      lines.push('- 主分支路径（从根到选中节点）：');
      snapshot.selectedPathPreview.forEach((n, i) => {
        lines.push(`  ${i + 1}. [#${n.id.slice(0, 8)}] ${n.userMessagePreview}`);
      });
    }
  } else {
    lines.push('- 选中节点：无（新节点默认从最近节点分叉，或作为根节点）');
  }

  // 最近节点预览（最多 5 个，含状态标记）
  if (snapshot.recentNodes.length > 0) {
    lines.push('- 最近节点预览（可用于 #id 引用）：');
    snapshot.recentNodes.forEach((n, i) => {
      const branch = n.parentId ? `← 父 #${n.parentId.slice(0, 8)}` : '根';
      const statusTag =
        n.status === 'ignored' ? ' [ignored]' : n.status === 'abandoned' ? ' [abandoned]' : '';
      lines.push(
        `  ${i + 1}. [#${n.id.slice(0, 8)}] ${branch}${statusTag} ${n.userMessagePreview}`,
      );
    });
  }

  // 其他分支节点（仅前 3 个，供助手引用但不进入主上下文）
  if (snapshot.otherBranchNodes.length > 0) {
    lines.push('- 其他分支节点（仅列出，不进入主上下文）：');
    snapshot.otherBranchNodes.forEach((n, i) => {
      const branch = n.parentId ? `← 父 #${n.parentId.slice(0, 8)}` : '根';
      lines.push(`  ${i + 1}. [#${n.id.slice(0, 8)}] ${branch} ${n.userMessagePreview}`);
    });
  }

  return lines.join('\n');
}

/** 转发到节点的解析结果：含分叉自引用 */
export interface ForwardedNodeSpec {
  /** 转发的用户消息文本（已清洗） */
  text: string;
  /** 分叉自引用：'selected' | 'root' | 'recent' | '#id前缀' | null（null 表示引擎自动推断） */
  forkFrom: string | null;
}

/** 节点操作指令（合并/弃用/忽略）解析结果 */
export interface NodeOperationSpec {
  type: 'abandon' | 'ignore' | 'merge';
  /** 操作目标节点 id 前缀列表（merge/abandon 可多个，ignore 单个） */
  targetIds: string[];
  /** merge 时的合并意图文本（作为新根 userMessage） */
  mergeIntent?: string;
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
  /** 画布上下文快照（注入 system prompt，让助手感知画布状态） */
  canvasContext?: CanvasContextSnapshot;
  /** 自动建图模式：true 时即使助手未输出转发标记也自动把用户消息转发为新节点 */
  autoCreateNode?: boolean;
  /** AbortSignal */
  signal?: AbortSignal;
  /** 流式回调，每收到一块文本即触发 */
  onDelta?: (text: string) => void;
  /** 转发到节点回调（含分叉自引用信息，UI 层负责解析为 parentId 并调用 createTurnNode） */
  onForwarded?: (spec: ForwardedNodeSpec) => void;
  /** 节点操作回调（合并/弃用/忽略），UI 层负责调用对应 store 方法 */
  onNodeOperation?: (op: NodeOperationSpec) => void;
}

/** streamAssistantResponse 的返回结构 */
export interface StreamAssistantResult {
  status: 'success' | 'error' | 'aborted';
  /** 完整的回答文本（success 时有值） */
  text?: string;
  /** 错误信息（error 时有值） */
  errorMessage?: string;
  /** 转发到节点的指令列表（含分叉自引用，如未触发转发则为空数组） */
  forwardedSpecs: ForwardedNodeSpec[];
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
 * - 若 canvasContext 非空，把 buildCanvasContextText 结果追加到 system 末尾，
 *   让助手感知当前画布状态（项目名/节点数/选中节点/最近节点）。
 * - 历史对话按 role 顺序拼接（保持多轮上下文）。
 * - 当前用户消息放在最后。
 */
function buildAssistantMessages(
  userText: string,
  history: AssistantHistoryItem[] | undefined,
  skill: Skill | undefined,
  canvasContext: CanvasContextSnapshot | undefined,
): LLMMessage[] {
  let systemContent = ASSISTANT_SYSTEM_PROMPT;
  if (skill) {
    const skillPrompt = substituteInput(skill.systemPrompt, userText);
    systemContent = `${skillPrompt}\n\n${ASSISTANT_SYSTEM_PROMPT}`;
  }
  // 注入画布上下文（让助手能引用具体节点、引导分叉/合并）
  if (canvasContext) {
    const canvasText = buildCanvasContextText(canvasContext);
    if (canvasText) {
      systemContent = `${systemContent}\n\n${canvasText}`;
    }
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
const FORWARD_NODE_GLOBAL_REGEX = /###\s*(?:转发到节点|创建节点)[ \t]*\r?\n([\s\S]*?)(?=###\s|$)/gi;

/**
 * 解析"分叉自:"引用行。
 * 支持：选中节点 / 根节点 / 最近节点 / #id前缀
 * 返回 null 表示未找到分叉自行（引擎自动推断）。
 */
function parseForkFromLine(text: string): string | null {
  // 取第一行匹配分叉自:
  const firstLineMatch = text.match(/^分叉自\s*[:：]\s*(.+?)[ \t]*\r?\n/);
  if (!firstLineMatch) return null;
  const ref = firstLineMatch[1].trim();
  // 标准化为小写关键字
  if (/^选中节点$/i.test(ref)) return 'selected';
  if (/^根节点$/i.test(ref)) return 'root';
  if (/^最近节点$/i.test(ref)) return 'recent';
  // #id前缀 格式
  const idMatch = ref.match(/^#([a-zA-Z0-9_-]{4,})$/);
  if (idMatch) return `#${idMatch[1]}`;
  return null;
}

/**
 * 从转发文本中剥离"分叉自:"行，返回纯用户消息文本。
 */
function stripForkFromLine(text: string): string {
  return text.replace(/^分叉自\s*[:：]\s*.+?[ \t]*\r?\n/, '').trim();
}

/**
 * 从助手回答中解析所有转发到节点的指令（支持多次转发 + 分叉自引用）。
 * 返回 ForwardedNodeSpec 数组（已对每段文本做 sanitizeForwardedText 清洗 + 剥离分叉自行）。
 * 数组为空表示未触发转发。
 */
export function parseForwardedTexts(assistantText: string): ForwardedNodeSpec[] {
  const results: ForwardedNodeSpec[] = [];
  // 重置 lastIndex（全局正则复用时需要）
  FORWARD_NODE_GLOBAL_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FORWARD_NODE_GLOBAL_REGEX.exec(assistantText)) !== null) {
    const raw = match[1].trim();
    if (raw.length === 0) continue;
    const forkFrom = parseForkFromLine(raw);
    const cleanedText = sanitizeForwardedText(stripForkFromLine(raw));
    if (cleanedText.length > 0) {
      results.push({ text: cleanedText, forkFrom });
    }
  }
  return results;
}

/**
 * 从助手回答中解析节点操作指令（弃用/忽略/合并）。
 * - 弃用节点: ### 弃用节点: #abc12345, #def67890
 * - 忽略节点: ### 忽略节点: #abc12345
 * - 合并节点: ### 合并节点: #abc12345, #def67890 \n <合并意图>
 *
 * 返回数组（按出现顺序），可能为空。
 */
export function parseNodeOperations(assistantText: string): NodeOperationSpec[] {
  const results: NodeOperationSpec[] = [];
  // 弃用节点 / 忽略节点：单行指令
  const singleLineRegex = /###\s*(弃用节点|忽略节点)\s*[:：]\s*([^\r\n]+)/gi;
  singleLineRegex.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = singleLineRegex.exec(assistantText)) !== null) {
    const type = match[1] === '弃用节点' ? 'abandon' : 'ignore';
    const idsRaw = match[2];
    const targetIds = parseIdList(idsRaw);
    if (targetIds.length > 0) {
      results.push({ type, targetIds });
    }
  }

  // 合并节点：含合并意图（下一行内容）
  const mergeRegex = /###\s*合并节点\s*[:：]\s*([^\r\n]+)\r?\n([\s\S]*?)(?=###\s|$)/gi;
  mergeRegex.lastIndex = 0;
  while ((match = mergeRegex.exec(assistantText)) !== null) {
    const idsRaw = match[1];
    const intentRaw = match[2].trim();
    const targetIds = parseIdList(idsRaw);
    if (targetIds.length >= 2 && intentRaw.length > 0) {
      results.push({ type: 'merge', targetIds, mergeIntent: intentRaw });
    }
  }

  return results;
}

/**
 * 从字符串中解析 #id 前缀列表。
 * 输入示例："#abc12345, #def67890" → ["abc12345", "def67890"]
 * 容忍空格、中文逗号、分号等分隔符。
 */
function parseIdList(raw: string): string[] {
  const ids: string[] = [];
  const matches = raw.matchAll(/#([a-zA-Z0-9_-]{4,})/g);
  for (const m of matches) {
    ids.push(m[1]);
  }
  return ids;
}

/**
 * 从助手回答中解析转发到节点的文本（单次转发兼容版，仅返回文本）。
 * 返回 undefined 表示未触发转发。
 * @deprecated 优先使用 parseForwardedTexts 支持多次转发 + 分叉自引用
 */
export function parseForwardedText(assistantText: string): string | undefined {
  const specs = parseForwardedTexts(assistantText);
  return specs.length > 0 ? specs[0].text : undefined;
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
  if (
    rolePrefixRegex.test(firstLine) &&
    (rest.trim() || firstLine.replace(rolePrefixRegex, '').trim())
  ) {
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
    canvasContext,
    autoCreateNode,
    signal,
    onDelta,
    onForwarded,
    onNodeOperation,
  } = options;

  // 查找激活的技能
  const skill = skillId ? skills?.find((s) => s.id === skillId) : undefined;

  try {
    const messages = buildAssistantMessages(userText, history, skill, canvasContext);
    const fullText = await quickCallLLM(messages, onDelta, signal);

    // 扫描转发标记（支持多次转发 + 分叉自引用，按顺序异步触发，不阻塞返回）
    // P0-3：parseForwardedTexts 内部已对每段文本做兜底清洗 + 剥离分叉自行
    const forwardedSpecs = parseForwardedTexts(fullText);
    if (forwardedSpecs.length > 0 && onForwarded) {
      // 按顺序异步触发每个转发：用 async IIFE 串行执行避免并发竞争
      void (async () => {
        for (const spec of forwardedSpecs) {
          onForwarded(spec);
          // 让出一个微任务，避免阻塞渲染
          await Promise.resolve();
        }
      })();
    } else if (autoCreateNode && onForwarded && userText.trim()) {
      // 自动建图模式：助手未显式输出转发标记时，把用户原始消息作为新节点转发。
      // forkFrom=null 让 UI 层按规则自动推断父节点（选中节点 → 最近节点 → 根节点）
      forwardedSpecs.push({ text: userText.trim(), forkFrom: null });
      void (async () => {
        onForwarded({ text: userText.trim(), forkFrom: null });
        await Promise.resolve();
      })();
    }

    // 扫描节点操作指令（弃用/忽略/合并），按顺序异步触发
    if (onNodeOperation) {
      const operations = parseNodeOperations(fullText);
      if (operations.length > 0) {
        void (async () => {
          for (const op of operations) {
            onNodeOperation(op);
            await Promise.resolve();
          }
        })();
      }
    }

    return {
      status: 'success',
      text: fullText,
      forwardedSpecs,
    };
  } catch (err) {
    // 用户主动取消（AbortError）
    if (err instanceof Error && err.name === 'AbortError') {
      return { status: 'aborted', forwardedSpecs: [] };
    }
    // 重试耗尽（RequestPoolError）或其他错误，统一归一化为可读 message
    return {
      status: 'error',
      errorMessage: describeError(err),
      forwardedSpecs: [],
    };
  }
}

/**
 * 把 AssistantMessage[] 转换为 LLM 历史消息（用于多轮对话上下文）。
 * 跳过 status='error' 的消息，避免把错误内容喂回模型。
 * 跳过 status='pending' 的消息（尚未完成）。
 */
export function messagesToHistory(messages: AssistantMessage[]): AssistantHistoryItem[] {
  const result: AssistantHistoryItem[] = [];
  for (const m of messages) {
    if (m.status === 'error' || m.status === 'pending') continue;
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    if (!m.content.trim()) continue;
    result.push({ role: m.role, content: m.content });
  }
  return result;
}
