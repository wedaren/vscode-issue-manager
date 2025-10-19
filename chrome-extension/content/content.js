/**
 * Content Script
 * 负责在网页中实现 DOM 选取功能
 */

// 幂等注入哨兵，避免重复注入
if (window.__ISSUE_MANAGER_CONTENT_INJECTED__) {
  // 已经注入过，直接返回（仍需保留监听器，避免重复）
  // 这里不抛错，允许后续 sendMessage 正常工作
} else {
  try {
    Object.defineProperty(window, '__ISSUE_MANAGER_CONTENT_INJECTED__', {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false
    });
  } catch (_) {
    // 某些 CSP 下 defineProperty 可能失败，降级处理
    window.__ISSUE_MANAGER_CONTENT_INJECTED__ = true;
  }
}

// 状态管理
let isSelectionMode = false;
let overlay = null;
let highlightBox = null;
let currentElement = null;
let hoverElement = null; // 鼠标悬停目标
let keyboardNavigating = false; // 键盘导航锁定：true 时鼠标移动不改变选中
let lastMouseX = 0;
let lastMouseY = 0;
const MOUSE_SWITCH_THRESHOLD = 8; // 像素阈值：超过则从键盘导航切回鼠标导航
let controlPanel = null; // 右上角确认/取消面板
let frozenByClick = false; // 点击后冻结鼠标对选中的影响，直到确认/取消或键盘微调
let navigationHistory = []; // 存储键盘导航路径，用于后退

const OUR_UI_CLASSES = ['issue-manager-overlay', 'issue-manager-highlight', 'issue-manager-toast', 'issue-manager-control'];

// --- 工具函数 ---

/**
 * 防抖函数
 * @param {Function} func 要执行的函数
 * @param {number} wait 等待时间（毫秒）
 * @returns {Function} 防抖处理后的函数
 */
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// 对 showToast 应用防抖
const debouncedShowToast = debounce(showToast, 500);

// -----------------

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
  frozenByClick = false; // 重置状态
  currentElement = null; // 重置状态
  navigationHistory = []; // 重置导航历史

  // 创建遮罩层
  createOverlay();
  
  // 创建高亮框（但此时不显示）
  createHighlightBox();

  // 绑定事件监听器
  document.addEventListener('mousemove', handleMouseMove, true);
  document.addEventListener('click', handleClick, true);
  document.addEventListener('keydown', handleKeyDown, true);
  // 同时在 window 层级捕获键盘，避免页面在 document 之前拦截
  window.addEventListener('keydown', handleKeyDown, true);

  // 尝试移除页面焦点，避免某些输入框或 iframe 抢占按键
  try {
    if (document.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }
    if (document.body && typeof document.body.focus === 'function') {
      document.body.focus();
    }
  } catch (_) {
    // 忽略聚焦相关异常
  }

  // 显示初始提示
  debouncedShowToast('请点击页面任意区域以选中内容');
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
  window.removeEventListener('keydown', handleKeyDown, true);

  // 移除 UI 元素
  removeOverlay();
  removeHighlightBox();
  removeToast();
  removeControlPanel();

  currentElement = null;
  frozenByClick = false;
  navigationHistory = [];
}

/**
 * 处理鼠标移动
 */
function handleMouseMove(event) {
  if (!isSelectionMode) {
    return;
  }

  event.stopPropagation();
  lastMouseX = event.clientX;
  lastMouseY = event.clientY;
  
  // 获取鼠标位置下的元素
  const element = document.elementFromPoint(event.clientX, event.clientY);
  
  if (!element || element === overlay || element === highlightBox) {
    return;
  }

  // 跳过我们自己创建的元素（包括控制面板、提示）
  if (isOurUiElement(element)) {
    return;
  }

  hoverElement = element;
  // 键盘导航时不自动改变 currentElement；当鼠标显著移动时，切回鼠标导航
  if (!keyboardNavigating) {
    currentElement = hoverElement;
    updateHighlight(currentElement);
  } else {
    // 点击冻结时，不因鼠标移动解锁
    if (!frozenByClick && hasMouseMovedSignificantly()) {
      keyboardNavigating = false;
      currentElement = hoverElement;
      updateHighlight(currentElement);
    }
  }
}

