'use client';

import { useEffect, useRef, useCallback } from 'react';

/**
 * 弹窗无障碍 hook（WCAG AA Dialog 模式）：
 * - 打开时焦点自动移到弹窗内第一个可聚焦元素
 * - Tab/Shift+Tab 在弹窗内循环（焦点陷阱）
 * - Escape 键关闭弹窗
 * - 关闭时焦点恢复到触发按钮
 *
 * @param open     弹窗是否打开
 * @param onClose  关闭回调
 * @returns 需要绑定到弹窗容器 div 的 ref
 */
export function useDialogA11y(
  open: boolean,
  onClose: () => void,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // 获取容器内所有可聚焦元素
  const getFocusableElements = useCallback((): HTMLElement[] => {
    const container = containerRef.current;
    if (!container) return [];
    const selector =
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return Array.from(container.querySelectorAll<HTMLElement>(selector)).filter(
      (el) => el.offsetParent !== null || el === document.activeElement
    );
  }, []);

  useEffect(() => {
    if (!open) return;

    // 记录打开前的焦点元素，关闭后恢复
    previousFocusRef.current = document.activeElement as HTMLElement;

    // 打开时焦点移到弹窗内（优先第一个可聚焦元素，否则容器自身）
    const timer = setTimeout(() => {
      const focusables = getFocusableElements();
      if (focusables.length > 0) {
        focusables[0].focus();
      } else {
        containerRef.current?.focus();
      }
    }, 0);

    // Escape 关闭
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      // 焦点陷阱：Tab / Shift+Tab 循环
      if (e.key === 'Tab') {
        const focusables = getFocusableElements();
        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement;

        if (e.shiftKey) {
          // Shift+Tab：从第一个跳到最后一个
          if (active === first || !containerRef.current?.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          // Tab：从最后一个跳到第一个
          if (active === last || !containerRef.current?.contains(active)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose, getFocusableElements]);

  // 关闭时恢复焦点
  useEffect(() => {
    if (open) return;
    if (previousFocusRef.current) {
      previousFocusRef.current.focus();
      previousFocusRef.current = null;
    }
  }, [open]);

  return containerRef;
}
