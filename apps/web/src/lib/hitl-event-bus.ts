// ============================================================
// AI Debug — P2-3 HITL 人工决策事件总线（精简版）
//
// 用于合并冲突等需要用户决策时挂起处理流程，UI 决策后唤醒。
// 设计为进程内单例（基于 Map 的内存级事件总线）：
//   - subscribe(runId, eventName, handler) 注册等待者
//   - emit(runId, eventName, payload)      触发等待者并解除注册
//   - 超时定时器自动管理（onTimeout 触发后清理订阅）
//
// 与 Zustand store 的常规更新流隔离：仅做"挂起 / 唤醒"协调，
// 不直接修改 store，由调用方在 handler 中决定后续副作用。
// ============================================================

/** 等待者处理器：被 emit 调用时接收 payload */
export type HitlEventHandler = (payload: unknown) => void;

/** 超时处理器：等待超时触发 */
export type HitlTimeoutHandler = () => void;

/**
 * HITL 决策会话 ID 常量（runId）。
 * 引入常量避免各调用方硬编码字符串字面量，降低拼写错误风险。
 * 后续新增决策类型时在此追加。
 */
export const HitlRunId = {
  /** 冲突决策会话：eventName 形如 `conflict:${nodeId}` */
  CONFLICT_RESOLUTION: 'conflict-resolution',
} as const;

/**
 * HITL 事件名生成器常量（eventName 模板）。
 * 动态事件名（含 nodeId 等）通过函数生成，保证格式统一。
 * 后续新增决策类型时在此追加。
 */
export const HitlEventName = {
  /** 冲突决策事件：参数为冲突节点 id */
  conflict: (conflictId: string): string => `conflict:${conflictId}`,
} as const;

interface WaitingEntry {
  runId: string;
  eventName: string;
  handler: HitlEventHandler;
  timeoutTimer?: ReturnType<typeof setTimeout>;
  onTimeout?: HitlTimeoutHandler;
}

/** listWaitings 返回的只读快照条目 */
export interface WaitingSnapshot {
  runId: string;
  eventName: string;
  hasTimeout: boolean;
}

/** 复合 key：`runId::eventName`，保证同 runId 多事件不冲突 */
function makeKey(runId: string, eventName: string): string {
  return `${runId}::${eventName}`;
}

class HitlEventBus {
  /** 等待者注册表：key → WaitingEntry */
  private waitings = new Map<string, WaitingEntry>();

  /**
   * 订阅指定 runId + eventName 的等待。
   * 同一 (runId, eventName) 仅保留最后一个订阅（覆盖语义），
   * 用于决策流程重新触发时刷新等待上下文。
   *
   * @param runId       决策会话 ID（建议使用 HitlRunId 常量）
   * @param eventName   等待的事件名（建议使用 HitlEventName 生成器）
   * @param handler     emit 触发时调用
   * @param onTimeout   超时回调（可选）
   * @param timeoutMs   超时毫秒数（可选，<=0 表示永不超时）
   * @returns 取消订阅函数（用于 cleanup）
   */
  subscribe(
    runId: string,
    eventName: string,
    handler: HitlEventHandler,
    onTimeout?: HitlTimeoutHandler,
    timeoutMs?: number,
  ): () => void {
    const key = makeKey(runId, eventName);
    // 已有同 key 订阅：先清理旧定时器再覆盖
    this.clearEntry(key);

    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    if (typeof timeoutMs === 'number' && timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        // 超时触发：从注册表中移除并调用 onTimeout
        if (this.waitings.has(key)) {
          this.waitings.delete(key);
          onTimeout?.();
        }
      }, timeoutMs);
    }

    this.waitings.set(key, { runId, eventName, handler, timeoutTimer, onTimeout });

    // 返回取消订阅函数
    return () => {
      // 仅当 entry 仍存在且 timer 未被 emit / 超时清理时才清理
      if (this.waitings.has(key)) {
        this.clearEntry(key);
        this.waitings.delete(key);
      }
    };
  }

  /**
   * 触发指定 runId + eventName 的等待者，传递 payload。
   * 触发后自动解除订阅（一次性语义）。
   * @returns true 表示命中等待者并触发；false 表示无匹配订阅
   */
  emit(runId: string, eventName: string, payload?: unknown): boolean {
    const key = makeKey(runId, eventName);
    const entry = this.waitings.get(key);
    if (!entry) return false;

    // 清理定时器后调用 handler，避免 handler 内部再次触发超时分支
    if (entry.timeoutTimer) {
      clearTimeout(entry.timeoutTimer);
      entry.timeoutTimer = undefined;
    }
    this.waitings.delete(key);
    try {
      entry.handler(payload);
    } catch (err) {
      // handler 内部异常不应阻塞 emit 调用方，仅打印警告
      console.warn('[hitl-event-bus] handler 抛出异常', err);
    }
    return true;
  }

  /**
   * 查询某 runId 是否仍在等待指定 eventName
   */
  isWaiting(runId: string, eventName: string): boolean {
    return this.waitings.has(makeKey(runId, eventName));
  }

  /**
   * 列出当前所有等待中的订阅快照（开发模式 debug 用，不暴露 handler 引用）。
   * 返回新数组，调用方修改不影响内部注册表。
   */
  listWaitings(): WaitingSnapshot[] {
    return Array.from(this.waitings.values()).map((e) => ({
      runId: e.runId,
      eventName: e.eventName,
      hasTimeout: !!e.timeoutTimer,
    }));
  }

  /**
   * 清理指定 runId 下所有等待订阅（例如会话被取消时）
   */
  clearRun(runId: string): void {
    for (const [key, entry] of this.waitings.entries()) {
      if (entry.runId === runId) {
        this.clearEntry(key);
        this.waitings.delete(key);
      }
    }
  }

  /** 清理全部订阅（HMR / 测试用） */
  clearAll(): void {
    for (const [key] of this.waitings.entries()) {
      this.clearEntry(key);
    }
    this.waitings.clear();
  }

  /** 内部：清理单条 entry 的定时器（不删除 Map 条目） */
  private clearEntry(key: string): void {
    const entry = this.waitings.get(key);
    if (entry?.timeoutTimer) {
      clearTimeout(entry.timeoutTimer);
      entry.timeoutTimer = undefined;
    }
  }
}

// ============================================================
// 单例导出：全应用共享同一个事件总线实例
// ============================================================
export const hitlEventBus = new HitlEventBus();

// ============================================================
// 开发模式 debug 暴露：window.__hitlDebug
// 仅在浏览器 + 非生产环境注册，便于排查"卡住的等待者"
// ============================================================
declare global {
  interface Window {
    __hitlDebug?: {
      listWaitings: () => WaitingSnapshot[];
      isWaiting: (runId: string, eventName: string) => boolean;
      clearAll: () => void;
    };
  }
}

if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  window.__hitlDebug = {
    listWaitings: () => hitlEventBus.listWaitings(),
    isWaiting: (runId: string, eventName: string) => hitlEventBus.isWaiting(runId, eventName),
    clearAll: () => hitlEventBus.clearAll(),
  };
}

export default hitlEventBus;
