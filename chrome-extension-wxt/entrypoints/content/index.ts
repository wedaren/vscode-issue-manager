/**
 * Content Script 主入口
 * 负责在网页中实现 DOM 选取功能和账号自动登录
 */

import './style.css';
import { resumeAccountSwitch, switchAccount } from './features/auth/accountSwitch';
import { autoLogin } from './features/auth/autoLogin';
import { createSelectionState, startSelectionMode, cancelSelectionMode } from './features/selection';

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
    chrome.storage.local.get('accountSwitchState').then(result => {
      const state = result.accountSwitchState;
      if (state && state.inProgress) {
        // 检查状态是否过期(超过5分钟)
        const isExpired = Date.now() - state.timestamp > 5 * 60 * 1000;
        if (isExpired) {
          console.log('[Account Switch] 恢复状态已过期,清除');
          chrome.storage.local.remove('accountSwitchState');
          return;
        }

        // 检查是否在登录页
        if (window.location.pathname.includes('/auth/login/')) {
          console.log('[Account Switch] 检测到待恢复的账号替换操作');
          console.log('[Account Switch] 原始路径:', state.originalPath);
          
          // 等待页面加载完成后执行自动登录
          if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
              setTimeout(() => {
                resumeAccountSwitch(state);
              }, 500);
            });
          } else {
            setTimeout(() => {
              resumeAccountSwitch(state);
            }, 500);
          }
        }
      }
    }).catch(err => {
      console.error('[Account Switch] 检查恢复状态失败:', err);
    });

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

      if (message.type === 'CANCEL_SELECTION') {
        console.log('Cancelling selection mode');
        cancelSelectionMode(selectionState);
        sendResponse({ success: true });
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
