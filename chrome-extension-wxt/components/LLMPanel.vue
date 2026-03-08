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
        <!-- 模型选择下拉 -->
        <div class="model-select-wrapper" :class="{ open: showModelMenu }">
          <button
            class="model-select-btn"
            @click="!modelsLoading && (showModelMenu = !showModelMenu)"
            :title="selectedModel ? selectedModel.family : '加载模型中…'"
            :disabled="modelsLoading"
          >
            <!-- 加载中：旋转图标 -->
            <svg v-if="modelsLoading" class="model-spin" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.6" stroke-dasharray="10 6" opacity="0.7"/>
            </svg>
            <!-- 已加载：AI 芯片图标 -->
            <svg v-else viewBox="0 0 20 20" fill="none">
              <rect x="2" y="5" width="16" height="11" rx="2.5" stroke="currentColor" stroke-width="1.4"/>
              <path d="M6 10h3l1.5 2L13 8l1.5 2H16" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span class="model-select-label">
              {{ modelsLoading ? '加载中' : (selectedModel ? selectedModel.family : '选择模型') }}
            </span>
            <svg class="model-arrow" viewBox="0 0 12 12" fill="none">
              <path d="M2 4.5l4 3 4-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <Transition name="model-menu">
            <div v-if="showModelMenu" class="model-menu" @click.stop>
              <!-- 错误状态 -->
              <div v-if="modelsError" class="model-menu-error">
                <span>{{ modelsError }}</span>
                <button class="model-retry-btn" @click="loadModels">重试</button>
              </div>
              <!-- 模型列表 -->
              <template v-else>
                <div
                  v-for="m in availableModels"
                  :key="m.id"
                  :class="['model-menu-item', { active: selectedModel && m.family === selectedModel.family }]"
                  @click="selectModel(m)"
                >
                  <span class="model-menu-name">{{ m.family }}</span>
                  <span class="model-menu-ctx">{{ formatTokenCount(m.maxInputTokens) }}</span>
                  <svg v-if="selectedModel && m.family === selectedModel.family" viewBox="0 0 16 16" fill="none">
                    <path d="M3 8l4 4 6-7" stroke="#60a5fa" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </div>
              </template>
            </div>
          </Transition>
        </div>
        <!-- 复制全部 -->
        <button v-if="messages.length > 0" class="icon-btn copy-all-btn" @click="copyAllMessages" :title="copied ? '已复制！' : '复制全部对话'">
          <svg v-if="!copied" viewBox="0 0 20 20" fill="none"><rect x="7" y="4" width="9" height="12" rx="1.5" stroke="currentColor" stroke-width="1.5"/><path d="M5 7H4a1 1 0 00-1 1v8a1 1 0 001 1h8a1 1 0 001-1v-1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          <svg v-else viewBox="0 0 20 20" fill="none"><path d="M4 10l4 4 8-8" stroke="#34d399" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <!-- 历史记录 -->
        <button class="icon-btn" :class="{ active: showHistory }" @click="showHistory = !showHistory" title="历史记录">
          <svg viewBox="0 0 20 20" fill="none"><path d="M10 3a7 7 0 100 14A7 7 0 0010 3z" stroke="currentColor" stroke-width="1.4"/><path d="M10 6v4l2.5 2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
        </button>
        <!-- 日志面板开关 -->
        <button class="icon-btn" :class="{ active: showLogPanel }" @click="showLogPanel = !showLogPanel" title="调用日志">
          <svg viewBox="0 0 20 20" fill="none">
            <rect x="2" y="3" width="16" height="14" rx="2" stroke="currentColor" stroke-width="1.4"/>
            <path d="M5 7h3M5 10h6M5 13h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
            <circle v-if="llmLogs.length > 0" cx="15" cy="5" r="3" fill="#f59e0b"/>
          </svg>
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
        <p class="chat-empty-text">和 {{ selectedModel ? selectedModel.family : 'AI' }} 开始对话</p>
        <p class="chat-empty-hint">输入消息后按回车发送</p>
      </div>

      <!-- 消息气泡 -->
      <div v-for="msg in messages" :key="msg.id" :class="['llm-message', msg.role]">
        <!-- 工具调用卡片 -->
        <template v-if="(msg.role as string) === 'tool'">
          <div
            class="tool-call-card"
            :class="[msg.toolPhase, { expandable: msg.toolResult }]"
            @click="msg.toolResult ? toggleToolExpand(msg) : undefined"
          >
            <div class="tool-call-header">
              <!-- 状态图标 -->
              <svg v-if="msg.toolPhase === 'calling'" class="tool-icon tool-spin" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4" stroke-dasharray="8 5"/>
              </svg>
              <svg v-else-if="msg.toolPhase === 'error'" class="tool-icon" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4"/>
                <path d="M8 5v3.5M8 10.5v.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
              </svg>
              <svg v-else class="tool-icon" viewBox="0 0 16 16" fill="none">
                <path d="M3 8l4 4 6-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <!-- 工具名 + 摘要 -->
              <span class="tool-call-label">{{ getToolLabel(msg.toolName) }}</span>
              <span v-if="msg.text" class="tool-call-summary">{{ msg.text }}</span>
              <!-- 展开箭头 -->
              <svg v-if="msg.toolResult" class="tool-expand-arrow" :class="{ expanded: msg.toolExpanded }" viewBox="0 0 16 16" fill="none">
                <path d="M5 6.5l3 3 3-3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
            <!-- 展开的结果详情 -->
            <div v-if="msg.toolExpanded && msg.toolResult" class="tool-result-detail">
              {{ msg.toolResult }}
            </div>
          </div>
        </template>
        <!-- 普通消息（用户 / 助手 / 系统） -->
        <template v-else>
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
            <div class="message-role-label">{{ msg.role === 'user' ? '我' : msg.role === 'assistant' ? (selectedModel ? selectedModel.family : 'AI') : '系统' }}</div>
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
        </template>
      </div>
    </div>

    <!-- 日志面板 -->
    <Transition name="log-panel">
      <div v-if="showLogPanel" class="llm-log-panel">
        <div class="log-panel-header">
          <span class="log-panel-title">
            <svg viewBox="0 0 16 16" fill="none">
              <rect x="1" y="2" width="14" height="12" rx="2" stroke="currentColor" stroke-width="1.2"/>
              <path d="M3 5.5h4M3 8h6M3 10.5h3" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
            </svg>
            调用日志
            <span class="log-count">{{ llmLogs.length }}</span>
          </span>
          <button class="log-clear-btn" @click="llmLogs = []" title="清空日志">清空</button>
        </div>
        <div class="log-entries" ref="logEntriesEl">
          <div v-if="llmLogs.length === 0" class="log-empty">暂无日志</div>
          <div
            v-for="entry in llmLogs"
            :key="entry.id"
            :class="['log-entry', entry.level]"
          >
            <span class="log-ts">{{ entry.tsStr }}</span>
            <span class="log-badge" :class="entry.level">{{ entry.level === 'info' ? 'I' : entry.level === 'warn' ? 'W' : 'E' }}</span>
            <span class="log-msg">{{ entry.message }}</span>
          </div>
        </div>
      </div>
    </Transition>

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
        <!-- 工具开关 -->
        <button
          class="tools-toggle-btn"
          :class="{ active: toolsEnabled }"
          @click="toolsEnabled = !toolsEnabled"
          :title="toolsEnabled ? '工具已启用（点击关闭）' : '启用工具调用'"
        >
          <svg viewBox="0 0 20 20" fill="none">
            <path d="M15.5 4.5l-3 3-1.5-1.5 3-3A4 4 0 005 8a4 4 0 00.3 1.5L3 11.8A2 2 0 006.2 15l2.3-2.3A4 4 0 0015.5 4.5z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
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

