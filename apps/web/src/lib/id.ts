// ============================================================
// AI Debug — 统一 ID 生成工具
//
// 用途：替换散落在各模块的 `Math.random()` ID 生成，使用浏览器原生
// `crypto.randomUUID()` 提供 CSPRNG 级别的唯一性，避免 CodeQL
// `js/insecure-randomness` 告警。
//
// SSR 安全：在非浏览器环境（SSR / 测试）下回退到时间戳 + counter 方案，
// 保证同进程内唯一性即可（SSR 不会持久化这些 ID）。
// ============================================================

/**
 * 生成带前缀的唯一 ID。
 * 浏览器：`crypto.randomUUID()` 截取前 8 位作为短ID
 * SSR：`Date.now()` + 自增 counter
 *
 * @example generateId('node') // -> 'node-1a2b3c4d'
 */
export function generateId(prefix: string): string {
  // 浏览器环境优先用 crypto.randomUUID（CSPRNG）
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    // crypto.randomUUID() 返回 36 位 UUID，取前 8 位作为短 ID（碰撞概率极低）
    const short = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    return `${prefix}-${short}`;
  }
  // SSR / 旧环境回退：时间戳 + 自增 counter（保证同进程内唯一）
  ssrCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${ssrCounter.toString(36)}`;
}

// SSR 回退方案的进程内自增计数器
let ssrCounter = 0;

/**
 * 从数组中随机选取一个元素。
 * 非安全场景的随机选择（如营销文案随机展示），可用 Math.random。
 * 若需要 CSPRNG 级别，可用 crypto.getRandomValues，但本场景无需。
 */
export function pickRandom<T>(arr: readonly T[]): T {
  if (arr.length === 0) throw new Error('pickRandom: empty array');
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * 生成指定长度的随机后缀串（base36，CSPRNG 安全）。
 * 用于需要自定义 ID 格式的场景（如带 index 的派生节点 ID）。
 *
 * @example `${prefix}-${Date.now()}-${index}-${randomSuffix(8)}`
 */
export function randomSuffix(len = 8): string {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    // 用 CSPRNG 生成足够长的随机字节，再转 base36 截取
    const bytes = crypto.getRandomValues(new Uint8Array(len * 2));
    let str = '';
    for (let i = 0; i < bytes.length; i++) {
      str += bytes[i].toString(36).padStart(2, '0');
    }
    return str.slice(0, len);
  }
  // SSR 回退
  ssrCounter += 1;
  return (ssrCounter.toString(36) + Date.now().toString(36)).slice(0, len);
}
