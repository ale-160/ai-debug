'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { X, Plus, Pencil, Trash2, Download, Upload, Sparkles, Check, Power } from 'lucide-react';
import { toast } from 'sonner';
import { useDebugStore } from '@/lib/debug-store';
import { useTranslation } from '@/components/I18nProvider';
import { useDialogA11y } from '@/hooks/useDialogA11y';
import { generateId } from '@/lib/id';
import type { Skill } from './types';

/** Skill JSON 文件版本 */
const SKILL_FILE_VERSION = 1;
/** Skill 文件 type 标识 */
const SKILL_FILE_TYPE = 'ai-debug-skills';

/** 技能表单的初始值（用于新建）。
 * 表单中所有字段都为非空字符串/数组，保存时再转为可选字段。 */
interface SkillFormState {
  name: string;
  description: string;
  icon: string;
  systemPrompt: string;
  inputHint: string;
  outputHint: string;
  enabled: boolean;
  tags: string[];
}

function emptySkillForm(): SkillFormState {
  return {
    name: '',
    description: '',
    icon: '',
    systemPrompt: '',
    inputHint: '',
    outputHint: '',
    enabled: true,
    tags: [],
  };
}

/** 生成技能 ID（统一使用 @/lib/id 的 CSPRNG 方案） */
const genSkillId = () => generateId('skill');

/** 解析标签字符串为标签数组（逗号分隔，去空白去重） */
function parseTags(tagStr: string): string[] {
  return Array.from(
    new Set(
      tagStr
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    ),
  );
}

interface SkillManagerProps {
  open: boolean;
  onClose: () => void;
}

