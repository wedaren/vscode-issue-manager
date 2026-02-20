<template>
  <div class="container fullscreen-focused">
    <!-- 自动登录工具视图 -->
    <AutoLoginPanel v-if="showAutoLogin" @back="showAutoLogin = false" />

    <!-- LLM 对话窗口 -->
    <LLMPanel v-else-if="showLLM" @back="showLLM = false" />

    <!-- 划线助手窗口 -->
    <SelectionAssistPanel v-else-if="showSelectionAssist" @back="showSelectionAssist = false" />

    <!-- 问题总览视图 - 全屏模式 -->
    <div v-else class="focused-section-fullscreen">
      <div class="section-header-fullscreen">
        <!-- 左侧标题区 -->
        <div class="header-title">
          <div class="header-logo">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="3" y="3" width="18" height="18" rx="3" fill="url(#logoGrad)"/>
              <path d="M7 8h10M7 12h7M7 16h5" stroke="white" stroke-width="1.8" stroke-linecap="round"/>
              <circle cx="18" cy="16" r="3" fill="#34d399"/>
              <path d="M16.5 16l1 1 1.5-1.5" stroke="white" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
              <defs>
                <linearGradient id="logoGrad" x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
                  <stop stop-color="#0ea5e9"/>
                  <stop offset="1" stop-color="#6366f1"/>
                </linearGradient>
              </defs>
            </svg>
          </div>
          <span class="header-title-text">Issue Manager</span>
        </div>

        <!-- 右侧操作按钮 -->
        <div class="header-actions">
          <button
            id="auto-login-btn"
            class="icon-btn"
            title="自动登录工具"
            @click="showAutoLogin = true"
          >
            <!-- 钥匙/安全图标 -->
            <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="8" cy="8" r="4.5" stroke="currentColor" stroke-width="1.5"/>
              <path d="M11.5 11.5L17 17" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              <path d="M14 15l1.5-1.5M15.5 16.5L17 15" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
            </svg>
          </button>
          <button
            id="start-selection-btn"
            class="icon-btn icon-btn--primary"
            title="新建笔记"
            @click="handleStartSelection"
          >
            <!-- 加号/新建图标 -->
            <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M4 8h7M4 12h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              <rect x="2" y="3" width="12" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/>
              <circle cx="15.5" cy="14.5" r="3" fill="currentColor" opacity="0.15"/>
              <path d="M15.5 13v3M14 14.5h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </button>
          <button
            id="start-translate-btn"
            class="icon-btn"
            title="区域翻译"
            @click="handleStartTranslate"
          >
            <!-- 翻译图标 (A/文) -->
            <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M4 5h7M4 8h5M4 11h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
              <path d="M10 5h6M13 5v10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
              <path d="M10.5 15h5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
            </svg>
          </button>
          <button
            id="open-llm-btn"
            class="icon-btn"
            title="LLM 对话"
            @click="showLLM = true"
          >
            <!-- 对话气泡图标 -->
            <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M3 5a2 2 0 012-2h10a2 2 0 012 2v7a2 2 0 01-2 2H8l-4 3V5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
              <path d="M7 8h6M7 11h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
            </svg>
          </button>
          <button
            id="open-selection-assist-btn"
            class="icon-btn"
            title="划线助手"
            @click="showSelectionAssist = true"
          >
            <!-- 翻译/对照图标 -->
            <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M3.5 5h7M3.5 8h5M3.5 11h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
              <path d="M11 5h5.5M13.5 5c0 3-1.5 5.2-4 6.8M13.5 5c0 3 1.5 5.2 4 6.8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
              <path d="M11 15h6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
            </svg>
          </button>
          <button
            id="open-issue-dir-btn"
            class="icon-btn"
            title="在 VS Code 中打开问题目录"
            @click="handleOpenIssueDir"
          >
            <!-- 文件夹图标 -->
            <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M2 6a2 2 0 012-2h3.17a2 2 0 011.42.59L9.83 6H16a2 2 0 012 2v7a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
            </svg>
          </button>
          <button
            id="refresh-focused-btn"
            class="icon-btn"
            :class="{ 'spinning': loading }"
            title="刷新问题总览"
            @click="loadFocusedIssues"
          >
            <!-- 刷新图标 -->
            <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M4.5 10A5.5 5.5 0 0110 4.5c1.8 0 3.4.87 4.4 2.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              <path d="M15.5 10A5.5 5.5 0 0110 15.5c-1.8 0-3.4-.87-4.4-2.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              <path d="M13.5 6.5h1.5V5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M6.5 13.5H5v1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
      </div>
      <div id="focused-list" class="focused-list-fullscreen">
        <div v-if="loading" class="loading">
          <div class="loading-spinner"></div>
          <span>加载中...</span>
        </div>
        <div v-else-if="focusedIssues.length === 0" class="empty-message">
          <svg class="empty-icon" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="8" y="6" width="32" height="36" rx="4" stroke="currentColor" stroke-width="2"/>
            <path d="M16 16h16M16 22h12M16 28h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
          <p>暂无问题</p>
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
      <span class="message-icon">
        <svg v-if="message.type === 'success'" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" fill="#34d399" opacity="0.2"/><path d="M5 8l2 2 4-4" stroke="#34d399" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <svg v-else-if="message.type === 'error'" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" fill="#f87171" opacity="0.2"/><path d="M10 6L6 10M6 6l4 4" stroke="#f87171" stroke-width="1.5" stroke-linecap="round"/></svg>
        <svg v-else viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" fill="#60a5fa" opacity="0.2"/><path d="M8 7v4M8 5.5v.5" stroke="#60a5fa" stroke-width="1.5" stroke-linecap="round"/></svg>
      </span>
      {{ message.text }}
    </div>

    <!-- WebSocket 连接状态 - 页面底部状态栏 -->
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
import SelectionAssistPanel from './SelectionAssistPanel.vue';

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
const showSelectionAssist = ref(false);

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