// ===== 模型选项 =====
interface CopilotModel {
  id: string;
  family: string;
  vendor: string;
  maxInputTokens: number;
}

const MODEL_STORAGE_KEY = 'llm_selected_model';
const TOOLS_STORAGE_KEY = 'llm_tools_enabled';

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${Math.round(n / 100_000) / 10}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

const availableModels = ref<CopilotModel[]>([]);
const modelsLoading = ref(false);
const modelsError = ref<string | null>(null);
const _savedModelFamily = localStorage.getItem(MODEL_STORAGE_KEY) || '';
const selectedModel = ref<CopilotModel | null>(null);

async function loadModels() {
  modelsLoading.value = true;
  modelsError.value = null;
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'GET_LLM_MODELS' }) as
      { success: boolean; data?: CopilotModel[]; error?: string };
    if (resp && resp.success && Array.isArray(resp.data) && resp.data.length > 0) {
      availableModels.value = resp.data;
      const saved = resp.data.find(m => m.family === _savedModelFamily);
      selectedModel.value = saved ?? resp.data[0];
    } else {
      modelsError.value = resp?.error || '未找到可用模型';
    }
  } catch (e) {
    modelsError.value = e instanceof Error ? e.message : String(e);
    console.error('[LLMPanel] 加载模型列表失败', e);
  } finally {
    modelsLoading.value = false;
  }
}

const showModelMenu = ref(false);

function selectModel(m: CopilotModel) {
  selectedModel.value = m;
  showModelMenu.value = false;
  localStorage.setItem(MODEL_STORAGE_KEY, m.family);
}

