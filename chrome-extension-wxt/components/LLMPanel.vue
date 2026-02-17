<template>
  <div class="llm-panel container">
    <div class="llm-header">
      <button class="action-btn" @click="$emit('back')">返回</button>
      <h2>Copilot 对话</h2>
      <div class="spacer"></div>
      <div class="llm-loading-indicator" v-if="loadingLLM">生成中…</div>
    </div>

    <div class="llm-messages" ref="messagesContainer">
      <div
        v-for="msg in messages"
        :key="msg.id"
        :class="['llm-message', msg.role]"
      >
        <div class="role">{{ msg.role === 'user' ? '我' : msg.role === 'assistant' ? 'Copilot' : '系统' }}</div>
        <div class="text">{{ msg.text }}</div>
      </div>
    </div>

    <div class="llm-input-area">
      <textarea v-model="inputText" placeholder="输入消息，按回车发送（Shift+Enter 换行）" @keydown.enter.exact.prevent="handleSend" :disabled="loadingLLM" />
      <button class="action-btn" @click="handleSend" :disabled="loadingLLM">发送</button>
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
.llm-panel {
  display: flex;
  flex-direction: column;
  height: 100vh;
  min-height: 0;
  background-color: #1e1e1e;
  color: #d4d4d4;
}

.llm-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 14px 18px;
  background-color: #252526;
  border-bottom: 1px solid #3c3c3c;
  position: sticky;
  top: 0;
  z-index: 10;
  flex-shrink: 0;
}

.llm-header h2 {
  margin: 0;
  font-size: 16px;
}

.spacer {
  flex: 1;
}

.llm-messages {
  flex: 1 1 auto;
  min-height: 0; /* allow flex child to shrink correctly */
  overflow-y: auto;
  padding: 14px 16px 18px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.llm-message {
  max-width: 78%;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(255,255,255,0.03);
  word-break: break-word;
  white-space: pre-wrap;
}

.llm-message.user {
  align-self: flex-end;
  background: #0e639c;
  color: #fff;
  margin-left: auto;
}

.llm-message.assistant {
  align-self: flex-start;
  background: #2d2d30;
  color: #d4d4d4;
  margin-right: auto;
}

.llm-message .role {
  font-size: 12px;
  opacity: 0.8;
  margin-bottom: 6px;
}

.llm-input-area {
  position: sticky;
  bottom: 0;
  display: flex;
  gap: 10px;
  padding: 12px 16px;
  border-top: 1px solid #2f2f2f;
  background: linear-gradient(180deg, rgba(21,21,21,0.95), rgba(21,21,21,1));
  align-items: center;
}

.llm-input-area textarea {
  flex: 1 1 auto;
  min-height: 52px;
  max-height: 180px;
  resize: vertical;
  padding: 12px 14px;
  border-radius: 8px;
  background: #0f1113;
  color: #d4d4d4;
  border: 1px solid #2a2a2a;
  box-sizing: border-box;
}

.action-btn {
  background-color: #0e639c;
  color: #ffffff;
  border: none;
  border-radius: 4px;
  padding: 6px 12px;
  cursor: pointer;
}

.llm-loading-indicator {
  font-size: 13px;
  color: #9cdcfe;
  margin-left: 8px;
}

.action-btn[disabled] {
  opacity: 0.6;
  cursor: not-allowed;
}

.llm-input-area textarea[disabled] {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
