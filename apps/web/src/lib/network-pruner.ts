// ============================================================
// AI Debug — 蛛网修剪引擎
//
// 调用 LLM 分析蛛网对话网络：识别重复支线与死胡同，
// 派生出精简版新项目（保留主干道）。原项目完整保留，
// 新项目通过 originalProjectId 链接到来源项目。
// ============================================================
import type { Node, Edge } from 'reactflow';
import type { NetworkProject, TurnNodeData } from '@/components/node-flow/types';
import { quickCallLLM } from './llm-helpers';
import type { LLMMessage } from './llm-client';
import { createProject, updateProject } from './project-storage';

/** 修剪分析结果 */
export interface PruneAnalysis {
  /** 建议保留的节点 ID 列表（去除重复支线与无用死胡同后） */
  keepNodeIds: string[];
  /** 主干道节点 ID 顺序（从根到末梢），用于重建精简项目的线性主干 */
  mainPath: string[];
  /** 分析说明：重复支线、死胡同的判断依据 */
  reasoning: string;
}

/** 修剪 LLM 的 System Prompt：约束输出 JSON 格式 */
const PRUNE_SYSTEM_PROMPT = `你是一位蛛网对话网络清理助手。用户有一个树形对话网络（每个节点是一次 AI 问答），节点过多后需要"清理蛛网"：识别重复支线与死胡同，保留主干道，派生出精简版项目。

你将收到所有节点的列表（每行：id / 父节点 / 状态 / 摘要）。请分析：
1. 哪些支线是重复的（探讨同一问题的不同分支，保留最有结论的一条）
2. 哪些是死胡同（abandoned 状态，或无后续进展的末端）
3. 哪些节点构成主干道（从根问题到最终结论的关键路径）

请输出严格的 JSON（用 \`\`\`json 代码块包裹），格式如下：

\`\`\`json
{
  "keepNodeIds": ["id1", "id2", "id3"],
  "mainPath": ["根节点id", "id2", "id3"],
  "reasoning": "简要说明判断依据（100字内）"
}
\`\`\`

要求：
- keepNodeIds：建议保留的节点 ID 列表（去除重复支线与无用死胡同后）
- mainPath：主干道节点 ID 顺序，从根节点到末梢，构成精简后项目的主线
- mainPath 必须是 keepNodeIds 的子集，且保持从根到末梢的顺序
- mainPath[0] 应为根节点（父节点为 null 的节点）
- 至少保留根节点和有结论的节点，不要全部丢弃
- 只输出 JSON 代码块，不要其他内容`;

