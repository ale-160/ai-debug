// ============================================================
// AI Debug — 全局执行状态条
// 订阅 Zustand 中的 running 节点，纯前端友好进度展示
// 不引入独立 pub/sub store，全部走 debug-store selector
// ============================================================
'use client';

import { useEffect, useRef, useState } from 'react';
import { Sparkles, CheckCircle2, XCircle, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useDebugStore } from '@/lib/debug-store';
import { useTranslation } from '@/components/I18nProvider';
import { pickStatusMessage } from './marketing-messages';
import { truncateStreamingText } from './nodes/node-utils';

/** 完成态自动隐藏延迟 */
const AUTO_HIDE_DELAY = 3000;

export default function ExecutionStatusBar() {
  const { language, t } = useTranslation();
  // 扩展为 runningNodes 数组 selector（支持多 running 轮播）
  // useShallow：避免 .filter() 每次返回新数组引用触发 useSyncExternalStore 无限循环
  const runningNodes = useDebugStore(
    useShallow((s) => s.nodes.filter((n) => n.data.status === 'running')),
  );
  const abortRunningTurn = useDebugStore((s) => s.abortRunningTurn);

  // 当前轮播索引（0-based），超过 runningNodes.length 时自动钳制
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [visible, setVisible] = useState(false);
  const [endState, setEndState] = useState<'success' | 'error' | null>(null);
  const [endLabel, setEndLabel] = useState('');
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamingRef = useRef<HTMLDivElement>(null);
  // 5.4.4：rAF 节流滚动句柄，合并连续 assistantMessage 变化触发的一次滚动
  const scrollRafRef = useRef<number | null>(null);
  // 记录上一次处于 running 的节点 id 列表，用于在其结束时查询最终状态
  const prevRunningIdsRef = useRef<string[]>([]);

  // 钳制轮播索引：runningNodes 数量变化时确保索引合法
  useEffect(() => {
    if (carouselIndex >= runningNodes.length) {
      setCarouselIndex(0);
    }
  }, [runningNodes.length, carouselIndex]);

  // 当前轮播焦点节点
  const currentRunning = runningNodes[carouselIndex] ?? runningNodes[0] ?? null;

  // 5.4.4：流式文本自动滚到底部，用 rAF 节流避免每个 chunk 都触发 layout thrashing
  useEffect(() => {
    if (scrollRafRef.current !== null) {
      cancelAnimationFrame(scrollRafRef.current);
    }
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      if (streamingRef.current) {
        streamingRef.current.scrollTop = streamingRef.current.scrollHeight;
      }
    });
    return () => {
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, [currentRunning?.data.assistantMessage]);

  // 监听 running 节点的出现/消失，结束时延迟自动隐藏
  useEffect(() => {
    if (runningNodes.length > 0) {
      setVisible(true);
      setEndState(null);
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
      prevRunningIdsRef.current = runningNodes.map((n) => n.id);
    } else {
      const prevIds = prevRunningIdsRef.current;
      if (prevIds.length > 0) {
        // running 全部消失：查询最后一个节点最终状态决定结束态配色
        const lastId = prevIds[prevIds.length - 1];
        const prevNode = useDebugStore.getState().nodes.find((n) => n.id === lastId);
        const st = prevNode?.data.status;
        if (st === 'success' || st === 'error') {
          setEndState(st);
          setEndLabel(st === 'success' ? pickStatusMessage('complete', language) : t.statusFailed);
          setVisible(true);
          if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
          hideTimerRef.current = setTimeout(() => {
            setVisible(false);
          }, AUTO_HIDE_DELAY);
        } else {
          setVisible(false);
        }
        prevRunningIdsRef.current = [];
      }
    }
    return () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
    };
  }, [runningNodes, language, t.statusFailed]);

  // 无内容时不渲染
  if (!visible && runningNodes.length === 0 && !endState) {
    return null;
  }

  const isRunning = runningNodes.length > 0;
  const streamingText = currentRunning?.data.assistantMessage ?? '';
  const hasStreaming = isRunning && !!streamingText;
  const runningCount = runningNodes.length;
  const hasMultipleRunning = runningCount > 1;

  // 配色：运行中(蓝) / 失败(红) / 完成(绿)
  const containerCls = isRunning
    ? 'bg-white/95 border-blue-200 text-slate-700 dark:bg-slate-800/95 dark:border-blue-800 dark:text-slate-200'
    : endState === 'error'
      ? 'bg-red-50/95 border-red-200 text-red-700 dark:bg-red-900/40 dark:border-red-700 dark:text-red-300'
      : 'bg-emerald-50/95 border-emerald-200 text-emerald-700 dark:bg-emerald-900/40 dark:border-emerald-700 dark:text-emerald-300';

  // 标签：多 running 时显示计数，单 running 显示友好文案
  const label = isRunning
    ? hasMultipleRunning
      ? tf(t.nodesRunning, { count: runningCount })
      : pickStatusMessage('running', language)
    : endLabel;

  // 处理取消
  const handleAbort = () => {
    if (currentRunning) {
      abortRunningTurn(currentRunning.id);
    }
  };

  // 轮播切换
  const handlePrev = () => {
    setCarouselIndex((i) => (i - 1 + runningCount) % runningCount);
  };
  const handleNext = () => {
    setCarouselIndex((i) => (i + 1) % runningCount);
  };

  return (
    <div
      className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-40 transition-all duration-300 ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'
      }`}
      style={{ maxWidth: '90vw' }}
      role="status"
      aria-live="polite"
    >
      <div
        className={`flex flex-col gap-2 px-5 py-3 rounded-2xl shadow-lg backdrop-blur-md border transition-all duration-300 min-w-[300px] ${containerCls}`}
      >
        {/* 顶部：图标 + 文案 + 轮播 + 取消按钮 */}
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0">
            {isRunning ? (
              <div className="relative w-5 h-5">
                <Sparkles className="w-5 h-5 text-blue-500 animate-pulse" />
                <div className="absolute inset-0 w-5 h-5 rounded-full bg-blue-400/30 animate-ping" />
              </div>
            ) : endState === 'error' ? (
              <XCircle className="w-5 h-5 text-red-500" />
            ) : (
              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            )}
          </div>
          <span className="text-sm font-medium truncate flex-1">{label}</span>

          {/* 多 running 轮播切换器 */}
          {hasMultipleRunning && (
            <div className="flex items-center gap-1 text-xs">
              <button
                onClick={handlePrev}
                className="p-1 rounded hover:bg-slate-200/60 dark:hover:bg-slate-700/60 transition-colors"
                aria-label={t.previousNode}
                disabled={!isRunning}
              >
                <ChevronLeft size={14} />
              </button>
              <span className="font-mono tabular-nums">
                {carouselIndex + 1}/{runningCount}
              </span>
              <button
                onClick={handleNext}
                className="p-1 rounded hover:bg-slate-200/60 dark:hover:bg-slate-700/60 transition-colors"
                aria-label={t.nextNode}
                disabled={!isRunning}
              >
                <ChevronRight size={14} />
              </button>
            </div>
          )}

          {/* 取消按钮：仅 running 态显示 */}
          {isRunning && (
            <button
              onClick={handleAbort}
              className="flex-shrink-0 p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/40 text-slate-400 hover:text-red-500 transition-colors"
              aria-label={t.cancelRunning}
              title={t.cancelRunning}
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* 流式内容展示区（截断 + 自动滚动） */}
        {hasStreaming && (
          <div
            ref={streamingRef}
            className="max-h-[120px] overflow-y-auto text-xs leading-relaxed font-mono bg-blue-50/60 rounded-lg px-3 py-2 border border-blue-100 text-blue-700 whitespace-pre-wrap break-words dark:bg-blue-900/30 dark:border-blue-800 dark:text-blue-300"
          >
            {truncateStreamingText(streamingText)}
            <span className="inline-block w-1.5 h-4 bg-blue-500 animate-pulse ml-0.5 align-text-bottom" />
          </div>
        )}
      </div>
    </div>
  );
}

/** 简易模板替换：{count} → vars.count */
function tf(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? `{${key}}`));
}
