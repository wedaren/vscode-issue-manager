/**
 * DOM 选取模式主模块
 */

import { UI_CLASSES, MOUSE_SWITCH_THRESHOLD, TIMEOUTS } from '../../config/constants';
import { createOverlay, removeOverlay } from './ui/overlay';
import { createHighlightBox, removeHighlightBox, updateHighlight } from './ui/highlight';
import { showToast, removeToast, debounce } from './ui/toast';
import { createControlPanel, removeControlPanel, type ControlPanelCallbacks } from './ui/controlPanel';
import { handleKeyboardNavigation } from './keyboard';
import { extractAndStoreTextNodes } from './textNodes';

export interface SelectionModeState {
  isActive: boolean;
  overlay: HTMLElement | null;
  highlightBox: HTMLElement | null;
  currentElement: HTMLElement | null;
  hoverElement: HTMLElement | null;
  controlPanel: HTMLElement | null;
  frozenByClick: boolean;
  keyboardNavigating: boolean;
  navigationHistory: HTMLElement[];
  lastMouseX: number;
  lastMouseY: number;
  selectionPurpose: 'issue' | 'llm' | 'translate';
}

const debouncedShowToast = debounce(showToast, TIMEOUTS.toastDebounce);

/**
 * 创建选取模式状态
 */
export function createSelectionState(): SelectionModeState {
  return {
    isActive: false,
    overlay: null,
    highlightBox: null,
    currentElement: null,
    hoverElement: null,
    controlPanel: null,
    frozenByClick: false,
    keyboardNavigating: false,
    navigationHistory: [],
    lastMouseX: 0,
    lastMouseY: 0,
    selectionPurpose: 'issue',
  };
}

/**
 * 开始选取模式
 */
export function startSelectionMode(state: SelectionModeState, purpose: 'issue' | 'llm' | 'translate' = 'issue'): void {
  if (state.isActive) {
    return;
  }

  console.log('Starting selection mode, purpose:', purpose);
  state.isActive = true;
  state.selectionPurpose = purpose;
  state.frozenByClick = false;
  state.currentElement = null;
  state.navigationHistory = [];

  state.overlay = createOverlay();
  state.highlightBox = createHighlightBox();

  const handlers = createEventHandlers(state);
  document.addEventListener('mousemove', handlers.mouseMove, true);
  document.addEventListener('click', handlers.click, true);
  document.addEventListener('keydown', handlers.keyDown, true);
  window.addEventListener('keydown', handlers.keyDown, true);

  try {
    if (document.activeElement && typeof (document.activeElement as any).blur === 'function') {
      (document.activeElement as any).blur();
    }
    if (document.body && typeof (document.body as any).focus === 'function') {
      (document.body as any).focus();
    }
  } catch { }

  debouncedShowToast('请点击页面任意区域以选中内容');
}

/**
 * 取消选取模式
 */
export function cancelSelectionMode(state: SelectionModeState): void {
  if (!state.isActive) {
    return;
  }

  console.log('Cancelling selection mode');
  state.isActive = false;

  const handlers = createEventHandlers(state);
  document.removeEventListener('mousemove', handlers.mouseMove, true);
  document.removeEventListener('click', handlers.click, true);
  document.removeEventListener('keydown', handlers.keyDown, true);
  window.removeEventListener('keydown', handlers.keyDown, true);

  removeOverlay(state.overlay);
  removeHighlightBox(state.highlightBox);
  removeToast();
  removeControlPanel(state.controlPanel);

  state.overlay = null;
  state.highlightBox = null;
  state.controlPanel = null;
  state.currentElement = null;
  state.frozenByClick = false;
  state.navigationHistory = [];
}

/**
 * 创建事件处理器
 */
function createEventHandlers(state: SelectionModeState) {
  return {
    mouseMove: (event: MouseEvent) => handleMouseMove(event, state),
    click: (event: MouseEvent) => handleClick(event, state),
    keyDown: (event: KeyboardEvent) => handleKeyDown(event, state),
  };
}

