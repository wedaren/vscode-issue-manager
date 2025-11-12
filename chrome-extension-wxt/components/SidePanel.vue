<template>
  <div class="container fullscreen-focused">
    <!-- 自动登录工具视图 -->
    <AutoLoginPanel v-if="showAutoLogin" @back="showAutoLogin = false" />
    
    <!-- 关注问题视图 - 全屏模式 -->
    <div v-else class="focused-section-fullscreen">
      <div class="section-header-fullscreen">
        <h2>
          <span class="section-icon">⭐</span>
          关注问题
        </h2>
        <div class="header-actions">
          <button 
            id="auto-login-btn" 
            class="action-btn tool-btn" 
            title="自动登录工具"
            @click="showAutoLogin = true"
          >
            <span class="btn-icon">🔐</span>
          </button>
          <button 
            id="start-selection-btn" 
            class="action-btn" 
            title="新建笔记"
            @click="handleStartSelection"
          >
            <span class="btn-icon">✨</span>
          </button>
          <button
            id="open-issue-dir-btn"
            class="action-btn"
            title="在 VS Code 中打开问题目录"
            @click="handleOpenIssueDir"
          >
            <span class="btn-icon">📁</span>
          </button>
          <button 
            id="refresh-focused-btn" 
            class="action-btn" 
            title="刷新关注问题"
            @click="loadFocusedIssues"
          >
            <span class="btn-icon">🔄</span>
          </button>
        </div>
      </div>
      <div id="focused-list" class="focused-list-fullscreen">
        <div v-if="loading" class="loading">加载中...</div>
        <div v-else-if="focusedIssues.length === 0" class="empty-message">
          暂无关注问题
        </div>
        <div v-else class="focused-issues">
          <TreeNode
            v-for="issue in focusedIssues"
            :key="issue.id"
            :node="issue"
            :level="0"
          />
        </div>
      </div>
    </div>

    <!-- WebSocket 连接状态 - 右下角 -->
    <div class="ws-status-bottom-right">
      <div 
        class="ws-status-indicator" 
        :class="wsStatusClass"
      ></div>
      <span class="ws-status-text">{{ wsStatusText }}</span>
    </div>

    <!-- 消息提示 -->
    <div 
      v-if="message.show" 
      class="message" 
      :class="message.type"
    >
      {{ message.text }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import TreeNode from './TreeNode.vue';
import AutoLoginPanel from './AutoLoginPanel.vue';

interface FocusedIssue {
  id: string;
  title: string;
  filename: string;
  content?: string;
  mtime?: number;
  children?: FocusedIssue[];
}

interface Message {
  show: boolean;
  text: string;
  type: 'success' | 'error' | 'info';
}

interface BackgroundMessage {
  type: 'CREATION_SUCCESS' | 'CREATION_ERROR' | 'WS_CONNECTED' | 'WS_DISCONNECTED' | 'FOCUSED_LIST_UPDATED';
  error?: string;
}

const focusedIssues = ref<FocusedIssue[]>([]);
const loading = ref(true);
const wsStatus = ref<'connected' | 'connecting' | 'disconnected'>('connecting');
const message = ref<Message>({ show: false, text: '', type: 'info' });
const showAutoLogin = ref(false);

const wsStatusClass = computed(() => {
  return {
    'ws-connected': wsStatus.value === 'connected',
    'ws-connecting': wsStatus.value === 'connecting',
    'ws-disconnected': wsStatus.value === 'disconnected',
  };
});

const wsStatusText = computed(() => {
  switch (wsStatus.value) {
    case 'connected':
      return '已连接';
    case 'connecting':
      return '连接中...';
    case 'disconnected':
      return '未连接';
    default:
      return '未知';
  }
});

function showMessage(text: string, type: 'success' | 'error' | 'info' = 'info') {
  message.value = { show: true, text, type };
  setTimeout(() => {
    message.value.show = false;
  }, 3000);
}

async function queryWsStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_WS_STATUS' });
    wsStatus.value = response.status;
  } catch (error: unknown) {
    console.error('Failed to query WS status:', error);
    wsStatus.value = 'disconnected';
  }
}

async function loadFocusedIssues() {
  loading.value = true;
  try {
    console.log('[SidePanel] Loading focused issues...');
    const response = await chrome.runtime.sendMessage({ type: 'GET_FOCUSED_ISSUES' });
    console.log('[SidePanel] Got response:', response);
    
    if (response.success) {
      focusedIssues.value = response.data || [];
      console.log('[SidePanel] Focused issues loaded:', focusedIssues.value);
    } else {
      showMessage('获取关注问题失败: ' + (response.error || '未知错误'), 'error');
      focusedIssues.value = [];
    }
  } catch (error: unknown) {
    console.error('Failed to load focused issues:', error);
    const errorMessage = error instanceof Error ? error.message : '未知错误';
    showMessage('获取关注问题失败: ' + errorMessage, 'error');
    focusedIssues.value = [];
  } finally {
    loading.value = false;
  }
}

