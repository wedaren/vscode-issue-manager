<template>
  <div class="container fullscreen-focused">
    <!-- 自动登录工具视图 -->
    <AutoLoginPanel v-if="showAutoLogin" @back="showAutoLogin = false" />

    <!-- LLM 对话窗口 -->
    <LLMPanel v-else-if="showLLM" @back="showLLM = false" />

    <!-- 问题总览视图 - 全屏模式 -->
    <div v-else class="focused-section-fullscreen">
      <div class="section-header-fullscreen">
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
            id="open-llm-btn"
            class="action-btn"
            title="LLM 对话"
            @click="showLLM = true"
          >
            <span class="btn-icon">💬</span>
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
            title="刷新问题总览"
            @click="loadFocusedIssues"
          >
            <span class="btn-icon">🔄</span>
          </button>
        </div>
      </div>
      <div id="focused-list" class="focused-list-fullscreen">
        <div v-if="loading" class="loading">加载中...</div>
        <div v-else-if="focusedIssues.length === 0" class="empty-message">
          暂无问题
        </div>
        <div v-else class="focused-issues">
          <TreeNode
            v-for="issue in focusedIssues"
            :key="issue.id"
            :node="issue"
            :level="0"
            @update:node-content="handleUpdateNodeContent"
          />
        </div>
      </div>
    </div>

    

    <!-- 消息提示 -->
    <div 
      v-if="message.show" 
      class="message" 
      :class="message.type"
    >
      {{ message.text }}
    </div>
    <!-- WebSocket 连接状态 - 页面底部状态栏（类似 VSCode 状态栏） -->
    <div class="ws-status-bar" :title="wsStatusText" aria-hidden="true">
      <div class="ws-status-left">
        <div
          class="ws-status-dot"
          :class="wsStatusClass"
          role="status"
          aria-label="WebSocket 状态"
        ></div>
        <div class="ws-status-text">{{ wsStatusText }}</div>
      </div>
      <div class="ws-status-right">
        <!-- 占位：将来可放置分支、模型等状态项 -->
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import TreeNode from './TreeNode.vue';
import AutoLoginPanel from './AutoLoginPanel.vue';
import LLMPanel from './LLMPanel.vue';

interface FocusedIssue {
  id: string;
  title: string;
  filename: string;
  filePath?: string;
  absolutePath?: string;
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
const showLLM = ref(false);

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
    // 请求轻量化的问题树（由 background 转发到 VSCode）
    const response = await chrome.runtime.sendMessage({ type: 'GET_ISSUE_TREE' });
    console.log('[SidePanel] Got response:', response);
    
    if (response.success) {
      focusedIssues.value = response.data || [];
      console.log('[SidePanel] Focused issues loaded:', focusedIssues.value);
    } else {
      showMessage('获取问题总览失败: ' + (response.error || '未知错误'), 'error');
      focusedIssues.value = [];
    }
  } catch (error: unknown) {
    console.error('Failed to load focused issues:', error);
    const errorMessage = error instanceof Error ? error.message : '未知错误';
    showMessage('获取问题总览失败: ' + errorMessage, 'error');
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

function updateNodeContentById(list: FocusedIssue[], nodeId: string, content: string, mtime?: number): boolean {
  for (const item of list) {
    if (item.id === nodeId) {
      item.content = content;
      if (mtime) item.mtime = mtime;
      return true;
    }
    if (item.children && item.children.length > 0) {
      const found = updateNodeContentById(item.children, nodeId, content, mtime);
      if (found) return true;
    }
  }
  return false;
}

function handleUpdateNodeContent(payload: { nodeId: string; content: string; mtime?: number }) {
  if (!payload || !payload.nodeId) return;
  const updated = updateNodeContentById(focusedIssues.value, payload.nodeId, payload.content, payload.mtime);
  if (!updated) {
    console.warn('[SidePanel] 未能在 focusedIssues 中找到节点:', payload.nodeId);
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
  position: relative;
  padding-bottom: 36px; /* 为底部状态栏预留空间，避免遮挡 */
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
  padding-bottom: 56px; /* 额外底部内边距，防止列表最后一项被状态栏覆盖 */
}

/* 右下角的连接状态点，不影响其他布局 */

.ws-status-bottom-right {
  position: fixed; /* detach from layout so it's always a single dot */
  left: 10px;
  bottom: 20px; /* lift above bottom message bar */
  z-index: 99999; /* ensure it's above message bars */
  width: auto;
  height: auto;
  display: block;
  background: transparent; /* no background */
  pointer-events: auto; /* allow tooltip hover */
}

.ws-status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background-clip: padding-box;
  background-color: transparent; /* will be set by state classes */
  box-shadow: none; /* remove inner background */
  transition: background-color 160ms ease, transform 120ms ease;
  display: inline-block;
  pointer-events: auto; /* 允许在小圆点上悬停/点击以显示 tooltip */
}

.ws-status-dot.ws-connected {
  background-color: #34d399; /* green */
  box-shadow: 0 0 10px rgba(52,211,153,0.18);
}

.ws-status-dot.ws-connecting {
  background-color: #f59e0b; /* amber */
  box-shadow: 0 0 8px rgba(245,158,11,0.14);
  transform: scale(1.05);
}

.ws-status-dot.ws-disconnected {
  background-color: #6b7280; /* gray */
  box-shadow: none;
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

/* 保留最小化的固定定位容器，点本身通过 .ws-status-dot 的状态类着色（无背景容器） */
.ws-status-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0; /* 紧贴最底部 */
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px;
  z-index: 99999; /* 确保在其他元素之上 */
  background: #252526; /* 类似 VSCode 状态栏的暗色背景 */
  border-top: 1px solid #2f2f31;
  color: #d4d4d4;
  font-size: 12px;
  pointer-events: none; /* 让状态栏本体不拦截页面点击，避免遮挡交互 */
}

.ws-status-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.ws-status-text {
  color: #9aa0a6;
}

.ws-status-right {
  display: flex;
  align-items: center;
  gap: 12px;
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
