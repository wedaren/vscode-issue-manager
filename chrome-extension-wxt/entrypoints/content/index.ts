/**
 * Content Script
 * 负责在网页中实现 DOM 选取功能
 */

import './style.css';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  allFrames: true,
  
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

    function debounce<T extends (...args: any[]) => void>(func: T, wait: number): (...args: Parameters<T>) => void {
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

    /**
     * 自动登录功能
     * 根据页面表单结构自动填充用户名和密码,并点击登录按钮
     */
    async function handleAutoLogin(username: string, password: string): Promise<void> {
      try {
        console.log('[Auto Login] 开始自动登录...');
        
        // 等待页面加载完成
        if (document.readyState !== 'complete') {
          console.log('[Auto Login] 等待页面加载...');
          await new Promise(resolve => {
            if (document.readyState === 'complete') {
              resolve(null);
            } else {
              window.addEventListener('load', () => resolve(null), { once: true });
              // 超时保护
              setTimeout(() => resolve(null), 5000);
            }
          });
        }

        console.log('[Auto Login] 页面已加载,查找表单元素...');

        // 查找用户名输入框 - 使用更宽松的选择器
        const usernameSelectors = [
          'input[name="username"]',
          'input[yotta-test="login-username-input"]',
          'input[type="text"][placeholder*="用户名"]',
          'input[type="text"][placeholder*="账号"]',
          'input[autocomplete="username"]',
          'input[id*="username"]',
          'input[id*="user"]',
          'input[class*="username"]'
        ];

        let usernameInput: HTMLInputElement | null = null;
        for (const selector of usernameSelectors) {
          usernameInput = document.querySelector<HTMLInputElement>(selector);
          if (usernameInput) {
            console.log('[Auto Login] 找到用户名输入框:', selector);
            break;
          }
        }
        
        if (!usernameInput) {
          throw new Error('未找到用户名输入框');
        }

        // 查找密码输入框
        const passwordSelectors = [
          'input[name="password"]',
          'input[yotta-test="login-password-input"]',
          'input[type="password"]',
          'input[autocomplete="current-password"]',
          'input[id*="password"]',
          'input[id*="passwd"]',
          'input[class*="password"]'
        ];

        let passwordInput: HTMLInputElement | null = null;
        for (const selector of passwordSelectors) {
          passwordInput = document.querySelector<HTMLInputElement>(selector);
          if (passwordInput) {
            console.log('[Auto Login] 找到密码输入框:', selector);
            break;
          }
        }
        
        if (!passwordInput) {
          throw new Error('未找到密码输入框');
        }

        console.log('[Auto Login] 开始填充表单...');

        // 填充用户名
        usernameInput.focus();
        usernameInput.value = username;
        usernameInput.dispatchEvent(new Event('input', { bubbles: true }));
        usernameInput.dispatchEvent(new Event('change', { bubbles: true }));
        usernameInput.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));

        // 填充密码
        passwordInput.focus();
        passwordInput.value = password;
        passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
        passwordInput.dispatchEvent(new Event('change', { bubbles: true }));
        passwordInput.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));

        console.log('[Auto Login] 表单填充完成,等待...');

        // 等待一小段时间,确保输入事件被处理
        await new Promise(resolve => setTimeout(resolve, 500));

        // 查找并点击登录按钮
        const buttonSelectors = [
          'button[type="submit"]',
          'button[yotta-test="login-login-button"]',
          'button.yotta-button-primary',
          'input[type="submit"]',
          'button:has-text("登录")',
          'button:has-text("Login")',
          'a:has-text("登录")'
        ];

        let loginButton: HTMLElement | null = null;
        for (const selector of buttonSelectors) {
          try {
            loginButton = document.querySelector<HTMLElement>(selector);
            if (loginButton) {
              console.log('[Auto Login] 找到登录按钮:', selector);
              break;
            }
          } catch (e) {
            // 某些选择器可能不支持(如 :has-text)
            continue;
          }
        }

        // 如果没找到按钮,尝试查找包含"登录"文字的按钮
        if (!loginButton) {
          const allButtons = Array.from(document.querySelectorAll<HTMLElement>('button, input[type="submit"]'));
          loginButton = allButtons.find(btn => 
            btn.textContent?.includes('登录') || 
            btn.textContent?.includes('Login') ||
            btn.getAttribute('value')?.includes('登录')
          ) || null;
          
          if (loginButton) {
            console.log('[Auto Login] 通过文本找到登录按钮');
          }
        }

        if (loginButton) {
          console.log('[Auto Login] 点击登录按钮...');
          loginButton.click();
          console.log('[Auto Login] 自动登录完成');
        } else {
          // 如果没有找到登录按钮,尝试提交表单
          const form = usernameInput.closest('form');
          if (form) {
            console.log('[Auto Login] 未找到登录按钮,提交表单...');
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            // 如果 submit 事件没被阻止,直接调用 submit
            setTimeout(() => {
              if (form.checkValidity()) {
                form.submit();
              }
            }, 100);
            console.log('[Auto Login] 表单已提交');
          } else {
            console.warn('[Auto Login] 未找到登录按钮或表单,但已填充账号密码');
          }
        }

      } catch (error) {
        console.error('[Auto Login] 自动登录失败:', error);
        throw error;
      }
    }

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      console.log('Content Script received message:', message);

      switch (message.type) {
        case 'START_SELECTION':
          startSelectionMode();
          sendResponse({ success: true });
          return false;

        case 'CANCEL_SELECTION':
          cancelSelectionMode();
          sendResponse({ success: true });
          return false;

        case 'AUTO_LOGIN':
          // 异步处理,需要返回 true 保持消息通道开启
          handleAutoLogin(message.username, message.password)
            .then(() => {
              console.log('[Auto Login] 发送成功响应');
              sendResponse({ success: true });
            })
            .catch((error: Error) => {
              console.error('[Auto Login] 发送失败响应:', error.message);
              sendResponse({ success: false, error: error.message });
            });
          return true; // 重要:保持消息通道开启以支持异步响应

        default:
          console.warn('Unknown message type:', message.type);
          sendResponse({ success: false });
          return false;
      }
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
