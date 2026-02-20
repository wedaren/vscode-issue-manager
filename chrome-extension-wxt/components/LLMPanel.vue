<template>
  <div class="llm-panel">

    <!-- 历史抽屉覆盖层 -->
    <Transition name="history-slide">
      <div v-if="showHistory" class="history-overlay" @click.self="showHistory = false">
        <div class="history-drawer">

          <!-- 抽屉头部 -->
          <div class="history-drawer-header">
            <span class="history-drawer-title">
              <svg viewBox="0 0 20 20" fill="none"><path d="M10 3a7 7 0 100 14A7 7 0 0010 3z" stroke="currentColor" stroke-width="1.4"/><path d="M10 6v4l2.5 2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
              历史记录
            </span>
            <button class="drawer-close-btn" @click="showHistory = false">
              <svg viewBox="0 0 20 20" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            </button>
          </div>

          <!-- 搜索框 -->
          <div class="history-search-bar">
            <svg viewBox="0 0 16 16" fill="none"><circle cx="6.5" cy="6.5" r="4" stroke="currentColor" stroke-width="1.3"/><path d="M10 10l3 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
            <input
              v-model="historySearch"
              placeholder="搜索对话…"
              class="history-search-input"
              @keydown.escape="historySearch = ''"
            />
            <button v-if="historySearch" class="history-search-clear" @click="historySearch = ''">
              <svg viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
            </button>
          </div>

          <!-- 对话列表 -->
          <div class="history-list">
            <!-- 搜索结果：扁平列表 -->
            <template v-if="historySearch.trim()">
              <div v-if="filteredConversations.length === 0" class="history-empty">无匹配结果</div>
              <div
                v-for="conv in filteredConversations"
                :key="conv.id"
                :class="['history-item', { active: conv.id === currentConvId }]"
                @click="editingConvId !== conv.id && switchConversation(conv.id)"
              >
                <span v-if="_loadingMap[conv.id]" class="history-loading-dot"></span>
                <span class="history-item-title">{{ conv.title }}</span>
                <!-- 删除按钮 -->
                <button class="history-item-delete" title="删除" @click.stop="deleteConversation(conv.id)">
                  <svg viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
                </button>
              </div>
            </template>

            <!-- 分组列表（带拖拽排序） -->
            <template v-else-if="conversations.length > 0">
              <template v-for="group in groupedConversations" :key="group.label">
                <div class="history-group-label">{{ group.label }}</div>
                <div
                  v-for="conv in group.items"
                  :key="conv.id"
                  :class="['history-item', {
                    active: conv.id === currentConvId,
                    'drag-over': dragOverId === conv.id,
                    dragging: draggingId === conv.id,
                  }]"
                  draggable="true"
                  @dragstart="onDragStart(conv.id)"
                  @dragover.prevent="onDragOver(conv.id)"
                  @drop.prevent="onDrop(conv.id)"
                  @dragend="onDragEnd"
                  @click="editingConvId !== conv.id && draggingId === null && switchConversation(conv.id)"
                >
                  <svg class="drag-handle" viewBox="0 0 16 16" fill="none">
                    <circle cx="5" cy="5" r="1" fill="currentColor"/><circle cx="5" cy="9" r="1" fill="currentColor"/><circle cx="5" cy="13" r="1" fill="currentColor"/>
                    <circle cx="9" cy="5" r="1" fill="currentColor"/><circle cx="9" cy="9" r="1" fill="currentColor"/><circle cx="9" cy="13" r="1" fill="currentColor"/>
                  </svg>
                  <span v-if="_loadingMap[conv.id]" class="history-loading-dot"></span>
                  <span class="history-item-title">{{ conv.title }}</span>
                  <button class="history-item-delete" title="删除" @click.stop="deleteConversation(conv.id)">
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
        
        <!-- 标题区域：支持双击编辑与 AI 总结 -->
        <div class="header-title-edit" v-if="currentConv">
          <!-- 重命名输入框 -->
          <input
            v-if="editingConvId === currentConv.id && generatingTitleId !== currentConv.id"
            ref="headerTitleInput"
            class="header-rename-input"
            v-model="editingTitle"
            @keydown.enter.prevent="commitRename"
            @keydown.escape="cancelRename"
            @blur="commitRename"
          />
          <!-- 正在生成中：打字动效占位 -->
          <div v-else-if="generatingTitleId === currentConv.id" class="header-ai-generating">
            <svg class="spin" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5" stroke-dasharray="8 6"/></svg>
            <span class="generating-text">AI 生成中<span class="dot-1">.</span><span class="dot-2">.</span><span class="dot-3">.</span></span>
          </div>
          <!-- 正常标题 -->
          <h2 v-else class="header-conv-title" @dblclick="startRename(currentConv)" title="双击修改标题">
            {{ currentConv.title || '新对话' }}
          </h2>
          
          <!-- AI 总结标题按钮 (仅平时悬浮展示) -->
          <button 
            v-if="editingConvId !== currentConv.id && generatingTitleId !== currentConv.id && $data_messages && $data_messages.length > 0" 
            class="header-ai-title-btn" 
            @click="generateTitle(currentConv)" 
            title="智能生成标题"
          >
            <!-- 闪耀图标 ✨ -->
            <svg viewBox="0 0 16 16" fill="none">
              <path d="M8 1L10 6L15 8L10 10L8 15L6 10L1 8L6 6L8 1Z" fill="currentColor" fill-opacity="0.8"/>
            </svg>
          </button>
        </div>
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
      <div class="input-wrapper" style="position: relative;">
        <!-- 提及菜单 -->
        <div v-show="showMentionMenu && filteredMentions.length > 0" class="mention-menu">
          <div 
            v-for="(opt, idx) in filteredMentions" 
            :key="opt.id"
            class="mention-item"
            :class="{ active: idx === mentionSelectedIndex }"
            @mousedown.prevent="selectMention(opt)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="3" y1="9" x2="21" y2="9"></line>
              <line x1="9" y1="21" x2="9" y2="9"></line>
            </svg>
            <span>{{ opt.label }}</span>
          </div>
        </div>

        <textarea
          ref="inputRef"
          v-model="inputText"
          :placeholder="loadingLLM ? '输入下一条消息，将在回复完成后自动发送…' : '输入消息，Enter 发送，Shift+Enter 换行…'"
          @input="handleInput"
          @keydown.up="handleMentionUp"
          @keydown.down="handleMentionDown"
          @keydown.enter.exact.prevent="handleEnter"
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
  pageContext?: { title: string; text: string }; // 隐藏的网页上下文，用于发给 LLM 但不在界面展示长内容
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

