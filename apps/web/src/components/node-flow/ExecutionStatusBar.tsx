// ============================================================
// AI Debug — 全局执行状态条
// 订阅 Zustand 中的 running 节点，纯前端友好进度展示
// 不引入独立 pub/sub store，全部走 debug-store selector
// ============================================================
'use client';

import { useEffect, useRef, useState } from 'react';
import { Sparkles, CheckCircle2, XCircle } from 'lucide-react';
import { useDebugStore } from '@/lib/debug-store';
import { useTranslation } from '@/components/I18nProvider';
import { pickStatusMessage } from './marketing-messages';
import { truncateStreamingText } from './nodes/node-utils';

/** 完成态自动隐藏延迟 */
const AUTO_HIDE_DELAY = 3000;

export default function ExecutionStatusBar() {
  const { language, t } = useTranslation();
  // 找到当前正在运行的节点（同时拿到其 id 与流式文本）
  const runningNode = useDebugStore(
    (s) => s.nodes.find((n) => n.data.status === 'running') ?? null,
  );

  const [visible, setVisible] = useState(false);
  const [endState, setEndState] = useState<'success' | 'error' | null>(null);
  const [endLabel, setEndLabel] = useState('');
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamingRef = useRef<HTMLDivElement>(null);
  // 记录上一次处于 running 的节点 id，用于在其结束时查询最终状态
  const prevRunningIdRef = useRef<string | null>(null);

  // 流式文本自动滚到底部
  useEffect(() => {
    if (streamingRef.current) {
      streamingRef.current.scrollTop = streamingRef.current.scrollHeight;
    }
  }, [runningNode?.data.assistantMessage]);

  // 监听 running 节点的出现/消失，结束时延迟自动隐藏
  useEffect(() => {
    if (runningNode) {
      setVisible(true);
      setEndState(null);
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
      prevRunningIdRef.current = runningNode.id;
    } else {
      const prevId = prevRunningIdRef.current;
      if (prevId) {
        // running 消失：查询该节点最终状态决定结束态配色
        const prevNode = useDebugStore.getState().nodes.find((n) => n.id === prevId);
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
        prevRunningIdRef.current = null;
      }
    }
    return () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
    };
  }, [runningNode, language, t.statusFailed]);

  // 无内容时不渲染
  if (!visible && !runningNode && !endState) {
    return null;
  }

  const isRunning = !!runningNode;
  const streamingText = runningNode?.data.assistantMessage ?? '';
  const hasStreaming = isRunning && !!streamingText;

  // 配色：运行中(蓝) / 失败(红) / 完成(绿)
  const containerCls = isRunning
    ? 'bg-white/95 border-blue-200 text-slate-700 dark:bg-slate-800/95 dark:border-blue-800 dark:text-slate-200'
    : endState === 'error'
    ? 'bg-red-50/95 border-red-200 text-red-700 dark:bg-red-900/40 dark:border-red-700 dark:text-red-300'
    : 'bg-emerald-50/95 border-emerald-200 text-emerald-700 dark:bg-emerald-900/40 dark:border-emerald-700 dark:text-emerald-300';

  const label = isRunning ? pickStatusMessage('running', language) : endLabel;

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
        {/* 顶部：图标 + 文案 */}
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
          <span className="text-sm font-medium truncate">{label}</span>
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
