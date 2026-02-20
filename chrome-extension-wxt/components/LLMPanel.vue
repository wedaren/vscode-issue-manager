<template>
  <div class="llm-panel">

    <!-- 历史抽屉覆盖层 -->
    <Transition name="history-slide">
      <div v-if="showHistory" class="history-overlay" @click.self="showHistory = false">
        <div class="history-drawer">
          <div class="history-drawer-header">
            <span class="history-drawer-title">
              <svg viewBox="0 0 20 20" fill="none"><path d="M10 3a7 7 0 100 14A7 7 0 0010 3z" stroke="currentColor" stroke-width="1.4"/><path d="M10 6v4l2.5 2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
              历史记录
            </span>
            <button class="drawer-close-btn" @click="showHistory = false">
              <svg viewBox="0 0 20 20" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            </button>
          </div>
          <div class="history-list">
            <template v-if="conversations.length > 0">
              <template v-for="group in groupedConversations" :key="group.label">
                <div class="history-group-label">{{ group.label }}</div>
              <div
                  v-for="conv in group.items"
                  :key="conv.id"
                  :class="['history-item', { active: conv.id === currentConvId }]"
                  @click="switchConversation(conv.id)"
                >
                  <!-- 后台生成中指示圆点 -->
                  <span v-if="_loadingMap[conv.id]" class="history-loading-dot"></span>
                  <span class="history-item-title">{{ conv.title }}</span>
                  <button
                    class="history-item-delete"
                    title="删除"
                    @click.stop="deleteConversation(conv.id)"
                  >
                    <svg viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
                  </button>
                </div>
              </template>
            </template>
            <div v-else class="history-empty">暂无历史记录</div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 头部 -->
    <div class="llm-header">
      <button class="back-btn" @click="$emit('back')" title="返回">
        <svg viewBox="0 0 20 20" fill="none"><path d="M12.5 5L7.5 10l5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="header-title-group">
        <div class="header-icon">
          <svg viewBox="0 0 20 20" fill="none">
            <path d="M3 5a2 2 0 012-2h10a2 2 0 012 2v7a2 2 0 01-2 2H8l-4 3V5z" fill="url(#chatGrad)" stroke="url(#chatGrad)" stroke-width="0.5" stroke-linejoin="round"/>
            <path d="M7 8h6M7 11h4" stroke="white" stroke-width="1.2" stroke-linecap="round"/>
            <defs>
              <linearGradient id="chatGrad" x1="3" y1="3" x2="17" y2="17" gradientUnits="userSpaceOnUse">
                <stop stop-color="#60a5fa"/><stop offset="1" stop-color="#a78bfa"/>
              </linearGradient>
            </defs>
          </svg>
        </div>
        <h2 class="header-conv-title">{{ currentConv?.title || 'Copilot 对话' }}</h2>
      </div>
      <div class="header-right">
        <!-- 复制全部 -->
        <button v-if="messages.length > 0" class="icon-btn copy-all-btn" @click="copyAllMessages" :title="copied ? '已复制！' : '复制全部对话'">
          <svg v-if="!copied" viewBox="0 0 20 20" fill="none"><rect x="7" y="4" width="9" height="12" rx="1.5" stroke="currentColor" stroke-width="1.5"/><path d="M5 7H4a1 1 0 00-1 1v8a1 1 0 001 1h8a1 1 0 001-1v-1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          <svg v-else viewBox="0 0 20 20" fill="none"><path d="M4 10l4 4 8-8" stroke="#34d399" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <!-- 历史记录 -->
        <button class="icon-btn" :class="{ active: showHistory }" @click="showHistory = !showHistory" title="历史记录">
          <svg viewBox="0 0 20 20" fill="none"><path d="M10 3a7 7 0 100 14A7 7 0 0010 3z" stroke="currentColor" stroke-width="1.4"/><path d="M10 6v4l2.5 2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
        </button>
        <!-- 新建对话 -->
        <button class="new-chat-btn" @click="newConversation" title="新建对话">
          <svg viewBox="0 0 20 20" fill="none"><path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
          新建
        </button>
      </div>
    </div>

    <!-- 消息列表 -->
    <div class="llm-messages" ref="messagesContainer">
      <!-- 空状态 -->
      <div v-if="messages.length === 0 && !loadingLLM" class="chat-empty">
        <div class="chat-empty-icon">
          <svg viewBox="0 0 48 48" fill="none">
            <circle cx="24" cy="24" r="20" fill="url(#emptyGrad)" opacity="0.15"/>
            <path d="M14 18a3 3 0 013-3h14a3 3 0 013 3v10a3 3 0 01-3 3H20l-6 4V18z" stroke="url(#emptyGrad)" stroke-width="1.5" stroke-linejoin="round"/>
            <path d="M19 22h10M19 26h6" stroke="url(#emptyGrad)" stroke-width="1.5" stroke-linecap="round"/>
            <defs>
              <linearGradient id="emptyGrad" x1="14" y1="15" x2="34" y2="35" gradientUnits="userSpaceOnUse">
                <stop stop-color="#60a5fa"/><stop offset="1" stop-color="#a78bfa"/>
              </linearGradient>
            </defs>
          </svg>
        </div>
        <p class="chat-empty-text">和 Copilot 开始对话</p>
        <p class="chat-empty-hint">输入消息后按回车发送</p>
      </div>

      <!-- 消息气泡 -->
      <div v-for="msg in messages" :key="msg.id" :class="['llm-message', msg.role]">
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
          <!-- 打字气泡占位 -->
          <div v-if="msg.id === lastAssistantMessageId && msg.text === ''" class="message-text typing-bubble">
            <span class="typing-dot"></span>
            <span class="typing-dot"></span>
            <span class="typing-dot"></span>
          </div>
          <!-- 正常文本 + 流式光标 -->
          <div v-else class="message-text">
            {{ msg.text }}<span v-if="msg.id === lastAssistantMessageId" class="stream-cursor">|</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 输入区域 -->
    <div class="llm-input-area">
      <!-- 排队提示条 -->
      <div v-if="loadingLLM && pendingText" class="queue-hint">
        <svg viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.3" opacity="0.6"/>
          <path d="M8 5v3l2 1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
        </svg>
        对话生成中，消息已排队…
      </div>
      <div class="input-wrapper">
        <textarea
          v-model="inputText"
          :placeholder="loadingLLM ? '输入下一条消息，将在回复完成后自动发送…' : '输入消息，Enter 发送，Shift+Enter 换行…'"
          @keydown.enter.exact.prevent="handleSend"
        />
        <button class="send-btn" @click="handleSend" :disabled="!inputText.trim()" :title="loadingLLM ? '加入排列' : '发送'">
          <svg v-if="loadingLLM" viewBox="0 0 20 20" fill="none">
            <circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.6" opacity="0.5"/>
            <path d="M10 6v4l3 1.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
          <svg v-else viewBox="0 0 20 20" fill="none">
            <path d="M16.5 10L3.5 4l2.5 6-2.5 6 13-6z" fill="currentColor"/>
          </svg>
        </button>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';