/**
 * 处理点击
 */
function handleClick(event) {
  if (!isSelectionMode) {
    return;
  }
  // 如果点击在我们的控制面板或自有 UI 上，不拦截，让按钮自身处理
  if (isOurUiElement(event.target)) {
    return;
  }
  // 阻止默认行为和事件传播，以完全控制点击
  event.preventDefault();
  event.stopPropagation();

  const el = document.elementFromPoint(event.clientX, event.clientY) || event.target;
  if (el && isSelectable(el)) {
    currentElement = el;
    navigationHistory = [currentElement]; // 每次点击都重置并设置导航历史起点
    updateHighlight(currentElement);

    // 如果是第一次点击（通过 frozenByClick 状态判断），则创建控制面板
    if (!frozenByClick) {
      createControlPanel();
      debouncedShowToast('已选中！方向键可微调，回车或点击“确认”完成。', 'info');
    } else {
      debouncedShowToast('已重新选择元素。', 'info');
    }

    // 点击后锁定为“键盘导航/冻结”模式，鼠标移动不再改变选中
    keyboardNavigating = true;
    frozenByClick = true;
  }
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
    event.stopImmediatePropagation();
    cancelSelectionMode();
    debouncedShowToast('已取消选取', 'info');
    return;
  }

  // Enter 确认当前选中
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

  // 方向键层级选择
  if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (!currentElement) {
      seedCurrentFromHoverOrCenter();
      if (!currentElement) { return; }
    }
    keyboardNavigating = true;
    // 键盘微调后仍保持冻结，直到用户再次点击或退出
    shrinkSelectionLevel();
    return;
  }
  if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (!currentElement) {
      seedCurrentFromHoverOrCenter();
      if (!currentElement) { return; }
    }
    keyboardNavigating = true;
    // 键盘微调后仍保持冻结，直到用户再次点击或退出
    expandSelectionLevel();
    return;
  }
}

/**
 * 将 currentElement 初始化为 hoverElement 或视口中心的元素
 */
function seedCurrentFromHoverOrCenter() {
  if (hoverElement && isSelectable(hoverElement)) {
    currentElement = hoverElement;
    updateHighlight(currentElement);
    return;
  }
  const centerX = Math.round(window.innerWidth / 2);
  const centerY = Math.round(window.innerHeight / 2);
  const el = document.elementFromPoint(centerX, centerY);
  if (el && isSelectable(el)) {
    currentElement = el;
    updateHighlight(currentElement);
  }
}

/**
 * 判断鼠标是否显著移动，超过阈值则认为用户希望切回鼠标导航
 */
function hasMouseMovedSignificantly() {
  const el = currentElement;
  if (!el) {
    return true;
  }
  const rect = el.getBoundingClientRect();
  // 如果鼠标离当前元素的矩形边界较远，也视为显著移动
  const dx = lastMouseX < rect.left ? rect.left - lastMouseX : (lastMouseX > rect.right ? lastMouseX - rect.right : 0);
  const dy = lastMouseY < rect.top ? rect.top - lastMouseY : (lastMouseY > rect.bottom ? lastMouseY - rect.bottom : 0);
  return (dx > MOUSE_SWITCH_THRESHOLD || dy > MOUSE_SWITCH_THRESHOLD);
}

/**
 * 尝试缩小选取层级：优先返回上一级，否则深入子级
 */
function shrinkSelectionLevel() {
  if (!currentElement) {
    return;
  }

  // 优先：如果可以返回，则返回
  if (navigationHistory.length > 1) {
    navigationHistory.pop(); // 移除当前层级
    currentElement = navigationHistory[navigationHistory.length - 1]; // 回到上一级
    updateHighlight(currentElement);
    debouncedShowToast('已返回上一级', 'info');
    return;
  }

  // 否则：尝试深入子级
  // 找当前元素中心点下的元素
  const rect = currentElement.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  
  let candidate = null;
  try {
    const el = document.elementFromPoint(centerX, centerY);
    if (el && currentElement.contains(el) && el !== currentElement && isSelectable(el)) {
      candidate = el;
    }
  } catch (e) {
    // ignore
  }

  // 如果没有找到合适的中心子元素，尝试第一个子元素
  if (!candidate) {
    candidate = Array.from(currentElement.children).find(isSelectable) || null;
  }

  if (candidate) {
    currentElement = candidate;
    navigationHistory.push(currentElement); // 深入子级，添加到历史
    updateHighlight(currentElement);
    debouncedShowToast('已深入子级', 'info');
  } else {
    debouncedShowToast('无法缩小：已在最内层', 'error');
  }
}

