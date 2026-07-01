'use client';
import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { Loader2, GitMerge, AlertTriangle } from 'lucide-react';
import type { TurnNodeData } from '../types';
import { useDebugStore } from '@/lib/debug-store';

// 截取字符串前 n 个字符，超出加省略号
function truncate(text: string, n: number): string {
  return text.length > n ? text.slice(0, n) + '…' : text;
}

// 渲染状态指示器（圆点 / 旋转图标）
function renderStatusIndicator(
  status: TurnNodeData['status'],
  errorMessage?: string,
): React.ReactNode {
  switch (status) {
    case 'running':
      return <Loader2 size={12} className="text-blue-500 animate-spin" />;
    case 'success':
      return <span className="w-2 h-2 rounded-full bg-emerald-500" />;
    case 'error':
      return (
        <span
          className="w-2 h-2 rounded-full bg-red-500"
          title={errorMessage}
        />
      );
    case 'ignored':
      return <span className="w-2 h-2 rounded-full bg-amber-400" title="已忽略" />;
    case 'idle':
    case 'abandoned':
    default:
      return <span className="w-2 h-2 rounded-full bg-slate-300" />;
  }
}

type TurnNodeProps = NodeProps<TurnNodeData>;

function TurnNodeComponent({ data, selected }: TurnNodeProps) {
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
  } = data;
  const nodeDisplayMode = useDebugStore((s) => s.nodeDisplayMode);
  const isCompact = nodeDisplayMode === 'compact';

  const isAbandoned = status === 'abandoned';
  const isIgnored = status === 'ignored';
  const isThinking = status === 'running' && !assistantMessage;
  // 合并节点：mergedFromIds 非空，作为新支线根，无 parentId
  const isMerged = Array.isArray(mergedFromIds) && mergedFromIds.length > 0;
  const hasConflict = !!conflictNote;

  return (
    <div
      className={`relative rounded-lg bg-white shadow-sm transition-all duration-200 p-3 ${
        isCompact ? 'w-[180px]' : 'w-[240px]'
      } ${
        // 合并节点：双色边框（violet 加粗）；普通节点：灰色细边框
        isMerged ? 'border-2 border-violet-400' : 'border border-slate-200'
      } ${selected ? 'ring-2 ring-blue-400 ring-offset-1' : ''} ${
        isAbandoned ? 'opacity-50' : ''
      } ${isIgnored ? 'border-amber-300 border-dashed opacity-70' : ''} ${
        hasConflict ? 'border-red-400' : ''
      }`}
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
        {renderStatusIndicator(status, errorMessage)}
        {isMerged && <GitMerge size={12} className="text-violet-500" />}
        <span className="text-[11px] font-medium text-slate-400">
          {isMerged ? '合并' : '对话'}
        </span>
        {isIgnored && (
          <span className="text-[11px] font-medium text-amber-500 ml-auto">
            已忽略
          </span>
        )}
        {isMerged && mergedFromIds && (
          <span className="text-[11px] text-violet-400 ml-auto">
            {mergedFromIds.length} 路
          </span>
        )}
      </div>

      {/* 摘要标题（commit message）：紧凑模式下作为主体显示，无摘要时回退到用户消息 */}
      {summary ? (
        <div className="text-sm font-semibold text-slate-800 mb-1 truncate">
          {summary}
        </div>
      ) : isCompact && (
        <div className="text-sm font-medium text-slate-700 mb-1 truncate">
          {truncate(userMessage, 20)}
        </div>
      )}

      {/* 详细模式：用户消息 + AI 回答摘要 */}
      {!isCompact && (
        <>
          {/* 用户消息摘要 */}
          <div
            className={`text-sm text-sky-600 mb-1 ${
              isAbandoned || isIgnored ? 'line-through' : ''
            }`}
          >
            你：{truncate(userMessage, 30)}
          </div>

          {/* AI 回答摘要 / 思考中 */}
          <div
            className={`text-sm text-slate-500 ${
              isAbandoned || isIgnored ? 'line-through' : ''
            }`}
          >
            {isThinking ? (
              <span className="flex items-center gap-1">
                <Loader2 size={12} className="animate-spin" />
                思考中...
              </span>
            ) : (
              <>AI：{truncate(assistantMessage, 50)}</>
            )}
          </div>
        </>
      )}

      {/* 建议方向徽章 */}
      {suggestions && suggestions.length > 0 && (
        <div className="mt-2">
          <span className="inline-block px-2 py-0.5 rounded-full text-[11px] font-medium bg-violet-100 text-violet-700">
            {suggestions.length} 个方向
          </span>
        </div>
      )}

      {/* 冲突标注：红色徽章 + 提示文案（hover 显示完整 note） */}
      {hasConflict && (
        <div className="mt-2">
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-100 text-red-700"
            title={conflictNote}
          >
            <AlertTriangle size={10} />
            冲突
          </span>
        </div>
      )}
    </div>
  );
}

const TurnNode = memo(TurnNodeComponent);
export default TurnNode;