// ===== 类型定义 =====
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
}

interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

// ===== 常量 =====
const STORAGE_KEY = 'llm_conversations';
const MAX_CONVERSATIONS = 50; // 最多保留 50 条历史

// ===== 工具函数 =====
function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function createConversation(): Conversation {
  return { id: genId(), title: '新对话', messages: [], createdAt: Date.now(), updatedAt: Date.now() };
}

/** 取第一条 user 消息前 22 字作为标题 */
function autoTitle(conv: Conversation): string {
  const first = conv.messages.find(m => m.role === 'user');
  if (!first) return '新对话';
  return first.text.trim().slice(0, 22) + (first.text.trim().length > 22 ? '…' : '');
}

// ===== 多会话状态 =====
const conversations = ref<Conversation[]>([]);
const currentConvId = ref<string>('');
const showHistory = ref(false);

const currentConv = computed(() =>
  conversations.value.find(c => c.id === currentConvId.value)
);

/** messages 直接指向当前会话的消息列表，所有 push/splice 都会触发 watch 自动保存 */
const messages = computed(() => currentConv.value?.messages ?? []);

/** 按今天/昨天/更早分组，每组内按 updatedAt 倒序 */
const groupedConversations = computed(() => {
  const todayStart = new Date().setHours(0, 0, 0, 0);
  const yesterdayStart = todayStart - 86400000;
  const sorted = [...conversations.value].sort((a, b) => b.updatedAt - a.updatedAt);

  const todayItems = sorted.filter(c => c.updatedAt >= todayStart);
  const yesterdayItems = sorted.filter(c => c.updatedAt >= yesterdayStart && c.updatedAt < todayStart);
  const olderItems = sorted.filter(c => c.updatedAt < yesterdayStart);

  const groups: { label: string; items: Conversation[] }[] = [];
  if (todayItems.length) groups.push({ label: '今天', items: todayItems });
  if (yesterdayItems.length) groups.push({ label: '昨天', items: yesterdayItems });
  if (olderItems.length) groups.push({ label: '更早', items: olderItems });
  return groups;
});