// ===== 搜索 =====
const historySearch = ref('');
const filteredConversations = computed(() => {
  const q = historySearch.value.trim().toLowerCase();
  if (!q) return conversations.value;
  return conversations.value.filter(c => c.title.toLowerCase().includes(q));
});

// ===== 重命名与 AI 生成标题 =====
const editingConvId = ref<string | null>(null);
const editingTitle = ref('');
const headerTitleInput = ref<HTMLInputElement | null>(null);
const generatingTitleId = ref<string | null>(null);

// 为了在模板中用 v-if 检查 length 且不覆盖全局 ref，导出 computed 的别名
const $data_messages = computed(() => messages.value);

function startRename(conv: Conversation) {
  editingConvId.value = conv.id;
  editingTitle.value = conv.title;
  nextTick(() => {
    headerTitleInput.value?.focus();
    headerTitleInput.value?.select();
  });
}

function commitRename() {
  const id = editingConvId.value;
  if (!id) return;
  const conv = conversations.value.find(c => c.id === id);
  if (conv) {
    const trimmed = editingTitle.value.trim();
    if (trimmed) conv.title = trimmed;
  }
  editingConvId.value = null;
}

function cancelRename() {
  editingConvId.value = null;
}

// 记录每个请求追踪的 title 生成 requestId -> convId 映射
const _titleGenMap: Record<string, string> = {};
// 累积生成标题的流式内容
const _titleGenBuffer: Record<string, string> = {};

