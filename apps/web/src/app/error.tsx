'use client';

// ============================================================
// AI Debug — Next.js App Router 全局错误兜底
//
// 当任何路由段抛出未捕获错误时，Next.js 会用本组件替换 children
// （layout 仍保留）。提供错误信息 + 重试按钮，中英双语文案。
// 文档：https://nextjs.org/docs/app/api-reference/file-conventions/error
// ============================================================

import { useEffect } from 'react';

interface ErrorBoundaryRouteProps {
  error: Error & { digest?: string };
  /** Next.js 提供的重置函数：调用后重新渲染当前路由段 */
  reset: () => void;
}

export default function ErrorBoundaryRoute({ error, reset }: ErrorBoundaryRouteProps) {
  // 把错误记录到 console.error，便于本地调试（不上报外部服务）
  useEffect(() => {
    console.error('[app/error]', error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-4">
      <div
        role="alert"
        className="max-w-md w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-sm"
      >
        <div className="flex flex-col gap-3 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5"
              aria-hidden="true"
            >
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">
            页面出错啦 / Something went wrong
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            应用遇到未预期的错误。请尝试重试，或刷新页面。 / The app hit an unexpected error. Please
            retry, or reload the page.
          </p>
          {error?.message && (
            <pre className="mt-1 max-h-32 overflow-auto rounded-md bg-slate-100 dark:bg-slate-800 p-2 text-left text-xs text-slate-600 dark:text-slate-300 break-all whitespace-pre-wrap">
              {error.message}
            </pre>
          )}
          <div className="mt-2 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={reset}
              className="px-3 py-1.5 text-xs rounded-md bg-violet-500 text-white hover:bg-violet-600 transition-colors"
            >
              重试 / Retry
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-3 py-1.5 text-xs rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              刷新页面 / Reload
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