// ===== 持久化 =====
async function loadConversations() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const data = result[STORAGE_KEY];
    if (Array.isArray(data) && data.length > 0) {
      conversations.value = data;
      // 切换到最近一次更新的会话
      const latest = [...data].sort((a, b) => b.updatedAt - a.updatedAt)[0];
      currentConvId.value = latest.id;
    } else {
      // 初次使用，创建默认会话
      const conv = createConversation();
      conversations.value = [conv];
      currentConvId.value = conv.id;
    }
  } catch (e) {
    console.error('[LLMPanel] 加载历史记录失败:', e);
    const conv = createConversation();
    conversations.value = [conv];
    currentConvId.value = conv.id;
  }
}

function saveConversations() {
  try {
    // 超出上限时删除最旧的
    let toSave = [...conversations.value];
    if (toSave.length > MAX_CONVERSATIONS) {
      toSave = toSave.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CONVERSATIONS);
    }
    chrome.storage.local.set({ [STORAGE_KEY]: toSave });
  } catch (e) {
    console.error('[LLMPanel] 保存历史记录失败:', e);
  }
}

// 深度监听，消息变化自动保存
watch(conversations, saveConversations, { deep: true });

// ===== 会话管理 =====
function newConversation() {
  const conv = createConversation();
  conversations.value.unshift(conv);
  currentConvId.value = conv.id;
  showHistory.value = false;
  nextTick(() => scrollToBottom());
}

function switchConversation(id: string) {
  currentConvId.value = id;
  showHistory.value = false;
  nextTick(() => scrollToBottom());
}

function deleteConversation(id: string) {
  const idx = conversations.value.findIndex(c => c.id === id);
  if (idx === -1) return;
  conversations.value.splice(idx, 1);

  // 如果删除的是当前会话，切换到最新的
  if (id === currentConvId.value) {
    if (conversations.value.length === 0) {
      const conv = createConversation();
      conversations.value = [conv];
    }
    const latest = [...conversations.value].sort((a, b) => b.updatedAt - a.updatedAt)[0];
    currentConvId.value = latest.id;
  }
}

// ===== 其余状态 =====
const inputText = ref('');
const messagesContainer = ref<HTMLElement | null>(null);
const copied = ref(false);

// 以 convId 为 key 的 Map，使每个会话拥有独立的 loading / pending / lastMsgId 状态
const _loadingMap = ref<Record<string, boolean>>({});
const _pendingMap = ref<Record<string, string>>({});
const _lastMsgIdMap = ref<Record<string, string | null>>({});

/** 当前会话是否正在生成（可写） */
const loadingLLM = computed<boolean>({
  get: () => _loadingMap.value[currentConvId.value] ?? false,
  set: (v) => { _loadingMap.value[currentConvId.value] = v; },
});

/** 当前会话的排队消息（可写） */
const pendingText = computed<string>({
  get: () => _pendingMap.value[currentConvId.value] ?? '',
  set: (v) => { _pendingMap.value[currentConvId.value] = v; },
});

/** 当前会话正在流式接收的 assistant 消息 ID（可写） */
const lastAssistantMessageId = computed<string | null>({
  get: () => _lastMsgIdMap.value[currentConvId.value] ?? null,
  set: (v) => { _lastMsgIdMap.value[currentConvId.value] = v ?? null; },
});

// ===== 复制功能 =====
function copyAllMessages() {
  const roleLabel = (role: string) => role === 'user' ? '我' : role === 'assistant' ? 'Copilot' : '系统';
  const text = messages.value.map(m => `${roleLabel(m.role)}:\n${m.text}`).join('\n\n---\n\n');
  navigator.clipboard.writeText(text).then(() => {
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 2000);
  });
}

// ===== 滚动 =====
function scrollToBottom() {
  nextTick(() => {
    const el = messagesContainer.value;
    if (el) el.scrollTop = el.scrollHeight;
  });
}

// ===== 发送逻辑 =====
function handleSend() {
  const text = inputText.value.trim();
  if (!text) return;

  if (loadingLLM.value) {
    pendingText.value = text;
    inputText.value = '';
    return;
  }

  inputText.value = '';
  doSend(text);
}

