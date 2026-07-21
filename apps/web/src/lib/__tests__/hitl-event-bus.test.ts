// ============================================================
// AI Debug — hitl-event-bus 单元测试
//
// 任务来源：H-17 测试覆盖（HITL 人工决策事件总线）
//
// 覆盖：
//   1. subscribe / emit：基本订阅与触发
//   2. 一次性语义：emit 后自动解除订阅
//   3. 覆盖语义：同 key 多次订阅仅保留最后一个
//   4. isWaiting：查询等待状态
//   5. clearRun / clearAll：批量清理
//   6. 超时定时器：onTimeout 触发后清理订阅
//   7. handler 异常隔离：不阻塞 emit 调用方
//   8. 取消订阅函数：手动取消
// ============================================================
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { hitlEventBus } from '../hitl-event-bus';

beforeEach(() => {
  hitlEventBus.clearAll();
});

afterEach(() => {
  hitlEventBus.clearAll();
});

// ----------------------------------------------------------------------
// subscribe / emit
// ----------------------------------------------------------------------
describe('hitl-event-bus - subscribe / emit', () => {
  it('订阅后 emit 触发 handler 接收 payload', () => {
    const handler = vi.fn();
    hitlEventBus.subscribe('run-1', 'event-1', handler);
    const hit = hitlEventBus.emit('run-1', 'event-1', { decision: 'yes' });
    expect(hit).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ decision: 'yes' });
  });

  it('无 payload 时 handler 接收 undefined', () => {
    const handler = vi.fn();
    hitlEventBus.subscribe('run-1', 'event-1', handler);
    hitlEventBus.emit('run-1', 'event-1');
    expect(handler).toHaveBeenCalledWith(undefined);
  });

  it('未订阅时 emit 返回 false', () => {
    expect(hitlEventBus.emit('no-such-run', 'no-such-event')).toBe(false);
  });

  it('eventName 不同互不影响', () => {
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    hitlEventBus.subscribe('run-1', 'event-A', handlerA);
    hitlEventBus.subscribe('run-1', 'event-B', handlerB);
    hitlEventBus.emit('run-1', 'event-A');
    expect(handlerA).toHaveBeenCalledTimes(1);
    expect(handlerB).not.toHaveBeenCalled();
  });

  it('runId 不同互不影响', () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    hitlEventBus.subscribe('run-1', 'event', handler1);
    hitlEventBus.subscribe('run-2', 'event', handler2);
    hitlEventBus.emit('run-1', 'event');
    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).not.toHaveBeenCalled();
  });
});

// ----------------------------------------------------------------------
// 一次性语义
// ----------------------------------------------------------------------
describe('hitl-event-bus - 一次性语义', () => {
  it('emit 后自动解除订阅，第二次 emit 不再触发', () => {
    const handler = vi.fn();
    hitlEventBus.subscribe('run-1', 'event', handler);
    hitlEventBus.emit('run-1', 'event', 'first');
    hitlEventBus.emit('run-1', 'event', 'second');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith('first');
  });
});

// ----------------------------------------------------------------------
// 覆盖语义
// ----------------------------------------------------------------------
describe('hitl-event-bus - 覆盖语义', () => {
  it('同 (runId, eventName) 多次订阅仅保留最后一个', () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    hitlEventBus.subscribe('run-1', 'event', handler1);
    hitlEventBus.subscribe('run-1', 'event', handler2);
    hitlEventBus.emit('run-1', 'event');
    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).toHaveBeenCalledTimes(1);
  });
});

// ----------------------------------------------------------------------
// isWaiting
// ----------------------------------------------------------------------
describe('hitl-event-bus - isWaiting', () => {
  it('订阅后 isWaiting=true', () => {
    hitlEventBus.subscribe('run-1', 'event', () => {});
    expect(hitlEventBus.isWaiting('run-1', 'event')).toBe(true);
  });

  it('未订阅时 isWaiting=false', () => {
    expect(hitlEventBus.isWaiting('run-1', 'event')).toBe(false);
  });

  it('emit 后 isWaiting=false（一次性语义）', () => {
    hitlEventBus.subscribe('run-1', 'event', () => {});
    hitlEventBus.emit('run-1', 'event');
    expect(hitlEventBus.isWaiting('run-1', 'event')).toBe(false);
  });
});

