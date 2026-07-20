'use client';

import {
  MousePointer2,
  Hand,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Focus,
  PanelLeft,
  Expand,
  Shrink,
  Undo2,
  Redo2,
  LayoutGrid,
  ListCollapse,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from '@/components/I18nProvider';

/** 工具栏所有可触发动作的回调集合，由 NodeCanvas 注入 */
export interface CanvasToolbarProps {
  /** 当前交互模式：select 选择 / hand 抓手 */
  interactionMode: 'select' | 'hand';
  setInteractionMode: (mode: 'select' | 'hand') => void;
  /** 临时抓手模式（按住空格） */
  spacePressed: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitView: () => void;
  /** 自动排列：调用 dagre 重排节点 */
  onAutoLayout: () => void;
  /** 路径隔离模式（focus mode）开关 */
  focusMode: boolean;
  onToggleFocusMode: () => void;
  /** 侧边栏是否已收起 */
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  /** 是否处于全屏 */
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  /** 节点显示模式：detailed 详细 / compact 紧凑（节点收纳） */
  nodeDisplayMode: 'detailed' | 'compact';
  onToggleNodeDisplayMode: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

/** 单个圆形按钮统一样式：32x32，激活/非激活态 */
function ToolbarButton({
  icon: Icon,
  label,
  active,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`flex items-center justify-center w-8 h-8 rounded-full transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
        active
          ? 'bg-slate-900/10 dark:bg-white/15 text-slate-900 dark:text-white'
          : 'text-slate-600 dark:text-white/50 hover:bg-slate-900/10 dark:hover:bg-white/8'
      }`}
    >
      <Icon size={16} />
    </button>
  );
}

/** 竖向分隔线：胶囊工具栏分组 */
function Divider() {
  return <div className="w-px h-5 bg-slate-200 dark:bg-white/10 mx-0.5" aria-hidden="true" />;
}

/**
 * 画布右上角胶囊形工具栏：模式切换 / 缩放 / 自动排列 / 路径隔离 / 侧边栏 / 全屏 / 撤销重做。
 * 样式参考 spark-flow：rounded-full + backdrop-blur-xl，按钮 32x32 圆形。
 */
export default function CanvasToolbar(props: CanvasToolbarProps) {
  const {
    interactionMode,
    setInteractionMode,
    spacePressed,
    onZoomIn,
    onZoomOut,
    onFitView,
    onAutoLayout,
    focusMode,
    onToggleFocusMode,
    sidebarCollapsed,
    onToggleSidebar,
    isFullscreen,
    onToggleFullscreen,
    nodeDisplayMode,
    onToggleNodeDisplayMode,
    canUndo,
    canRedo,
    onUndo,
    onRedo,
  } = props;
  const { t } = useTranslation();

  // 临时抓手：按住空格时即使交互模式是 select，也按抓手激活态展示
  const isHandActive = interactionMode === 'hand' || spacePressed;
  const sidebarLabel = sidebarCollapsed ? t.toggleSidebarExpand : t.toggleSidebarCollapse;
  const fullscreenLabel = isFullscreen ? t.fullscreenExit : t.fullscreenEnter;
  // 节点收纳：active 表示当前处于紧凑模式；tooltip 提示下一步动作
  const isCompact = nodeDisplayMode === 'compact';
  const nodeDisplayLabel = isCompact ? t.detailedMode : t.compactMode;

  return (
    <div className="absolute top-3 right-3 z-10 flex items-center gap-0.5 bg-slate-100/90 dark:bg-white/10 backdrop-blur-xl rounded-full px-1.5 py-1.5 border border-slate-200 dark:border-white/10 shadow-2xl shadow-black/10 dark:shadow-black/40">
      {/* 模式切换：选择 + 抓手 */}
      <ToolbarButton
        icon={MousePointer2}
        label={t.selectTool}
        active={interactionMode === 'select' && !spacePressed}
        onClick={() => setInteractionMode('select')}
      />
      <ToolbarButton
        icon={Hand}
        label={t.handTool}
        active={isHandActive}
        onClick={() => setInteractionMode('hand')}
      />

      <Divider />

      {/* 缩放：缩小 + 放大 + 适应视图 + 自动排列 */}
      <ToolbarButton icon={ZoomOut} label={t.zoomOut} onClick={onZoomOut} />
      <ToolbarButton icon={ZoomIn} label={t.zoomIn} onClick={onZoomIn} />
      <ToolbarButton icon={Maximize2} label={t.fitView} onClick={onFitView} />
      <ToolbarButton icon={LayoutGrid} label={t.autoLayout} onClick={onAutoLayout} />

      <Divider />

      {/* 节点收纳：详细 / 紧凑模式切换（active 表示当前紧凑） */}
      <ToolbarButton
        icon={ListCollapse}
        label={nodeDisplayLabel}
        active={isCompact}
        onClick={onToggleNodeDisplayMode}
      />

      <Divider />

      {/* 路径隔离模式 */}
      <ToolbarButton
        icon={Focus}
        label={focusMode ? t.focusModeOnHint : t.focusModeOffHint}
        active={focusMode}
        onClick={onToggleFocusMode}
      />

      {/* 侧边栏切换 */}
      <ToolbarButton
        icon={PanelLeft}
        label={sidebarLabel}
        active={!sidebarCollapsed}
        onClick={onToggleSidebar}
      />

      {/* 全屏切换 */}
      <ToolbarButton
        icon={isFullscreen ? Shrink : Expand}
        label={fullscreenLabel}
        active={isFullscreen}
        onClick={onToggleFullscreen}
      />

      <Divider />

      {/* 撤销 / 重做 */}
      <ToolbarButton icon={Undo2} label={t.undo} disabled={!canUndo} onClick={onUndo} />
      <ToolbarButton icon={Redo2} label={t.redo} disabled={!canRedo} onClick={onRedo} />
    </div>
  );
}
