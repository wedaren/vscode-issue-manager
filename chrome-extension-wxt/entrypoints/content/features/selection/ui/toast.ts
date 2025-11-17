/**
 * UI 组件:Toast 提示框
 */

import { TIMEOUTS } from '../../../config/constants';

export function showToast(message: string, type: 'info' | 'success' | 'error' = 'info'): void {
  removeToast();

  const toast = document.createElement('div');
  toast.className = `issue-manager-toast issue-manager-toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    removeToast();
  }, TIMEOUTS.toastDuration);
}

export function removeToast(): void {
  const existingToast = document.querySelector('.issue-manager-toast');
  if (existingToast?.parentNode) {
    existingToast.parentNode.removeChild(existingToast);
  }
}

export function debounce<T extends (...args: any[]) => void>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;
  return function executedFunction(...args: any[]) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}
