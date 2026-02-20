<template>
  <div class="llm-panel">
    <!-- 头部 -->
    <div class="llm-header">
      <button class="back-btn" @click="$emit('back')" title="返回">
        <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12.5 5L7.5 10l5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <div class="header-title-group">
        <div class="header-icon">
          <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 5a2 2 0 012-2h10a2 2 0 012 2v7a2 2 0 01-2 2H8l-4 3V5z" fill="url(#chatGrad)" stroke="url(#chatGrad)" stroke-width="0.5" stroke-linejoin="round"/>
            <path d="M7 8h6M7 11h4" stroke="white" stroke-width="1.2" stroke-linecap="round"/>
            <defs>
              <linearGradient id="chatGrad" x1="3" y1="3" x2="17" y2="17" gradientUnits="userSpaceOnUse">
                <stop stop-color="#60a5fa"/>
                <stop offset="1" stop-color="#a78bfa"/>
              </linearGradient>
            </defs>
          </svg>
        </div>
        <h2>Copilot 对话</h2>
      </div>
      <div class="header-right">
        <div class="llm-loading-indicator" v-if="loadingLLM">
          <span class="loading-dot"></span>
          <span class="loading-dot"></span>
          <span class="loading-dot"></span>
        </div>
      </div>
    </div>

    <!-- 消息列表 -->
    <div class="llm-messages" ref="messagesContainer">
      <!-- 空状态 -->
      <div v-if="messages.length === 0" class="chat-empty">
        <div class="chat-empty-icon">
          <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="24" cy="24" r="20" fill="url(#emptyGrad)" opacity="0.15"/>
            <path d="M14 18a3 3 0 013-3h14a3 3 0 013 3v10a3 3 0 01-3 3H20l-6 4V18z" stroke="url(#emptyGrad)" stroke-width="1.5" stroke-linejoin="round"/>
            <path d="M19 22h10M19 26h6" stroke="url(#emptyGrad)" stroke-width="1.5" stroke-linecap="round"/>
            <defs>
              <linearGradient id="emptyGrad" x1="14" y1="15" x2="34" y2="35" gradientUnits="userSpaceOnUse">
                <stop stop-color="#60a5fa"/>
                <stop offset="1" stop-color="#a78bfa"/>
              </linearGradient>
            </defs>
          </svg>
        </div>
        <p class="chat-empty-text">和 Copilot 开始对话</p>
        <p class="chat-empty-hint">输入消息后按回车发送</p>
      </div>

      <!-- 消息气泡 -->
      <div
        v-for="msg in messages"
        :key="msg.id"
        :class="['llm-message', msg.role]"
      >
        <!-- 角色标识 -->
        <div class="message-avatar" :class="msg.role">
          <svg v-if="msg.role === 'user'" viewBox="0 0 20 20" fill="none">
            <circle cx="10" cy="7" r="3.5" stroke="currentColor" stroke-width="1.4"/>
            <path d="M3 17c0-3.87 3.13-7 7-7s7 3.13 7 7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
          </svg>
          <svg v-else viewBox="0 0 20 20" fill="none">
            <rect x="2" y="5" width="16" height="11" rx="3" stroke="currentColor" stroke-width="1.4"/>
            <path d="M7 10h2l1 2 2-4 1 2h2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <div class="message-body">
          <div class="message-role-label">{{ msg.role === 'user' ? '我' : msg.role === 'assistant' ? 'Copilot' : '系统' }}</div>
          <div class="message-text">{{ msg.text }}</div>
        </div>
      </div>
    </div>

    <!-- 输入区域 -->
    <div class="llm-input-area">
      <div class="input-wrapper" :class="{ disabled: loadingLLM }">
        <textarea
          v-model="inputText"
          placeholder="输入消息，Enter 发送，Shift+Enter 换行…"
          @keydown.enter.exact.prevent="handleSend"
          :disabled="loadingLLM"
        />
        <button
          class="send-btn"
          @click="handleSend"
          :disabled="loadingLLM || !inputText.trim()"
          title="发送"
        >
          <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M16.5 10L3.5 4l2.5 6-2.5 6 13-6z" fill="currentColor"/>
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue';

// 聊天消息类型
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
}

const messages = ref<ChatMessage[]>([]);
const inputText = ref('');
const messagesContainer = ref<HTMLElement | null>(null);
const lastAssistantMessageId = ref<string | null>(null);
const loadingLLM = ref(false);

function scrollToBottom() {
  nextTick(() => {
    const el = messagesContainer.value;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  });
}

