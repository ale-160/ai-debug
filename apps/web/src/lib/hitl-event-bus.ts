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

interface WaitingEntry {
  runId: string;
  eventName: string;
  handler: HitlEventHandler;
  timeoutTimer?: ReturnType<typeof setTimeout>;
  onTimeout?: HitlTimeoutHandler;
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
   * @param runId       决策会话 ID（如 'conflict-resolution'）
   * @param eventName   等待的事件名（如 `conflict:${nodeId}`）
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

export default hitlEventBus;
