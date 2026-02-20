/**
 * Content Script 主入口
 * 负责在网页中实现 DOM 选取功能和账号自动登录
 */

import './style.css';
import { resumeAccountSwitch, switchAccount } from './features/auth/accountSwitch';
import { autoLogin } from './features/auth/autoLogin';
import { type AccountSwitchState } from './features/auth/storage';
import { createSelectionState, startSelectionMode, cancelSelectionMode } from './features/selection';
import { TIMEOUTS, STORAGE_KEYS, LOGIN_PATH } from './config/constants';

interface PageSelectionData {
  text: string;
  html: string;
  title: string;
  url: string;
}

function getSelectionHtml(): string {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return '';
  }

  const container = document.createElement('div');
  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index);
    const fragment = range.cloneContents();
    container.appendChild(fragment);
  }

  return container.innerHTML;
}

function getPageSelectionData(): PageSelectionData {
  const selection = window.getSelection();
  const text = selection?.toString().trim() ?? '';
  const html = getSelectionHtml();

  return {
    text,
    html,
    title: document.title || '未命名页面',
    url: window.location.href,
  };
}

function getPageContentData(): PageSelectionData {
  return {
    text: document.body.innerText || '',
    html: document.body.innerHTML || '',
    title: document.title || '未命名页面',
    url: window.location.href,
  };
}

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

    // ===== 账号替换恢复检查 =====
    (async () => {
      try {
        const result = await chrome.storage.local.get(STORAGE_KEYS.accountSwitchState);
        const state: AccountSwitchState | undefined = result.accountSwitchState;

        if (!state || !state.inProgress) {
          return;
        }

        // 检查状态是否过期
        const isExpired = Date.now() - state.timestamp > TIMEOUTS.stateExpiry;
        if (isExpired) {
          console.log('[Account Switch] 恢复状态已过期,清除');
          await chrome.storage.local.remove(STORAGE_KEYS.accountSwitchState);
          return;
        }

        // 检查是否在登录页
        if (!window.location.pathname.includes(LOGIN_PATH)) {
          return;
        }

        console.log('[Account Switch] 检测到待恢复的账号替换操作');
        console.log('[Account Switch] 原始路径:', state.originalPath);

        // 等待页面加载完成后执行自动登录
        const executeResume = () => {
          setTimeout(() => {
            resumeAccountSwitch(state);
          }, TIMEOUTS.resumeDelay);
        };

        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', executeResume);
        } else {
          executeResume();
        }
      } catch (err) {
        console.error('[Account Switch] 检查恢复状态失败:', err);
      }
    })();

    // ===== 选取模式状态管理 =====
    const selectionState = createSelectionState();

    // ===== 消息监听 =====
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      console.log('Content script received message:', message);

      if (message.type === 'START_SELECTION') {
        console.log('Starting selection mode');
        startSelectionMode(selectionState);
        sendResponse({ success: true });
        return true;
      }

      if (message.type === 'START_LLM_SELECTION') {
        console.log('Starting LLM selection mode');
        startSelectionMode(selectionState, 'llm');
        sendResponse({ success: true });
        return true;
      }

      if (message.type === 'CANCEL_SELECTION') {
        console.log('Cancelling selection mode');
        cancelSelectionMode(selectionState);
        sendResponse({ success: true });
        return true;
      }

      if (message.type === 'GET_PAGE_SELECTION') {
        try {
          const data = getPageSelectionData();
          sendResponse({ success: true, data });
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          sendResponse({ success: false, error: errorMessage });
        }
        return true;
      }

      if (message.type === 'GET_PAGE_CONTENT') {
        try {
          const data = getPageContentData();
          sendResponse({ success: true, data });
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          sendResponse({ success: false, error: errorMessage });
        }
        return true;
      }

      if (message.type === 'AUTO_LOGIN') {
        console.log('Processing AUTO_LOGIN request');
        // 异步处理,需要返回 true 保持消息通道开启
        autoLogin(message.username, message.password)
          .then(() => {
            console.log('[Auto Login] 发送成功响应');
            sendResponse({ success: true });
          })
          .catch((error: Error) => {
            console.error('[Auto Login] 发送失败响应:', error.message);
            sendResponse({ success: false, error: error.message });
          });
        return true; // 重要:保持消息通道开启以支持异步响应
      }

      if (message.type === 'ACCOUNT_SWITCH') {
        console.log('Processing ACCOUNT_SWITCH request');
        // 账号替换功能 - 异步处理
        switchAccount(message.username, message.password)
          .then(() => {
            console.log('[Account Switch] 发送成功响应');
            sendResponse({ success: true });
          })
          .catch((error: Error) => {
            console.error('[Account Switch] 发送失败响应:', error.message);
            sendResponse({ success: false, error: error.message });
          });
        return true; // 保持消息通道开启
      }

      return false;
    });

    console.log('Issue Manager content script initialized');
  }
});
