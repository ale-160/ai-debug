// ============================================================
// AI Debug — llm-config 单元测试
//
// 任务来源：H-17 测试覆盖（validateCustomBaseUrl / maskKey / getEffectivePathSummaryConfig）
//
// 覆盖：
//   1. validateCustomBaseUrl：自定义 baseUrl 安全校验
//      - 协议白名单 / https 强制 / 拒绝裸 IP / 拒绝私有 IP
//   2. maskKey：API Key 脱敏显示
//   3. getEffectivePathSummaryConfig：用户覆盖 vs provider 预设
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  validateCustomBaseUrl,
  maskKey,
  getEffectivePathSummaryConfig,
  PROVIDER_PRESETS,
  type LLMProvider,
} from '../llm-config';

// ----------------------------------------------------------------------
// validateCustomBaseUrl
// ----------------------------------------------------------------------
describe('validateCustomBaseUrl - 协议白名单', () => {
  it('https 域名 → ok=true', () => {
    expect(validateCustomBaseUrl('https://api.example.com/v1')).toEqual({ ok: true });
  });

  it('http://localhost → ok=true（localhost 允许 http）', () => {
    expect(validateCustomBaseUrl('http://localhost:3000/v1')).toEqual({ ok: true });
  });

  it('http://127.0.0.1 → 因私有 IP 被拒（即使视为 localhost）', () => {
    const result = validateCustomBaseUrl('http://127.0.0.1:3000');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('私有 IP');
  });

  it('javascript: 协议 → 拒绝', () => {
    const result = validateCustomBaseUrl('javascript:alert(1)');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('不支持的协议');
  });

  it('data: 协议 → 拒绝', () => {
    const result = validateCustomBaseUrl('data:text/plain,hello');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('不支持的协议');
  });

  it('file: 协议 → 拒绝', () => {
    const result = validateCustomBaseUrl('file:///etc/passwd');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('不支持的协议');
  });

  it('http://example.com → 拒绝（非 localhost 必须 https）', () => {
    const result = validateCustomBaseUrl('http://example.com');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('https');
  });
});

describe('validateCustomBaseUrl - 空值与非法格式', () => {
  it('空字符串 → 拒绝', () => {
    const result = validateCustomBaseUrl('');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('不能为空');
  });

  it('纯空白字符串 → 拒绝', () => {
    const result = validateCustomBaseUrl('   ');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('不能为空');
  });

  it('非 URL 字符串 → 拒绝', () => {
    const result = validateCustomBaseUrl('not a url');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('不是合法 URL');
  });
});

describe('validateCustomBaseUrl - IP 地址拒绝', () => {
  it('公网 IP（https）→ 拒绝裸 IP 直连', () => {
    const result = validateCustomBaseUrl('https://8.8.8.8/v1');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('IP 地址');
  });

  it('公网 IP（http）→ 优先拒绝 http 非 localhost', () => {
    const result = validateCustomBaseUrl('http://8.8.8.8');
    expect(result.ok).toBe(false);
    // http 检查先于 IP 检查
    expect(result.reason).toContain('https');
  });

  it('私有 IP 10.x.x.x → 拒绝', () => {
    const result = validateCustomBaseUrl('http://10.0.0.1');
    expect(result.ok).toBe(false);
    // http 检查先于 IP 检查
    expect(result.reason).toContain('https');
  });

  it('私有 IP 10.x.x.x https → 拒绝裸 IP', () => {
    const result = validateCustomBaseUrl('https://10.0.0.1');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('IP 地址');
  });

  it('私有 IP 192.168.x.x https → 拒绝裸 IP', () => {
    const result = validateCustomBaseUrl('https://192.168.1.1');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('IP 地址');
  });

  it('私有 IP 172.16.x.x ~ 172.31.x.x https → 拒绝裸 IP', () => {
    expect(validateCustomBaseUrl('https://172.16.0.1').ok).toBe(false);
    expect(validateCustomBaseUrl('https://172.31.255.255').ok).toBe(false);
  });

  it('172.15.x.x 不属于私有段（边界检查）→ 仍是裸 IP 被拒', () => {
    const result = validateCustomBaseUrl('https://172.15.0.1');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('IP 地址');
  });

  it('172.32.x.x 不属于私有段（边界检查）→ 仍是裸 IP 被拒', () => {
    const result = validateCustomBaseUrl('https://172.32.0.1');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('IP 地址');
  });

  it('169.254.x.x 链路本地地址 https → 拒绝裸 IP', () => {
    const result = validateCustomBaseUrl('https://169.254.169.254');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('IP 地址');
  });
});

