/**
 * Side Panel 脚本
 * 负责处理用户交互和显示状态
 */

// DOM 元素
const startBtn = document.getElementById('start-selection-btn');
const cancelBtn = document.getElementById('cancel-selection-btn');
const openIssueDirBtn = document.getElementById('open-issue-dir-btn');
const statusText = document.getElementById('status-text');
const statusDiv = document.getElementById('status');
const messageDiv = document.getElementById('message');
const wsStatusDiv = document.getElementById('ws-status');
const wsStatusText = document.getElementById('ws-status-text');

// 使用 vscode:// URI scheme 打开 VSCode 并执行命令
// 格式: vscode://publisher.extensionName/path
const VSCODE_OPEN_DIR_URI = 'vscode://wedaren.issue-manager/open-issue-dir';

// 状态管理
let isSelecting = false;

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  console.log('Side Panel loaded');
  
  // 绑定事件监听器
  startBtn.addEventListener('click', handleStartSelection);
  cancelBtn.addEventListener('click', handleCancelSelection);
  openIssueDirBtn.addEventListener('click', handleOpenIssueDir);
  
  // 监听来自 Background 的消息
  chrome.runtime.onMessage.addListener(handleBackgroundMessage);
  
  // 查询当前 WebSocket 状态
  queryWsStatus();
});

/**
 * 处理开始选取按钮点击
 */
async function handleStartSelection() {
  console.log('Start selection clicked');
  
  try {
    // 获取当前活动标签页
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab?.id) {
      showMessage('无法获取当前标签页', 'error');
      return;
    }

    // 发送消息到 Background Script
    const response = await chrome.runtime.sendMessage({
      type: 'START_SELECTION',
      tabId: tab.id
    });

    if (response.success) {
      setSelectingState(true);
      showMessage('请在页面上选取内容', 'success');
    } else {
      showMessage('启动选取模式失败', 'error');
    }
  } catch (error) {
    console.error('Failed to start selection:', error);
    showMessage('启动选取模式失败: ' + error.message, 'error');
  }
}

/**
 * 处理取消选取按钮点击
 */
async function handleCancelSelection() {
  console.log('Cancel selection clicked');
  
  try {
    // 获取当前活动标签页，尽量保证与开始时相同窗口
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.runtime.sendMessage({
      type: 'CANCEL_SELECTION',
      tabId: tab?.id
    });
    
    setSelectingState(false);
    showMessage('已取消选取', 'success');
  } catch (error) {
    console.error('Failed to cancel selection:', error);
    showMessage('取消选取失败', 'error');
  }
}

/**
 * 处理打开问题目录按钮点击
 */
function handleOpenIssueDir() {
  console.log('Open issue directory clicked');
  
  try {
    // 在新标签页中打开 VSCode URI
    window.open(VSCODE_OPEN_DIR_URI, '_blank');
    
    showMessage('正在打开 VSCode 问题目录...', 'success');
  } catch (error) {
    console.error('Failed to open issue directory:', error);
    showMessage('打开问题目录失败: ' + error.message, 'error');
  }
}

/**
 * 处理来自 Background 的消息
 */
function handleBackgroundMessage(message) {
  if (!message || !message.type) {
    return;
  }

  switch (message.type) {
    case 'CREATION_SUCCESS':
      setSelectingState(false);
      showMessage('✅ 笔记创建成功！', 'success');
      break;
      
    case 'CREATION_ERROR':
      setSelectingState(false);
      showMessage('❌ ' + (message.error || '创建笔记失败'), 'error');
      break;
      
    case 'WS_CONNECTED':
      updateWsStatus('connected');
      break;
      
    case 'WS_DISCONNECTED':
      updateWsStatus('disconnected');
      break;
      
    default:
      console.log('Unknown message type:', message.type);
  }
}

/**
 * 设置选取状态
 */
function setSelectingState(selecting) {
  isSelecting = selecting;
  
  if (selecting) {
    // 选取中状态
    startBtn.style.display = 'none';
    cancelBtn.style.display = 'block';
    statusText.textContent = '选取中...';
    statusDiv.classList.add('selecting');
  } else {
    // 就绪状态
    startBtn.style.display = 'block';
    cancelBtn.style.display = 'none';
    statusText.textContent = '就绪';
    statusDiv.classList.remove('selecting', 'error');
  }
}

/**
 * 显示消息
 */
function showMessage(text, type = 'success') {
  messageDiv.textContent = text;
  messageDiv.className = `message ${type}`;
  messageDiv.style.display = 'block';
  
  if (type === 'error') {
    statusDiv.classList.add('error');
  }
  
  // 3秒后自动隐藏消息
  setTimeout(() => {
    messageDiv.style.display = 'none';
    if (type === 'error') {
      statusDiv.classList.remove('error');
    }
  }, 3000);
}

/**
 * 更新 WebSocket 连接状态
 */
function updateWsStatus(status) {
  // 移除所有状态类
  wsStatusDiv.classList.remove('connected', 'disconnected', 'connecting');
  
  switch (status) {
    case 'connected':
      wsStatusDiv.classList.add('connected');
      wsStatusText.textContent = '已连接';
      break;
      
    case 'disconnected':
      wsStatusDiv.classList.add('disconnected');
      wsStatusText.textContent = '已断开';
      break;
      
    case 'connecting':
      wsStatusDiv.classList.add('connecting');
      wsStatusText.textContent = '连接中';
      break;
      
    default:
      wsStatusText.textContent = '未知';
  }
}

/**
 * 查询当前 WebSocket 连接状态
 */
async function queryWsStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_WS_STATUS' });
    if (response && response.status) {
      updateWsStatus(response.status);
    } else {
      updateWsStatus('connecting');
    }
  } catch (error) {
    console.error('Failed to query WebSocket status:', error);
    updateWsStatus('disconnected');
  }
}