async function handleStartTranslate() {
  console.log('Start translate clicked');
  
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab?.id) {
      showMessage('无法获取当前标签页', 'error');
      return;
    }

    const response = await chrome.runtime.sendMessage({
      type: 'START_TRANSLATE_SELECTION',
      tabId: tab.id
    });

    if (response && response.success) {
      showMessage('请在页面上选取要翻译的内容', 'success');
    } else {
      showMessage('启动翻译模式失败', 'error');
    }
  } catch (error: unknown) {
    console.error('Failed to start translate selection:', error);
    const errorMessage = error instanceof Error ? error.message : '未知错误';
    showMessage('启动翻译模式失败: ' + errorMessage, 'error');
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
      showMessage('笔记创建成功！', 'success');
      // 刷新关注问题列表
      loadFocusedIssues();
      break;
      
    case 'CREATION_ERROR':
      showMessage((msg.error || '创建笔记失败'), 'error');
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
/* ========== 全局变量 ========== */
.container {
  --bg-deep: #0f1117;
  --bg-base: #161b22;
  --bg-card: #1c2130;
  --bg-hover: #242938;
  --border-subtle: #2a3040;
  --border-focus: #388bfd;
  --accent-blue: #388bfd;
  --accent-teal: #34d399;
  --text-primary: #e6edf3;
  --text-secondary: #8b949e;
  --text-muted: #484f58;
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;

  width: 100%;
  height: 100vh;
  background-color: var(--bg-deep);
  color: var(--text-primary);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  position: relative;
  padding-bottom: 28px; /* 为底部状态栏预留空间 */
}

.fullscreen-focused {
  padding: 0;
}

.focused-section-fullscreen {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

/* ========== 头部 ========== */
.section-header-fullscreen {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  background: linear-gradient(180deg, #1a2030 0%, #161b22 100%);
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
  gap: 8px;
}

/* 左侧标题 */
.header-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.header-logo {
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  filter: drop-shadow(0 2px 6px rgba(56, 139, 253, 0.35));
}

.header-logo svg {
  width: 100%;
  height: 100%;
}

.header-title-text {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: 0.3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ========== 图标按钮 ========== */
.header-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s ease;
  padding: 0;
}

.icon-btn svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.icon-btn:hover {
  background: var(--bg-hover);
  border-color: var(--border-subtle);
  color: var(--text-primary);
}

.icon-btn:active {
  background: #2d3548;
  transform: scale(0.94);
}

/* 主要操作按钮（新建笔记）高亮 */
.icon-btn--primary {
  color: var(--accent-blue);
  border-color: rgba(56, 139, 253, 0.25);
  background: rgba(56, 139, 253, 0.08);
}

.icon-btn--primary:hover {
  background: rgba(56, 139, 253, 0.18);
  border-color: rgba(56, 139, 253, 0.5);
  color: #60a5fa;
}

/* 刷新图标旋转动画 */
.spinning svg {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* ========== 问题列表 ========== */
.focused-list-fullscreen {
  flex: 1;
  overflow-y: auto;
  padding: 10px 10px 52px;
}

.focused-issues {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* ========== 加载 & 空状态 ========== */
.loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 60px 20px;
  color: var(--text-secondary);
  font-size: 13px;
}

.loading-spinner {
  width: 28px;
  height: 28px;
  border: 2px solid var(--border-subtle);
  border-top-color: var(--accent-blue);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.empty-message {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 60px 20px;
  color: var(--text-muted);
  font-size: 13px;
}

.empty-icon {
  width: 48px;
  height: 48px;
  color: var(--text-muted);
  opacity: 0.5;
}

/* ========== 消息提示 ========== */
.message {
  position: fixed;
  top: 58px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 16px;
  border-radius: var(--radius-md);
  font-size: 13px;
  z-index: 2000;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255,255,255,0.04);
  animation: slideDown 0.25s ease-out;
  white-space: nowrap;
  backdrop-filter: blur(12px);
}

.message-icon {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.message-icon svg {
  width: 16px;
  height: 16px;
}

.message.success {
  background: rgba(20, 50, 35, 0.92);
  color: #4ade80;
  border: 1px solid rgba(52, 211, 153, 0.3);
}

.message.error {
  background: rgba(50, 20, 20, 0.92);
  color: #fb7185;
  border: 1px solid rgba(248, 113, 113, 0.3);
}

.message.info {
  background: rgba(20, 30, 55, 0.92);
  color: #60a5fa;
  border: 1px solid rgba(96, 165, 250, 0.3);
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(-12px);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
}

/* ========== 状态栏 ========== */
.ws-status-bar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  z-index: 99999;
  background: #161b22;
  border-top: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  font-size: 11px;
  pointer-events: none;
}

.ws-status-left {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ws-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  transition: background-color 160ms ease;
}

.ws-status-dot.ws-connected {
  background-color: #34d399;
  box-shadow: 0 0 6px rgba(52, 211, 153, 0.5);
}

.ws-status-dot.ws-connecting {
  background-color: #fbbf24;
  box-shadow: 0 0 6px rgba(251, 191, 36, 0.4);
  animation: pulse 1.4s ease-in-out infinite;
}

.ws-status-dot.ws-disconnected {
  background-color: #6b7280;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.ws-status-text {
  color: var(--text-muted);
  font-size: 11px;
}

.ws-status-right {
  display: flex;
  align-items: center;
}

/* ========== 自定义滚动条 ========== */
.focused-list-fullscreen::-webkit-scrollbar {
  width: 6px;
}

.focused-list-fullscreen::-webkit-scrollbar-track {
  background: transparent;
}

.focused-list-fullscreen::-webkit-scrollbar-thumb {
  background: #2a3040;
  border-radius: 3px;
}

.focused-list-fullscreen::-webkit-scrollbar-thumb:hover {
  background: #3a4258;
}
</style>