/** 生成节点 ID（与 store 保持一致格式，加 index 防批量生成碰撞） */
function generateNodeId(prefix: string, index: number): string {
  return `${prefix}-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 格式化为 YYYYMMDD */
function formatYYYYMMDD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/** 校验并转换为 PruneAnalysis（返回 null 表示格式不符） */
function tryParseAnalysisObject(raw: string): PruneAnalysis | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const keepNodeIds: string[] = Array.isArray(parsed.keepNodeIds)
      ? parsed.keepNodeIds.filter((x: unknown) => typeof x === 'string')
      : [];
    const mainPath: string[] = Array.isArray(parsed.mainPath)
      ? parsed.mainPath.filter((x: unknown) => typeof x === 'string')
      : [];
    const reasoning: string =
      typeof parsed.reasoning === 'string' ? parsed.reasoning : '';
    if (keepNodeIds.length === 0) return null;
    return { keepNodeIds, mainPath, reasoning };
  } catch {
    return null;
  }
}

/**
 * 从 LLM 响应中提取 JSON 分析结果。
 * 优先匹配 ```json``` 代码块，兜底尝试直接解析整段为 JSON。
 */
function parsePruneAnalysis(text: string): PruneAnalysis | null {
  const regex = /```json\s*([\s\S]*?)```/gi;
  const matches = Array.from(text.matchAll(regex));
  for (const match of matches) {
    const parsed = tryParseAnalysisObject(match[1].trim());
    if (parsed) return parsed;
  }
  // 兜底：尝试直接解析整段
  return tryParseAnalysisObject(text.trim());
}

/**
 * 保守分析：LLM 失败时保留所有非 abandoned 节点。
 * mainPath 取从根出发的最长根到叶路径，作为主干道。
 */
function conservativeAnalysis(project: NetworkProject): PruneAnalysis {
  const valid = project.nodes.filter((n) => n.data.status !== 'abandoned');
  const validIds = new Set(valid.map((n) => n.id));

  // 构建子节点映射 + 收集根（原父不在有效集也视为根）
  const childrenMap = new Map<string, string[]>();
  const roots: string[] = [];
  for (const n of valid) {
    const pid = n.data.parentId;
    if (pid === null || !validIds.has(pid)) {
      roots.push(n.id);
    } else {
      const list = childrenMap.get(pid) ?? [];
      list.push(n.id);
      childrenMap.set(pid, list);
    }
  }

  // DFS 找最长根到叶路径
  let longest: string[] = [];
  const dfs = (id: string, path: string[]) => {
    const cur = [...path, id];
    const children = childrenMap.get(id) ?? [];
    if (children.length === 0) {
      if (cur.length > longest.length) longest = cur;
      return;
    }
    for (const c of children) dfs(c, cur);
  };
  for (const r of roots) dfs(r, []);

  const mainPath = longest.length > 0 ? longest : valid.map((n) => n.id);
  return {
    keepNodeIds: valid.map((n) => n.id),
    mainPath,
    reasoning: 'LLM 分析失败，已保守保留所有非 abandoned 节点。',
  };
}

/**
 * 分析蛛网网络：收集所有节点 summary/userMessage 摘要，调用 LLM 识别
 * 重复支线与死胡同。失败时返回保守分析（保留所有非 abandoned 节点），不抛异常。
 */
export async function analyzeNetwork(
  project: NetworkProject,
): Promise<PruneAnalysis> {
  if (project.nodes.length === 0) {
    return { keepNodeIds: [], mainPath: [], reasoning: '项目无节点。' };
  }

  // 收集节点信息：优先用 summary，无则截取 userMessage 前 80 字
  const nodeInfos = project.nodes.map((n) => ({
    id: n.id,
    parentId: n.data.parentId,
    status: n.data.status,
    brief: n.data.summary?.trim() || n.data.userMessage.slice(0, 80) || '(空)',
  }));
  const validIds = new Set(project.nodes.map((n) => n.id));
  const nodeListText = nodeInfos
    .map(
      (n) =>
        `- id:${n.id} | 父:${n.parentId ?? '根'} | 状态:${n.status} | 摘要:${n.brief}`,
    )
    .join('\n');

  const userPrompt = `以下是蛛网对话网络的所有节点（id / 父节点 / 状态 / 摘要）：\n${nodeListText}\n\n请分析重复支线、死胡同，并给出主干道。严格按 System 约定的 JSON 格式输出，只输出 JSON 代码块。`;

  try {
    const messages: LLMMessage[] = [
      { role: 'system', content: PRUNE_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ];
    // 非流式调用（不传 onDelta），需要完整 JSON
    const result = await quickCallLLM(messages);
    const parsed = parsePruneAnalysis(result);
    if (parsed) {
      // 过滤掉不存在的节点 id
      parsed.keepNodeIds = parsed.keepNodeIds.filter((id) => validIds.has(id));
      parsed.mainPath = parsed.mainPath.filter((id) => validIds.has(id));
      // mainPath 必须是 keepNodeIds 的子集
      const keepSet = new Set(parsed.keepNodeIds);
      parsed.mainPath = parsed.mainPath.filter((id) => keepSet.has(id));
      if (parsed.keepNodeIds.length > 0) return parsed;
    }
  } catch {
    // LLM 调用或解析失败，走保守分析
  }

  return conservativeAnalysis(project);
}

/**
 * 基于分析结果派生精简项目。
 *
 * - 新项目命名：{原名}-精简版-{YYYYMMDD}
 * - originalProjectId 指向原项目，projectType='derived-pruned'
 * - 节点取自 analysis.keepNodeIds，按 analysis.mainPath 重建线性主干
 *   （mainPath[0] 为根 parentId=null，后续节点 parentId 为前一个节点 id）
 * - 非 mainPath 的保留节点：尽量保留原父（若也在保留集），否则挂到主干末梢
 * - 保留原节点 userMessage/assistantMessage/summary/status，重新生成 id
 * - 清理 mergedFromIds（派生项目为线性主干，原合并来源 id 已不在新项目中）
 * - 原项目不做任何修改
 */
export function derivePrunedProject(
  originalProject: NetworkProject,
  analysis: PruneAnalysis,
): NetworkProject {
  const yyyymmdd = formatYYYYMMDD(new Date());
  const name = `${originalProject.name}-精简版-${yyyymmdd}`;

  // 用 createProject 生成项目骨架（已写入 storage），再填充节点
  const base = createProject(name, {
    originalProjectId: originalProject.id,
    projectType: 'derived-pruned',
  });

  const originalById = new Map<string, Node<TurnNodeData>>(
    originalProject.nodes.map((n) => [n.id, n]),
  );

  // 旧 id -> 新 id 映射（仅保留节点）
  let idCounter = 0;
  const idMap = new Map<string, string>();
  for (const oldId of analysis.keepNodeIds) {
    idMap.set(oldId, generateNodeId('turn', idCounter++));
  }

  const mainPathSet = new Set(analysis.mainPath);
  // 主干末梢新 id：用于把脱离主干的保留节点挂回主干
  const lastMainOldId =
    analysis.mainPath.length > 0
      ? analysis.mainPath[analysis.mainPath.length - 1]
      : null;
  const lastMainNewId = lastMainOldId ? idMap.get(lastMainOldId) ?? null : null;

  // 决定每个保留节点的新 parentId
  const newParentIdMap = new Map<string, string | null>();

  // 1. mainPath：线性链（mainPath[0] 为根，其余 parentId 为前一个节点）
  for (let i = 0; i < analysis.mainPath.length; i++) {
    const oldId = analysis.mainPath[i];
    const newId = idMap.get(oldId);
    if (!newId) continue;
    const parentId =
      i === 0 ? null : idMap.get(analysis.mainPath[i - 1]) ?? null;
    newParentIdMap.set(newId, parentId);
  }

  // 2. 非 mainPath 保留节点：原父在保留集则保留映射，否则挂到主干末梢
  for (const oldId of analysis.keepNodeIds) {
    if (mainPathSet.has(oldId)) continue;
    const newId = idMap.get(oldId);
    if (!newId) continue;
    const original = originalById.get(oldId);
    const origParentId = original?.data.parentId ?? null;
    if (origParentId && idMap.has(origParentId)) {
      newParentIdMap.set(newId, idMap.get(origParentId) ?? null);
    } else {
      newParentIdMap.set(newId, lastMainNewId);
    }
  }

  // 构建新节点：保留原 data 内容，仅覆盖 id/parentId/mergedFromIds
  const newNodes: Node<TurnNodeData>[] = [];
  for (const oldId of analysis.keepNodeIds) {
    const original = originalById.get(oldId);
    if (!original) continue;
    const newId = idMap.get(oldId);
    if (!newId) continue;
    const parentId = newParentIdMap.get(newId) ?? null;
    newNodes.push({
      id: newId,
      type: original.type,
      position: { ...original.position },
      data: {
        ...original.data,
        parentId,
        // 清理合并引用：派生项目为线性主干，原合并来源 id 已不在新项目中
        mergedFromIds: undefined,
      },
    });
  }

  // 按 parent-child 重建边
  const newEdges: Edge[] = [];
  for (const node of newNodes) {
    const pid = node.data.parentId;
    if (pid) {
      newEdges.push({
        id: `edge-${pid}-${node.id}`,
        source: pid,
        target: node.id,
        animated: false,
      });
    }
  }

  // 填充新项目的 nodes/edges（updateProject 内部已 saveProjects）
  updateProject(base.id, { nodes: newNodes, edges: newEdges });

  return {
    ...base,
    nodes: newNodes,
    edges: newEdges,
    updatedAt: Date.now(),
  };
}
