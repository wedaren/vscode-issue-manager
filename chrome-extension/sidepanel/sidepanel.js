/**
 * Side Panel 脚本
 * 负责处理用户交互和显示状态
 */

/**
 * 简单的 Markdown 解析器
 */
function parseMarkdown(markdown) {
  if (!markdown) return '';
  
  let html = markdown;
  
  // 转义 HTML 特殊字符
  const escapeMap = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;'
  };
  html = html.replace(/[&<>]/g, char => escapeMap[char] || char);
  
  // 代码块
  html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
  
  // 行内代码
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  
  // 标题
  html = html.replace(/^### (.*$)/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gm, '<h1>$1</h1>');
  
  // 粗体和斜体
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  
  // 链接
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  
  // 引用块
  html = html.replace(/^> (.*$)/gm, '<blockquote>$1</blockquote>');
  
  // 无序列表
  html = html.replace(/^\- (.*$)/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
  
  // 有序列表
  html = html.replace(/^\d+\. (.*$)/gm, '<li>$1</li>');
  
  // 段落
  html = html.replace(/\n\n/g, '</p><p>');
  html = '<p>' + html + '</p>';
  
  // 清理多余的空段落
  html = html.replace(/<p><\/p>/g, '');
  html = html.replace(/<p>(<h[123]>)/g, '$1');
  html = html.replace(/(<\/h[123]>)<\/p>/g, '$1');
  html = html.replace(/<p>(<pre>)/g, '$1');
  html = html.replace(/(<\/pre>)<\/p>/g, '$1');
  html = html.replace(/<p>(<ul>)/g, '$1');
  html = html.replace(/(<\/ul>)<\/p>/g, '$1');
  html = html.replace(/<p>(<blockquote>)/g, '$1');
  html = html.replace(/(<\/blockquote>)<\/p>/g, '$1');
  
  return html;
}

// DOM 元素
const startBtn = document.getElementById('start-selection-btn');
const cancelBtn = document.getElementById('cancel-selection-btn');
const openIssueDirBtn = document.getElementById('open-issue-dir-btn');
const refreshFocusedBtn = document.getElementById('refresh-focused-btn');
const focusedList = document.getElementById('focused-list');
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
  refreshFocusedBtn.addEventListener('click', loadFocusedIssues);
  
  // 监听来自 Background 的消息
  chrome.runtime.onMessage.addListener(handleBackgroundMessage);
  
  // 查询当前 WebSocket 状态
  queryWsStatus();
  
  // 加载关注问题
  loadFocusedIssues();
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

/**
 * 加载关注问题列表
 */
async function loadFocusedIssues() {
  console.log('Loading focused issues...');
  
  // 显示加载状态
  focusedList.innerHTML = '<div class="loading">加载中...</div>';
  
  try {
    const response = await chrome.runtime.sendMessage({ 
      type: 'GET_FOCUSED_ISSUES'
    });
    
    if (response && response.success) {
      displayFocusedIssues(response.data);
    } else {
      displayFocusedError(response.error || '加载关注问题失败');
    }
  } catch (error) {
    console.error('Failed to load focused issues:', error);
    displayFocusedError('无法连接到 VSCode，请确保 VSCode 已打开且 Issue Manager 扩展已启用');
  }
}

/**
 * 显示关注问题树结构
 */
function displayFocusedIssues(issueTree) {
  if (!issueTree || issueTree.length === 0) {
    focusedList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📭</div>
        <div class="empty-state-text">暂无关注问题<br>在 VSCode 中添加关注后将在此显示</div>
      </div>
    `;
    return;
  }
  
  focusedList.innerHTML = '';
  
  // 渲染每个根节点的树结构
  issueTree.forEach(rootNode => {
    const treeElement = renderTreeNode(rootNode, 0);
    focusedList.appendChild(treeElement);
  });
}

/**
 * 渲染树节点（递归）
 */
function renderTreeNode(node, level) {
  const nodeDiv = document.createElement('div');
  nodeDiv.className = 'tree-node';
  nodeDiv.dataset.id = node.id;
  
  // 节点头部（标题和折叠按钮）
  const headerDiv = document.createElement('div');
  headerDiv.className = 'tree-node-header';
  
  // 折叠/展开图标
  const hasChildren = node.children && node.children.length > 0;
  const toggleSpan = document.createElement('span');
  toggleSpan.className = 'tree-node-toggle';
  toggleSpan.textContent = hasChildren ? (node.expanded !== false ? '▼' : '▶') : '•';
  
  // 标题
  const titleSpan = document.createElement('span');
  titleSpan.className = 'tree-node-title';
  titleSpan.textContent = node.title;
  
  headerDiv.appendChild(toggleSpan);
  headerDiv.appendChild(titleSpan);
  
  // 内容区域（markdown）
  const contentDiv = document.createElement('div');
  contentDiv.className = 'tree-node-content';
  contentDiv.style.display = node.expanded !== false ? 'block' : 'none';
  
  // 渲染 markdown
  if (node.content) {
    const markdownDiv = document.createElement('div');
    markdownDiv.className = 'markdown-body';
    markdownDiv.innerHTML = parseMarkdown(node.content);
    contentDiv.appendChild(markdownDiv);
  }
  
  // 子节点容器
  const childrenDiv = document.createElement('div');
  childrenDiv.className = 'tree-node-children';
  childrenDiv.style.display = node.expanded !== false && hasChildren ? 'block' : 'none';
  
  if (hasChildren) {
    node.children.forEach(child => {
      const childElement = renderTreeNode(child, level + 1);
      childrenDiv.appendChild(childElement);
    });
  }
  
  // 点击头部切换展开/折叠
  headerDiv.addEventListener('click', (e) => {
    e.stopPropagation();
    const isExpanded = contentDiv.style.display !== 'none';
    contentDiv.style.display = isExpanded ? 'none' : 'block';
    childrenDiv.style.display = isExpanded ? 'none' : 'block';
    toggleSpan.textContent = hasChildren ? (isExpanded ? '▶' : '▼') : '•';
  });
  
  nodeDiv.appendChild(headerDiv);
  nodeDiv.appendChild(contentDiv);
  if (hasChildren) {
    nodeDiv.appendChild(childrenDiv);
  }
  
  return nodeDiv;
}

/**
 * 显示关注问题加载错误
 */
function displayFocusedError(errorMessage) {
  focusedList.innerHTML = `
    <div class="empty-state">
      <div class="empty-state-icon">⚠️</div>
      <div class="empty-state-text">${escapeHtml(errorMessage)}</div>
    </div>
  `;
}


