/**
 * Content Script
 * 负责在网页中实现 DOM 选取功能
 */

// 状态管理
let isSelectionMode = false;
let overlay = null;
let highlightBox = null;
let currentElement = null;

// 监听来自 Background Script 的消息
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

/**
 * 开始选取模式
 */
function startSelectionMode() {
  if (isSelectionMode) {
    return;
  }

  console.log('Starting selection mode');
  isSelectionMode = true;

  // 创建遮罩层
  createOverlay();
  
  // 创建高亮框
  createHighlightBox();

  // 绑定事件监听器
  document.addEventListener('mousemove', handleMouseMove, true);
  document.addEventListener('click', handleClick, true);
  document.addEventListener('keydown', handleKeyDown, true);

  // 显示提示
  showToast('请选择要保存的内容，按 ESC 取消');
}

/**
 * 取消选取模式
 */
function cancelSelectionMode() {
  if (!isSelectionMode) {
    return;
  }

  console.log('Cancelling selection mode');
  isSelectionMode = false;

  // 移除事件监听器
  document.removeEventListener('mousemove', handleMouseMove, true);
  document.removeEventListener('click', handleClick, true);
  document.removeEventListener('keydown', handleKeyDown, true);

  // 移除 UI 元素
  removeOverlay();
  removeHighlightBox();
  removeToast();

  currentElement = null;
}

/**
 * 处理鼠标移动
 */
function handleMouseMove(event) {
  if (!isSelectionMode) {
    return;
  }

  event.stopPropagation();
  
  // 获取鼠标位置下的元素
  const element = document.elementFromPoint(event.clientX, event.clientY);
  
  if (!element || element === overlay || element === highlightBox) {
    return;
  }

  // 跳过我们自己创建的元素
  if (element.classList.contains('issue-manager-overlay') || 
      element.classList.contains('issue-manager-highlight')) {
    return;
  }

  currentElement = element;
  updateHighlight(element);
}

/**
 * 处理点击
 */
function handleClick(event) {
  if (!isSelectionMode || !currentElement) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  // 提取选中元素的内容
  const html = currentElement.outerHTML;
  const title = extractTitle();
  const url = window.location.href;

  console.log('Element selected:', { html: html.substring(0, 100), title, url });

  // 发送到 Background Script
  chrome.runtime.sendMessage({
    type: 'CONTENT_SELECTED',
    data: { html, title, url }
  });

  // 显示成功提示
  showToast('✓ 内容已选取，正在创建笔记...', 'success');

  // 延迟取消选取模式
  setTimeout(() => {
    cancelSelectionMode();
  }, 1000);
}

/**
 * 处理键盘按键
 */
function handleKeyDown(event) {
  if (!isSelectionMode) {
    return;
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    cancelSelectionMode();
    showToast('已取消选取', 'info');
  }
}

/**
 * 提取页面标题
 */
function extractTitle() {
  // 优先使用 h1 标签
  const h1 = document.querySelector('h1');
  if (h1) {
    return h1.textContent.trim();
  }

  // 其次使用 title 标签
  return document.title || '未命名页面';
}

/**
 * 创建遮罩层
 */
function createOverlay() {
  overlay = document.createElement('div');
  overlay.className = 'issue-manager-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.3);
    z-index: 999998;
    pointer-events: none;
  `;
  document.body.appendChild(overlay);
}

/**
 * 移除遮罩层
 */
function removeOverlay() {
  if (overlay && overlay.parentNode) {
    overlay.parentNode.removeChild(overlay);
    overlay = null;
  }
}

/**
 * 创建高亮框
 */
function createHighlightBox() {
  highlightBox = document.createElement('div');
  highlightBox.className = 'issue-manager-highlight';
  highlightBox.style.cssText = `
    position: absolute;
    border: 3px solid #667eea;
    background: rgba(102, 126, 234, 0.1);
    pointer-events: none;
    z-index: 999999;
    transition: all 0.1s ease;
    display: none;
  `;
  document.body.appendChild(highlightBox);
}

/**
 * 移除高亮框
 */
function removeHighlightBox() {
  if (highlightBox && highlightBox.parentNode) {
    highlightBox.parentNode.removeChild(highlightBox);
    highlightBox = null;
  }
}

/**
 * 更新高亮框位置
 */
function updateHighlight(element) {
  if (!highlightBox) {
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

/**
 * 显示提示消息
 */
function showToast(message, type = 'info') {
  // 移除已存在的提示
  removeToast();

  const toast = document.createElement('div');
  toast.className = 'issue-manager-toast';
  
  const bgColor = {
    info: '#667eea',
    success: '#28a745',
    error: '#dc3545'
  }[type] || '#667eea';

  toast.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: ${bgColor};
    color: white;
    padding: 12px 24px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    z-index: 9999999;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    animation: slideDown 0.3s ease;
  `;
  
  toast.textContent = message;
  document.body.appendChild(toast);

  // 3秒后自动移除
  setTimeout(() => {
    removeToast();
  }, 3000);
}

/**
 * 移除提示消息
 */
function removeToast() {
  const existingToast = document.querySelector('.issue-manager-toast');
  if (existingToast && existingToast.parentNode) {
    existingToast.parentNode.removeChild(existingToast);
  }
}