// placeholderId → convId 映射：用于将流式 chunk 路由到发起请求的会话（而非当前活跃会话）
const _placeholderConvMap: Record<string, string> = {};

async function doSend(text: string, targetConvId?: string) {
  // 在函数开头捕获 convId，防止后续 await 期间用户切换会话导致路由错误
  const convId = targetConvId ?? currentConvId.value;
  const conv = conversations.value.find(c => c.id === convId);
  if (!conv) return;

  const id = genId();

  // 快照历史（不含当前消息），用于多轮上下文
  const history = conv.messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({ role: m.role, content: m.text }));

  conv.messages.push({ id, role: 'user', text });
  // 更新标题（第一次发消息时）
  if (conv.messages.filter(m => m.role === 'user').length === 1) {
    conv.title = autoTitle(conv);
  }
  conv.updatedAt = Date.now();
  scrollToBottom();

  try {
    _loadingMap.value[convId] = true;
    const response = await chrome.runtime.sendMessage({
      type: 'LLM_REQUEST',
      model: 'copilot',
      prompt: text,
      history,
    });

    if (response && response.success) {
      const reply = response.data && response.data.reply;
      const requestId = response.data && response.data.requestId;
      if (typeof reply === 'string' && reply.length > 0) {
        conv.messages.push({ id: 'r-' + id, role: 'assistant', text: reply });
        conv.updatedAt = Date.now();
        finishLoadingForConv(convId);
      } else if (requestId) {
        const placeholderId = 'p-' + requestId;
        conv.messages.push({ id: placeholderId, role: 'assistant', text: '' });
        // 注册路由映射：后续 chunk/reply 通过此 ID 找到正确的会话
        _placeholderConvMap[placeholderId] = convId;
        _lastMsgIdMap.value[convId] = placeholderId;
      }
    } else {
      conv.messages.push({ id: 'e-' + id, role: 'assistant', text: '请求失败: ' + (response?.error || '未知错误') });
      conv.updatedAt = Date.now();
      finishLoadingForConv(convId);
    }
  } catch (err: unknown) {
    const em = err instanceof Error ? err.message : String(err);
    conv.messages.push({ id: 'e2-' + id, role: 'assistant', text: '发送异常: ' + em });
    conv.updatedAt = Date.now();
    finishLoadingForConv(convId);
  } finally {
    scrollToBottom();
  }
}

/** 结束指定会话的 loading 状态，若有排队消息则自动发送到同一会话 */
function finishLoadingForConv(convId: string) {
  const lastId = _lastMsgIdMap.value[convId];
  if (lastId) {
    delete _placeholderConvMap[lastId];
    _lastMsgIdMap.value[convId] = null;
  }
  _loadingMap.value[convId] = false;

  const pending = _pendingMap.value[convId];
  if (pending) {
    _pendingMap.value[convId] = '';
    nextTick(() => doSend(pending, convId));
  }
}

// ===== 接收流式消息 =====
function handleIncomingMessage(msg: any) {
  if (!msg || !msg.type) return;
  if (msg.type !== 'LLM_PUSH') return;

  const payload = msg.payload;
  if (!payload) return;

  // 通过 requestId 精确定位 placeholder 和会话（requestId 由 background 转发时附带）
  const requestId = msg.requestId;
  const placeholderId = requestId ? 'p-' + requestId : Object.keys(_placeholderConvMap)[0];
  if (!placeholderId) return;

  const convId = _placeholderConvMap[placeholderId];
  if (!convId) return;

  const conv = conversations.value.find(c => c.id === convId);
  if (!conv) return;

  const chunk = payload.chunk || payload.text;
  const reply = payload.reply;

  if (chunk) {
    const idx = conv.messages.findIndex(m => m.id === placeholderId);
    if (idx !== -1) {
      conv.messages[idx].text += String(chunk);
    } else {
      // 占位消息丢失，直接追加
      conv.messages.push({ id: placeholderId, role: 'assistant', text: String(chunk) });
    }
    conv.updatedAt = Date.now();
    // 若正在查看该会话，则滚动到底部
    if (convId === currentConvId.value) scrollToBottom();
    return;
  }

  if (typeof reply === 'string') {
    const idx = conv.messages.findIndex(m => m.id === placeholderId);
    if (idx !== -1) {
      conv.messages[idx].text = String(reply);
    } else {
      conv.messages.push({ id: 'r-' + genId(), role: 'assistant', text: String(reply) });
    }
    conv.updatedAt = Date.now();
    finishLoadingForConv(convId);
    if (convId === currentConvId.value) scrollToBottom();
  }
}