async function handleSend() {
  const text = inputText.value.trim();
  if (!text) return;

  const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
  messages.value.push({ id, role: 'user', text });
  inputText.value = '';
  scrollToBottom();

  try {
    // 向 background 发起 LLM 请求，background 负责通过 websocket 转发到 VS Code
    loadingLLM.value = true;
    const response = await chrome.runtime.sendMessage({
      type: 'LLM_REQUEST',
      model: 'copilot',
      prompt: text,
    });

    if (response && response.success) {
      // 如果后端直接返回了 reply（兼容旧实现），则显示最终回复；
      // 否则若返回 requestId，创建一个占位的 assistant 消息以接收流式 chunk。
      const reply = response.data && response.data.reply;
      const requestId = response.data && response.data.requestId;
      if (typeof reply === 'string' && reply.length > 0) {
        messages.value.push({ id: 'r-' + id, role: 'assistant', text: reply });
        loadingLLM.value = false;
      } else if (requestId) {
        const placeholderId = 'p-' + (requestId || Date.now().toString(36));
        messages.value.push({ id: placeholderId, role: 'assistant', text: '' });
        lastAssistantMessageId.value = placeholderId;
      }
    } else {
      messages.value.push({ id: 'e-' + id, role: 'assistant', text: '请求失败: ' + (response?.error || '未知错误') });
      loadingLLM.value = false;
    }
  } catch (err: unknown) {
    const em = err instanceof Error ? err.message : String(err);
    messages.value.push({ id: 'e2-' + id, role: 'assistant', text: '发送异常: ' + em });
    loadingLLM.value = false;
  } finally {
    scrollToBottom();
  }
}

function handleIncomingMessage(msg: any) {
  if (!msg || !msg.type) return;
  if (msg.type === 'LLM_PUSH') {
    const payload = msg.payload;
    if (!payload) return;

    // 支持不同字段：chunk（流式片段） / text / reply（最终回复）
    const chunk = payload.chunk || payload.text;
    const reply = payload.reply;

    if (chunk) {
      // 将流式 chunk 附加到最后一条 assistant 消息
      if (lastAssistantMessageId.value) {
        const idx = messages.value.findIndex(m => m.id === lastAssistantMessageId.value);
        if (idx !== -1) {
          messages.value[idx].text += String(chunk);
        } else {
          const id = 'p-' + Date.now().toString(36) + Math.random().toString(36).slice(2);
          messages.value.push({ id, role: 'assistant', text: String(chunk) });
          lastAssistantMessageId.value = id;
        }
      } else {
        const id = 'p-' + Date.now().toString(36) + Math.random().toString(36).slice(2);
        messages.value.push({ id, role: 'assistant', text: String(chunk) });
        lastAssistantMessageId.value = id;
      }
      scrollToBottom();
      return;
    }

    if (typeof reply === 'string') {
      // 最终回复：如果已有未完成的 assistant 消息，替换/追加；否则新增
      if (lastAssistantMessageId.value) {
        const idx = messages.value.findIndex(m => m.id === lastAssistantMessageId.value);
        if (idx !== -1) {
          messages.value[idx].text = String(reply);
        } else {
          const id = 'r-' + Date.now().toString(36);
          messages.value.push({ id, role: 'assistant', text: String(reply) });
        }
        lastAssistantMessageId.value = null;
        loadingLLM.value = false;
      } else {
        const id = 'r-' + Date.now().toString(36);
        messages.value.push({ id, role: 'assistant', text: String(reply) });
        loadingLLM.value = false;
      }
      scrollToBottom();
      return;
    }
  }
}

onMounted(() => {
  // 监听 background 推送的 LLM 消息
  chrome.runtime.onMessage.addListener(handleIncomingMessage);
});

onUnmounted(() => {
  chrome.runtime.onMessage.removeListener(handleIncomingMessage);
});
</script>

<style scoped>
/* ========== 全局变量 ========== */
.llm-panel {
  --bg-deep: #0f1117;
  --bg-base: #161b22;
  --bg-card: #1c2130;
  --bg-hover: #242938;
  --border-subtle: #2a3040;
  --accent-blue: #388bfd;
  --accent-purple: #a78bfa;
  --text-primary: #e6edf3;
  --text-secondary: #8b949e;
  --text-muted: #484f58;
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 16px;

  display: flex;
  flex-direction: column;
  height: calc(100vh - 28px);
  min-height: 0;
  background-color: var(--bg-deep);
  color: var(--text-primary);
}

/* ========== 头部 ========== */
.llm-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: linear-gradient(180deg, #1a2030 0%, #161b22 100%);
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.back-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s ease;
  padding: 0;
  flex-shrink: 0;
}

.back-btn svg {
  width: 16px;
  height: 16px;
}

.back-btn:hover {
  background: var(--bg-hover);
  border-color: var(--border-subtle);
  color: var(--text-primary);
}

.back-btn:active {
  transform: scale(0.92);
}