async function generateTitle(conv: Conversation) {
  if (generatingTitleId.value === conv.id) return;
  
  // 提取历史文本
  const textContext = conv.messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`)
    .join('\n\n')
    .slice(0, 4000); // 截取前面一部分供总结即可
    
  if (!textContext.trim()) return;

  generatingTitleId.value = conv.id;
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'LLM_REQUEST',
      model: 'copilot',
      prompt: "Based on the following conversation, generate a short, concise, and descriptive title (maximum 15 characters, no quotes or punctuation at the start/end). Output ONLY the title text.\n\n" + textContext,
      history: []
    });

    if (response && response.success && response.data?.requestId) {
      // 成功发起请求，将其 requestId 注册，让流式拦截器处理后续
      const reqId = response.data.requestId;
      _titleGenMap[reqId] = conv.id;
      _titleGenBuffer[reqId] = '';
    } else {
      // 发起失败
      generatingTitleId.value = null;
    }
  } catch (e) {
    console.error('[LLMPanel] Failed to generate title', e);
    generatingTitleId.value = null;
  }
}

// ===== 拖拽排序 =====
const draggingId = ref<string | null>(null);
const dragOverId = ref<string | null>(null);

function onDragStart(convId: string) {
  draggingId.value = convId;
}

function onDragOver(convId: string) {
  if (convId !== draggingId.value) { dragOverId.value = convId; }
}

function onDrop(targetId: string) {
  const fromId = draggingId.value;
  if (!fromId || fromId === targetId) return;
  const arr = conversations.value;
  const fromIdx = arr.findIndex(c => c.id === fromId);
  const toIdx = arr.findIndex(c => c.id === targetId);
  if (fromIdx === -1 || toIdx === -1) return;
  const [item] = arr.splice(fromIdx, 1);
  arr.splice(toIdx, 0, item);
}

function onDragEnd() {
  draggingId.value = null;
  dragOverId.value = null;
}

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

// ===== 提取网页上下文 =====
const fetchingPage = ref(false);



// ===== 滚动 =====
function scrollToBottom() {
  nextTick(() => {
    const el = messagesContainer.value;
    if (el) el.scrollTop = el.scrollHeight;
  });
}

// ===== # 提及菜单 (Mention) 与区域选取状态 =====
const inputRef = ref<HTMLTextAreaElement | null>(null);
const showMentionMenu = ref(false);
const mentionSearch = ref('');
const mentionSelectedIndex = ref(0);

// 用于保存通过 #当前区域 触发获取到的独立上下文
const selectedAreaContext = ref<{ title: string; text: string } | null>(null);

const mentionOptions = [
  { id: 'page', label: '当前网页' },
  { id: 'selection', label: '当前划选' },
  { id: 'area', label: '当前区域' }
];

const filteredMentions = computed(() => {
  const q = mentionSearch.value.toLowerCase();
  return mentionOptions.filter(o => o.label.toLowerCase().includes(q));
});

function handleInput(e: Event) {
  const el = e.target as HTMLTextAreaElement;
  const cursor = el.selectionStart;
  const textBeforeCursor = inputText.value.slice(0, cursor);
  const match = textBeforeCursor.match(/#([^\s#]*)$/);
  
  if (match) {
    showMentionMenu.value = true;
    mentionSearch.value = match[1];
    mentionSelectedIndex.value = 0;
  } else {
    showMentionMenu.value = false;
  }
}

// 监听完整的手写输入或者别的触发方式，一旦完整的 "#当前区域" 出现在文本中并且尚未有选区数据，立即触发。
// 为防止多次触发，也可以绑定在 selectMention 里为主，手输的则依靠 watch 文本正则查找。
watch(inputText, (newVal, oldVal) => {
  if (newVal.endsWith('#当前区域') && !oldVal.endsWith('#当前区域')) {
    triggerAreaSelection();
  }
});

async function triggerAreaSelection() {
  if (fetchingPage.value) return;
  fetchingPage.value = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'START_LLM_SELECTION' });
    if (response && response.success && response.data?.html) {
      const pageTitle = response.data.title || '指定区域';
      const areaHtml = response.data.html.trim();
      selectedAreaContext.value = {
        title: pageTitle,
        text: `\n--- 页面指定区域结构 ---\n${areaHtml}\n`
      };
      // 可选：将 #当前区域 替换成选中成功标记，让用户感知到已经绑定数据
      inputText.value = inputText.value.replace(/#当前区域/g, `【已选定区域: ${pageTitle}】`);
    } else {
      console.warn('[LLMPanel] #当前区域 选取失败或取消:', response?.error);
      inputText.value = inputText.value.replace(/#当前区域/g, ''); // 取消则移除标签
    }
  } catch (err) {
    console.error('[LLMPanel] 触发区域选取异常', err);
    inputText.value = inputText.value.replace(/#当前区域/g, '');
  } finally {
    fetchingPage.value = false;
  }
}

function handleMentionUp(e: KeyboardEvent) {
  if (showMentionMenu.value && filteredMentions.value.length > 0) {
    e.preventDefault();
    mentionSelectedIndex.value = (mentionSelectedIndex.value - 1 + filteredMentions.value.length) % filteredMentions.value.length;
  }
}

function handleMentionDown(e: KeyboardEvent) {
  if (showMentionMenu.value && filteredMentions.value.length > 0) {
    e.preventDefault();
    mentionSelectedIndex.value = (mentionSelectedIndex.value + 1) % filteredMentions.value.length;
  }
}

function handleEnter(e: KeyboardEvent) {
  if (showMentionMenu.value && filteredMentions.value.length > 0) {
    e.preventDefault();
    selectMention(filteredMentions.value[mentionSelectedIndex.value]);
    return;
  }
  handleSend();
}

function selectMention(option: { id: string, label: string }) {
  const el = inputRef.value;
  if (!el) return;
  const cursor = el.selectionStart;
  const textBeforeCursor = inputText.value.slice(0, cursor);
  const match = textBeforeCursor.match(/#([^\s#]*)$/);
  
  if (match) {
    const textAfterCursor = inputText.value.slice(cursor);
    const replacement = `#${option.label} `;
    
    inputText.value = textBeforeCursor.slice(0, match.index) + replacement + textAfterCursor;
    showMentionMenu.value = false;
    
    nextTick(() => {
      const newCursor = (match.index || 0) + replacement.length;
      el.setSelectionRange(newCursor, newCursor);
      el.focus();
      if (option.id === 'area') {
        triggerAreaSelection();
      }
    });
  }
}