// ===== 工具调用开关（默认开启：Chrome 面板的核心能力依赖工具调用） =====
const toolsEnabled = ref(localStorage.getItem(TOOLS_STORAGE_KEY) !== 'false');
watch(toolsEnabled, v => localStorage.setItem(TOOLS_STORAGE_KEY, String(v)));

function handleOutsideClick(e: MouseEvent) {
  const target = e.target as HTMLElement;
  if (!target.closest('.model-select-wrapper')) {
    showModelMenu.value = false;
  }
}

// ===== 类型定义 =====
/** UI 消息（含 tool 等临时状态） */
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  text: string;
  toolName?: string;
  toolPhase?: 'calling' | 'done' | 'error';
  toolResult?: string;
  toolExpanded?: boolean;
  pageContext?: { title: string; text: string };
}

/** 轻量对话元数据（来自 issueMarkdown 后端） */
interface ConvMeta {
  id: string;
  title: string;
  mtime: number;
}

interface LlmPushPayload {
  chunk?: string;
  text?: string;
  reply?: string;
  event?: string;
  error?: string;
  toolName?: string;
  summary?: string;
  preview?: string;
  success?: boolean;
}

interface RuntimeLlmPushMessage {
  type: 'LLM_PUSH';
  payload?: LlmPushPayload;
  requestId?: string;
}

// ===== 工具函数 =====
function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

/** 工具中文名映射 */
const TOOL_LABELS: Record<string, string> = {
  open_tab: '打开标签页',
  get_tab_content: '读取页面内容',
  activate_tab: '切换标签页',
  list_tabs: '列出标签页',
  organize_tabs: '整理标签页',
  close_tabs: '关闭标签页',
  get_page_elements: '获取页面元素',
  click_element: '点击元素',
  fill_input: '填写输入框',
  select_option: '选择下拉项',
  press_key: '模拟按键',
  web_search: '网络搜索',
  fetch_url: '抓取网页',
  search_issues: '检索笔记',
  read_issue: '读取笔记',
  create_issue: '创建笔记',
  create_issue_tree: '创建笔记树',
  list_issue_tree: '笔记结构',
  update_issue: '更新笔记',
};

function getToolLabel(name?: string): string {
  return (name && TOOL_LABELS[name]) || name || '工具';
}

function toggleToolExpand(msg: ChatMessage) {
  msg.toolExpanded = !msg.toolExpanded;
  touchMessages();
}

/** 取第一条 user 消息前 22 字作为标题 */
function autoTitle(msgs: ChatMessage[]): string {
  const first = msgs.find(m => m.role === 'user');
  if (!first) return '新对话';
  return first.text.trim().slice(0, 22) + (first.text.trim().length > 22 ? '…' : '');
}

// ===== 多会话状态（元数据来自 issueMarkdown 后端） =====
const conversations = ref<ConvMeta[]>([]);
const currentConvId = ref<string>('');
const showHistory = ref(false);

/** 每个会话的消息缓存（内存） */
const _convMessages: Record<string, ChatMessage[]> = {};

/** 获取指定会话的消息列表（确保缓存存在） */
function getConvMessages(convId: string): ChatMessage[] {
  if (!_convMessages[convId]) {
    _convMessages[convId] = [];
  }
  return _convMessages[convId];
}

// ===== 日志面板 =====
interface LlmLogEntry {
  id: string;
  ts: number;
  tsStr: string;
  level: 'info' | 'warn' | 'error';
  message: string;
}

const llmLogs = ref<LlmLogEntry[]>([]);
const showLogPanel = ref(false);
const logEntriesEl = ref<HTMLElement | null>(null);
const MAX_LOGS = 200;

function addLog(level: LlmLogEntry['level'], message: string) {
  const now = new Date();
  const tsStr = now.toTimeString().slice(0, 8);
  llmLogs.value.push({ id: `log-${Date.now()}-${Math.random()}`, ts: now.getTime(), tsStr, level, message });
  if (llmLogs.value.length > MAX_LOGS) {
    llmLogs.value.splice(0, llmLogs.value.length - MAX_LOGS);
  }
  if (showLogPanel.value) {
    nextTick(() => {
      if (logEntriesEl.value) {
        logEntriesEl.value.scrollTop = logEntriesEl.value.scrollHeight;
      }
    });
  }
}

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

const $data_messages = computed(() => messages.value);

function startRename(conv: ConvMeta) {
  editingConvId.value = conv.id;
  editingTitle.value = conv.title;
  nextTick(() => {
    headerTitleInput.value?.focus();
    headerTitleInput.value?.select();
  });
}

async function commitRename() {
  const id = editingConvId.value;
  if (!id) return;
  const trimmed = editingTitle.value.trim();
  editingConvId.value = null;
  if (!trimmed) return;

  const conv = conversations.value.find(c => c.id === id);
  if (conv) conv.title = trimmed;

  // 持久化到 issueMarkdown
  try {
    await chrome.runtime.sendMessage({ type: 'CHROME_CHAT_RENAME', convId: id, title: trimmed });
  } catch (e) {
    console.error('[LLMPanel] 重命名失败', e);
  }
}

