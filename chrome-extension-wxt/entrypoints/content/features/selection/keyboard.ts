/**
 * DOM 选取模式键盘导航
 */

import type { SelectionModeState } from './index';

/**
 * 处理键盘导航
 */
export function handleKeyboardNavigation(
  event: KeyboardEvent,
  state: SelectionModeState,
  updateHighlight: (box: HTMLElement | null, element: HTMLElement | null) => void,
  showToast: (message: string, type?: 'info' | 'error' | 'success') => void
): void {
  const navKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 's', 'e'];
  if (!navKeys.includes(event.key)) {
    return;
  }

  event.preventDefault();
  event.stopImmediatePropagation();

  state.keyboardNavigating = true;

  if (event.key === 'Enter') {
    // 回车键确认
    if (state.currentElement) {
      const html = state.currentElement.outerHTML;
      const title = extractTitle();
      const url = window.location.href;

      chrome.runtime.sendMessage({
        type: 'CONTENT_SELECTED',
        data: { html, title, url }
      });

      showToast('✓ 内容已选取，正在创建笔记...', 'success');
    } else {
      showToast('请先选择一个元素。', 'error');
    }
    return;
  }

  if (!state.currentElement) {
    seedCurrentFromHoverOrCenter(state);
    if (state.currentElement) {
      updateHighlight(state.highlightBox, state.currentElement);
    }
    return;
  }

  if (event.key === 's') {
    shrinkSelection(state, updateHighlight);
  } else if (event.key === 'e') {
    expandSelection(state, updateHighlight);
  } else {
    navigate(event.key as 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight', state, updateHighlight);
  }
}

/**
 * 收缩选择
 */
function shrinkSelection(
  state: SelectionModeState,
  updateHighlight: (box: HTMLElement | null, element: HTMLElement | null) => void
): void {
  if (!state.currentElement) {
    return;
  }
  
  const first = state.currentElement.firstElementChild as HTMLElement | null;
  if (first) {
    state.navigationHistory.push(state.currentElement);
    state.currentElement = first;
    updateHighlight(state.highlightBox, state.currentElement);
  }
}

/**
 * 扩展选择
 */
function expandSelection(
  state: SelectionModeState,
  updateHighlight: (box: HTMLElement | null, element: HTMLElement | null) => void
): void {
  if (!state.currentElement) {
    return;
  }
  
  const parent = state.currentElement.parentElement;
  if (parent && parent !== document.documentElement && parent !== document.body) {
    state.navigationHistory.push(state.currentElement);
    state.currentElement = parent as HTMLElement;
    updateHighlight(state.highlightBox, state.currentElement);
  }
}

/**
 * 方向键导航
 */
function navigate(
  direction: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight',
  state: SelectionModeState,
  updateHighlight: (box: HTMLElement | null, element: HTMLElement | null) => void
): void {
  if (!state.currentElement) {
    return;
  }
  
  let target: Element | null = null;
  if (direction === 'ArrowUp') {
    target = state.currentElement.previousElementSibling;
  } else if (direction === 'ArrowDown') {
    target = state.currentElement.nextElementSibling;
  } else if (direction === 'ArrowLeft') {
    target = state.currentElement.parentElement;
  } else if (direction === 'ArrowRight') {
    target = state.currentElement.firstElementChild;
  }

  if (target && target !== document.documentElement && target !== document.body) {
    state.navigationHistory.push(state.currentElement);
    state.currentElement = target as HTMLElement;
    updateHighlight(state.highlightBox, state.currentElement);
  }
}

/**
 * 从悬停或中心位置设置当前元素
 */
function seedCurrentFromHoverOrCenter(state: SelectionModeState): void {
  if (state.hoverElement) {
    state.currentElement = state.hoverElement;
    return;
  }
  
  const centerX = Math.round(window.innerWidth / 2);
  const centerY = Math.round(window.innerHeight / 2);
  const el = document.elementFromPoint(centerX, centerY) as HTMLElement;
  
  if (el && el !== document.documentElement && el !== document.body) {
    state.currentElement = el;
  }
}

/**
 * 提取页面标题
 */
function extractTitle(): string {
  const h1 = document.querySelector('h1');
  if (h1) {
    return h1.textContent?.trim() || '未命名页面';
  }
  return document.title || '未命名页面';
}
