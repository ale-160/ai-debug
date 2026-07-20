// ============================================================
// ai-debug — 变量池精简版（P2-2）
//
// 设计：
//  - 纯内存 Map，不持久化（SSR 安全：模块级单例只读写 Map，不访问 window/localStorage）
//  - 引用语法 {{#nodeId.varName#}}（与既有 {{key}} 模板语法不冲突）
//  - 命中替换为 String(value)，未命中保留原文（向后兼容）
//  - 当前 ai-debug 每个节点只有 'text' 一个变量（= assistantMessage）
//    变量池核心价值：跨分支引用，分支 A 中可引用分支 B 的节点输出
// ============================================================

/** 变量值条目 */
export interface VariableValue {
  nodeId: string;
  varName: string;
  value: unknown;
  type: string;
}

/** 变量引用语法正则：{{#nodeId.varName#}} */
export const VARIABLE_REF_PATTERN = /\{\{#([^}]+)#\}\}/g;
/** 单次匹配检测用正则（无 g 标志，避免 lastIndex 状态残留） */
const VARIABLE_REF_TEST = /\{\{#[^}]+#\}\}/;

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
 * - 未命中的引用保留原文（向后兼容：不含 {{#...#}} 的文本走原流程）
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
  // 重置 lastIndex（全局正则复用安全）
  VARIABLE_REF_PATTERN.lastIndex = 0;
  const resolved = text.replace(VARIABLE_REF_PATTERN, (match, ref: string) => {
    references.push(ref);
    const [nodeId, varName] = ref.split('.');
    if (!nodeId || !varName) return match;
    const variable = variablePool.get(nodeId, varName);
    if (variable) {
      return String(variable.value);
    }
    return match; // 未找到变量，保留原引用
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
