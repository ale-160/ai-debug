// ============================================================
// AI Debug — LLM 配置管理
// 管理 LLM Provider 配置（API Key、Base URL、Model）的持久化与脱敏
// ============================================================

import type { PathSummaryConfig } from '@/components/node-flow/types';
import { obfuscateJSON, deobfuscateJSON } from '@/lib/crypto';

/** 支持的 LLM 服务商 */
export type LLMProvider = 'mimo' | 'volcengine' | 'openrouter' | 'deepseek' | 'openai' | 'custom';

/** LLM 调用配置 */
export interface LLMConfig {
  provider: LLMProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
}

/** 各 Provider 默认配置（baseUrl / model / 显示名 / 官方文档链接 / pathSummary 预设） */
export const PROVIDER_PRESETS: Record<
  LLMProvider,
  {
    baseUrl: string;
    model: string;
    label: string;
    /** 官方获取 API Key / 模型列表的文档链接 */
    docsUrl: string;
    /** 文档链接的显示文案 */
    docsLabel: string;
    /**
     * 路径摘要（pathSummary）混合模式预设。
     * 按模型上下文窗口推荐：8K 模型 threshold=4/recentKeep=3/maxLength=800；
     * 128K 模型 threshold=10/recentKeep=6/maxLength=1500；2M 模型可关闭混合模式（enabled=false）。
     * 用户可在设置面板覆盖此预设。
     */
    pathSummary: PathSummaryConfig;
  }
> = {
  mimo: {
    baseUrl: 'https://api.xiaomimimo.com/v1',
    model: 'mimo-v2.5',
    label: 'Xiaomi MiMo',
    docsUrl: 'https://platform.xiaomimimo.com?ref=HVJJGY',
    docsLabel: '前往 Xiaomi MiMo 开放平台获取 API Key',
    // MiMo v2.5 上下文 8K：保守阈值
    pathSummary: { enabled: true, threshold: 4, recentKeep: 3, maxLength: 800 },
  },
  volcengine: {
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-seed-2.0',
    label: '火山方舟',
    docsUrl: 'https://volcengine.com/L/uH3ewWuCZDw/',
    docsLabel: '立即订阅方舟 Coding Plan（邀请码 K42LBHZY，9.5折优惠）',
    // Doubao Seed 2.0 上下文 128K：标准阈值
    pathSummary: { enabled: true, threshold: 10, recentKeep: 6, maxLength: 1500 },
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    label: 'OpenRouter',
    docsUrl: 'https://openrouter.ai/keys',
    docsLabel: '前往 OpenRouter 获取 API Key',
    // OpenRouter 模型多样，默认走 128K 阈值
    pathSummary: { enabled: true, threshold: 10, recentKeep: 6, maxLength: 1500 },
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-flash',
    label: 'DeepSeek',
    docsUrl: 'https://platform.deepseek.com/api_keys',
    docsLabel: '前往 DeepSeek 获取 API Key',
    // DeepSeek V4-Flash 上下文 128K：标准阈值
    pathSummary: { enabled: true, threshold: 10, recentKeep: 6, maxLength: 1500 },
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    label: 'OpenAI',
    docsUrl: 'https://platform.openai.com/api-keys',
    docsLabel: '前往 OpenAI 获取 API Key',
    // GPT-4o-mini 上下文 128K：标准阈值
    pathSummary: { enabled: true, threshold: 10, recentKeep: 6, maxLength: 1500 },
  },
  custom: {
    baseUrl: '',
    model: '',
    label: '自定义',
    docsUrl: '',
    docsLabel: '',
    // 自定义 provider 默认走 128K 阈值，用户可按实际模型调整
    pathSummary: { enabled: true, threshold: 10, recentKeep: 6, maxLength: 1500 },
  },
};

/**
 * 获取生效的 pathSummary 配置：用户覆盖 > provider 预设 > 默认值。
 * 调用方传入 AppSettings.pathSummaryConfig（用户覆盖）与 provider，
 * 返回实际生效的配置。
 */
export function getEffectivePathSummaryConfig(
  userOverride: PathSummaryConfig | undefined,
  provider: LLMProvider,
): PathSummaryConfig {
  if (userOverride) return userOverride;
  return PROVIDER_PRESETS[provider].pathSummary;
}

/**
 * localStorage 存储键
 *
 * 4.1.9：使用语义清晰的明文 key 名（`ai-debug:llm-config`）而非不透明
 * 随机字符串（如 `k_a1b2c3`）的原因：
 * - 纯前端应用（output: 'export'，无后端），攻击模型与传统 Web 应用不同：
 *   任何能访问浏览器 localStorage 的代码（XSS / 浏览器扩展 / 物理访问）都能
 *   通过遍历 localStorage 找到敏感数据，不透明 key 名无法提供实质安全增益。
 * - 明文 key 名便于开发者调试（DevTools Application 面板直接定位）、迁移
 *   （用户手动导入导出）、运维排查（日志中可读）。
 * - 敏感数据（API Key）已通过 obfuscateJSON 做 AES-GCM 加密存储（crypto.ts），
 *   明文 key 名不增加攻击面。
 * - 若未来引入后端或多租户场景，需重新评估 key 名策略。
 */