async function handleStartSelection() {
  console.log('Start selection clicked');
  
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab?.id) {
      showMessage('无法获取当前标签页', 'error');
      return;
    }

    const response = await chrome.runtime.sendMessage({
      type: 'START_SELECTION',
      tabId: tab.id
    });

    if (response.success) {
      showMessage('请在页面上选取内容', 'success');
    } else {
      showMessage('启动选取模式失败', 'error');
    }
  } catch (error: unknown) {
    console.error('Failed to start selection:', error);
    const errorMessage = error instanceof Error ? error.message : '未知错误';
    showMessage('启动选取模式失败: ' + errorMessage, 'error');
  }
}

function handleOpenIssueDir() {
  console.log('Open issue directory clicked');

  try {
    const vscodeUri = 'vscode://wedaren.issue-manager/open-issue-dir';
    // 使用浏览器打开 vscode URI，会触发系统去打开 VS Code
    window.open(vscodeUri, '_blank');
    showMessage('正在打开 VSCode 问题目录...', 'success');
  } catch (error: unknown) {
    console.error('Failed to open issue directory:', error);
    const errorMessage = error instanceof Error ? error.message : '未知错误';
    showMessage('打开问题目录失败: ' + errorMessage, 'error');
  }
}


function handleBackgroundMessage(msg: BackgroundMessage) {
  if (!msg || !msg.type) return;

  switch (msg.type) {
    case 'CREATION_SUCCESS':
      showMessage('✅ 笔记创建成功！', 'success');
      // 刷新关注问题列表
      loadFocusedIssues();
      break;
      
    case 'CREATION_ERROR':
      showMessage('❌ ' + (msg.error || '创建笔记失败'), 'error');
      break;
      
    case 'WS_CONNECTED':
      wsStatus.value = 'connected';
      // WebSocket 连接成功后立即加载关注问题
      loadFocusedIssues();
      break;
      
    case 'WS_DISCONNECTED':
      wsStatus.value = 'disconnected';
      break;
      
    case 'FOCUSED_LIST_UPDATED':
      // 关注列表已更新，自动刷新
      console.log('[SidePanel] 收到关注列表更新通知，刷新列表');
      loadFocusedIssues();
      break;
  }
}

onMounted(() => {
  console.log('Side Panel mounted');
  
  // 监听来自 Background 的消息
  chrome.runtime.onMessage.addListener(handleBackgroundMessage);
  
  // 查询当前 WebSocket 状态
  queryWsStatus();
  
  // 加载关注问题
  loadFocusedIssues();
});

onUnmounted(() => {
  console.log('Side Panel unmounted');
  
  // 移除消息监听器,防止内存泄漏
  chrome.runtime.onMessage.removeListener(handleBackgroundMessage);
});
</script>

<style scoped>
.container {
  width: 100%;
  height: 100vh;
  background-color: #1e1e1e;
  color: #d4d4d4;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.fullscreen-focused {
  padding: 0;
}

.focused-section-fullscreen {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

.section-header-fullscreen {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  background-color: #252526;
  border-bottom: 1px solid #3c3c3c;
  flex-shrink: 0;
}

.section-header-fullscreen h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
}

.section-icon {
  font-size: 20px;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.action-btn {
  background-color: #0e639c;
  color: #ffffff;
  border: none;
  border-radius: 4px;
  padding: 6px 12px;
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 4px;
  transition: background-color 0.2s;
}

.tool-btn {
  background-color: #5a3e1e;
}

.tool-btn:hover {
  background-color: #6e4c23;
}

.action-btn:hover {
  background-color: #1177bb;
}

.action-btn:active {
  background-color: #0d5a8f;
}

.btn-icon {
  font-size: 16px;
}

.focused-list-fullscreen {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}

.loading,
.empty-message {
  text-align: center;
  padding: 40px 20px;
  color: #858585;
  font-size: 14px;
}

.focused-issues {
  display: flex;
  flex-direction: column;
}

.ws-status-bottom-right {
  position: fixed;
  bottom: 16px;
  right: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background-color: #2d2d30;
  border: 1px solid #3c3c3c;
  border-radius: 6px;
  font-size: 12px;
  color: #d4d4d4;
  z-index: 1000;
}

.ws-status-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: #858585;
}

.ws-status-indicator.ws-connected {
  background-color: #4ec9b0;
  box-shadow: 0 0 4px #4ec9b0;
}

.ws-status-indicator.ws-connecting {
  background-color: #dcdcaa;
  animation: pulse 1.5s ease-in-out infinite;
}

.ws-status-indicator.ws-disconnected {
  background-color: #f48771;
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

.message {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  padding: 12px 24px;
  border-radius: 6px;
  font-size: 14px;
  z-index: 2000;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  animation: slideDown 0.3s ease-out;
}

.message.success {
  background-color: #1e3a20;
  color: #4ec9b0;
  border: 1px solid #4ec9b0;
}

.message.error {
  background-color: #3a1e1e;
  color: #f48771;
  border: 1px solid #f48771;
}

.message.info {
  background-color: #1e2a3a;
  color: #569cd6;
  border: 1px solid #569cd6;
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(-20px);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
}

/* 自定义滚动条样式 */
.focused-list-fullscreen::-webkit-scrollbar {
  width: 10px;
}

.focused-list-fullscreen::-webkit-scrollbar-track {
  background: #1e1e1e;
}

.focused-list-fullscreen::-webkit-scrollbar-thumb {
  background: #424242;
  border-radius: 5px;
}

.focused-list-fullscreen::-webkit-scrollbar-thumb:hover {
  background: #4e4e4e;
}
</style>