// ===== 生命周期 =====
onMounted(async () => {
  await loadConversations();
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

  width: 100%;
  height: calc(100vh - 28px);
  background-color: var(--bg-deep);
  color: var(--text-primary);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}

/* ========== 历史抽屉 ========== */
.history-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 100;
  display: flex;
}

.history-drawer {
  width: 220px;
  max-width: 80%;
  height: 100%;
  background: var(--bg-base);
  border-right: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  box-shadow: 4px 0 20px rgba(0, 0, 0, 0.4);
}

.history-drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 11px 14px;
  border-bottom: 1px solid var(--border-subtle);
  background: linear-gradient(180deg, #1a2030 0%, #161b22 100%);
  flex-shrink: 0;
}

.history-drawer-title {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.history-drawer-title svg {
  width: 14px;
  height: 14px;
  color: var(--accent-blue);
}

.drawer-close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  padding: 0;
  transition: all 0.15s ease;
}

.drawer-close-btn svg { width: 13px; height: 13px; }
.drawer-close-btn:hover { background: var(--bg-hover); border-color: var(--border-subtle); color: var(--text-primary); }

.history-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

.history-group-label {
  padding: 8px 14px 4px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: var(--text-muted);
}

.history-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  cursor: pointer;
  transition: background 0.12s ease;
  border-radius: 0;
  position: relative;
}

.history-item:hover { background: var(--bg-hover); }
.history-item.active {
  background: rgba(56, 139, 253, 0.1);
  border-right: 2px solid var(--accent-blue);
}

.history-item-title {
  flex: 1;
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.history-item.active .history-item-title { color: var(--text-primary); }

.history-item-delete {
  display: none;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0;
  border-radius: 3px;
  flex-shrink: 0;
  transition: color 0.12s;
}

.history-item-delete svg { width: 10px; height: 10px; }
.history-item:hover .history-item-delete { display: flex; }
.history-item-delete:hover { color: #f87171; }

/* 后台生成中圆点 */
.history-loading-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent-blue);
  flex-shrink: 0;
  animation: historyPulse 1.2s ease-in-out infinite;
}

@keyframes historyPulse {
  0%, 100% { opacity: 0.4; transform: scale(0.85); }
  50% { opacity: 1; transform: scale(1.15); }
}

.history-empty {
  padding: 32px 14px;
  text-align: center;
  font-size: 12px;
  color: var(--text-muted);
}

/* 抽屉滑入动画 */
.history-slide-enter-active,
.history-slide-leave-active {
  transition: opacity 0.2s ease;
}
.history-slide-enter-active .history-drawer,
.history-slide-leave-active .history-drawer {
  transition: transform 0.2s ease;
}
.history-slide-enter-from,
.history-slide-leave-to { opacity: 0; }
.history-slide-enter-from .history-drawer,
.history-slide-leave-to .history-drawer { transform: translateX(-100%); }

/* 滚动条 */
.history-list::-webkit-scrollbar { width: 4px; }
.history-list::-webkit-scrollbar-track { background: transparent; }
.history-list::-webkit-scrollbar-thumb { background: var(--border-subtle); border-radius: 2px; }

/* ========== 头部 ========== */
.llm-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
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
  padding: 0;
  flex-shrink: 0;
  transition: all 0.15s ease;
}

.back-btn svg { width: 16px; height: 16px; }
.back-btn:hover { background: var(--bg-hover); border-color: var(--border-subtle); color: var(--text-primary); }
.back-btn:active { transform: scale(0.92); }

.header-title-group {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.header-icon { width: 24px; height: 24px; flex-shrink: 0; }
.header-icon svg { width: 100%; height: 100%; }

.header-conv-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

/* 通用图标按钮 */
.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  padding: 0;
  transition: all 0.15s ease;
}