export const LLM_CONFIG_KEY = 'ai-debug:llm-config';

/**
 * 从 localStorage 读取 LLM 配置。
 * 在非浏览器环境（SSR）下返回 null。
 * 读取时自动解混淆，兼容旧版明文存储的数据。
 */
export function loadConfig(): LLMConfig | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LLM_CONFIG_KEY);
    if (!raw) return null;
    // 自动检测：混淆格式（enc: 前缀）用 deobfuscateJSON，否则按明文 JSON 解析（兼容旧数据）
    const parsed = deobfuscateJSON<LLMConfig>(raw);
    if (!parsed) return null;
    // 基本字段校验
    if (
      !parsed ||
      typeof parsed.provider !== 'string' ||
      typeof parsed.apiKey !== 'string' ||
      typeof parsed.baseUrl !== 'string' ||
      typeof parsed.model !== 'string'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 将 LLM 配置写入 localStorage（混淆存储，避免明文 API Key）。
 * 在非浏览器环境下静默跳过。
 */
export function saveConfig(config: LLMConfig): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LLM_CONFIG_KEY, obfuscateJSON(config));
  } catch {
    // 写入失败（隐私模式 / 配额满）时静默忽略
  }
}

/**
 * 清除 localStorage 中的 LLM 配置。
 * 在非浏览器环境下静默跳过。
 */
export function clearConfig(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(LLM_CONFIG_KEY);
  } catch {
    // 静默忽略
  }
}

/**
 * 对 API Key 脱敏显示。
 * 例如 'sk-abcdef123456' -> 'sk-****3456'
 * 过短的 key 全部用 * 替代以避免泄露。
 */
export function maskKey(apiKey: string): string {
  if (!apiKey) return '';
  const len = apiKey.length;
  // 少于 8 位时全部脱敏
  if (len <= 8) {
    return '*'.repeat(len);
  }
  // 保留前 3 位与后 4 位
  const head = apiKey.slice(0, 3);
  const tail = apiKey.slice(-4);
  return `${head}****${tail}`;
}

/**
 * 判断是否已配置有效的 API Key。
 * 仅检查存在性，不验证 Key 是否真实可用。
 */
export function isConfigured(): boolean {
  const config = loadConfig();
  return !!config && !!config.apiKey && !!config.baseUrl && !!config.model;
}

/**
 * 校验自定义 provider 的 baseUrl，防止钓鱼泄露 apiKey。
 *
 * 规则（安全优先，可能影响少数本地开发场景）：
 * - 必须是合法 URL，协议仅允许 http / https（拒绝 javascript: / data: / file: 等）
 * - 非 localhost 必须为 https
 * - 拒绝私有 IP 段：10.0.0.0/8、172.16.0.0/12、192.168.0.0/16、127.0.0.0/8、169.254.0.0/16
 *   （169.254 含云元数据服务，禁用避免 SSRF；本地开发请用 localhost 域名）
 * - 拒绝裸 IP 直连（非常规 LLM 服务商形态，钓鱼风险高）
 *
 * @returns ok=true 表示通过；ok=false 时 reason 给出可读原因
 */
export function validateCustomBaseUrl(url: string): { ok: boolean; reason?: string } {
  if (!url || typeof url !== 'string' || !url.trim()) {
    return { ok: false, reason: 'Base URL 不能为空' };
  }

  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return { ok: false, reason: 'Base URL 不是合法 URL' };
  }

  // 协议仅允许 http / https（拒绝 javascript: / data: / file: 等）
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: `不支持的协议：${parsed.protocol}（仅允许 http/https）` };
  }

  const host = parsed.hostname.toLowerCase();
  const isLocalhost =
    host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost');

  // 非 localhost 必须 https
  if (!isLocalhost && parsed.protocol !== 'https:') {
    return { ok: false, reason: '非本地地址必须使用 https' };
  }

  // 拒绝裸 IP 直连（localhost 例外）
  if (!isLocalhost && isIPv4Literal(host)) {
    return { ok: false, reason: '不允许直接使用 IP 地址，请使用域名' };
  }

  // 拒绝私有 IP 段（即使 localhost 域名解析到私有 IP 也无法在此层拦截，
  // 但能拦截直接以 IP 字面量填入的情况）
  if (isIPv4Literal(host) && isPrivateIPv4(host)) {
    return { ok: false, reason: '不允许使用私有 IP 地址' };
  }

  return { ok: true };
}

/** 判断字符串是否为合法 IPv4 字面量 */
function isIPv4Literal(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => {
    if (!/^\d{1,3}$/.test(p)) return false;
    const n = Number(p);
    return n >= 0 && n <= 255;
  });
}

/** 判断 IPv4 字面量是否落在私有 / 保留段 */
function isPrivateIPv4(host: string): boolean {
  const parts = host.split('.').map(Number);
  const [a, b] = parts;
  // 10.0.0.0/8
  if (a === 10) return true;
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true;
  // 127.0.0.0/8
  if (a === 127) return true;
  // 169.254.0.0/16（含云元数据服务）
  if (a === 169 && b === 254) return true;
  return false;
}
