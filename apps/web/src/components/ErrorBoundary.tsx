'use client';

// ============================================================
// AI Debug — 通用 React Error Boundary
//
// 类组件实现（componentDidCatch 仅类组件可用），可包裹任意子树。
// 默认 fallback：友好的错误提示 + "重试" 按钮（重置内部 state）。
// 通过 componentDidCatch 把错误记录到 console.error（不上报外部服务）。
// ============================================================

import React, { type ReactNode } from 'react';

export interface ErrorBoundaryProps {
  /** 子树 */
  children: ReactNode;
  /** 可选自定义 fallback UI；不传则使用默认 UI */
  fallback?: ReactNode;
  /** 可选回调，错误发生时通知调用方（用于打日志 / 上层提示） */
  onError?: (error: Error, info: React.ErrorInfo) => void;
  /** 可选重置键：当此 prop 变化时，重置内部错误状态（与 reset 按钮等效） */
  resetKey?: string | number;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // 仅本地 console 记录，不上报到外部服务（项目无后端）
    console.error('[ErrorBoundary]', error, info.componentStack);
    this.props.onError?.(error, info);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    // resetKey 变化时清除错误状态（用于父组件控制重试时机）
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null });
    }
  }

  /** 重置内部错误状态，让子树重新渲染 */
  reset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback !== undefined) {
        return this.props.fallback;
      }
      return (
        <div
          role="alert"
          className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center"
        >
          <div className="text-sm text-slate-600 dark:text-slate-300">
            <div className="font-medium">渲染出错 / Something went wrong</div>
            {this.state.error?.message && (
              <div className="mt-1 text-xs text-slate-400 break-all">{this.state.error.message}</div>
            )}
          </div>
          <button
            type="button"
            onClick={this.reset}
            className="px-3 py-1.5 text-xs rounded-md bg-violet-500 text-white hover:bg-violet-600 transition-colors"
          >
            重试 / Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
