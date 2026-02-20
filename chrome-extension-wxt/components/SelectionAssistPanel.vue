<template>
  <div class="selection-assist-panel">
    <div class="panel-header">
      <button class="back-btn" @click="$emit('back')" title="返回">
        <svg viewBox="0 0 20 20" fill="none"><path d="M12.5 5L7.5 10l5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="title-group">
        <h2>划线助手</h2>
        <p>自动分析当前划线内容</p>
      </div>
      <button class="refresh-btn" :disabled="loadingSelection || loadingLLM" @click="refreshSelection" title="重新读取划线">
        <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M4.5 10A5.5 5.5 0 0110 4.5c1.8 0 3.4.87 4.4 2.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <path d="M15.5 10A5.5 5.5 0 0110 15.5c-1.8 0-3.4-.87-4.4-2.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>
    </div>

    <div class="panel-body">
      <div class="block">
        <div class="block-title">原文划线</div>
        <div v-if="loadingSelection" class="placeholder">正在读取当前页面划线内容...</div>
        <div v-else-if="!selectionText" class="placeholder">
          未检测到划线内容。请在网页中先用鼠标划线，再点击右上角刷新按钮。
        </div>
        <div v-else class="content">{{ selectionText }}</div>
      </div>

      <div class="block">
        <div class="block-title">LLM 对照翻译</div>
        <div v-if="loadingLLM" class="placeholder">正在生成翻译，请稍候...</div>
        <div v-else-if="errorMessage" class="error">{{ errorMessage }}</div>
        <div v-else-if="!analysisResult" class="placeholder">暂无结果</div>
        <div v-else class="content">{{ analysisResult }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';

interface SelectionData {
  text: string;
  html: string;
  title: string;
  url: string;
}

interface RuntimeResponse<TData> {
  success?: boolean;
  data?: TData;
  error?: string;
}

interface LlmRequestData {
  requestId?: string;
  reply?: string;
}

interface LlmPushPayload {
  chunk?: string;
  text?: string;
  reply?: string;
}

interface RuntimeMessage {
  type?: string;
  payload?: LlmPushPayload;
}

const selectionText = ref('');
const analysisResult = ref('');
const loadingSelection = ref(false);
const loadingLLM = ref(false);
const errorMessage = ref('');

function buildTranslationPrompt(text: string): string {
  return [
    '请对以下文本进行中英对照翻译。',
    '要求：',
    '1. 先给出原文分段。',
    '2. 每段后紧跟对应中文翻译。',
    '3. 保留术语准确性，语言自然。',
    '',
    '待翻译内容：',
    text,
  ].join('\n');
}

async function refreshSelection() {
  loadingSelection.value = true;
  errorMessage.value = '';
  analysisResult.value = '';

  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_PAGE_SELECTION' }) as RuntimeResponse<SelectionData>;
    if (!response.success || !response.data) {
      throw new Error(response.error || '读取划线内容失败');
    }

    selectionText.value = response.data.text.trim();
    if (!selectionText.value) {
      return;
    }

    await runAutoTranslate(selectionText.value);
  } catch (error: unknown) {
    const errorText = error instanceof Error ? error.message : String(error);
    errorMessage.value = `读取划线内容失败：${errorText}`;
  } finally {
    loadingSelection.value = false;
  }
}

async function runAutoTranslate(text: string) {
  loadingLLM.value = true;
  errorMessage.value = '';

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'LLM_REQUEST',
      model: 'copilot',
      prompt: buildTranslationPrompt(text),
      history: [],
    }) as RuntimeResponse<LlmRequestData>;

    if (!response.success || !response.data) {
      throw new Error(response.error || 'LLM 请求失败');
    }

    if (typeof response.data.reply === 'string' && response.data.reply.length > 0) {
      analysisResult.value = response.data.reply;
      loadingLLM.value = false;
    }
  } catch (error: unknown) {
    const errorText = error instanceof Error ? error.message : String(error);
    errorMessage.value = `自动翻译失败：${errorText}`;
    loadingLLM.value = false;
  }
}

function handleIncomingMessage(msg: RuntimeMessage) {
  if (!msg || msg.type !== 'LLM_PUSH' || !loadingLLM.value) {
    return;
  }

  const payload = msg.payload;
  if (!payload) {
    return;
  }

  const chunk = payload.chunk || payload.text;
  if (chunk) {
    analysisResult.value += String(chunk);
  }

  if (typeof payload.reply === 'string') {
    analysisResult.value = payload.reply;
    loadingLLM.value = false;
  }
}

onMounted(async () => {
  chrome.runtime.onMessage.addListener(handleIncomingMessage);
  await refreshSelection();
});

onUnmounted(() => {
  chrome.runtime.onMessage.removeListener(handleIncomingMessage);
});
</script>

<style scoped>
.selection-assist-panel {
  --bg-deep: #0f1117;
  --bg-base: #161b22;
  --bg-hover: #242938;
  --border-subtle: #2a3040;
  --text-primary: #e6edf3;
  --text-secondary: #8b949e;
  --accent-blue: #388bfd;

  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-deep);
  color: var(--text-primary);
}

.panel-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-subtle);
  background: linear-gradient(180deg, #1a2030 0%, #161b22 100%);
}

.back-btn,
.refresh-btn {
  width: 30px;
  height: 30px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.back-btn:hover,
.refresh-btn:hover {
  background: var(--bg-hover);
  border-color: var(--border-subtle);
  color: var(--text-primary);
}

.refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.back-btn svg,
.refresh-btn svg {
  width: 16px;
  height: 16px;
}

.title-group {
  flex: 1;
  min-width: 0;
}

.title-group h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.title-group p {
  margin: 2px 0 0;
  color: var(--text-secondary);
  font-size: 11px;
}

.panel-body {
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
}

.block {
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--bg-base);
  overflow: hidden;
}

.block-title {
  padding: 8px 10px;
  font-size: 12px;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border-subtle);
}

.placeholder,
.content,
.error {
  padding: 10px;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
  font-size: 13px;
}

.placeholder {
  color: var(--text-secondary);
}

.content {
  color: var(--text-primary);
}

.error {
  color: #fb7185;
}
</style>
