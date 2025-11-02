/**
 * Content Script
 * 负责在网页中实现 DOM 选取功能
 */

import './style.css';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  allFrames: true,
  cssInjectionMode: 'ui',
  
  main() {
    // 幂等注入哨兵，避免重复注入
    if ((window as any).__ISSUE_MANAGER_CONTENT_INJECTED__) {
      return;
    } else {
      try {
        Object.defineProperty(window, '__ISSUE_MANAGER_CONTENT_INJECTED__', {
          value: true,
          configurable: false,
          enumerable: false,
          writable: false
        });
      } catch {
        (window as any).__ISSUE_MANAGER_CONTENT_INJECTED__ = true;
      }
    }

    // 状态管理
    let isSelectionMode = false;
    let overlay: HTMLElement | null = null;
    let highlightBox: HTMLElement | null = null;
    let currentElement: HTMLElement | null = null;
    let hoverElement: HTMLElement | null = null;
    let keyboardNavigating = false;
    let lastMouseX = 0;
    let lastMouseY = 0;
    const MOUSE_SWITCH_THRESHOLD = 8;
    let controlPanel: HTMLElement | null = null;
    let frozenByClick = false;
    let navigationHistory: HTMLElement[] = [];

    const OUR_UI_CLASSES = ['issue-manager-overlay', 'issue-manager-highlight', 'issue-manager-toast', 'issue-manager-control'];

    function debounce(func: Function, wait: number) {
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

    const debouncedShowToast = debounce(showToast, 500);

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      console.log('Content Script received message:', message);

      switch (message.type) {
        case 'START_SELECTION':
          startSelectionMode();
          sendResponse({ success: true });
          break;

        case 'CANCEL_SELECTION':
          cancelSelectionMode();
          sendResponse({ success: true });
          break;

        default:
          console.warn('Unknown message type:', message.type);
          sendResponse({ success: false });
      }

      return true;
    });

    function startSelectionMode() {
      if (isSelectionMode) return;

      console.log('Starting selection mode');
      isSelectionMode = true;
      frozenByClick = false;
      currentElement = null;
      navigationHistory = [];

      createOverlay();
      createHighlightBox();

      document.addEventListener('mousemove', handleMouseMove, true);
      document.addEventListener('click', handleClick, true);
      document.addEventListener('keydown', handleKeyDown, true);
      window.addEventListener('keydown', handleKeyDown, true);

      try {
        if (document.activeElement && typeof (document.activeElement as any).blur === 'function') {
          (document.activeElement as any).blur();
        }
        if (document.body && typeof (document.body as any).focus === 'function') {
          (document.body as any).focus();
        }
      } catch {}

      debouncedShowToast('请点击页面任意区域以选中内容');
    }

    function cancelSelectionMode() {
      if (!isSelectionMode) return;

      console.log('Cancelling selection mode');
      isSelectionMode = false;

      document.removeEventListener('mousemove', handleMouseMove, true);
      document.removeEventListener('click', handleClick, true);
      document.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keydown', handleKeyDown, true);

      removeOverlay();
      removeHighlightBox();
      removeToast();
      removeControlPanel();

      currentElement = null;
      frozenByClick = false;
      navigationHistory = [];
    }

    function handleMouseMove(event: MouseEvent) {
      if (!isSelectionMode) return;

      event.stopPropagation();
      lastMouseX = event.clientX;
      lastMouseY = event.clientY;
      
      const element = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement;
      
      if (!element || element === overlay || element === highlightBox) return;
      if (isOurUiElement(element)) return;

      hoverElement = element;
      if (!keyboardNavigating) {
        currentElement = hoverElement;
        updateHighlight(currentElement);
      } else {
        if (!frozenByClick && hasMouseMovedSignificantly()) {
          keyboardNavigating = false;
          currentElement = hoverElement;
          updateHighlight(currentElement);
        }
      }
    }

    function handleClick(event: MouseEvent) {
      if (!isSelectionMode) return;
      if (isOurUiElement(event.target as HTMLElement)) return;

      event.preventDefault();
      event.stopPropagation();

      const el = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement || event.target as HTMLElement;
      if (el && isSelectable(el)) {
        currentElement = el;
        navigationHistory = [currentElement];
        updateHighlight(currentElement);

        if (!frozenByClick) {
          createControlPanel();
          debouncedShowToast('已选中！方向键可微调，回车或点击"确认"完成。', 'info');
        } else {
          debouncedShowToast('已重新选择元素。', 'info');
        }

        keyboardNavigating = true;
        frozenByClick = true;
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (!isSelectionMode) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        cancelSelectionMode();
        debouncedShowToast('已取消选取', 'info');
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        if (!currentElement) {
          seedCurrentFromHoverOrCenter();
        }
        if (currentElement) {
          confirmSelection();
        }
        return;
      }

      if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        if (!currentElement) {
          seedCurrentFromHoverOrCenter();
          if (!currentElement) return;
        }
        keyboardNavigating = true;
        shrinkSelectionLevel();
        return;
      }

      if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        if (!currentElement) {
          seedCurrentFromHoverOrCenter();
          if (!currentElement) return;
        }
        keyboardNavigating = true;
        expandSelectionLevel();
        return;
      }
    }

    function seedCurrentFromHoverOrCenter() {
      if (hoverElement && isSelectable(hoverElement)) {
        currentElement = hoverElement;
        updateHighlight(currentElement);
        return;
      }
      const centerX = Math.round(window.innerWidth / 2);
      const centerY = Math.round(window.innerHeight / 2);
      const el = document.elementFromPoint(centerX, centerY) as HTMLElement;
      if (el && isSelectable(el)) {
        currentElement = el;
        updateHighlight(currentElement);
      }
    }

    function hasMouseMovedSignificantly(): boolean {
      const el = currentElement;
      if (!el) return true;
      const rect = el.getBoundingClientRect();
      const dx = lastMouseX < rect.left ? rect.left - lastMouseX : (lastMouseX > rect.right ? lastMouseX - rect.right : 0);
      const dy = lastMouseY < rect.top ? rect.top - lastMouseY : (lastMouseY > rect.bottom ? lastMouseY - rect.bottom : 0);
      return (dx > MOUSE_SWITCH_THRESHOLD || dy > MOUSE_SWITCH_THRESHOLD);
    }

    function shrinkSelectionLevel() {
      if (!currentElement) return;

      if (navigationHistory.length > 1) {
        navigationHistory.pop();
        currentElement = navigationHistory[navigationHistory.length - 1];
        updateHighlight(currentElement);
        debouncedShowToast('已返回上一级', 'info');
        return;
      }

      const rect = currentElement.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      
      let candidate: HTMLElement | null = null;
      try {
        const el = document.elementFromPoint(centerX, centerY) as HTMLElement;
        if (el && currentElement.contains(el) && el !== currentElement && isSelectable(el)) {
          candidate = el;
        }
      } catch {}

      if (!candidate) {
        candidate = Array.from(currentElement.children).find(child => isSelectable(child as HTMLElement)) as HTMLElement || null;
      }

      if (candidate) {
        currentElement = candidate;
        navigationHistory.push(currentElement);
        updateHighlight(currentElement);
        debouncedShowToast('已深入子级', 'info');
      } else {
        debouncedShowToast('无法缩小：已在最内层', 'error');
      }
    }

    function expandSelectionLevel() {
      if (!currentElement) return;

      let parent = currentElement.parentElement;
      while (parent && !isSelectable(parent)) {
        parent = parent.parentElement;
      }

      if (parent && parent !== document.documentElement && parent !== document.body) {
        currentElement = parent;
        navigationHistory.push(currentElement);
        updateHighlight(currentElement);
        debouncedShowToast('已扩大层级（选中父元素）', 'info');
      } else {
        debouncedShowToast('无法扩大：已经到达顶层', 'error');
      }
    }

    function isSelectable(el: HTMLElement): boolean {
      if (!el || el === overlay || el === highlightBox) return false;
      if (isOurUiElement(el)) return false;
      if (el === document.documentElement || el === document.body) return false;
      return true;
    }

    function isOurUiElement(el: HTMLElement | null): boolean {
      if (!el) return false;
      if (el.classList) {
        for (const cls of OUR_UI_CLASSES) {
          if (el.classList.contains(cls)) return true;
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

    function extractTitle(): string {
      const h1 = document.querySelector('h1');
      if (h1) return h1.textContent?.trim() || '未命名页面';
      return document.title || '未命名页面';
    }

    function createOverlay() {
      overlay = document.createElement('div');
      overlay.className = 'issue-manager-overlay';
      document.body.appendChild(overlay);
    }

    function removeOverlay() {
      if (overlay && overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
        overlay = null;
      }
    }

    function createHighlightBox() {
      highlightBox = document.createElement('div');
      highlightBox.className = 'issue-manager-highlight';
      document.body.appendChild(highlightBox);
    }

    function removeHighlightBox() {
      if (highlightBox && highlightBox.parentNode) {
        highlightBox.parentNode.removeChild(highlightBox);
        highlightBox = null;
      }
    }

    function updateHighlight(element: HTMLElement | null) {
      if (!highlightBox) return;
      if (!element) {
        highlightBox.style.display = 'none';
        return;
      }
      const rect = element.getBoundingClientRect();
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

      highlightBox.style.display = 'block';
      highlightBox.style.top = (rect.top + scrollTop) + 'px';
      highlightBox.style.left = (rect.left + scrollLeft) + 'px';
      highlightBox.style.width = rect.width + 'px';
      highlightBox.style.height = rect.height + 'px';
    }

    function showToast(message: string, type = 'info') {
      removeToast();

      const toast = document.createElement('div');
      toast.className = `issue-manager-toast issue-manager-toast-${type}`;
      toast.textContent = message;
      document.body.appendChild(toast);

      setTimeout(() => {
        removeToast();
      }, 3000);
    }

    function confirmSelection() {
      if (!currentElement) return;
      
      const html = currentElement.outerHTML;
      const title = extractTitle();
      const url = window.location.href;

      console.log('Element selected:', { html: html.substring(0, 100), title, url });

      chrome.runtime.sendMessage({
        type: 'CONTENT_SELECTED',
        data: { html, title, url }
      });

      debouncedShowToast('✓ 内容已选取，正在创建笔记...', 'success');

      setTimeout(() => {
        cancelSelectionMode();
      }, 1000);
    }

    function removeToast() {
      const existingToast = document.querySelector('.issue-manager-toast');
      if (existingToast && existingToast.parentNode) {
        existingToast.parentNode.removeChild(existingToast);
      }
    }

    function createControlPanel() {
      if (controlPanel) return;
      controlPanel = document.createElement('div');
      controlPanel.className = 'issue-manager-control';

      const confirmBtn = document.createElement('button');
      confirmBtn.className = 'issue-manager-control-confirm';
      confirmBtn.textContent = '确认';
      confirmBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!currentElement) {
          seedCurrentFromHoverOrCenter();
        }
        if (currentElement) {
          confirmSelection();
        } else {
          debouncedShowToast('请先选择一个元素,然后再点击确认。', 'error');
        }
      }, true);

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'issue-manager-control-cancel';
      cancelBtn.textContent = '重新选择';
      cancelBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        clearCurrentSelection();
        frozenByClick = false;
        keyboardNavigating = false;
        navigationHistory = [];
        debouncedShowToast('已取消当前选中,请移动鼠标重新选择;按 ESC 可退出。', 'info');
      }, true);

      controlPanel.appendChild(confirmBtn);
      controlPanel.appendChild(cancelBtn);
      document.body.appendChild(controlPanel);
    }

    function removeControlPanel() {
      if (controlPanel && controlPanel.parentNode) {
        controlPanel.parentNode.removeChild(controlPanel);
      }
      controlPanel = null;
    }

    function clearCurrentSelection() {
      currentElement = null;
      updateHighlight(null);
    }
  }
});
