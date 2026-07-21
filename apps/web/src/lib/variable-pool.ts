// ============================================================
// ai-debug — 变量池精简版（P2-2）
//
// 设计：
//  - 纯内存 Map，不持久化（SSR 安全：模块级单例只读写 Map，不访问 window/localStorage）
//  - 引用语法 {{#nodeId.varName#}}（与既有 {{key}} 模板语法不冲突）
//  - 命中替换为 String(value)，未命中替换为占位符 `[未找到变量: nodeId.varName]`
//    （3.8.1：原"保留原文"会让 LLM 看到原始 {{#...#}} 语法，可能误解为指令；
//    改为显式占位符后用户/LLM 都能直观看到引用失败，避免静默错误传播）
//  - 当前 ai-debug 每个节点只有 'text' 一个变量（= assistantMessage）
//    变量池核心价值：跨分支引用，分支 A 中可引用分支 B 的节点输出
//
// 4.6.4 注记（保守方案，本次不强制实现）：当前变量池允许跨分支引用任意节点
// （只要 nodeId 存在于变量池中即可解析）。这在功能上很有用（如把分支 B 的结论
// 引入分支 A 继续讨论），但也意味着用户可能引用已 abandoned / 已 ignored 分支
// 的输出，造成上下文混淆。后续可在 UI 层增加提示：
//   - 引用语法输入时自动补全只显示当前路径 + 已 success 节点
//   - 引用 ignored / abandoned 节点时在 Inspector 显示警告
//   - 在节点上下文菜单中提供"复制引用"按钮，避免用户手动拼 nodeId
// 当前保守策略：依赖用户手动管理引用，不做强制限制。
// ============================================================

/** 4.6.2：当前 ai-debug 每个节点仅产出 'text' 一个变量（= assistantMessage）。
 * 此常量定义允许的 varName 集合，未来扩展（如引入 'summary' / 'tags' 等变量）
 * 时在此添加。解析时遇到不在白名单的 varName 视为未找到（占位符提示）。 */
export const ALLOWED_VAR_NAMES = new Set(['text']);

/** 变量值条目 */
export interface VariableValue {
  nodeId: string;
  varName: string;
  value: unknown;
  type: string;
}

/**
 * 变量引用语法正则：{{#nodeId.varName#}}
 *
 * 4.6.1：限制 nodeId 与 varName 字符集为 [A-Za-z0-9_-]，
 * 避免过宽的正则匹配到非预期内容（如 `{{#</script><script>#}}`）造成注入风险。
 * - nodeId 与 varName 之间用 `.` 分隔（与既有 split('.') 拆分逻辑兼容）
 * - 不符合字符集的引用（如 `{{#n1#}}` 缺 varName、`{{#.text#}}` 缺 nodeId）
 *   不会被匹配，原文保留
 */
export const VARIABLE_REF_PATTERN = /\{\{#([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)#\}\}/g;
/** 单次匹配检测用正则（无 g 标志，避免 lastIndex 状态残留） */
const VARIABLE_REF_TEST = /\{\{#[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+#\}\}/;

/**
 * 4.6.3：单次解析的最大替换次数上限。
 * 超过此值的引用保留原文，防止恶意构造的超长引用文本导致正则回溯 / 性能问题。
 * 100 次足够覆盖正常使用场景（一个节点消息中很少引用超过 100 个变量）。
 */
export const MAX_VARIABLE_REPLACEMENTS = 100;

/**
 * 变量池：按 nodeId::varName 索引存储节点产出变量。
 * 节点执行完成后由 network-engine 写入，发起 LLM 请求前解析引用时读取。
 * 不持久化：刷新页面后清空，需要重新执行节点才会重建。
 */
class VariablePool {
  // key 使用 `::` 分隔，避免与 nodeId 中可能出现的 `.` 字符冲突
  private pool = new Map<string, VariableValue>();

  /** 写入变量（覆盖同 key 旧值） */
  set(nodeId: string, varName: string, value: unknown, type: string): void {
    const key = `${nodeId}::${varName}`;
    this.pool.set(key, { nodeId, varName, value, type });
  }

  /** 读取单个变量 */
  get(nodeId: string, varName: string): VariableValue | undefined {
    return this.pool.get(`${nodeId}::${varName}`);
  }

  /** 获取全部变量 */
  getAll(): VariableValue[] {
    return Array.from(this.pool.values());
  }

  /** 获取指定节点的全部变量 */
  getByNode(nodeId: string): VariableValue[] {
    return this.getAll().filter((v) => v.nodeId === nodeId);
  }

  /** 清空变量池 */
  clear(): void {
    this.pool.clear();
  }
}

/** 全局变量池单例（前端使用，模块级常量，SSR 安全不读写浏览器 API） */
export const variablePool = new VariablePool();

/**
 * 解析文本中的 {{#nodeId.varName#}} 变量引用。
 * - 命中的引用替换为变量值（String 化）
 * - 未命中的引用替换为占位符 `[未找到变量: nodeId.varName]`
 *   （3.8.1：原"保留原文"会让 LLM 看到原始 {{#...#}} 语法，可能误解为指令；
 *    改为显式占位符后用户/LLM 都能直观看到引用失败，避免静默错误传播）
 *
 * 4.6.3：限制单次解析的最大替换次数 MAX_VARIABLE_REPLACEMENTS（100），
 * 超过此值的引用保留原文（不再尝试匹配），防止恶意构造的超长引用文本
 * 导致正则回溯 / 性能问题。
 *
 * @returns text        解析后的文本
 * @returns references  文本中出现的所有引用（含未命中的），格式为 `nodeId.varName`
 */
export function resolveVariableReferences(text: string): {
  text: string;
  references: string[];
} {
  if (!text || !VARIABLE_REF_TEST.test(text)) {
    return { text, references: [] };
  }

  const references: string[] = [];
  // 4.6.3：替换计数器，超过上限后停止替换
  let replacementCount = 0;
  // 重置 lastIndex（全局正则复用安全）
  VARIABLE_REF_PATTERN.lastIndex = 0;
  const resolved = text.replace(VARIABLE_REF_PATTERN, (match, nodeId: string, varName: string) => {
    // 4.6.3：超过最大替换次数后保留原文，不再尝试解析
    if (replacementCount >= MAX_VARIABLE_REPLACEMENTS) {
      return match;
    }
    replacementCount++;
    // 4.6.1：正则已限制字符集，nodeId/varName 必然非空（[A-Za-z0-9_-]+）
    references.push(`${nodeId}.${varName}`);
    // 4.6.2：varName 白名单校验。只允许 'text'（当前 ai-debug 每个节点仅产出
    // 'text' 一个变量）。其他 varName 视为未找到，返回占位符提示用户。
    // 这避免了误引用未定义变量（如 {{#node1.summary#}}）导致 String(undefined)
    // 等不预期行为。
    if (!ALLOWED_VAR_NAMES.has(varName)) {
      return `[未找到变量: ${nodeId}.${varName}]`;
    }
    const variable = variablePool.get(nodeId, varName);
    if (variable) {
      return String(variable.value);
    }
    // 3.8.1：未找到变量时替换为显式占位符，避免 LLM 看到原始 {{#...#}} 语法误解为指令
    return `[未找到变量: ${nodeId}.${varName}]`;
  });
  return { text: resolved, references };
}

/**
 * 检测文本中是否包含变量引用语法。
 * 用于 Inspector 判断是否需要提示变量解析。
 */
export function hasVariableReferences(text: string): boolean {
  return VARIABLE_REF_TEST.test(text);
}