/**
 * 处理鼠标移动
 */
function handleMouseMove(event: MouseEvent, state: SelectionModeState): void {
  if (!state.isActive) {
    return;
  }

  event.stopPropagation();
  state.lastMouseX = event.clientX;
  state.lastMouseY = event.clientY;

  const element = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement;

  if (!element || element === state.overlay || element === state.highlightBox) {
    return;
  }
  if (isOurUiElement(element, state.controlPanel)) {
    return;
  }

  state.hoverElement = element;
  if (!state.keyboardNavigating) {
    state.currentElement = state.hoverElement;
    updateHighlight(state.highlightBox, state.currentElement);
  } else {
    if (!state.frozenByClick && hasMouseMovedSignificantly(state)) {
      state.keyboardNavigating = false;
      state.currentElement = state.hoverElement;
      updateHighlight(state.highlightBox, state.currentElement);
    }
  }
}

/**
 * 处理点击
 */
function handleClick(event: MouseEvent, state: SelectionModeState): void {
  if (!state.isActive) {
    return;
  }
  if (isOurUiElement(event.target as HTMLElement, state.controlPanel)) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  const el = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement || event.target as HTMLElement;
  if (el && isSelectable(el, state)) {
    state.currentElement = el;
    state.navigationHistory = [state.currentElement];
    updateHighlight(state.highlightBox, state.currentElement);

    if (!state.frozenByClick) {
      const callbacks: ControlPanelCallbacks = {
        onConfirm: () => handleConfirm(state),
        onCancel: () => handleCancelSelection(state),
      };
      state.controlPanel = createControlPanel(callbacks);
      debouncedShowToast('已选中！方向键可微调，回车或点击"确认"完成。', 'info');
    } else {
      debouncedShowToast('已重新选择元素。', 'info');
    }

    state.keyboardNavigating = true;
    state.frozenByClick = true;
  }
}

/**
 * 处理键盘事件
 */
function handleKeyDown(event: KeyboardEvent, state: SelectionModeState): void {
  if (!state.isActive) {
    return;
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopImmediatePropagation();
    cancelSelectionMode(state);
    debouncedShowToast('已取消选取', 'info');
    return;
  }

  handleKeyboardNavigation(event, state, updateHighlight, debouncedShowToast);
}

/**
 * 处理确认选择
 */
function handleConfirm(state: SelectionModeState): void {
  if (!state.currentElement) {
    seedCurrentFromHoverOrCenter(state);
  }

  if (state.currentElement) {
    confirmSelection(state);
  } else {
    debouncedShowToast('请先选择一个元素,然后再点击确认。', 'error');
  }
}

/**
 * 处理取消当前选择
 */
function handleCancelSelection(state: SelectionModeState): void {
  state.currentElement = null;
  updateHighlight(state.highlightBox, null);
  state.frozenByClick = false;
  state.keyboardNavigating = false;
  state.navigationHistory = [];
  debouncedShowToast('已取消当前选中,请移动鼠标重新选择;按 ESC 可退出。', 'info');
}

/**
 * 确认选择并发送消息
 */
