'use client';

import { Zap, Eraser } from 'lucide-react';
import type { Node } from 'reactflow';
import { useTranslation } from '@/components/I18nProvider';
import type { TurnNodeData } from '../types';

/** 推演元数据卡片所需字段（取自 TurnNodeData.evolutionMeta） */
type EvolutionMeta = NonNullable<TurnNodeData['evolutionMeta']>;

interface EvolutionMetaCardProps {
  /** 推演元数据（step/confidence/startNodeId/reasoning） */
  evolutionMeta: EvolutionMeta;
  /** 当前所有节点（用于查找推演起点摘要展示） */
  nodes: Node<TurnNodeData>[];
  /** 清除推演标记（转为普通节点） */
  onClear: () => void;
}

/**
 * 推演元数据卡片：在 Inspector 的"上下文"Tab 中显示当前节点的 evolutionMeta
 * （step / confidence / startNodeId / reasoning），并提供"清除推演标记"按钮。
 * 清除后节点转为普通节点（evolutionMeta 置 undefined）。
 */
export default function EvolutionMetaCard({
  evolutionMeta,
  nodes,
  onClear,
}: EvolutionMetaCardProps) {
  const { t, tf } = useTranslation();

  // 查找推演起点节点（用于显示其摘要，便于用户识别）
  const startNode = nodes.find((n) => n.id === evolutionMeta.startNodeId);
  const startNodeLabel = startNode
    ? startNode.data.summary?.trim() || startNode.data.userMessage.slice(0, 30) || '—'
    : '—';

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold text-amber-500 dark:text-amber-400 uppercase tracking-wide flex items-center gap-1.5">
          <Zap size={12} />
          {t.autoEvolutionMetaTitle}
        </h4>
        <button
          onClick={onClear}
          className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 hover:text-red-500 dark:hover:text-red-400 px-1.5 py-0.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          title={t.autoEvolutionClearMeta}
        >
          <Eraser size={11} />
          {t.autoEvolutionClearMeta}
        </button>
      </div>

      <div className="rounded-lg border border-amber-200 dark:border-amber-700/50 bg-amber-50/50 dark:bg-amber-900/10 p-2.5 space-y-1.5">
        {/* 步数 + 置信度 */}
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          <span className="text-slate-600 dark:text-slate-300">
            {tf('autoEvolutionStepLabel', { step: evolutionMeta.step })}
          </span>
          <span className="text-slate-600 dark:text-slate-300">
            {t.autoEvolutionConfidence}：
            <span className="font-mono font-semibold text-amber-600 dark:text-amber-400 ml-0.5">
              {evolutionMeta.confidence.toFixed(2)}
            </span>
          </span>
        </div>

        {/* 推演起点 */}
        <div className="text-xs">
          <span className="text-slate-500 dark:text-slate-400">{t.autoEvolutionStartNode}：</span>
          <span className="text-slate-700 dark:text-slate-200 ml-1 break-words">
            {startNodeLabel}
          </span>
        </div>

        {/* 生成理由 */}
        {evolutionMeta.reasoning && (
          <div className="text-xs">
            <div className="text-slate-500 dark:text-slate-400 mb-0.5">
              {t.autoEvolutionReasoningLabel}
            </div>
            <div className="text-slate-700 dark:text-slate-200 break-words bg-white/50 dark:bg-slate-800/40 rounded p-1.5">
              {evolutionMeta.reasoning}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