/**
 * 尝试扩大选取层级：选择父元素并记录到历史
 */
function expandSelectionLevel() {
  if (!currentElement) {
    return;
  }

  let parent = currentElement.parentElement;
  while (parent && !isSelectable(parent)) {
    parent = parent.parentElement;
  }

  if (parent && parent !== document.documentElement && parent !== document.body) {
    currentElement = parent;
    navigationHistory.push(currentElement); // 将新层级添加到历史记录
    updateHighlight(currentElement);
    debouncedShowToast('已扩大层级（选中父元素）', 'info');
  } else {
    debouncedShowToast('无法扩大：已经到达顶层', 'error');
  }
}

/**
 * 判断元素是否可被选作目标（排除我们创建的 UI 和文档根）
 */
function isSelectable(el) {
  if (!el || el === overlay || el === highlightBox) {
    return false;
  }
  if (isOurUiElement(el)) {
    return false;
  }
  if (el === document.documentElement || el === document.body) {
    return false;
  }
  return true;
}

/**
 * 判断是否为我们创建的 UI 元素
 */
function isOurUiElement(el) {
  if (!el) { return false; }
  if (el.classList) {
    for (const cls of OUR_UI_CLASSES) {
      if (el.classList.contains(cls)) { return true; }
    }
  }
  // 如果在控制面板内部，也视为自有 UI
  if (controlPanel && (el === controlPanel || (el.closest && el.closest('.issue-manager-control')))) {
    return true;
  }
  // 如果在提示元素内部
  const toast = document.querySelector('.issue-manager-toast');
  if (toast && (el === toast || (el.closest && el.closest('.issue-manager-toast')))) {
    return true;
  }
  return false;
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
 * 确认当前选中元素，将其发送给 Background 并结束选取
 */
function confirmSelection() {
  if (!currentElement) {
    return;
  }
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
  debouncedShowToast('✓ 内容已选取，正在创建笔记...', 'success');

  // 延迟取消选取模式
  setTimeout(() => {
    cancelSelectionMode();
  }, 1000);
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

/**
 * 创建右上角控制面板（确认/取消）
 */
function createControlPanel() {
  if (controlPanel) { return; }
  controlPanel = document.createElement('div');
  controlPanel.className = 'issue-manager-control';
  controlPanel.style.cssText = `
    position: fixed;
    top: 16px;
    right: 16px;
    z-index: 10000000;
    display: flex;
    gap: 8px;
    background: rgba(33, 37, 41, 0.9);
    padding: 8px 10px;
    border-radius: 8px;
    color: #fff;
    font-size: 13px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  `;

  const confirmBtn = document.createElement('button');
  confirmBtn.textContent = '确认';
  confirmBtn.style.cssText = `
    background: #28a745;
    color: #fff;
    border: none;
    border-radius: 6px;
    padding: 6px 12px;
    cursor: pointer;
    font-weight: 600;
  `;
  confirmBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!currentElement) {
      seedCurrentFromHoverOrCenter();
    }
    if (currentElement) {
      confirmSelection();
    } else {
      debouncedShowToast('请先选择一个元素，然后再点击确认。', 'error');
    }
  }, true);

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = '重新选择';
  cancelBtn.style.cssText = `
    background: #dc3545;
    color: #fff;
    border: none;
    border-radius: 6px;
    padding: 6px 12px;
    cursor: pointer;
    font-weight: 600;
  `;
  cancelBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    // 软取消：清空当前选中并解锁，继续处于选取模式
    clearCurrentSelection();
    frozenByClick = false;
    keyboardNavigating = false;
    navigationHistory = []; // 清空历史
    debouncedShowToast('已取消当前选中，请移动鼠标重新选择；按 ESC 可退出。', 'info');
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

/**
 * 清空当前选中并隐藏高亮
 */
function clearCurrentSelection() {
  currentElement = null;
  updateHighlight(null);
}