describe('validateCustomBaseUrl - localhost 子域', () => {
  it('http://api.localhost → ok=true（.localhost 后缀视为本地）', () => {
    expect(validateCustomBaseUrl('http://api.localhost').ok).toBe(true);
  });

  it('http://my-api.localhost:8080 → ok=true', () => {
    expect(validateCustomBaseUrl('http://my-api.localhost:8080').ok).toBe(true);
  });

  it('https://api.localhost → ok=true', () => {
    expect(validateCustomBaseUrl('https://api.localhost').ok).toBe(true);
  });
});

describe('validateCustomBaseUrl - 合法域名', () => {
  it('https://api.openai.com → ok=true', () => {
    expect(validateCustomBaseUrl('https://api.openai.com').ok).toBe(true);
  });

  it('带路径的 https URL → ok=true', () => {
    expect(validateCustomBaseUrl('https://api.example.com/v1/chat').ok).toBe(true);
  });

  it('带端口的 https URL → ok=true', () => {
    expect(validateCustomBaseUrl('https://api.example.com:8080').ok).toBe(true);
  });
});

// ----------------------------------------------------------------------
// maskKey
// ----------------------------------------------------------------------
describe('maskKey - API Key 脱敏', () => {
  it('空字符串 → 空字符串', () => {
    expect(maskKey('')).toBe('');
  });

  it('短 key（≤8 位）→ 全部 * 替代', () => {
    expect(maskKey('short')).toBe('*****');
    expect(maskKey('12345678')).toBe('********');
  });

  it('长 key → 前 3 + **** + 后 4', () => {
    expect(maskKey('sk-abcdefghijklmnopqrstuvwxyz')).toBe('sk-****wxyz');
  });

  it('恰好 9 位 key（边界）→ 应用脱敏格式', () => {
    // 9 位 > 8 → 走 head + **** + tail
    expect(maskKey('123456789')).toBe('123****6789');
  });

  it('恰好 8 位 key（边界）→ 全部 * 替代', () => {
    expect(maskKey('12345678')).toBe('********');
  });
});

// ----------------------------------------------------------------------
// getEffectivePathSummaryConfig
// ----------------------------------------------------------------------
describe('getEffectivePathSummaryConfig - 配置优先级', () => {
  it('userOverride 存在 → 直接返回 userOverride', () => {
    const override = {
      enabled: true,
      threshold: 8,
      recentKeep: 5,
      maxLength: 1200,
    };
    expect(getEffectivePathSummaryConfig(override, 'custom')).toEqual(override);
  });

  it('userOverride = undefined → 返回 provider 预设', () => {
    const result = getEffectivePathSummaryConfig(undefined, 'mimo');
    expect(result).toEqual(PROVIDER_PRESETS.mimo.pathSummary);
  });

  it('userOverride = undefined + 不同 provider → 返回各自预设', () => {
    const mimoResult = getEffectivePathSummaryConfig(undefined, 'mimo');
    const volcengineResult = getEffectivePathSummaryConfig(undefined, 'volcengine');
    // MiMo 8K 模型 threshold=4，火山 128K 模型 threshold=10
    expect(mimoResult.threshold).toBe(4);
    expect(volcengineResult.threshold).toBe(10);
  });

  it('userOverride.enabled=false 时仍返回 userOverride（调用方按需处理）', () => {
    const override = { enabled: false, threshold: 100, recentKeep: 100, maxLength: 1000 };
    expect(getEffectivePathSummaryConfig(override, 'mimo')).toEqual(override);
  });

  it('每个 provider 都有 pathSummary 预设', () => {
    const providers: LLMProvider[] = ['mimo', 'volcengine', 'openrouter', 'deepseek', 'openai', 'custom'];
    for (const p of providers) {
      const preset = PROVIDER_PRESETS[p].pathSummary;
      expect(preset).toBeDefined();
      expect(typeof preset.enabled).toBe('boolean');
      expect(typeof preset.threshold).toBe('number');
      expect(typeof preset.recentKeep).toBe('number');
      expect(typeof preset.maxLength).toBe('number');
    }
  });
});