/** 技能管理面板（模态弹窗） */
export default function SkillManager({ open, onClose }: SkillManagerProps) {
  const { t, tf } = useTranslation();
  const { containerRef: dialogRef, containerProps } = useDialogA11y(open, onClose);

  // ===== store =====
  const skills = useDebugStore((s) => s.skills);
  const activeSkillId = useDebugStore((s) => s.activeSkillId);
  const addSkill = useDebugStore((s) => s.addSkill);
  const updateSkill = useDebugStore((s) => s.updateSkill);
  const deleteSkill = useDebugStore((s) => s.deleteSkill);
  const importSkills = useDebugStore((s) => s.importSkills);
  const setActiveSkillId = useDebugStore((s) => s.setActiveSkillId);

  // ===== 本地 UI 状态 =====
  // 表单显示模式：'list' 列表 / 'form' 表单（新建或编辑）
  const [formMode, setFormMode] = useState<'list' | 'form'>('list');
  // 当前编辑的技能 ID（form 模式下使用，null 表示新建）
  const [editingId, setEditingId] = useState<string | null>(null);
  // 表单字段
  const [form, setForm] = useState(emptySkillForm());
  // 表单错误（name 和 systemPrompt 必填）
  const [formError, setFormError] = useState<{ name?: boolean; systemPrompt?: boolean }>({});

  // 文件导入 input ref
  const importFileRef = useRef<HTMLInputElement>(null);

  // 打开时重置到列表模式（避免上次编辑态残留）
  useEffect(() => {
    if (open) {
      setFormMode('list');
      setEditingId(null);
      setForm(emptySkillForm());
      setFormError({});
    }
  }, [open]);

  /** 新建技能：切换到表单模式，清空表单 */
  const handleCreate = useCallback(() => {
    setEditingId(null);
    setForm(emptySkillForm());
    setFormError({});
    setFormMode('form');
  }, []);

  /** 编辑技能：加载现有数据到表单 */
  const handleEdit = useCallback((skill: Skill) => {
    setEditingId(skill.id);
    setForm({
      name: skill.name,
      description: skill.description,
      icon: skill.icon ?? '',
      systemPrompt: skill.systemPrompt,
      inputHint: skill.inputHint ?? '',
      outputHint: skill.outputHint ?? '',
      enabled: skill.enabled,
      tags: skill.tags ?? [],
    });
    setFormError({});
    setFormMode('form');
  }, []);

  /** 取消编辑：返回列表 */
  const handleCancelForm = useCallback(() => {
    setFormMode('list');
    setEditingId(null);
    setForm(emptySkillForm());
    setFormError({});
  }, []);

  /** 保存技能：校验 → 新建或更新 → 返回列表 */
  const handleSave = useCallback(() => {
    // 表单校验：name 和 systemPrompt 必填
    const errors: { name?: boolean; systemPrompt?: boolean } = {};
    if (!form.name.trim()) errors.name = true;
    if (!form.systemPrompt.trim()) errors.systemPrompt = true;
    if (Object.keys(errors).length > 0) {
      setFormError(errors);
      return;
    }

    const now = Date.now();
    if (editingId) {
      // 更新现有技能
      updateSkill(editingId, {
        name: form.name.trim(),
        description: form.description.trim(),
        icon: form.icon.trim() || undefined,
        systemPrompt: form.systemPrompt,
        inputHint: form.inputHint.trim() || undefined,
        outputHint: form.outputHint.trim() || undefined,
        enabled: form.enabled,
        tags: form.tags,
      });
    } else {
      // 新建技能
      const newSkill: Skill = {
        id: genSkillId(),
        name: form.name.trim(),
        description: form.description.trim(),
        icon: form.icon.trim() || undefined,
        systemPrompt: form.systemPrompt,
        inputHint: form.inputHint.trim() || undefined,
        outputHint: form.outputHint.trim() || undefined,
        createdAt: now,
        updatedAt: now,
        source: 'custom',
        enabled: form.enabled,
        tags: form.tags,
      };
      addSkill(newSkill);
    }
    toast.success(t.skillSaveSuccess);
    handleCancelForm();
  }, [form, editingId, updateSkill, addSkill, t, handleCancelForm]);

  /** 删除技能（带 confirm） */
  const handleDelete = useCallback(
    (skill: Skill) => {
      if (!window.confirm(tf('skillConfirmDelete', { name: skill.name }))) return;
      deleteSkill(skill.id);
    },
    [deleteSkill, tf],
  );

  /** 激活/取消激活技能 */
  const handleToggleActivate = useCallback(
    (skill: Skill) => {
      if (activeSkillId === skill.id) {
        setActiveSkillId(null);
        toast.success(t.skillDeactivated);
      } else {
        setActiveSkillId(skill.id);
        toast.success(tf('skillActivated', { name: skill.name }));
      }
    },
    [activeSkillId, setActiveSkillId, t, tf],
  );

  /** 切换启用状态 */
  const handleToggleEnabled = useCallback(
    (skill: Skill) => {
      updateSkill(skill.id, { enabled: !skill.enabled });
    },
    [updateSkill],
  );

  /** 导出单个技能为 JSON 文件 */
  const handleExport = useCallback((skill: Skill) => {
    const payload = {
      version: SKILL_FILE_VERSION,
      type: SKILL_FILE_TYPE,
      skills: [
        {
          name: skill.name,
          description: skill.description,
          icon: skill.icon,
          systemPrompt: skill.systemPrompt,
          inputHint: skill.inputHint,
          outputHint: skill.outputHint,
          tags: skill.tags,
        },
      ],
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${skill.name || 'skill'}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  /** 从 JSON 文件批量导入技能 */
  const handleImportFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result as string);
          // 兼容两种格式：{ skills: [...] } 或直接 [ ... ]
          const list = Array.isArray(parsed) ? parsed : parsed?.skills;
          if (!Array.isArray(list)) {
            toast.error(t.skillImportFailed);
            return;
          }
          const now = Date.now();
          const newSkills: Skill[] = [];
          for (const item of list) {
            if (
              !item ||
              typeof item !== 'object' ||
              typeof item.name !== 'string' ||
              typeof item.systemPrompt !== 'string'
            ) {
              continue;
            }
            newSkills.push({
              id: genSkillId(),
              name: item.name,
              description: typeof item.description === 'string' ? item.description : '',
              icon: typeof item.icon === 'string' ? item.icon : undefined,
              systemPrompt: item.systemPrompt,
              inputHint: typeof item.inputHint === 'string' ? item.inputHint : undefined,
              outputHint: typeof item.outputHint === 'string' ? item.outputHint : undefined,
              createdAt: now,
              updatedAt: now,
              source: 'imported',
              enabled: true,
              tags: Array.isArray(item.tags) ? item.tags : undefined,
            });
          }
          if (newSkills.length === 0) {
            toast.error(t.skillImportFailed);
            return;
          }
          // 覆盖式导入：合并现有 + 新导入（按 name 去重，新导入覆盖同名旧技能）
          const existingSkills = useDebugStore.getState().skills;
          const mergedMap = new Map<string, Skill>();
          for (const s of existingSkills) mergedMap.set(s.name, s);
          for (const s of newSkills) mergedMap.set(s.name, s);
          const merged = Array.from(mergedMap.values());
          importSkills(merged);
          toast.success(tf('skillImportSuccess', { count: newSkills.length }));
        } catch {
          toast.error(t.skillImportFailed);
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    },
    [importSkills, t, tf],
  );

  /** 渲染来源徽章 */
  const renderSourceBadge = (source: Skill['source']) => {
    const label =
      source === 'builtin'
        ? t.skillSourceBuiltin
        : source === 'imported'
          ? t.skillSourceImported
          : t.skillSourceCustom;
    const color =
      source === 'builtin'
        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
        : source === 'imported'
          ? 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300'
          : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300';
    return <span className={`px-1 py-0.5 rounded text-[9px] ${color}`}>{label}</span>;
  };

  /** 渲染单个技能卡片 */
  const renderSkillCard = (skill: Skill) => {
    const isActive = activeSkillId === skill.id;
    return (
      <div
        key={skill.id}
        className={`p-2.5 rounded-lg border transition-colors ${
          isActive
            ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-600'
            : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'
        } ${!skill.enabled ? 'opacity-60' : ''}`}
      >
        {/* 头部：图标 + 名称 + 来源徽章 + 启用开关 */}
        <div className="flex items-start gap-2 mb-1.5">
          <span className="text-base flex-shrink-0">{skill.icon ?? '⭐'}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1 flex-wrap">
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">
                {skill.name}
              </span>
              {renderSourceBadge(skill.source)}
            </div>
            {skill.description && (
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2">
                {skill.description}
              </div>
            )}
          </div>
          {/* 启用开关 */}
          <button
            onClick={() => handleToggleEnabled(skill)}
            className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors flex-shrink-0 ${
              skill.enabled ? 'bg-violet-500' : 'bg-slate-300 dark:bg-slate-600'
            }`}
            aria-label={skill.enabled ? t.skillEnabled : t.skillDisabled}
            title={skill.enabled ? t.skillEnabled : t.skillDisabled}
          >
            <span
              className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                skill.enabled ? 'translate-x-3.5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
        {/* 标签 */}
        {skill.tags && skill.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-1.5">
            {skill.tags.map((tag) => (
              <span
                key={tag}
                className="px-1 py-0.5 rounded text-[9px] bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
        {/* 操作按钮 */}
        <div className="flex items-center gap-1 flex-wrap">
          <button
            onClick={() => handleToggleActivate(skill)}
            className={`inline-flex items-center gap-1 px-1.5 py-1 rounded text-[10px] transition-colors ${
              isActive
                ? 'bg-blue-500 text-white hover:bg-blue-600'
                : 'bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50'
            }`}
          >
            <Power size={9} />
            {isActive ? t.skillDeactivate : t.skillActivate}
          </button>
          <button
            onClick={() => handleEdit(skill)}
            className="inline-flex items-center gap-1 px-1.5 py-1 rounded text-[10px] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            aria-label={t.skillEdit}
            title={t.skillEdit}
          >
            <Pencil size={9} />
            {t.edit}
          </button>
          <button
            onClick={() => handleExport(skill)}
            className="inline-flex items-center gap-1 px-1.5 py-1 rounded text-[10px] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            aria-label={t.skillExport}
            title={t.skillExport}
          >
            <Download size={9} />
            {t.skillExport}
          </button>
          <button
            onClick={() => handleDelete(skill)}
            className="inline-flex items-center gap-1 px-1.5 py-1 rounded text-[10px] text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
            aria-label={t.skillDelete}
            title={t.skillDelete}
          >
            <Trash2 size={9} />
            {t.delete}
          </button>
        </div>
      </div>
    );
  };

  /** 渲染表单（新建/编辑） */
  const renderForm = () => {
    return (
      <div className="space-y-3">
        {/* 技能名称 */}
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
            {t.skillName} <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => {
              setForm((f) => ({ ...f, name: e.target.value }));
              if (formError.name) setFormError((err) => ({ ...err, name: false }));
            }}
            placeholder={t.skillNamePlaceholder}
            className={`w-full rounded border bg-white dark:bg-slate-700 px-2 py-1.5 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-violet-400 ${
              formError.name
                ? 'border-red-400 focus:border-red-400'
                : 'border-slate-200 dark:border-slate-600 focus:border-violet-400'
            }`}
          />
          {formError.name && (
            <div className="text-[10px] text-red-500 mt-0.5">{t.skillName}必填</div>
          )}
        </div>

        {/* 技能描述 */}
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
            {t.skillDescription}
          </label>
          <input
            type="text"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder={t.skillDescriptionPlaceholder}
            className="w-full rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 px-2 py-1.5 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-violet-400 focus:border-violet-400"
          />
        </div>

        {/* 图标 */}
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
            {t.skillIcon}
          </label>
          <input
            type="text"
            value={form.icon}
            onChange={(e) => setForm((f) => ({ ...f, icon: e.target.value }))}
            placeholder={t.skillIconPlaceholder}
            className="w-full rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 px-2 py-1.5 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-violet-400 focus:border-violet-400"
          />
        </div>

        {/* 系统提示词 */}
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
            {t.skillSystemPrompt} <span className="text-red-500">*</span>
          </label>
          <textarea
            value={form.systemPrompt}
            onChange={(e) => {
              setForm((f) => ({ ...f, systemPrompt: e.target.value }));
              if (formError.systemPrompt) setFormError((err) => ({ ...err, systemPrompt: false }));
            }}
            placeholder={t.skillSystemPromptPlaceholder}
            rows={5}
            className={`w-full rounded border bg-white dark:bg-slate-700 px-2 py-1.5 text-xs text-slate-800 dark:text-slate-100 font-mono focus:outline-none focus:ring-1 focus:ring-violet-400 ${
              formError.systemPrompt
                ? 'border-red-400 focus:border-red-400'
                : 'border-slate-200 dark:border-slate-600 focus:border-violet-400'
            }`}
          />
          {formError.systemPrompt && (
            <div className="text-[10px] text-red-500 mt-0.5">{t.skillSystemPrompt}必填</div>
          )}
        </div>

        {/* 输入说明 */}
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
            {t.skillInputHint}
          </label>
          <input
            type="text"
            value={form.inputHint}
            onChange={(e) => setForm((f) => ({ ...f, inputHint: e.target.value }))}
            placeholder={t.skillInputHintPlaceholder}
            className="w-full rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 px-2 py-1.5 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-violet-400 focus:border-violet-400"
          />
        </div>

        {/* 输出说明 */}
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
            {t.skillOutputHint}
          </label>
          <input
            type="text"
            value={form.outputHint}
            onChange={(e) => setForm((f) => ({ ...f, outputHint: e.target.value }))}
            placeholder={t.skillOutputHintPlaceholder}
            className="w-full rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 px-2 py-1.5 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-violet-400 focus:border-violet-400"
          />
        </div>

        {/* 标签 */}
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
            {t.skillTags}
          </label>
          <input
            type="text"
            value={form.tags.join(', ')}
            onChange={(e) => setForm((f) => ({ ...f, tags: parseTags(e.target.value) }))}
            placeholder={t.skillTagsPlaceholder}
            className="w-full rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 px-2 py-1.5 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-violet-400 focus:border-violet-400"
          />
        </div>

        {/* 启用开关 */}
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
            {t.skillEnabled}
          </label>
          <button
            onClick={() => setForm((f) => ({ ...f, enabled: !f.enabled }))}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              form.enabled ? 'bg-violet-500' : 'bg-slate-300 dark:bg-slate-600'
            }`}
            aria-label={form.enabled ? t.skillEnabled : t.skillDisabled}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                form.enabled ? 'translate-x-4' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>

        {/* 表单操作按钮 */}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-700">
          <button
            onClick={handleCancelForm}
            className="px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded transition-colors"
          >
            {t.cancel}
          </button>
          <button
            onClick={handleSave}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-violet-600 text-white hover:bg-violet-700 rounded transition-colors"
          >
            <Check size={11} />
            {t.save}
          </button>
        </div>
      </div>
    );
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-lg bg-white shadow-xl dark:bg-slate-800"
        onClick={(e) => e.stopPropagation()}
        {...containerProps}
        aria-label={t.skillManagerTitle}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-700">
          <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Sparkles size={16} className="text-violet-500" />
            {t.skillManagerTitle}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200"
            aria-label={t.close}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 内容区：列表 / 表单 */}
        <div className="flex-1 overflow-y-auto p-4">
          {formMode === 'form' ? (
            renderForm()
          ) : (
            <>
              {/* 顶部操作栏：新建 / 从文件导入 */}
              <div className="flex items-center gap-2 mb-3">
                <button
                  onClick={handleCreate}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-violet-600 text-white hover:bg-violet-700 rounded transition-colors"
                >
                  <Plus size={12} />
                  {t.skillCreate}
                </button>
                <input
                  ref={importFileRef}
                  type="file"
                  accept=".json"
                  onChange={handleImportFile}
                  className="hidden"
                />
                <button
                  onClick={() => importFileRef.current?.click()}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded transition-colors"
                >
                  <Upload size={12} />
                  {t.skillImportFromFile}
                </button>
              </div>

              {/* 技能列表 */}
              {skills.length === 0 ? (
                <div className="text-center text-xs text-slate-400 dark:text-slate-500 py-8 px-2">
                  {t.skillNoSkills}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {skills.map((skill) => renderSkillCard(skill))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
