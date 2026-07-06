// ============================================================
// AI Debug — 上下文混合模式配置
//
// 路径级 rolling summary 的阈值参数：当分支路径超过 SUMMARY_THRESHOLD
// 时启用"前段摘要 + 后段完整"的混合模式，避免单分支过长导致 token 超限
// 与早期细节稀释近期焦点。参数集中存放，便于后续按模型调整。
// ============================================================

/**
 * 路径长度阈值：超过 6 个节点启用混合模式。
 * 路径长度 ≤ 此值时保持原行为（完整拼接所有节点）。
 */
export const SUMMARY_THRESHOLD = 6;

/**
 * 混合模式下保留完整内容的最近节点数（后段长度）。
 * 前段节点用 pathSummary 替代，后 RECENT_KEEP 个节点传完整 userMessage + assistantMessage。
 */
export const RECENT_KEEP = 4;

/**
 * 路径摘要（rolling summary）字数上限。
 * LLM 生成 pathSummary 时约束输出 ≤ 此长度，超长时由调用方截断。
 */
export const PATH_SUMMARY_MAX_LENGTH = 1000;