.header-title-group {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.header-icon {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
}

.header-icon svg {
  width: 100%;
  height: 100%;
}

.llm-header h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.header-right {
  flex-shrink: 0;
  display: flex;
  align-items: center;
}

/* 生成中动画 */
.llm-loading-indicator {
  display: flex;
  gap: 4px;
  align-items: center;
  padding: 0 4px;
}

.loading-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--accent-blue);
  animation: dotBounce 1.2s ease-in-out infinite;
}

.loading-dot:nth-child(2) { animation-delay: 0.2s; }
.loading-dot:nth-child(3) { animation-delay: 0.4s; }

@keyframes dotBounce {
  0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
  40% { opacity: 1; transform: scale(1.1); }
}

/* ========== 消息区域 ========== */
.llm-messages {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* 空状态 */
.chat-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 40px 20px;
}

.chat-empty-icon {
  width: 72px;
  height: 72px;
}

.chat-empty-icon svg {
  width: 100%;
  height: 100%;
}

.chat-empty-text {
  font-size: 15px;
  font-weight: 500;
  color: var(--text-secondary);
  margin: 0;
}

.chat-empty-hint {
  font-size: 12px;
  color: var(--text-muted);
  margin: 0;
}

/* 消息条目 */
.llm-message {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  max-width: 100%;
}

.llm-message.user {
  flex-direction: row-reverse;
}

/* 头像 */
.message-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 2px;
}

.message-avatar svg {
  width: 16px;
  height: 16px;
}

.message-avatar.user {
  background: rgba(56, 139, 253, 0.2);
  color: #60a5fa;
}

.message-avatar.assistant {
  background: rgba(167, 139, 250, 0.2);
  color: #a78bfa;
}

.message-avatar.system {
  background: rgba(251, 191, 36, 0.15);
  color: #fbbf24;
}

/* 消息内容 */
.message-body {
  flex: 1;
  min-width: 0;
  max-width: 82%;
}

.llm-message.user .message-body {
  align-items: flex-end;
  display: flex;
  flex-direction: column;
}

.message-role-label {
  font-size: 11px;
  color: var(--text-muted);
  margin-bottom: 4px;
  font-weight: 500;
  letter-spacing: 0.3px;
}

.message-text {
  padding: 10px 13px;
  border-radius: var(--radius-md);
  font-size: 13px;
  line-height: 1.7;
  word-break: break-word;
  white-space: pre-wrap;
}

.llm-message.user .message-text {
  background: linear-gradient(135deg, #1d4ed8, #2563eb);
  color: #fff;
  border-bottom-right-radius: 3px;
  box-shadow: 0 2px 8px rgba(29, 78, 216, 0.3);
}

.llm-message.assistant .message-text {
  background: var(--bg-card);
  color: var(--text-primary);
  border: 1px solid var(--border-subtle);
  border-bottom-left-radius: 3px;
}

.llm-message.system .message-text {
  background: rgba(30, 30, 20, 0.8);
  color: #fbbf24;
  border: 1px solid rgba(251, 191, 36, 0.2);
  font-size: 12px;
  border-radius: var(--radius-sm);
}

/* ========== 输入区域 ========== */
.llm-input-area {
  padding: 10px 12px;
  border-top: 1px solid var(--border-subtle);
  background: var(--bg-base);
  flex-shrink: 0;
}

.input-wrapper {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  padding: 8px 8px 8px 14px;
  transition: border-color 0.15s ease;
}

.input-wrapper:focus-within {
  border-color: rgba(56, 139, 253, 0.5);
  box-shadow: 0 0 0 3px rgba(56, 139, 253, 0.08);
}

.input-wrapper.disabled {
  opacity: 0.6;
}

.input-wrapper textarea {
  flex: 1 1 auto;
  min-height: 40px;
  max-height: 160px;
  resize: none;
  background: transparent;
  color: var(--text-primary);
  border: none;
  outline: none;
  font-size: 13px;
  line-height: 1.6;
  font-family: inherit;
  padding: 2px 0;
}

.input-wrapper textarea::placeholder {
  color: var(--text-muted);
}

.input-wrapper textarea:disabled {
  cursor: not-allowed;
}

.send-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: var(--accent-blue);
  border: none;
  border-radius: 50%;
  color: #fff;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.15s ease;
  padding: 0;
}

.send-btn svg {
  width: 16px;
  height: 16px;
}

.send-btn:hover:not(:disabled) {
  background: #4d9bff;
  transform: scale(1.06);
}

.send-btn:active:not(:disabled) {
  transform: scale(0.94);
}

.send-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ========== 自定义滚动条 ========== */
.llm-messages::-webkit-scrollbar {
  width: 6px;
}

.llm-messages::-webkit-scrollbar-track {
  background: transparent;
}

.llm-messages::-webkit-scrollbar-thumb {
  background: #2a3040;
  border-radius: 3px;
}

.llm-messages::-webkit-scrollbar-thumb:hover {
  background: #3a4258;
}
</style>