// ===== 发送逻辑 =====
async function handleSend() {
  const text = inputText.value.trim();
  if (!text) return;

  if (loadingLLM.value) {
    pendingText.value = text;
    inputText.value = '';
    return;
  }

  inputText.value = '';
  showMentionMenu.value = false;
  
  let finalPrompt = text;
  let pageContextData: { title: string; text: string } | undefined;

  // 标记是否需要请求
  const needsPage = finalPrompt.includes('#当前网页');
  const needsSelection = finalPrompt.includes('#当前划选');
  // 已选中的区域直接从 selectedAreaContext 取

  if (needsPage || needsSelection || selectedAreaContext.value) {
    fetchingPage.value = true;
    try {
      let mergedText = '';
      let pageTitle = '当前网页';

      if (needsPage) {
        const response = await chrome.runtime.sendMessage({ type: 'GET_PAGE_CONTENT' });
        if (response && response.success && response.data?.text) {
          pageTitle = response.data.title || '当前网页';
          finalPrompt = finalPrompt.replace(/#当前网页/g, `【已引用当前网页上下文: ${pageTitle}】`);
          mergedText += `\n--- 网页全文 ---\n${response.data.text.trim()}\n`;
        } else {
          console.warn('[LLMPanel] #当前网页 引用内容失败:', response?.error);
        }
      }

      if (needsSelection) {
        const response = await chrome.runtime.sendMessage({ type: 'GET_PAGE_SELECTION' });
        if (response && response.success && response.data?.text) {
          pageTitle = response.data.title || pageTitle; // 以防未请求全文时需要 title
          finalPrompt = finalPrompt.replace(/#当前划选/g, `【已引用网页当前划选部分: ${pageTitle}】`);
          mergedText += `\n--- 网页划选内容 ---\n${response.data.text.trim()}\n`;
        } else {
          console.warn('[LLMPanel] #当前划选 引用内容失败:', response?.error);
        }
      }

      if (selectedAreaContext.value) {
        pageTitle = selectedAreaContext.value.title || pageTitle;
        mergedText += selectedAreaContext.value.text;
        selectedAreaContext.value = null; // 消费后清空
      }

      if (mergedText) {
        pageContextData = { title: pageTitle, text: mergedText };
      }

    } catch (err) {
      console.error('[LLMPanel] 提取网页 API 异常', err);
    } finally {
      fetchingPage.value = false;
    }
  }

  doSend(finalPrompt, currentConvId.value, pageContextData);
}

// placeholderId → convId 映射：用于将流式 chunk 路由到发起请求的会话（而非当前活跃会话）
const _placeholderConvMap: Record<string, string> = {};

async function doSend(text: string, targetConvId?: string, pageContextData?: { title: string; text: string }) {
  // 在函数开头捕获 convId，防止后续 await 期间用户切换会话导致路由错误
  const convId = targetConvId ?? currentConvId.value;
  const conv = conversations.value.find(c => c.id === convId);
  if (!conv) return;

  const id = genId();

  // 快照历史（不含当前消息），组装给后端的完整上下文
  const history = conv.messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => {
      let content = m.text;
      if (m.pageContext) {
        content = `${content}\n\n\`\`\`page-context\n【当前网页: ${m.pageContext.title}】\n${m.pageContext.text}\n\`\`\``;
      }
      return { role: m.role, content };
    });

  // UI 展示的消息体
  conv.messages.push({ id, role: 'user', text, pageContext: pageContextData });
  // 更新标题（第一次发消息时）
  if (conv.messages.filter(m => m.role === 'user').length === 1) {
    conv.title = autoTitle(conv);
  }
  conv.updatedAt = Date.now();
  scrollToBottom();

  try {
    _loadingMap.value[convId] = true;
    
    let realPrompt = text;
    if (pageContextData) {
      realPrompt = `${realPrompt}\n\n\`\`\`page-context\n【当前网页: ${pageContextData.title}】\n${pageContextData.text}\n\`\`\`\n`;
    }

    const response = await chrome.runtime.sendMessage({
      type: 'LLM_REQUEST',
      model: 'copilot',
      prompt: realPrompt,
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

  const requestId: string = msg.requestId;
  
  // 1. 拦截标题生成任务
  if (requestId && _titleGenMap[requestId]) {
    const genConvId = _titleGenMap[requestId];
    const targetConv = conversations.value.find(c => c.id === genConvId);
    
    if (payload.chunk) {
      _titleGenBuffer[requestId] += String(payload.chunk);
    } else if (typeof payload.reply === 'string') {
      const fullText = (payload.reply || _titleGenBuffer[requestId]).trim().replace(/^["']|["']$/g, '');
      if (fullText && targetConv) targetConv.title = fullText;
      // 清理状态
      delete _titleGenMap[requestId];
      delete _titleGenBuffer[requestId];
      if (generatingTitleId.value === genConvId) {
        generatingTitleId.value = null;
      }
    } else if (payload.event === 'error') {
      delete _titleGenMap[requestId];
      delete _titleGenBuffer[requestId];
      if (generatingTitleId.value === genConvId) generatingTitleId.value = null;
    }
    return;
  }

  // 2. 正常聊天流任务
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

.history-search-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: var(--bg-deep);
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.history-search-bar svg {
  width: 14px;
  height: 14px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.history-search-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: var(--text-primary);
  font-size: 12px;
}

.history-search-input::placeholder {
  color: var(--text-muted);
}

.history-search-clear {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  background: rgba(255, 255, 255, 0.1);
  border: none;
  border-radius: 50%;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0;
}

.history-search-clear:hover {
  background: rgba(255, 255, 255, 0.2);
  color: var(--text-primary);
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

.history-item.drag-over {
  border-top: 2px solid var(--accent-blue);
}

.history-item.dragging {
  opacity: 0.5;
  background: var(--bg-hover);
}

.drag-handle {
  width: 12px;
  height: 12px;
  color: var(--text-muted);
  cursor: grab;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.12s;
}

.history-item:hover .drag-handle {
  opacity: 0.6;
}

.drag-handle:hover {
  opacity: 1;
}

.history-rename-input {
  flex: 1;
  background: var(--bg-deep);
  border: 1px solid var(--accent-blue);
  color: var(--text-primary);
  font-size: 12px;
  padding: 2px 4px;
  border-radius: 3px;
  outline: none;
  min-width: 0;
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

.header-title-edit {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.header-conv-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: text;
  padding: 2px 4px;
  border-radius: 4px;
  transition: background 0.15s;
}

.header-conv-title:hover {
  background: rgba(255,255,255,0.05);
}

.header-rename-input {
  flex: 1;
  background: rgba(0,0,0,0.3);
  border: 1px solid var(--accent-blue);
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 600;
  padding: 2px 4px;
  border-radius: 4px;
  outline: none;
  min-width: 0;
}

/* AI 生成中占位 */
.header-ai-generating {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #fbbf24;
  font-size: 13px;
  font-weight: 600;
  padding: 2px 4px;
  border-radius: 4px;
  background: rgba(251, 191, 36, 0.1);
  border: 1px solid rgba(251, 191, 36, 0.2);
}

.header-ai-generating svg {
  width: 14px;
  height: 14px;
}

.generating-text .dot-1, .generating-text .dot-2, .generating-text .dot-3 {
  opacity: 0;
  animation: dotBlink 1.4s infinite;
}
.generating-text .dot-2 { animation-delay: 0.2s; }
.generating-text .dot-3 { animation-delay: 0.4s; }

@keyframes dotBlink {
  0% { opacity: 0; }
  20% { opacity: 1; }
  80% { opacity: 1; }
  100% { opacity: 0; }
}

/* 总结按钮 */
.header-ai-title-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: #fbbf24; /* 闪亮的金黄色 */
  cursor: pointer;
  padding: 0;
  opacity: 0; /* 平时隐藏，悬浮出现 */
  transition: all 0.2s;
  flex-shrink: 0;
}

.header-title-edit:hover .header-ai-title-btn {
  opacity: 0.4;
}

.header-ai-title-btn:hover {
  opacity: 1 !important;
  background: rgba(251, 191, 36, 0.15);
  transform: scale(1.1);
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  100% { transform: rotate(360deg); }
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



/* ========== 消息区域 ========== */
.llm-messages {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
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
  gap: 8px;
  align-items: flex-start;
}

.llm-message.user { flex-direction: row-reverse; }

.message-avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 2px;
}

.message-avatar svg { width: 14px; height: 14px; }
.message-avatar.user { background: linear-gradient(135deg, #1d4ed8, #2563eb); color: white; }
.message-avatar.assistant { background: linear-gradient(135deg, rgba(56,139,253,0.15), rgba(167,139,250,0.15)); color: #60a5fa; border: 1px solid rgba(96,165,250,0.2); }

.message-body { max-width: 85%; display: flex; flex-direction: column; gap: 2px; }
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
  padding: 8px 12px;
  font-size: 13px;
  line-height: 1.5;
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
  padding: 0 0 8px;
  border-top: 1px solid var(--border-subtle);
  background: var(--bg-base);
  flex-shrink: 0;
}

/* ========== 提及菜单 ========== */
.mention-menu {
  position: absolute;
  bottom: 100%;
  left: 0;
  margin-bottom: 8px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  padding: 4px;
  min-width: 140px;
  z-index: 100;
}

.mention-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  font-size: 13px;
  color: var(--text-primary);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.1s;
}

.mention-item:hover,
.mention-item.active {
  background: rgba(56, 139, 253, 0.15);
  color: #60a5fa;
}

.mention-item svg { width: 14px; height: 14px; color: currentColor; }

.input-wrapper {
  position: relative;
  display: flex;
  align-items: flex-end;
  gap: 8px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  padding: 6px 6px 6px 12px;
  margin: 6px 10px 0;
  transition: border-color 0.15s ease;
}

.input-wrapper:focus-within {
  border-color: rgba(56, 139, 253, 0.5);
  box-shadow: 0 0 0 3px rgba(56, 139, 253, 0.08);
}

.input-wrapper textarea {
  flex: 1 1 auto;
  min-height: 28px;
  max-height: 160px;
  resize: none;
  background: transparent;
  color: var(--text-primary);
  border: none;
  outline: none;
  font-size: 13px;
  line-height: 1.5;
  font-family: inherit;
  padding: 4px 0;
}

.input-wrapper textarea::placeholder { color: var(--text-muted); font-style: italic; }

.send-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: var(--accent-blue);
  border: none;
  border-radius: 6px;
  color: #fff;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.15s ease;
  padding: 0;
  margin-bottom: 2px;
}

.send-btn svg { width: 14px; height: 14px; }
.send-btn:hover { background: #4d9bff; }
.send-btn:active { transform: scale(0.92); }
.send-btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }

.page-context-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: transparent;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  color: var(--text-secondary);
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.15s ease;
  padding: 0;
  margin-bottom: 2px;
}
.page-context-btn svg { width: 14px; height: 14px; }
.page-context-btn:hover { background: var(--bg-hover); color: var(--text-primary); border-color: var(--accent-blue); }
.page-context-btn:active { transform: scale(0.92); }
.page-context-btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }
</style>
