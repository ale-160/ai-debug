// ============================================================
// AI Debug — 上下文混合模式配置
//
// 路径级 rolling summary 的阈值参数：当分支路径超过 SUMMARY_THRESHOLD
// 时启用"前段摘要 + 后段完整"的混合模式，避免单分支过长导致 token 超限
// 与早期细节稀释近期焦点。参数集中存放，便于后续按模型调整。
//
// T007 起：参数可通过 AppSettings.pathSummaryConfig 用户覆盖，本模块
// 常量作为"未配置时的兜底默认值"。getEffectivePathSummaryConfig（来自
// llm-config.ts）按 用户覆盖 > provider 预设 顺序解析生效配置。
// ============================================================

import type { PathSummaryConfig } from '@/components/node-flow/types';
import { loadConfig, getEffectivePathSummaryConfig } from './llm-config';
import { loadSettings } from './settings-storage';

/**
 * 路径长度阈值：超过 6 个节点启用混合模式。
 * 路径长度 ≤ 此值时保持原行为（完整拼接所有节点）。
 * T007 起：实际生效值优先取 AppSettings.pathSummaryConfig.threshold，
 * 此常量仅作为未配置时的兜底默认值（向后兼容）。
 */
export const SUMMARY_THRESHOLD = 6;

/**
 * 混合模式下保留完整内容的最近节点数（后段长度）。
 * 前段节点用 pathSummary 替代，后 RECENT_KEEP 个节点传完整 userMessage + assistantMessage。
 * T007 起：实际生效值优先取 AppSettings.pathSummaryConfig.recentKeep。
 */
export const RECENT_KEEP = 4;

/**
 * 路径摘要（rolling summary）字数上限。
 * LLM 生成 pathSummary 时约束输出 ≤ 此长度，超长时由调用方截断。
 * T007 起：实际生效值优先取 AppSettings.pathSummaryConfig.maxLength。
 */
export const PATH_SUMMARY_MAX_LENGTH = 1000;

/**
 * 从 localStorage 读取当前生效的 pathSummary 配置。
 * 解析顺序：AppSettings.pathSummaryConfig（用户覆盖） > PROVIDER_PRESETS[provider].pathSummary（预设）。
 * - 未配置 LLM（loadConfig 返回 null）时返回 undefined，调用方走兜底常量。
 * - AppSettings.pathSummaryConfig.enabled === false 时返回 undefined，表示关闭混合模式
 *   （调用方按 threshold=Infinity 处理）。
 *
 * SSR 安全：loadConfig / loadSettings 在非浏览器环境返回 null/默认值，本函数也返回 undefined。
 */
export function getActivePathSummaryConfig(): PathSummaryConfig | undefined {
  const config = loadConfig();
  if (!config) return undefined;
  const settings = loadSettings();
  const effective = getEffectivePathSummaryConfig(settings.pathSummaryConfig, config.provider);
  // 用户显式关闭混合模式：返回带 enabled=false 的配置，调用方按需处理
  return effective;
}
