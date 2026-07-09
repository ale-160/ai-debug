// ============================================================
// AI Debug — 执行进度友好文案生成器
// 按状态随机选取营销式文案，避免在组件中硬编码"思考中"。
// ============================================================
import type { Language } from '@/data/i18n';

/** 运行中：AI 正在沿蛛网路径工作的多种表达 */
const RUNNING_MESSAGES_ZH = [
  'AI 正在梳理上下文...',
  '正在沿蛛网路径收集记忆...',
  '正在编织新的分支...',
  'AI 正在思考最佳路线...',
];

const RUNNING_MESSAGES_EN = [
  'AI is organizing context...',
  'Collecting memory along the web path...',
  'Weaving a new branch...',
  'AI is thinking about the best route...',
];

/** 完成：分支就绪的简短确认 */
const COMPLETE_MESSAGES_ZH = ['分支已就绪', '蛛网已更新'];

const COMPLETE_MESSAGES_EN = ['Branch is ready', 'Web updated'];

/** 从数组中随机取一项 */
function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** 按语言与状态返回随机友好文案 */
export function pickStatusMessage(status: 'running' | 'complete', lang: Language = 'zh'): string {
  if (status === 'running') {
    return pickRandom(lang === 'en' ? RUNNING_MESSAGES_EN : RUNNING_MESSAGES_ZH);
  }
  return pickRandom(lang === 'en' ? COMPLETE_MESSAGES_EN : COMPLETE_MESSAGES_ZH);
}
