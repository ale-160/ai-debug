// ============================================================
// AI Debug — LLM 配置管理
// 管理 LLM Provider 配置（API Key、Base URL、Model）的持久化与脱敏
// ============================================================

/** 支持的 LLM 服务商 */
export type LLMProvider = 'mimo' | 'volcengine' | 'openrouter' | 'deepseek' | 'openai' | 'custom';

/** LLM 调用配置 */
export interface LLMConfig {
  provider: LLMProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
}

/** 各 Provider 默认配置（baseUrl / model / 显示名 / 官方文档链接） */
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
  }
> = {
  mimo: {
    baseUrl: 'https://api.xiaomimimo.com/v1',
    model: 'mimo-v2.5',
    label: 'Xiaomi MiMo',
    docsUrl: 'https://platform.xiaomimimo.com?ref=HVJJGY',
    docsLabel: '前往 Xiaomi MiMo 开放平台获取 API Key',
  },
  volcengine: {
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-seed-2.0',
    label: '火山方舟',
    docsUrl: 'https://volcengine.com/L/uH3ewWuCZDw/',
    docsLabel: '立即订阅方舟 Coding Plan（邀请码 K42LBHZY，9.5折优惠）',
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    label: 'OpenRouter',
    docsUrl: 'https://openrouter.ai/keys',
    docsLabel: '前往 OpenRouter 获取 API Key',
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-flash',
    label: 'DeepSeek',
    docsUrl: 'https://platform.deepseek.com/api_keys',
    docsLabel: '前往 DeepSeek 获取 API Key',
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    label: 'OpenAI',
    docsUrl: 'https://platform.openai.com/api-keys',
    docsLabel: '前往 OpenAI 获取 API Key',
  },
  custom: {
    baseUrl: '',
    model: '',
    label: '自定义',
    docsUrl: '',
    docsLabel: '',
  },
};

/** localStorage 存储键 */
export const LLM_CONFIG_KEY = 'ai-debug:llm-config';

/**
 * 从 localStorage 读取 LLM 配置。
 * 在非浏览器环境（SSR）下返回 null。
 */
export function loadConfig(): LLMConfig | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LLM_CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LLMConfig;
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
 * 将 LLM 配置写入 localStorage。
 * 在非浏览器环境下静默跳过。
 */
export function saveConfig(config: LLMConfig): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LLM_CONFIG_KEY, JSON.stringify(config));
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