// ----------------------------------------------------------------------
// 取消订阅函数
// ----------------------------------------------------------------------
describe('hitl-event-bus - 取消订阅函数', () => {
  it('subscribe 返回的函数调用后取消订阅，后续 emit 不再触发', () => {
    const handler = vi.fn();
    const unsubscribe = hitlEventBus.subscribe('run-1', 'event', handler);
    unsubscribe();
    expect(hitlEventBus.emit('run-1', 'event')).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it('emit 后再调用 unsubscribe 不抛错（幂等）', () => {
    const handler = vi.fn();
    const unsubscribe = hitlEventBus.subscribe('run-1', 'event', handler);
    hitlEventBus.emit('run-1', 'event');
    expect(() => unsubscribe()).not.toThrow();
  });
});

// ----------------------------------------------------------------------
// clearRun
// ----------------------------------------------------------------------
describe('hitl-event-bus - clearRun', () => {
  it('清理指定 runId 下所有订阅', () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    const handler3 = vi.fn();
    hitlEventBus.subscribe('run-1', 'event-A', handler1);
    hitlEventBus.subscribe('run-1', 'event-B', handler2);
    hitlEventBus.subscribe('run-2', 'event-A', handler3);

    hitlEventBus.clearRun('run-1');

    expect(hitlEventBus.emit('run-1', 'event-A')).toBe(false);
    expect(hitlEventBus.emit('run-1', 'event-B')).toBe(false);
    // run-2 仍可触发
    expect(hitlEventBus.emit('run-2', 'event-A')).toBe(true);
    expect(handler3).toHaveBeenCalledTimes(1);
  });

  it('清理不存在的 runId 静默跳过', () => {
    expect(() => hitlEventBus.clearRun('no-such-run')).not.toThrow();
  });
});

// ----------------------------------------------------------------------
// clearAll
// ----------------------------------------------------------------------
describe('hitl-event-bus - clearAll', () => {
  it('清理所有订阅', () => {
    hitlEventBus.subscribe('run-1', 'event-A', () => {});
    hitlEventBus.subscribe('run-2', 'event-B', () => {});
    hitlEventBus.clearAll();
    expect(hitlEventBus.isWaiting('run-1', 'event-A')).toBe(false);
    expect(hitlEventBus.isWaiting('run-2', 'event-B')).toBe(false);
  });
});

// ----------------------------------------------------------------------
// 超时定时器
// ----------------------------------------------------------------------
describe('hitl-event-bus - 超时定时器', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('超时后调用 onTimeout 并解除订阅', () => {
    const handler = vi.fn();
    const onTimeout = vi.fn();
    hitlEventBus.subscribe('run-1', 'event', handler, onTimeout, 1000);

    // 推进 1000ms 触发超时
    vi.advanceTimersByTime(1000);

    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(hitlEventBus.isWaiting('run-1', 'event')).toBe(false);
    // 超时后 emit 不再触发 handler
    expect(hitlEventBus.emit('run-1', 'event')).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it('timeoutMs <= 0 时不设置超时定时器', () => {
    const onTimeout = vi.fn();
    hitlEventBus.subscribe('run-1', 'event', () => {}, onTimeout, 0);
    vi.advanceTimersByTime(10000);
    expect(onTimeout).not.toHaveBeenCalled();
    expect(hitlEventBus.isWaiting('run-1', 'event')).toBe(true);
  });

  it('emit 前未超时 → emit 触发 handler，onTimeout 不被调用', () => {
    const handler = vi.fn();
    const onTimeout = vi.fn();
    hitlEventBus.subscribe('run-1', 'event', handler, onTimeout, 1000);

    // 推进 500ms（未超时）
    vi.advanceTimersByTime(500);
    expect(onTimeout).not.toHaveBeenCalled();

    // emit 触发
    hitlEventBus.emit('run-1', 'event');
    expect(handler).toHaveBeenCalledTimes(1);

    // 推进剩余时间，onTimeout 不应被调用（emit 已清理定时器）
    vi.advanceTimersByTime(1000);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('覆盖订阅时旧定时器被清理，旧 onTimeout 不被调用', () => {
    const onTimeout1 = vi.fn();
    const onTimeout2 = vi.fn();
    hitlEventBus.subscribe('run-1', 'event', () => {}, onTimeout1, 1000);
    // 覆盖订阅
    hitlEventBus.subscribe('run-1', 'event', () => {}, onTimeout2, 2000);

    vi.advanceTimersByTime(1000);
    // 旧的 1000ms 定时器应已清理，onTimeout1 不被调用
    expect(onTimeout1).not.toHaveBeenCalled();
    expect(onTimeout2).not.toHaveBeenCalled();

    // 推进到 2000ms 触发新的 onTimeout
    vi.advanceTimersByTime(1000);
    expect(onTimeout2).toHaveBeenCalledTimes(1);
  });

  it('取消订阅后定时器被清理，onTimeout 不被调用', () => {
    const onTimeout = vi.fn();
    const unsubscribe = hitlEventBus.subscribe('run-1', 'event', () => {}, onTimeout, 1000);
    unsubscribe();
    vi.advanceTimersByTime(2000);
    expect(onTimeout).not.toHaveBeenCalled();
  });
});

// ----------------------------------------------------------------------
// handler 异常隔离
// ----------------------------------------------------------------------
describe('hitl-event-bus - handler 异常隔离', () => {
  it('handler 抛出异常时 emit 仍返回 true（不阻塞调用方）', () => {
    const errorSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    hitlEventBus.subscribe('run-1', 'event', () => {
      throw new Error('handler crashed');
    });
    expect(hitlEventBus.emit('run-1', 'event')).toBe(true);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('handler 抛异常后订阅仍被解除（一次性语义保留）', () => {
    const errorSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let callCount = 0;
    hitlEventBus.subscribe('run-1', 'event', () => {
      callCount++;
      throw new Error('crash');
    });
    hitlEventBus.emit('run-1', 'event');
    hitlEventBus.emit('run-1', 'event');
    expect(callCount).toBe(1);
    errorSpy.mockRestore();
  });
});
