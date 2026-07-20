'use client';

import { useState, useEffect } from 'react';
import { useTranslation } from '@/components/I18nProvider';

/** P2-1：节点级 LLM 配置覆盖值（未设置的字段使用全局默认值） */
export interface LLMOverrideValues {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

interface ParamRendererProps {
  /** 当前覆盖值 */
  values: LLMOverrideValues;
  /** 值变更回调，参数为下一份完整覆盖值 */
  onChange: (next: LLMOverrideValues) => void;
  /** 是否禁用编辑（流式请求中等场景） */
  disabled?: boolean;
}

/**
 * P2-1 精简版 ParamRenderer：渲染节点级 LLM 配置覆盖字段。
 * 参考 spark-flow ParamRenderer 的折叠分组思想，但因 ai-debug 节点类型极简，
 * 不引入完整 Schema 系统，仅渲染 model / temperature / maxTokens 三个字段。
 * 字段留空表示使用全局默认值。
 */
export default function ParamRenderer({ values, onChange, disabled }: ParamRendererProps) {
  const { t } = useTranslation();
  // 本地字符串状态：解决受控 number input 无法输入 "0." 等中间态的问题
  const [tempStr, setTempStr] = useState(values.temperature?.toString() ?? '');
  const [maxTokensStr, setMaxTokensStr] = useState(values.maxTokens?.toString() ?? '');

  // 外部值变化时同步本地字符串（如切换节点、重置等场景）
  useEffect(() => {
    setTempStr(values.temperature?.toString() ?? '');
  }, [values.temperature]);
  useEffect(() => {
    setMaxTokensStr(values.maxTokens?.toString() ?? '');
  }, [values.maxTokens]);

  const inputCls =
    'flex-1 w-full px-2 py-1 text-xs border border-slate-200 dark:border-slate-600 rounded bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 focus:outline-none focus:border-blue-400 disabled:opacity-50 disabled:cursor-not-allowed';

  /** model 输入：trim 后空字符串转为 undefined（使用全局默认） */
  const handleModelChange = (v: string) => {
    const trimmed = v.trim();
    onChange({ ...values, model: trimmed === '' ? undefined : trimmed });
  };

  /** temperature 输入：本地字符串立即更新；空/NaN 转为 undefined，否则 clamp 到 [0, 2] */
  const handleTemperatureChange = (v: string) => {
    setTempStr(v);
    if (v.trim() === '') {
      onChange({ ...values, temperature: undefined });
      return;
    }
    const num = Number(v);
    if (Number.isNaN(num)) return; // 非法中间态不通知父级
    onChange({ ...values, temperature: Math.min(2, Math.max(0, num)) });
  };

  /** maxTokens 输入：本地字符串立即更新；空/NaN 转为 undefined，否则 clamp 到 [1, 32768] */
  const handleMaxTokensChange = (v: string) => {
    setMaxTokensStr(v);
    if (v.trim() === '') {
      onChange({ ...values, maxTokens: undefined });
      return;
    }
    const num = Number(v);
    if (Number.isNaN(num)) return;
    onChange({ ...values, maxTokens: Math.min(32768, Math.max(1, Math.floor(num))) });
  };

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-slate-400 dark:text-slate-500 italic">
        {t.inspectorAdvancedParamsHint}
      </p>

      {/* 模型覆盖 */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
          {t.inspectorModelOverride}
        </label>
        <input
          type="text"
          value={values.model ?? ''}
          placeholder={t.inspectorModelOverridePlaceholder}
          disabled={disabled}
          onChange={(e) => handleModelChange(e.target.value)}
          className={inputCls}
        />
      </div>

      {/* 温度 */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
          {t.inspectorTemperature}
        </label>
        <input
          type="number"
          step={0.1}
          min={0}
          max={2}
          value={tempStr}
          placeholder={t.inspectorModelOverridePlaceholder}
          disabled={disabled}
          onChange={(e) => handleTemperatureChange(e.target.value)}
          className={inputCls}
        />
      </div>

      {/* 最大 Token 数 */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
          {t.inspectorMaxTokens}
        </label>
        <input
          type="number"
          min={1}
          max={32768}
          value={maxTokensStr}
          placeholder={t.inspectorModelOverridePlaceholder}
          disabled={disabled}
          onChange={(e) => handleMaxTokensChange(e.target.value)}
          className={inputCls}
        />
      </div>
    </div>
  );
}