function cancelRename() {
  editingConvId.value = null;
}

const _titleGenMap: Record<string, string> = {};
const _titleGenBuffer: Record<string, string> = {};

async function generateTitle(conv: ConvMeta) {
  if (generatingTitleId.value === conv.id) return;

  const msgs = getConvMessages(conv.id);
  const textContext = msgs
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`)
    .join('\n\n')
    .slice(0, 4000);

  if (!textContext.trim()) return;

  generatingTitleId.value = conv.id;
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'LLM_REQUEST',
      model: selectedModel.value?.family ?? 'copilot',
      prompt: "Based on the following conversation, generate a short, concise, and descriptive title (maximum 15 characters, no quotes or punctuation at the start/end). Output ONLY the title text.\n\n" + textContext,
      history: []
    });

    if (response && response.success && response.data?.requestId) {
      const reqId = response.data.requestId;
      _titleGenMap[reqId] = conv.id;
      _titleGenBuffer[reqId] = '';
    } else {
      generatingTitleId.value = null;
    }
  } catch (e) {
    console.error('[LLMPanel] Failed to generate title', e);
    generatingTitleId.value = null;
  }
}

// ===== 拖拽排序（仅 UI 层，不持久化顺序） =====
const draggingId = ref<string | null>(null);
const dragOverId = ref<string | null>(null);

function onDragStart(convId: string) { draggingId.value = convId; }
function onDragOver(convId: string) { if (convId !== draggingId.value) dragOverId.value = convId; }
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
function onDragEnd() { draggingId.value = null; dragOverId.value = null; }

const currentConv = computed(() =>
  conversations.value.find(c => c.id === currentConvId.value)
);

/** 当前会话的消息（响应式触发器通过 _msgTrigger 驱动） */
const _msgTrigger = ref(0);
const messages = computed(() => {
  void _msgTrigger.value; // 依赖此触发器
  return currentConvId.value ? getConvMessages(currentConvId.value) : [];
});

/** 手动触发 messages computed 刷新 */
function touchMessages() { _msgTrigger.value++; }

/** 按今天/昨天/更早分组 */
const groupedConversations = computed(() => {
  const todayStart = new Date().setHours(0, 0, 0, 0);
  const yesterdayStart = todayStart - 86400000;
  const sorted = [...conversations.value].sort((a, b) => b.mtime - a.mtime);

  const todayItems = sorted.filter(c => c.mtime >= todayStart);
  const yesterdayItems = sorted.filter(c => c.mtime >= yesterdayStart && c.mtime < todayStart);
  const olderItems = sorted.filter(c => c.mtime < yesterdayStart);

  const groups: { label: string; items: ConvMeta[] }[] = [];
  if (todayItems.length) groups.push({ label: '今天', items: todayItems });
  if (yesterdayItems.length) groups.push({ label: '昨天', items: yesterdayItems });
  if (olderItems.length) groups.push({ label: '更早', items: olderItems });
  return groups;
});

// ===== 持久化：issueMarkdown 文件（通过 WebSocket → VS Code） =====

/** 从后端加载对话列表 */
async function loadConversationList() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'CHROME_CHAT_LIST' }) as
      { success: boolean; data?: ConvMeta[]; error?: string };
    if (resp && resp.success && Array.isArray(resp.data)) {
      conversations.value = resp.data;
      if (resp.data.length > 0) {
        // 选择最近的对话
        const latest = [...resp.data].sort((a, b) => b.mtime - a.mtime)[0];
        currentConvId.value = latest.id;
        await loadMessages(latest.id);
      } else {
        // 无对话，自动创建
        await newConversation();
      }
    } else {
      console.error('[LLMPanel] 加载对话列表失败:', resp?.error);
      await newConversation();
    }
  } catch (e) {
    console.error('[LLMPanel] 加载对话列表异常:', e);
    await newConversation();
  }
}

/** 从后端加载指定对话的消息 */
async function loadMessages(convId: string) {
  // 若已有缓存且非空，跳过加载
  if (_convMessages[convId] && _convMessages[convId].length > 0) return;

  try {
    const resp = await chrome.runtime.sendMessage({ type: 'CHROME_CHAT_MESSAGES', convId }) as
      { success: boolean; data?: Array<{ role: string; content: string; timestamp: number }>; error?: string };
    if (resp && resp.success && Array.isArray(resp.data)) {
      _convMessages[convId] = resp.data.map((m, i) => ({
        id: `md-${convId}-${i}-${m.timestamp}`,
        role: m.role as 'user' | 'assistant',
        text: m.content,
      }));
      touchMessages();
    }
  } catch (e) {
    console.error('[LLMPanel] 加载消息失败:', e);
  }
}

/** 向后端追加消息并更新本地缓存 */
async function persistMessage(convId: string, role: 'user' | 'assistant', content: string) {
  try {
    await chrome.runtime.sendMessage({ type: 'CHROME_CHAT_APPEND', convId, role, content });
  } catch (e) {
    console.error('[LLMPanel] 持久化消息失败:', e);
  }
}

// ===== 会话管理 =====
async function newConversation() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'CHROME_CHAT_CREATE', title: '新对话' }) as
      { success: boolean; data?: ConvMeta; error?: string };
    if (resp && resp.success && resp.data) {
      const conv = resp.data;
      conversations.value.unshift(conv);
      _convMessages[conv.id] = [];
      currentConvId.value = conv.id;
      touchMessages();
    } else {
      console.error('[LLMPanel] 创建对话失败:', resp?.error);
    }
  } catch (e) {
    console.error('[LLMPanel] 创建对话异常:', e);
  }
  showHistory.value = false;
  nextTick(() => scrollToBottom());
}

async function switchConversation(id: string) {
  currentConvId.value = id;
  showHistory.value = false;
  await loadMessages(id);
  touchMessages();
  nextTick(() => scrollToBottom());
}

async function deleteConversation(id: string) {
  const idx = conversations.value.findIndex(c => c.id === id);
  if (idx === -1) return;

  // 远程删除
  try {
    await chrome.runtime.sendMessage({ type: 'CHROME_CHAT_DELETE', convId: id });
  } catch (e) {
    console.error('[LLMPanel] 删除对话失败:', e);
  }

  conversations.value.splice(idx, 1);
  delete _convMessages[id];

  if (id === currentConvId.value) {
    if (conversations.value.length === 0) {
      await newConversation();
    } else {
      const latest = [...conversations.value].sort((a, b) => b.mtime - a.mtime)[0];
      await switchConversation(latest.id);
    }
  }
}

// ===== 其余状态 =====
const inputText = ref('');
const messagesContainer = ref<HTMLElement | null>(null);
const copied = ref(false);

const _loadingMap = ref<Record<string, boolean>>({});
const _pendingMap = ref<Record<string, string>>({});
const _lastMsgIdMap = ref<Record<string, string | null>>({});

const loadingLLM = computed<boolean>({
  get: () => _loadingMap.value[currentConvId.value] ?? false,
  set: (v) => { _loadingMap.value[currentConvId.value] = v; },
});

const pendingText = computed<string>({
  get: () => _pendingMap.value[currentConvId.value] ?? '',
  set: (v) => { _pendingMap.value[currentConvId.value] = v; },
});

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
  const convId = targetConvId ?? currentConvId.value;
  if (!convId) return;

  const convMsgs = getConvMessages(convId);
  const id = genId();

  // 快照历史（不含当前消息）
  const history = convMsgs
    .filter((m: ChatMessage) => m.role === 'user' || m.role === 'assistant')
    .map((m: ChatMessage) => {
      let content = m.text;
      if (m.pageContext) {
        content = `${content}\n\n\`\`\`page-context\n【当前网页: ${m.pageContext.title}】\n${m.pageContext.text}\n\`\`\``;
      }
      return { role: m.role, content };
    });

  // UI 展示的消息体
  convMsgs.push({ id, role: 'user', text, pageContext: pageContextData });
  touchMessages();

  // 持久化 user 消息到 issueMarkdown 文件
  void persistMessage(convId, 'user', text);

  // 更新标题（第一条 user 消息时）
  const convMeta = conversations.value.find(c => c.id === convId);
  if (convMeta && convMsgs.filter((m: ChatMessage) => m.role === 'user').length === 1) {
    const newTitle = autoTitle(convMsgs);
    convMeta.title = newTitle;
    void chrome.runtime.sendMessage({ type: 'CHROME_CHAT_RENAME', convId, title: newTitle }).catch(() => {});
  }
  if (convMeta) convMeta.mtime = Date.now();
  scrollToBottom();

  try {
    _loadingMap.value[convId] = true;

    let realPrompt = text;
    if (pageContextData) {
      realPrompt = `${realPrompt}\n\n\`\`\`page-context\n【当前网页: ${pageContextData.title}】\n${pageContextData.text}\n\`\`\`\n`;
    }

    const _sendModel = selectedModel.value?.family ?? 'copilot';
    addLog('info', `发送 → 模型: ${_sendModel} | 历史: ${history.length}条 | prompt: ${realPrompt.length}字`);

    const response = await chrome.runtime.sendMessage({
      type: toolsEnabled.value ? 'LLM_REQUEST_WITH_TOOLS' : 'LLM_REQUEST',
      model: _sendModel,
      prompt: realPrompt,
      history,
    });

    if (response && response.success) {
      const reply = response.data && response.data.reply;
      const requestId = response.data && response.data.requestId;
      if (typeof reply === 'string' && reply.length > 0) {
        addLog('info', `完成 ← 模型: ${_sendModel} | 响应: ${reply.length}字`);
        convMsgs.push({ id: 'r-' + id, role: 'assistant', text: reply });
        touchMessages();
        void persistMessage(convId, 'assistant', reply);
        finishLoadingForConv(convId);
      } else if (requestId) {
        addLog('info', `排队 ⟳ 模型: ${_sendModel} | requestId: ${requestId}`);
        const placeholderId = 'p-' + requestId;
        convMsgs.push({ id: placeholderId, role: 'assistant', text: '' });
        touchMessages();
        _placeholderConvMap[placeholderId] = convId;
        _lastMsgIdMap.value[convId] = placeholderId;
      } else {
        convMsgs.push({ id: 'e3-' + id, role: 'assistant', text: '请求失败: LLM 返回结果缺少 reply / requestId' });
        touchMessages();
        finishLoadingForConv(convId);
      }
    } else {
      convMsgs.push({ id: 'e-' + id, role: 'assistant', text: '请求失败: ' + (response?.error || '未知错误') });
      touchMessages();
      finishLoadingForConv(convId);
    }
  } catch (err: unknown) {
    const em = err instanceof Error ? err.message : String(err);
    addLog('error', `发送异常: ${em}`);
    convMsgs.push({ id: 'e2-' + id, role: 'assistant', text: '发送异常: ' + em });
    touchMessages();
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
function isRuntimeLlmPushMessage(msg: unknown): msg is RuntimeLlmPushMessage {
  if (!msg || typeof msg !== 'object') return false;
  const raw = msg as Record<string, unknown>;
  return raw.type === 'LLM_PUSH';
}

function handleIncomingMessage(msg: unknown) {
  if (!isRuntimeLlmPushMessage(msg)) return;

  const payload = msg.payload;
  if (!payload) return;

  const requestId = msg.requestId;

  // 1. 拦截标题生成任务
  if (requestId && _titleGenMap[requestId]) {
    const genConvId = _titleGenMap[requestId];
    const targetConv = conversations.value.find(c => c.id === genConvId);

    if (payload.chunk) {
      _titleGenBuffer[requestId] += String(payload.chunk);
    } else if (typeof payload.reply === 'string') {
      const fullText = (payload.reply || _titleGenBuffer[requestId]).trim().replace(/^["']|["']$/g, '');
      if (fullText && targetConv) {
        targetConv.title = fullText;
        // 持久化标题到 issueMarkdown
        void chrome.runtime.sendMessage({ type: 'CHROME_CHAT_RENAME', convId: genConvId, title: fullText }).catch(() => {});
      }
      delete _titleGenMap[requestId];
      delete _titleGenBuffer[requestId];
      if (generatingTitleId.value === genConvId) generatingTitleId.value = null;
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

  const convMsgs = getConvMessages(convId);
  const chunk = payload.chunk || payload.text;
  const reply = payload.reply;

  // 工具调用事件（临时 UI 状态，不持久化）
  if (payload.event === 'tool_call') {
    const toolMsgId = `tool-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    convMsgs.push({
      id: toolMsgId,
      role: 'tool',
      text: payload.summary || '',
      toolName: payload.toolName,
      toolPhase: 'calling',
    });
    if (convId === currentConvId.value) { touchMessages(); scrollToBottom(); }
    return;
  }

  if (payload.event === 'tool_result') {
    for (let i = convMsgs.length - 1; i >= 0; i--) {
      const m = convMsgs[i];
      if (m.role === 'tool' && m.toolName === payload.toolName && m.toolPhase === 'calling') {
        const resultPreview = payload.preview || '';
        const isError = payload.success === false || resultPreview.startsWith('失败') || resultPreview.startsWith('错误');
        convMsgs[i] = {
          ...m,
          toolPhase: isError ? 'error' : 'done',
          toolResult: resultPreview,
          toolExpanded: false,
        };
        break;
      }
    }
    if (convId === currentConvId.value) { touchMessages(); scrollToBottom(); }
    return;
  }

  if (chunk) {
    const idx = convMsgs.findIndex((m: ChatMessage) => m.id === placeholderId);
    if (idx !== -1) {
      convMsgs[idx].text += String(chunk);
    } else {
      convMsgs.push({ id: placeholderId, role: 'assistant', text: String(chunk) });
    }
    if (convId === currentConvId.value) { touchMessages(); scrollToBottom(); }
    return;
  }

  if (payload.event === 'error') {
    const idx = convMsgs.findIndex((m: ChatMessage) => m.id === placeholderId);
    const errText = payload.error || '对话生成失败';
    addLog('error', `错误: ${errText}`);
    if (idx !== -1) {
      convMsgs[idx].text = `请求失败: ${errText}`;
    } else {
      convMsgs.push({ id: 'e4-' + genId(), role: 'assistant', text: `请求失败: ${errText}` });
    }
    finishLoadingForConv(convId);
    if (convId === currentConvId.value) { touchMessages(); scrollToBottom(); }
    return;
  }

  if (typeof reply === 'string') {
    const replyModelFamily = (payload as any).modelFamily as string | undefined;
    const idx = convMsgs.findIndex((m: ChatMessage) => m.id === placeholderId);
    const fullText = reply || convMsgs[idx]?.text || '';
    addLog('info', `完成 ← 模型: ${replyModelFamily ?? '?'} | 响应: ${fullText.length}字`);
    if (idx !== -1) {
      convMsgs[idx].text = String(reply);
    } else {
      convMsgs.push({ id: 'r-' + genId(), role: 'assistant', text: String(reply) });
    }
    // 持久化 assistant 最终回复到 issueMarkdown 文件
    const persistText = reply || fullText;
    if (persistText) {
      void persistMessage(convId, 'assistant', persistText);
    }
    finishLoadingForConv(convId);
    if (convId === currentConvId.value) { touchMessages(); scrollToBottom(); }
  }
}

// ===== 生命周期 =====
onMounted(() => {
  chrome.runtime.onMessage.removeListener(handleIncomingMessage);
  chrome.runtime.onMessage.addListener(handleIncomingMessage);
  document.addEventListener('click', handleOutsideClick);

  void loadModels();
  void loadConversationList();
});

onUnmounted(() => {
  chrome.runtime.onMessage.removeListener(handleIncomingMessage);
  document.removeEventListener('click', handleOutsideClick);
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

/* ========== 模型选择器 ========== */
.model-select-wrapper {
  position: relative;
}

.model-select-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: rgba(167, 139, 250, 0.08);
  border: 1px solid rgba(167, 139, 250, 0.25);
  border-radius: var(--radius-sm);
  color: #c4b5fd;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.model-select-btn svg:first-child { width: 14px; height: 14px; flex-shrink: 0; }
.model-select-label { max-width: 52px; overflow: hidden; text-overflow: ellipsis; }
.model-arrow { width: 10px; height: 10px; flex-shrink: 0; transition: transform 0.2s ease; }

.model-select-wrapper.open .model-arrow { transform: rotate(180deg); }
.model-select-btn:hover { background: rgba(167,139,250,0.16); border-color: rgba(167,139,250,0.5); color: #ddd6fe; }
.model-select-btn:active { transform: scale(0.96); }

.model-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 180px;
  max-height: 260px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--border-subtle) transparent;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  z-index: 200;
  padding: 4px;
}

.model-menu-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 7px 10px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 12px;
  color: var(--text-secondary);
  transition: background 0.12s ease, color 0.12s ease;
}

.model-menu-item:hover { background: var(--bg-hover); color: var(--text-primary); }
.model-menu-item.active { color: #93c5fd; }
.model-menu-item svg { width: 14px; height: 14px; flex-shrink: 0; }
.model-menu-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.model-menu-ctx { font-size: 10px; color: var(--text-muted); flex-shrink: 0; }

/* 加载中旋转动画 */
.model-spin { animation: modelSpin 1s linear infinite; }
@keyframes modelSpin { to { transform: rotate(360deg); } }

/* 菜单错误状态 */
.model-menu-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  font-size: 11px;
  color: #f87171;
}

.model-retry-btn {
  padding: 2px 8px;
  background: rgba(248, 113, 113, 0.12);
  border: 1px solid rgba(248, 113, 113, 0.3);
  border-radius: var(--radius-sm);
  color: #f87171;
  font-size: 11px;
  cursor: pointer;
  flex-shrink: 0;
}
.model-retry-btn:hover { background: rgba(248, 113, 113, 0.25); }

/* 下拉菜单过渡 */
.model-menu-enter-active, .model-menu-leave-active { transition: opacity 0.15s ease, transform 0.15s ease; }
.model-menu-enter-from, .model-menu-leave-to { opacity: 0; transform: translateY(-4px); }

/* ========== 日志面板 ========== */
.llm-log-panel {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  max-height: 180px;
  background: rgba(10, 10, 16, 0.85);
  border-top: 1px solid var(--border-subtle);
  font-family: 'SF Mono', 'Fira Code', 'Menlo', monospace;
  font-size: 10.5px;
}

.log-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 10px;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.log-panel-title {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--text-secondary);
  font-size: 11px;
  font-family: var(--font-ui);
}
.log-panel-title svg { width: 12px; height: 12px; opacity: 0.7; }

.log-count {
  padding: 0 5px;
  background: rgba(245, 158, 11, 0.2);
  color: #f59e0b;
  border-radius: 4px;
  font-size: 10px;
}

.log-clear-btn {
  padding: 1px 8px;
  background: transparent;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-size: 10px;
  cursor: pointer;
  transition: color 0.12s, border-color 0.12s;
}
.log-clear-btn:hover { color: #f87171; border-color: #f87171; }

.log-entries {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
  scrollbar-width: thin;
  scrollbar-color: var(--border-subtle) transparent;
}

.log-empty {
  padding: 12px;
  text-align: center;
  color: var(--text-muted);
  font-family: var(--font-ui);
  font-size: 11px;
}

.log-entry {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 1.5px 10px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
}
.log-entry:hover { background: rgba(255,255,255,0.03); }

.log-ts { color: #4b5563; flex-shrink: 0; }

.log-badge {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
  font-size: 9px;
  font-weight: 700;
}
.log-badge.info { background: rgba(96, 165, 250, 0.15); color: #60a5fa; }
.log-badge.warn { background: rgba(245, 158, 11, 0.15); color: #f59e0b; }
.log-badge.error { background: rgba(248, 113, 113, 0.15); color: #f87171; }

.log-msg { color: var(--text-secondary); }
.log-entry.info .log-msg { color: #9ca3af; }
.log-entry.warn .log-msg { color: #fbbf24; }
.log-entry.error .log-msg { color: #f87171; }

/* 日志面板展开/收起过渡 */
.log-panel-enter-active, .log-panel-leave-active { transition: max-height 0.2s ease, opacity 0.15s ease; overflow: hidden; }
.log-panel-enter-from, .log-panel-leave-to { max-height: 0; opacity: 0; }
.log-panel-enter-to, .log-panel-leave-from { max-height: 180px; opacity: 1; }

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

/* ========== 工具调用开关 ========== */
.tools-toggle-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: transparent;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  color: var(--text-muted);
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.15s ease;
  padding: 0;
  margin-bottom: 2px;
}
.tools-toggle-btn svg { width: 14px; height: 14px; }
.tools-toggle-btn:hover { background: var(--bg-hover); color: var(--text-secondary); border-color: var(--border-subtle); }
.tools-toggle-btn.active {
  background: rgba(52, 211, 153, 0.1);
  border-color: rgba(52, 211, 153, 0.4);
  color: #34d399;
}
.tools-toggle-btn.active:hover { background: rgba(52, 211, 153, 0.18); }
.tools-toggle-btn:active { transform: scale(0.92); }

/* ========== 工具调用卡片 ========== */
.llm-message.tool {
  padding: 0 4px;
}

.tool-call-card {
  display: flex;
  flex-direction: column;
  padding: 6px 10px;
  background: rgba(167, 139, 250, 0.06);
  border: 1px solid rgba(167, 139, 250, 0.15);
  border-radius: 8px;
  font-size: 11.5px;
  color: var(--text-muted);
  max-width: 100%;
  transition: background 0.15s, border-color 0.15s;
}
.tool-call-card.expandable { cursor: pointer; }
.tool-call-card.expandable:hover { background: rgba(167, 139, 250, 0.10); }

.tool-call-header {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 18px;
}

.tool-icon { width: 13px; height: 13px; flex-shrink: 0; }

.tool-call-label {
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
}
.tool-call-summary {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.75;
  flex: 1;
  min-width: 0;
}

.tool-expand-arrow {
  width: 14px; height: 14px; flex-shrink: 0;
  opacity: 0.4;
  transition: transform 0.2s;
}
.tool-expand-arrow.expanded { transform: rotate(180deg); }

.tool-call-card.calling {
  color: var(--accent-purple);
  border-color: rgba(167, 139, 250, 0.3);
  background: rgba(167, 139, 250, 0.08);
}
.tool-call-card.done {
  color: #34d399;
  border-color: rgba(52, 211, 153, 0.25);
  background: rgba(52, 211, 153, 0.05);
}
.tool-call-card.done.expandable:hover { background: rgba(52, 211, 153, 0.08); }
.tool-call-card.error {
  color: #f87171;
  border-color: rgba(248, 113, 113, 0.3);
  background: rgba(248, 113, 113, 0.06);
}
.tool-call-card.error.expandable:hover { background: rgba(248, 113, 113, 0.10); }

.tool-result-detail {
  margin-top: 5px;
  padding-top: 5px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  opacity: 0.8;
  max-height: 150px;
  overflow-y: auto;
}

.tool-spin {
  animation: toolSpin 1s linear infinite;
}
@keyframes toolSpin {
  to { transform: rotate(360deg); }
}
</style>
