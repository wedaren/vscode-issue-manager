/**
 * Content Script 主入口
 * 负责在网页中实现 DOM 选取功能和账号自动登录
 */

import './style.css';
import { resumeAccountSwitch, switchAccount } from './features/auth/accountSwitch';
import { autoLogin } from './features/auth/autoLogin';
import { type AccountSwitchState } from './features/auth/storage';
import { createSelectionState, startSelectionMode, cancelSelectionMode } from './features/selection';
import { showQuickPick } from './features/selection/ui/quickpick';
import { TIMEOUTS, STORAGE_KEYS, LOGIN_PATH } from './config/constants';
import { getTextNodes, removeTextNodes } from './features/selection/textNodes';

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
    const translateAccumulator = new Map<string, string>();

    // ===== 快捷命令面板: Cmd+Shift+P =====
    window.addEventListener('keydown', (e) => {
      // 忽略输入框中的快捷键
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || (tgt as HTMLElement).isContentEditable)) {
        return;
      }

      if (e.metaKey && e.shiftKey && e.code === 'KeyP') {
        e.preventDefault();
        const commands = [
          { id: 'start_selection', label: '进入选取模式', description: '进入页面选取模式' },
          { id: 'start_llm_selection', label: '进入 LLM 选取', description: '用于 LLM 的选取模式' },
          { id: 'get_page_selection', label: '显示当前选中内容', description: '打印当前选中文本' },
          { id: 'get_page_content', label: '获取页面内容信息', description: '显示页面标题与长度' },
          { id: 'create_note', label: '从页面创建笔记', description: '将页面内容发送到 VSCode 创建笔记' },
          { id: 'create_note_from_selection', label: '从选中内容创建笔记', description: '将当前选中的内容发送到 VSCode 创建笔记' },
          { id: 'export_png', label: '导出为图片 (PNG 截图)', description: '截取当前可见页面并下载 PNG' },
          { id: 'export_pdf', label: '以 PDF 打印页面', description: '调用浏览器打印对话以保存为 PDF' }
        ];

        console.log('[QuickPick] commands to show:', commands.length, commands.map(c=>c.id));
        showQuickPick(commands, (id) => {
          try {
            if (id === 'start_selection') {
              startSelectionMode(selectionState);
            } else if (id === 'start_llm_selection') {
              startSelectionMode(selectionState, 'llm');
            } else if (id === 'get_page_selection') {
              const data = getPageSelectionData();
              console.log('[QuickPick] page selection', data);
              chrome.runtime.sendMessage({ type: 'SHOW_TOAST', level: 'info', text: `选中内容长度: ${String((data.text || '').length)}` });
            } else if (id === 'get_page_content') {
              const data = getPageContentData();
              console.log('[QuickPick] page content', data);
              chrome.runtime.sendMessage({ type: 'SHOW_TOAST', level: 'info', text: `标题: ${data.title} · 文本长度: ${String(data.text.length)}` });
            } else if (id === 'create_note') {
              // Gather page content and send to background to create a note
              try {
                const page = getPageContentData();
                chrome.runtime.sendMessage({ type: 'CONTENT_SELECTED', data: { html: page.html, title: page.title, url: page.url } }, (resp) => {
                  try {
                    if (resp && resp.success) {
                      chrome.runtime.sendMessage({ type: 'SHOW_TOAST', level: 'success', text: '已发送创建笔记请求，稍后在 VSCode 中查看' });
                    } else {
                      const err = resp && (resp.error || JSON.stringify(resp));
                      chrome.runtime.sendMessage({ type: 'SHOW_TOAST', level: 'error', text: '创建笔记请求失败: ' + String(err) });
                    }
                  } catch (e) {
                    console.error('create_note response handling error', e);
                  }
                });
              } catch (err) {
                console.error('create_note error', err);
                chrome.runtime.sendMessage({ type: 'SHOW_TOAST', level: 'error', text: '无法获取页面内容' });
              }
            } else if (id === 'create_note_from_selection') {
              try {
                const sel = getPageSelectionData();
                if (!sel.text && !sel.html) {
                  chrome.runtime.sendMessage({ type: 'SHOW_TOAST', level: 'error', text: '没有检测到选中内容' });
                } else {
                  chrome.runtime.sendMessage({ type: 'CONTENT_SELECTED', data: { html: sel.html || sel.text, title: sel.title, url: sel.url } }, (resp) => {
                    if (resp && resp.success) {
                      chrome.runtime.sendMessage({ type: 'SHOW_TOAST', level: 'success', text: '已发送选中内容创建笔记请求' });
                    } else {
                      chrome.runtime.sendMessage({ type: 'SHOW_TOAST', level: 'error', text: '创建笔记请求失败' });
                    }
                  });
                }
              } catch (err) {
                console.error('create_note_from_selection error', err);
                chrome.runtime.sendMessage({ type: 'SHOW_TOAST', level: 'error', text: '无法读取选中内容' });
              }
              } else if (id === 'export_page') {
                try {
                  const page = getPageContentData();
                  const filename = (page.title || 'page').replace(/[^\w\-\u4e00-\u9fa5\. ]+/g, '_').slice(0, 120) + '.html';
                  const blob = new Blob([page.html || '<!-- empty -->'], { type: 'text/html;charset=utf-8' });
                  const href = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = href;
                  a.download = filename;
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                  setTimeout(() => URL.revokeObjectURL(href), 2000);
                  chrome.runtime.sendMessage({ type: 'SHOW_TOAST', level: 'success', text: `已开始下载：${filename}` });
                } catch (err) {
                  console.error('export_page error', err);
                  chrome.runtime.sendMessage({ type: 'SHOW_TOAST', level: 'error', text: '导出页面失败' });
                }
              } else if (id === 'export_png') {
                // Request background to capture visible tab as PNG
                try {
                  chrome.runtime.sendMessage({ type: 'CAPTURE_VISIBLE_TAB' }, (resp) => {
                    try {
                      if (resp && resp.dataUrl) {
                        const dataUrl = resp.dataUrl as string;
                        const filename = (document.title || 'screenshot').replace(/[^\\w\\-\\u4e00-\\u9fa5\\. ]+/g, '_').slice(0, 120) + '.png';
                        const a = document.createElement('a');
                        a.href = dataUrl;
                        a.download = filename;
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                        chrome.runtime.sendMessage({ type: 'SHOW_TOAST', level: 'success', text: `已开始下载截图：${filename}` });
                      } else {
                        chrome.runtime.sendMessage({ type: 'SHOW_TOAST', level: 'error', text: '截屏失败：未收到数据' });
                      }
                    } catch (e) {
                      console.error('export_png response handling error', e);
                      chrome.runtime.sendMessage({ type: 'SHOW_TOAST', level: 'error', text: '截屏处理失败' });
                    }
                  });
                } catch (err) {
                  console.error('export_png error', err);
                  chrome.runtime.sendMessage({ type: 'SHOW_TOAST', level: 'error', text: '截屏请求失败' });
                }
              } else if (id === 'export_pdf') {
                try {
                  // Trigger browser print dialog; user can choose Save as PDF
                  window.print();
                  chrome.runtime.sendMessage({ type: 'SHOW_TOAST', level: 'info', text: '打开打印对话，请选择 “保存为 PDF”' });
                } catch (err) {
                  console.error('export_pdf error', err);
                  chrome.runtime.sendMessage({ type: 'SHOW_TOAST', level: 'error', text: '无法打开打印对话' });
                }
              }
          } catch (err) {
            console.error('[QuickPick] command handler error', err);
          }
        });
      }
    });

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

      if (message.type === 'START_TRANSLATE_SELECTION') {
        console.log('Starting translate selection mode');
        startSelectionMode(selectionState, 'translate');
        sendResponse({ success: true });
        return true;
      }

      if (message.type === 'LLM_PUSH') {
        const payload = message.payload;
        if (!payload) { return false; }

        // 此处的 message 额外包含了从 background 透传的 translateBlockId
        const translateBlockId = message.translateBlockId;
        if (!translateBlockId) { return false; }

        const targetEl = document.querySelector(`[data-translate-id="${translateBlockId}"]`) as HTMLElement;
        if (!targetEl) { return false; }

        const textNodes = getTextNodes(translateBlockId);
        if (!textNodes) { return false; }

        // 如果是最终回复
        if (typeof payload.reply === 'string') {
          translateAccumulator.delete(translateBlockId);
          removeTextNodes(translateBlockId);
          if (targetEl) { targetEl.classList.remove('issue-manager-translating-pulse'); }

          let finalHtml = payload.reply.replace(/^```html\n?/i, '').replace(/```$/i, '').replace(/^```xml\n?/i, '');
          const regex = /<t id="(\d+)">([\s\S]*?)(?:<\/t>|$)/g;
          let match;
          while ((match = regex.exec(finalHtml)) !== null) {
            const id = parseInt(match[1]);
            const text = match[2];
            if (textNodes[id]) {
              const original = textNodes[id].original;
              const leadSpace = original.match(/^(\s+)/)?.[1] || '';
              const trailSpace = original.match(/(\s+)$/)?.[1] || '';
              textNodes[id].node.textContent = leadSpace + text + trailSpace;
            }
          }
        }
        // 报错处理
        else if (payload.event === 'error') {
          translateAccumulator.delete(translateBlockId);
          removeTextNodes(translateBlockId);
          if (targetEl) {
            targetEl.classList.remove('issue-manager-translating-pulse');
            targetEl.style.outline = '2px solid red';
          }
        }
        // 分块提示，产生打字机特效
        else if (payload.chunk) {
          const prev = translateAccumulator.get(translateBlockId) || '';
          const newHtml = prev + payload.chunk;
          translateAccumulator.set(translateBlockId, newHtml);

          const regex = /<t id="(\d+)">([\s\S]*?)(?:<\/t>|$)/g;
          let match;
          while ((match = regex.exec(newHtml)) !== null) {
            const id = parseInt(match[1]);
            const text = match[2];
            if (textNodes[id]) {
              const original = textNodes[id].original;
              const leadSpace = original.match(/^(\s+)/)?.[1] || '';
              const trailSpace = original.match(/(\s+)$/)?.[1] || '';
              textNodes[id].node.textContent = leadSpace + text + trailSpace;
            }
          }
        }

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