.icon-btn svg { width: 14px; height: 14px; }
.icon-btn:hover { background: var(--bg-hover); border-color: var(--border-subtle); color: var(--text-primary); }
.icon-btn.active { background: rgba(56,139,253,0.12); border-color: rgba(56,139,253,0.3); color: #60a5fa; }
.icon-btn:active { transform: scale(0.9); }

/* 新建对话按钮 */
.new-chat-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 9px;
  background: rgba(56, 139, 253, 0.12);
  border: 1px solid rgba(56, 139, 253, 0.3);
  border-radius: var(--radius-sm);
  color: #60a5fa;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}

.new-chat-btn svg { width: 12px; height: 12px; }
.new-chat-btn:hover { background: rgba(56,139,253,0.2); border-color: rgba(56,139,253,0.55); color: #93c5fd; }
.new-chat-btn:active { transform: scale(0.96); }

/* ========== 策略一：流式光标 ========== */
.stream-cursor {
  display: inline-block;
  width: 1px;
  margin-left: 1px;
  color: var(--accent-blue);
  animation: cursorBlink 0.9s step-end infinite;
}

@keyframes cursorBlink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

/* ========== 策略二：打字气泡 ========== */
.typing-bubble {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 10px 13px;
  min-height: 38px;
}

.typing-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent-blue);
  opacity: 0.4;
  animation: typingBounce 1.2s ease-in-out infinite;
}

.typing-dot:nth-child(2) { animation-delay: 0.18s; }
.typing-dot:nth-child(3) { animation-delay: 0.36s; }

@keyframes typingBounce {
  0%, 80%, 100% { opacity: 0.3; transform: translateY(0); }
  40% { opacity: 1; transform: translateY(-4px); }
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

.llm-messages::-webkit-scrollbar { width: 6px; }
.llm-messages::-webkit-scrollbar-track { background: transparent; }
.llm-messages::-webkit-scrollbar-thumb { background: var(--border-subtle); border-radius: 3px; }

/* 空状态 */
.chat-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 40px 20px;
  margin: auto;
}

.chat-empty-icon { width: 72px; height: 72px; }
.chat-empty-icon svg { width: 100%; height: 100%; }
.chat-empty-text { margin: 0; font-size: 15px; font-weight: 500; color: var(--text-secondary); }
.chat-empty-hint { margin: 0; font-size: 12px; color: var(--text-muted); }

/* 消息气泡 */
.llm-message {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.llm-message.user { flex-direction: row-reverse; }

.message-avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.message-avatar svg { width: 16px; height: 16px; }
.message-avatar.user { background: linear-gradient(135deg, #1d4ed8, #2563eb); color: white; }
.message-avatar.assistant { background: linear-gradient(135deg, rgba(56,139,253,0.15), rgba(167,139,250,0.15)); color: #60a5fa; border: 1px solid rgba(96,165,250,0.2); }

.message-body { max-width: 82%; display: flex; flex-direction: column; gap: 4px; }
.llm-message.user .message-body { align-items: flex-end; }

.message-role-label {
  font-size: 11px;
  color: var(--text-muted);
  font-weight: 500;
  padding: 0 4px;
}

.message-text {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: 10px 13px;
  font-size: 13px;
  line-height: 1.7;
  word-break: break-word;
  white-space: pre-wrap;
}

.llm-message.user .message-text {
  background: linear-gradient(135deg, #1d4ed8, #2563eb);
  color: #fff;
  border-color: transparent;
  border-bottom-right-radius: 3px;
  box-shadow: 0 2px 8px rgba(29, 78, 216, 0.3);
}

.llm-message.assistant .message-text {
  border-bottom-left-radius: 3px;
  color: var(--text-primary);
}

.llm-message.system .message-text {
  background: rgba(30, 30, 20, 0.8);
  color: #fbbf24;
  border: 1px solid rgba(251, 191, 36, 0.2);
  font-size: 12px;
  border-radius: var(--radius-sm);
}

/* ========== 策略四：排队提示条 ========== */
.queue-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 14px;
  font-size: 11px;
  color: var(--text-muted);
  background: rgba(56, 139, 253, 0.05);
  border-bottom: 1px solid rgba(56, 139, 253, 0.1);
}

.queue-hint svg { width: 12px; height: 12px; flex-shrink: 0; color: var(--accent-blue); }

/* ========== 输入区域 ========== */
.llm-input-area {
  padding: 0 0 10px;
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
  margin: 8px 10px 0;
  transition: border-color 0.15s ease;
}

.input-wrapper:focus-within {
  border-color: rgba(56, 139, 253, 0.5);
  box-shadow: 0 0 0 3px rgba(56, 139, 253, 0.08);
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

.input-wrapper textarea::placeholder { color: var(--text-muted); font-style: italic; }

.send-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: var(--accent-blue);
  border: none;
  border-radius: var(--radius-md);
  color: #fff;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.15s ease;
  padding: 0;
}

.send-btn svg { width: 15px; height: 15px; }
.send-btn:hover { background: #4d9bff; }
.send-btn:active { transform: scale(0.92); }
.send-btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }
</style>