function confirmSelection(state: SelectionModeState): void {
  if (!state.currentElement) {
    return;
  }

  const html = state.currentElement.outerHTML;
  const title = extractTitle();
  const url = window.location.href;

  console.log('Element selected:', { html: html.substring(0, 100), title, url, purpose: state.selectionPurpose });

  if (state.selectionPurpose === 'llm') {
    chrome.runtime.sendMessage({
      type: 'LLM_CONTENT_SELECTED',
      data: { html, title, url }
    });
    debouncedShowToast('✓ 区域已选择', 'success');
  } else if (state.selectionPurpose === 'translate') {
    const blockId = `trans-${Math.random().toString(36).substring(2, 9)}`;
    state.currentElement.setAttribute('data-translate-id', blockId);

    // 给选定区域整体添加背景脉冲动画，不再担心被 LLM 原样返回毁坏
    state.currentElement.classList.add('issue-manager-translating-pulse');

    // 穿透提取整块 DOM 下干净的待翻译所有文本节点集合（带有 <t id> 保护）
    const promptContent = extractAndStoreTextNodes(state.currentElement, blockId);

    chrome.runtime.sendMessage({
      type: 'LLM_REQUEST',
      data: {
        model: '',
        prompt: `你是一个网页翻译专家。请将以下XML格式内容中所有的 <t id="X">...</t> 元素的文本翻译成准确流畅的中文。\n规则：\n1. 必须完全保留原始的 <t id="X">...</t> 结构，不得遗漏、合并或随意更改 id 的序号。\n2. 直接输出带有 <t> 标签翻译结果的纯文本，不能输出任何其他内容（哪怕是markdown提示符如 \`\`\`xml 也不要）。\n3. 如果原始文本只有标点或空格，也请原版返回保留。\n\n${promptContent}`,
        isTranslate: true,
        translateBlockId: blockId
      }
    });

    debouncedShowToast('正在原地逐步翻译，请稍候...', 'info');
  } else {
    chrome.runtime.sendMessage({
      type: 'CONTENT_SELECTED',
      data: { html, title, url }
    });
    debouncedShowToast('✓ 内容已选取，正在创建笔记...', 'success');
  }

  setTimeout(() => {
    cancelSelectionMode(state);
  }, state.selectionPurpose === 'translate' ? 300 : 1000);
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

/**
 * 从悬停或中心位置设置当前元素
 */
function seedCurrentFromHoverOrCenter(state: SelectionModeState): void {
  if (state.hoverElement && isSelectable(state.hoverElement, state)) {
    state.currentElement = state.hoverElement;
    updateHighlight(state.highlightBox, state.currentElement);
    return;
  }

  const centerX = Math.round(window.innerWidth / 2);
  const centerY = Math.round(window.innerHeight / 2);
  const el = document.elementFromPoint(centerX, centerY) as HTMLElement;

  if (el && isSelectable(el, state)) {
    state.currentElement = el;
    updateHighlight(state.highlightBox, state.currentElement);
  }
}

/**
 * 检查鼠标是否移动了足够的距离
 */
function hasMouseMovedSignificantly(state: SelectionModeState): boolean {
  const el = state.currentElement;
  if (!el) {
    return true;
  }

  const rect = el.getBoundingClientRect();
  const dx = state.lastMouseX < rect.left ? rect.left - state.lastMouseX :
    (state.lastMouseX > rect.right ? state.lastMouseX - rect.right : 0);
  const dy = state.lastMouseY < rect.top ? rect.top - state.lastMouseY :
    (state.lastMouseY > rect.bottom ? state.lastMouseY - rect.bottom : 0);

  return (dx > MOUSE_SWITCH_THRESHOLD || dy > MOUSE_SWITCH_THRESHOLD);
}

/**
 * 检查元素是否可选择
 */
export function isSelectable(el: HTMLElement, state: SelectionModeState): boolean {
  if (!el || el === state.overlay || el === state.highlightBox) {
    return false;
  }
  if (isOurUiElement(el, state.controlPanel)) {
    return false;
  }
  if (el === document.documentElement || el === document.body) {
    return false;
  }
  return true;
}

/**
 * 检查是否是我们的 UI 元素
 */
function isOurUiElement(el: HTMLElement | null, controlPanel: HTMLElement | null): boolean {
  if (!el) {
    return false;
  }

  if (el.classList) {
    for (const cls of UI_CLASSES) {
      if (el.classList.contains(cls)) {
        return true;
      }
    }
  }

  if (controlPanel && (el === controlPanel || el.closest?.('.issue-manager-control'))) {
    return true;
  }

  const toast = document.querySelector('.issue-manager-toast');
  if (toast && (el === toast || el.closest?.('.issue-manager-toast'))) {
    return true;
  }

  return false;
}


