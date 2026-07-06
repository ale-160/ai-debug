'use client';
import React, { memo, useMemo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { Loader2, GitMerge, AlertTriangle, Zap } from 'lucide-react';
import type { TurnNodeData } from '../types';
import { statusColors, truncateStreamingText } from './node-utils';
import { pickStatusMessage } from '../marketing-messages';
import { useDebugStore } from '@/lib/debug-store';
import { useTranslation } from '@/components/I18nProvider';

// 截取字符串前 n 个字符，超出加省略号
function truncate(text: string, n: number): string {
  return text.length > n ? text.slice(0, n) + '…' : text;
}

type TurnNodeProps = NodeProps<TurnNodeData>;

function TurnNodeComponent({ data, selected }: TurnNodeProps) {
  const { t, tf, language } = useTranslation();
  const {
    parentId,
    userMessage,
    assistantMessage,
    suggestions,
    status,
    errorMessage,
    summary,
    mergedFromIds,
    conflictNote,
    pathSummary,
    evolutionMeta,
  } = data;
  const nodeDisplayMode = useDebugStore((s) => s.nodeDisplayMode);
  const isCompact = nodeDisplayMode === 'compact';
  // hover 显示路径摘要开关（默认关闭，用户主动开启后才显示）
  const hoverShowPathSummary = useDebugStore((s) => s.appSettings.hoverShowPathSummary);
  // 仅在开启开关且 pathSummary 非空时显示 hover 卡片
  const showHoverSummary =
    hoverShowPathSummary &&
    typeof pathSummary === 'string' &&
    pathSummary.trim().length > 0;

  const isAbandoned = status === 'abandoned';
  const isIgnored = status === 'ignored';
  // running 且已有流式文本：在卡片内联展开流式预览
  const isStreaming = status === 'running' && !!assistantMessage;
  // 流式预览：保留尾部 2000 字，避免长对话渲染卡顿
  const streamingPreview = isStreaming ? truncateStreamingText(assistantMessage) : '';
  // 友好文案：running 时随机选取一条，按 status+lang 记忆化避免每次渲染都换文案
  const runningLabel = useMemo(
    () => (status === 'running' ? pickStatusMessage('running', language) : ''),
    [status, language],
  );
  // 合并节点：mergedFromIds 非空，作为新支线根，无 parentId
  const isMerged = Array.isArray(mergedFromIds) && mergedFromIds.length > 0;
  const hasConflict = !!conflictNote;
  // 自动推演产生节点：evolutionMeta 非空，左上角显示 ⚡ 图标 + hover tooltip
  const isEvolution = !!evolutionMeta;
  const evolutionTooltip = isEvolution
    ? tf('autoEvolutionNodeTooltip', {
        step: evolutionMeta.step,
        confidence: evolutionMeta.confidence.toFixed(2),
      })
    : '';

  // 渲染状态指示器（圆点 / 旋转图标）：配色统一取自 statusColors，与 MiniMap 一致
  const renderStatusIndicator = (
    status: TurnNodeData['status'],
    errorMessage?: string,
  ): React.ReactNode => {
    const colors = statusColors[status];
    switch (status) {
      case 'running':
        return <Loader2 size={12} className={`animate-spin ${colors.text}`} />;
      case 'error':
        return (
          <span
            className={`w-2 h-2 rounded-full ${colors.dot}`}
            title={errorMessage}
          />
        );
      case 'ignored':
        return (
          <span
            className={`w-2 h-2 rounded-full ${colors.dot}`}
            title={t.ignored}
          />
        );
      case 'success':
      case 'idle':
      case 'abandoned':
      default:
        return <span className={`w-2 h-2 rounded-full ${colors.dot}`} />;
    }
  };

  return (
    <div
      className={`group relative rounded-lg bg-white dark:bg-slate-800 shadow-sm transition-all duration-200 p-3 ${
        isCompact ? 'w-[180px]' : 'w-[240px]'
      } ${
        // 合并节点：双色边框（violet 加粗）；普通节点：灰色细边框
        isMerged ? 'border-2 border-violet-400 dark:border-violet-500' : 'border border-slate-200 dark:border-slate-600'
      } ${selected ? 'ring-2 ring-blue-400 ring-offset-1' : ''} ${isAbandoned ? 'opacity-50' : ''} ${isIgnored ? 'border-amber-300 dark:border-amber-500 border-dashed opacity-70' : ''} ${
        hasConflict ? 'border-red-400 dark:border-red-500' : ''
      } ${isEvolution && !isMerged && !hasConflict ? 'border-violet-300 dark:border-violet-600' : ''}`}
    >
      {/* 左侧输入端口：仅非根节点显示（合并节点 parentId 为 null，不显示） */}
      {parentId !== null && (
        <Handle
          type="target"
          position={Position.Left}
          className="!w-3 !h-3 !bg-slate-400 !border-2 !border-white hover:opacity-80"
          style={{ top: '50%', transform: 'translate(-50%, -50%)' }}
        />
      )}

      {/* 右侧输出端口 */}
      <Handle
        type="source"
        position={Position.Right}
        className="!w-3 !h-3 !bg-slate-400 !border-2 !border-white hover:opacity-80"
        style={{ top: '50%', transform: 'translate(50%, -50%)' }}
      />

      {/* 顶部：状态指示器 + 类型标签（合并节点显示 GitMerge 图标） */}
      <div className="flex items-center gap-1.5 mb-2">
        {/* 自动推演产生节点：左上角 ⚡ 图标 + hover tooltip，带脉冲动画提示 */}
        {isEvolution && (
          <span
            className="inline-flex items-center justify-center w-5 h-5 rounded bg-gradient-to-br from-violet-500 to-amber-500 text-white shadow-sm shadow-violet-500/30"
            title={evolutionTooltip}
            aria-label={evolutionTooltip}
          >
            <Zap size={11} />
          </span>
        )}
        {renderStatusIndicator(status, errorMessage)}
        {isMerged && <GitMerge size={12} className="text-violet-500" />}
        <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
          {isMerged ? t.merge : t.conversation}
        </span>
        {isIgnored && (
          <span className="text-[11px] font-medium text-amber-500 ml-auto">
            {t.ignored}
          </span>
        )}
        {isMerged && mergedFromIds && (
          <span className="text-[11px] text-violet-400 ml-auto">
            {tf('nRoutes', { count: mergedFromIds.length })}
          </span>
        )}
      </div>

      {/* 摘要标题（commit message）：紧凑模式下作为主体显示，无摘要时回退到用户消息 */}
      {summary ? (
        <div className="text-sm font-semibold text-slate-800 dark:text-slate-100 mb-1 truncate">
          {summary}
        </div>
      ) : isCompact && (
        <div className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-1 truncate">
          {truncate(userMessage, 20)}
        </div>
      )}

      {/* 详细模式：用户消息 + AI 回答摘要 */}
      {!isCompact && (
        <>
          {/* 用户消息摘要 */}
          <div
            className={`text-sm text-sky-600 dark:text-sky-400 mb-1 ${
              isAbandoned || isIgnored ? 'line-through' : ''
            }`}
          >
            {t.you}：{truncate(userMessage, 30)}
          </div>

          {/* AI 回答摘要 / 思考中 / 流式生成中 */}
          <div
            className={`text-sm text-slate-500 dark:text-slate-400 ${
              isAbandoned || isIgnored ? 'line-through' : ''
            }`}
          >
            {status === 'running' ? (
              <span className="flex items-center gap-1 text-blue-500 dark:text-blue-400">
                <Loader2 size={12} className="animate-spin" />
                {runningLabel}
              </span>
            ) : (
              <>{t.ai}：{truncate(assistantMessage, 50)}</>
            )}
          </div>
        </>
      )}

      {/* 流式预览：running 且有流式文本时展开，截断尾部 2000 字 + 闪烁光标 ▊ */}
      {isStreaming && (
        <div className="mt-1 text-xs leading-relaxed font-mono text-blue-600 dark:text-blue-300 bg-blue-50/60 dark:bg-blue-900/30 rounded px-1.5 py-1 max-h-[100px] overflow-hidden whitespace-pre-wrap break-words">
          {streamingPreview}
          <span className="inline-block w-1.5 h-3 bg-blue-500 animate-pulse ml-0.5 align-text-bottom" aria-hidden="true" />
        </div>
      )}

      {/* 建议方向徽章 */}
      {suggestions && suggestions.length > 0 && (
        <div className="mt-2">
          <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-medium bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300">
            {tf('nDirections', { count: suggestions.length })}
          </span>
        </div>
      )}

      {/* 冲突标注：红色徽章 + 提示文案（hover 显示完整 note） */}
      {hasConflict && (
        <div className="mt-2">
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300"
            title={conflictNote}
          >
            <AlertTriangle size={10} />
            {t.conflict}
          </span>
        </div>
      )}

      {/* 路径摘要 hover 卡片：仅在开启 hoverShowPathSummary 且存在 pathSummary 时显示。
          绝对定位在节点右下方，避免遮挡节点本体；z-50 确保浮于其他节点之上。
          pointer-events-none 防止 hover 卡片自身捕获鼠标导致闪烁。 */}
      {showHoverSummary && (
        <div
          className="hidden group-hover:block absolute top-full left-0 mt-1 z-50 w-[320px] max-w-[320px] pointer-events-none rounded-lg border border-violet-200 dark:border-violet-700 bg-white dark:bg-slate-800 shadow-xl p-2.5 text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words max-h-[240px] overflow-y-auto"
          role="tooltip"
        >
          <div className="text-[10px] font-semibold text-violet-500 dark:text-violet-400 uppercase tracking-wide mb-1">
            {t.pathSummaryTitle}
          </div>
          <div className="text-[10px] text-slate-400 dark:text-slate-500 mb-1.5">
            {t.pathSummaryDesc}
          </div>
          {pathSummary}
        </div>
      )}
    </div>
  );
}

const TurnNode = memo(TurnNodeComponent);
export default TurnNode;
