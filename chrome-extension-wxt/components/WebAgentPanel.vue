<template>
  <div class="agent-panel">

    <!-- ========== 历史记录抽屉 ========== -->
    <Transition name="history-slide">
      <div v-if="showHistory" class="history-overlay" @click.self="showHistory = false">
        <div class="history-drawer">
          <div class="history-drawer-header">
            <span class="history-drawer-title">
              <svg viewBox="0 0 20 20" fill="none"><path d="M10 3a7 7 0 100 14A7 7 0 0010 3z" stroke="currentColor" stroke-width="1.4"/><path d="M10 6v4l2.5 2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
              执行历史
            </span>
            <button class="drawer-close-btn" @click="showHistory = false">
              <svg viewBox="0 0 20 20" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            </button>
          </div>

          <div class="history-list">
            <div v-if="historyRecords.length === 0" class="history-empty">暂无执行记录</div>
            <div
              v-for="record in historyRecords"
              :key="record.id"
              :class="['history-item', { active: viewingRecordId === record.id }]"
              @click="viewRecord(record)"
            >
              <div class="history-item-top">
                <span :class="['history-status-dot', `status-${record.status}`]"></span>
                <span class="history-item-task">{{ record.task }}</span>
                <button class="history-item-delete" title="删除" @click.stop="deleteRecord(record.id)">
                  <svg viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
                </button>
              </div>
              <div class="history-item-meta">
                <span>{{ formatDate(record.startedAt) }}</span>
                <span v-if="record.completedAt">{{ formatDuration(record.startedAt, record.completedAt) }}</span>
                <span class="history-item-stats">
                  {{ record.searchQueries.length }} 搜索 / {{ record.urlsFetched.length }} 页面 / {{ record.notesCreated.length }} 笔记
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- ========== 顶栏 ========== -->
    <div class="agent-header">
      <button class="back-btn" @click="handleBack" title="返回">
        <svg viewBox="0 0 20 20" fill="none"><path d="M12 4l-6 6 6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <div class="agent-header-title">
        <svg class="agent-icon" viewBox="0 0 20 20" fill="none">
          <circle cx="10" cy="10" r="7.5" stroke="currentColor" stroke-width="1.4"/>
          <path d="M10 6v4l3 2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="16" cy="4" r="2.5" fill="#34d399"/>
          <path d="M15 4h2M16 3v2" stroke="white" stroke-width="1" stroke-linecap="round"/>
        </svg>
        <span>Web Research Agent</span>
      </div>
      <div class="agent-header-actions">
        <button class="icon-btn" title="执行历史" @click="showHistory = true">
          <svg viewBox="0 0 20 20" fill="none"><path d="M10 3a7 7 0 100 14A7 7 0 0010 3z" stroke="currentColor" stroke-width="1.4"/><path d="M10 6v4l2.5 2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
        </button>
      </div>
    </div>

    <!-- ========== 查看历史记录详情 ========== -->
    <template v-if="viewingRecord">
      <div class="viewing-banner">
        <div class="viewing-banner-info">
          <span :class="['history-status-dot', `status-${viewingRecord.status}`]"></span>
          <span class="viewing-task">{{ viewingRecord.task }}</span>
        </div>
        <button class="viewing-close-btn" @click="closeViewRecord" title="关闭">
          <svg viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
        </button>
      </div>

      <!-- 执行策略概览 -->
      <div v-if="viewingRecord.strategy" class="strategy-section">
        <div class="strategy-header" @click="strategyExpanded = !strategyExpanded">
          <svg viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.3"/><path d="M5 5h6M5 8h4M5 11h5" stroke="currentColor" stroke-width="1" stroke-linecap="round"/></svg>
          <span>执行策略</span>
          <svg :class="['strategy-chevron', { expanded: strategyExpanded }]" viewBox="0 0 16 16" fill="none"><path d="M5 6l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <div v-show="strategyExpanded" class="strategy-body">
          <div class="strategy-stats">
            <div class="stat-item">
              <span class="stat-label">搜索</span>
              <span class="stat-value">{{ viewingRecord.searchQueries.length }}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">页面</span>
              <span class="stat-value">{{ viewingRecord.urlsFetched.length }}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">笔记</span>
              <span class="stat-value">{{ viewingRecord.notesCreated.length }}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">工具调用</span>
              <span class="stat-value">{{ viewingRecord.toolsUsed.length }}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">耗时</span>
              <span class="stat-value">{{ viewingRecord.completedAt ? formatDuration(viewingRecord.startedAt, viewingRecord.completedAt) : '-' }}</span>
            </div>
          </div>
          <div v-if="viewingRecord.searchQueries.length" class="strategy-detail">
            <div class="strategy-detail-title">搜索关键词</div>
            <div v-for="(q, i) in viewingRecord.searchQueries" :key="i" class="strategy-tag">{{ q }}</div>
          </div>
          <div v-if="viewingRecord.urlsFetched.length" class="strategy-detail">
            <div class="strategy-detail-title">访问页面</div>
            <div v-for="(u, i) in viewingRecord.urlsFetched" :key="i" class="strategy-url">{{ u }}</div>
          </div>
          <div v-if="viewingRecord.notesCreated.length" class="strategy-detail">
            <div class="strategy-detail-title">创建笔记</div>
            <div v-for="(n, i) in viewingRecord.notesCreated" :key="i" class="strategy-note">{{ n }}</div>
          </div>
        </div>
      </div>

      <!-- 历史日志 + 报告 -->
      <div ref="logRef" class="agent-log">
        <div
          v-for="(entry, idx) in viewingRecord.logs"
          :key="idx"
          :class="['log-entry', `log-${entry.phase}`]"
        >
          <div class="log-entry-header">
            <span class="log-phase-icon"><component :is="phaseIcon(entry.phase)" /></span>
            <span class="log-message">{{ entry.message }}</span>
            <span class="log-time">{{ entry.timeStr }}</span>
          </div>
          <div v-if="entry.detail && entry.phase !== 'thinking'" class="log-detail">{{ entry.detail }}</div>
        </div>
        <div v-if="viewingRecord.report" class="agent-report">
          <div class="report-header">
            <svg viewBox="0 0 16 16" fill="none"><rect x="3" y="2" width="10" height="12" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M6 6h4M6 8.5h4M6 11h2" stroke="currentColor" stroke-width="1" stroke-linecap="round"/></svg>
            <span>研究报告</span>
          </div>
          <div class="report-body" v-html="renderMarkdown(viewingRecord.report)"></div>
        </div>
      </div>
    </template>

    <!-- ========== 当前任务视图 ========== -->
    <template v-else>
      <!-- 输入区 -->
      <div class="agent-input-section">
        <textarea
          ref="inputRef"
          v-model="taskInput"
          class="agent-input"
          :placeholder="isRunning ? '任务执行中…' : '描述你的研究任务，例如：\n调研 2024 年 AI Agent 主流框架的优劣对比'"
          :disabled="isRunning"
          rows="3"
          @keydown.meta.enter="startAgent"
          @keydown.ctrl.enter="startAgent"
        ></textarea>
        <div class="agent-input-actions">
          <button
            v-if="!isRunning"
            class="agent-start-btn"
            :disabled="!taskInput.trim()"
            @click="startAgent"
          >
            <svg viewBox="0 0 16 16" fill="none"><path d="M4 2l10 6-10 6V2z" fill="currentColor"/></svg>
            开始研究
          </button>
          <button
            v-else
            class="agent-cancel-btn"
            @click="cancelAgent"
          >
            <svg viewBox="0 0 16 16" fill="none"><rect x="3" y="3" width="10" height="10" rx="2" fill="currentColor"/></svg>
            取消
          </button>
        </div>
      </div>

      <!-- 实时执行策略 (运行中/完成后) -->
      <div v-if="currentStrategy.toolsUsed.length > 0" class="strategy-section">
        <div class="strategy-header" @click="liveStrategyExpanded = !liveStrategyExpanded">
          <svg viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.3"/><path d="M5 5h6M5 8h4M5 11h5" stroke="currentColor" stroke-width="1" stroke-linecap="round"/></svg>
          <span>执行策略</span>
          <span v-if="isRunning" class="strategy-live-badge">LIVE</span>
          <svg :class="['strategy-chevron', { expanded: liveStrategyExpanded }]" viewBox="0 0 16 16" fill="none"><path d="M5 6l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <div v-show="liveStrategyExpanded" class="strategy-body">
          <div class="strategy-stats">
            <div class="stat-item">
              <span class="stat-label">搜索</span>
              <span class="stat-value">{{ currentStrategy.searchQueries.length }}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">页面</span>
              <span class="stat-value">{{ currentStrategy.urlsFetched.length }}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">笔记</span>
              <span class="stat-value">{{ currentStrategy.notesCreated.length }}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">工具调用</span>
              <span class="stat-value">{{ currentStrategy.toolsUsed.length }}</span>
            </div>
          </div>
          <div v-if="currentStrategy.searchQueries.length" class="strategy-detail">
            <div class="strategy-detail-title">搜索关键词</div>
            <div v-for="(q, i) in currentStrategy.searchQueries" :key="i" class="strategy-tag">{{ q }}</div>
          </div>
          <div v-if="currentStrategy.urlsFetched.length" class="strategy-detail">
            <div class="strategy-detail-title">访问页面</div>
            <div v-for="(u, i) in currentStrategy.urlsFetched" :key="i" class="strategy-url">{{ u }}</div>
          </div>
        </div>
      </div>

      <!-- 进度日志 -->
      <div ref="logRef" class="agent-log">
        <div v-if="logEntries.length === 0 && !isRunning" class="agent-empty">
          <svg class="agent-empty-icon" viewBox="0 0 48 48" fill="none">
            <circle cx="24" cy="24" r="18" stroke="currentColor" stroke-width="2"/>
            <path d="M24 14v10l7 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <circle cx="38" cy="10" r="5" fill="#34d399"/>
            <path d="M36 10h4M38 8v4" stroke="white" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          <p>输入研究任务后，Agent 将自动：</p>
          <ul>
            <li>搜索网络信息</li>
            <li>访问相关页面获取数据</li>
            <li>整理并记录到笔记</li>
            <li>生成研究报告</li>
          </ul>
        </div>

        <div
          v-for="(entry, idx) in logEntries"
          :key="idx"
          :class="['log-entry', `log-${entry.phase}`]"
        >
          <div class="log-entry-header">
            <span class="log-phase-icon"><component :is="phaseIcon(entry.phase)" /></span>
            <span class="log-message">{{ entry.message }}</span>
            <span class="log-time">{{ entry.timeStr }}</span>
          </div>
          <div v-if="entry.detail && entry.phase !== 'thinking'" class="log-detail">{{ entry.detail }}</div>
        </div>

        <!-- 报告区域 -->
        <div v-if="report" class="agent-report">
          <div class="report-header">
            <svg viewBox="0 0 16 16" fill="none"><rect x="3" y="2" width="10" height="12" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M6 6h4M6 8.5h4M6 11h2" stroke="currentColor" stroke-width="1" stroke-linecap="round"/></svg>
            <span>研究报告</span>
          </div>
          <div class="report-body" v-html="reportHtml"></div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, nextTick, onMounted, onUnmounted, computed, h, type FunctionalComponent } from 'vue';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

// ─── 类型 ──────────────────────────────────────────────────

interface LogEntry {
  phase: string;
  message: string;
  detail?: string;
  timeStr: string;
  timestamp: number;
}

interface StrategyInfo {
  toolsUsed: string[];
  searchQueries: string[];
  urlsFetched: string[];
  notesCreated: string[];
}

interface AgentHistoryRecord {
  id: string;
  task: string;
  startedAt: number;
  completedAt: number;
  status: 'complete' | 'error' | 'cancelled';
  logs: LogEntry[];
  report: string;
  strategy: string;
  toolsUsed: string[];
  searchQueries: string[];
  urlsFetched: string[];
  notesCreated: string[];
}

interface AgentEvent {
  type: 'WEB_AGENT_EVENT';
  agentEventType: string;
  data?: any;
  taskId?: string;
}

const STORAGE_KEY = 'webAgentHistory';
const MAX_HISTORY = 50;

// ─── 状态 ──────────────────────────────────────────────────

const emit = defineEmits<{ (e: 'back'): void }>();

const inputRef = ref<HTMLTextAreaElement | null>(null);
const logRef = ref<HTMLElement | null>(null);

// 当前任务
const taskInput = ref('');
const isRunning = ref(false);
const currentTaskId = ref<string | null>(null);
const logEntries = ref<LogEntry[]>([]);
const report = ref('');
const taskStartedAt = ref(0);

// 实时策略追踪
const currentStrategy = reactive<StrategyInfo>({
  toolsUsed: [],
  searchQueries: [],
  urlsFetched: [],
  notesCreated: [],
});
const liveStrategyExpanded = ref(true);

// 历史记录
const showHistory = ref(false);
const historyRecords = ref<AgentHistoryRecord[]>([]);
const viewingRecord = ref<AgentHistoryRecord | null>(null);
const viewingRecordId = computed(() => viewingRecord.value?.id || null);
const strategyExpanded = ref(true);

// ─── 工具函数 ──────────────────────────────────────────────

const reportHtml = computed(() => {
  if (!report.value) return '';
  return renderMarkdown(report.value);
});

function renderMarkdown(md: string): string {
  const raw = marked.parse(md) as string;
  return DOMPurify.sanitize(raw);
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  return `${month}-${day} ${hours}:${mins}`;
}

function formatDuration(start: number, end: number): string {
  const sec = Math.round((end - start) / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const s = sec % 60;
  return `${min}m${s}s`;
}

function addLog(phase: string, message: string, detail?: string) {
  const now = Date.now();
  logEntries.value.push({ phase, message, detail, timeStr: formatTime(now), timestamp: now });
  nextTick(() => {
    if (logRef.value) {
      logRef.value.scrollTop = logRef.value.scrollHeight;
    }
  });
}

/** 从 tool_call detail 中提取策略信息 */
function trackStrategy(phase: string, message: string, detail?: string) {
  if (phase !== 'tool_call' && phase !== 'tool_result') return;
  if (phase === 'tool_call') {
    // 提取工具名
    const toolMatch = message.match(/调用工具[:：]\s*(.+)/);
    if (toolMatch) {
      currentStrategy.toolsUsed.push(toolMatch[1].trim());
    }
    // 提取搜索关键词
    if (detail?.startsWith('搜索:') || detail?.startsWith('搜索：')) {
      currentStrategy.searchQueries.push(detail.replace(/^搜索[:：]\s*/, '').trim());
    }
    // 提取 URL
    if (detail?.startsWith('访问:') || detail?.startsWith('访问：')) {
      currentStrategy.urlsFetched.push(detail.replace(/^访问[:：]\s*/, '').trim());
    }
  }
  if (phase === 'tool_result') {
    // 提取笔记创建
    if (detail && (detail.includes('已创建') || detail.includes('已成功创建'))) {
      currentStrategy.notesCreated.push(detail.slice(0, 100));
    }
  }
}

function resetStrategy() {
  currentStrategy.toolsUsed = [];
  currentStrategy.searchQueries = [];
  currentStrategy.urlsFetched = [];
  currentStrategy.notesCreated = [];
}

// ─── SVG 图标（函数式组件） ────────────────────────────────

function phaseIcon(phase: string): FunctionalComponent {
  const icons: Record<string, () => any> = {
    planning: () => h('svg', { viewBox: '0 0 16 16', fill: 'none', innerHTML: '<circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.3"/><path d="M8 5v3l2 1.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>' }),
    tool_call: () => h('svg', { viewBox: '0 0 16 16', fill: 'none', innerHTML: '<path d="M5 3l6 5-6 5V3z" fill="currentColor" opacity="0.6"/>' }),
    tool_result: () => h('svg', { viewBox: '0 0 16 16', fill: 'none', innerHTML: '<path d="M4 8l3 3 5-6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' }),
    thinking: () => h('svg', { viewBox: '0 0 16 16', fill: 'none', innerHTML: '<circle cx="4" cy="8" r="1.5" fill="currentColor" opacity="0.4"/><circle cx="8" cy="8" r="1.5" fill="currentColor" opacity="0.6"/><circle cx="12" cy="8" r="1.5" fill="currentColor" opacity="0.8"/>' }),
    report: () => h('svg', { viewBox: '0 0 16 16', fill: 'none', innerHTML: '<rect x="3" y="2" width="10" height="12" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M6 6h4M6 8.5h4M6 11h2" stroke="currentColor" stroke-width="1" stroke-linecap="round"/>' }),
    complete: () => h('svg', { viewBox: '0 0 16 16', fill: 'none', innerHTML: '<circle cx="8" cy="8" r="6" fill="#34d399" opacity="0.2"/><path d="M5 8l2.5 2.5L11 6" stroke="#34d399" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' }),
    error: () => h('svg', { viewBox: '0 0 16 16', fill: 'none', innerHTML: '<circle cx="8" cy="8" r="6" fill="#f87171" opacity="0.2"/><path d="M6 6l4 4M10 6l-4 4" stroke="#f87171" stroke-width="1.5" stroke-linecap="round"/>' }),
  };
  return (icons[phase] || icons.thinking) as FunctionalComponent;
}

// ─── 持久化 ──────────────────────────────────────────────────

async function loadHistory() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    historyRecords.value = result[STORAGE_KEY] || [];
  } catch (e) {
    console.error('[WebAgent] 加载历史失败:', e);
    historyRecords.value = [];
  }
}

async function saveHistory() {
  try {
    // 只保留最近 MAX_HISTORY 条
    const toSave = historyRecords.value.slice(0, MAX_HISTORY);
    await chrome.storage.local.set({ [STORAGE_KEY]: toSave });
  } catch (e) {
    console.error('[WebAgent] 保存历史失败:', e);
  }
}

async function saveCurrentRun(status: 'complete' | 'error' | 'cancelled') {
  const record: AgentHistoryRecord = {
    id: currentTaskId.value || `task-${Date.now()}`,
    task: taskInput.value.trim(),
    startedAt: taskStartedAt.value,
    completedAt: Date.now(),
    status,
    logs: [...logEntries.value],
    report: report.value,
    strategy: buildStrategySummary(),
    toolsUsed: [...currentStrategy.toolsUsed],
    searchQueries: [...currentStrategy.searchQueries],
    urlsFetched: [...currentStrategy.urlsFetched],
    notesCreated: [...currentStrategy.notesCreated],
  };
  historyRecords.value.unshift(record);
  await saveHistory();
}

function buildStrategySummary(): string {
  const parts: string[] = [];
  if (currentStrategy.searchQueries.length) {
    parts.push(`搜索了 ${currentStrategy.searchQueries.length} 个关键词: ${currentStrategy.searchQueries.join(', ')}`);
  }
  if (currentStrategy.urlsFetched.length) {
    parts.push(`访问了 ${currentStrategy.urlsFetched.length} 个页面`);
  }
  if (currentStrategy.notesCreated.length) {
    parts.push(`创建了 ${currentStrategy.notesCreated.length} 个笔记`);
  }
  parts.push(`共调用 ${currentStrategy.toolsUsed.length} 次工具`);
  return parts.join('；');
}

// ─── 历史查看 ──────────────────────────────────────────────

function viewRecord(record: AgentHistoryRecord) {
  viewingRecord.value = record;
  showHistory.value = false;
  strategyExpanded.value = true;
}

function closeViewRecord() {
  viewingRecord.value = null;
}

function handleBack() {
  if (viewingRecord.value) {
    closeViewRecord();
  } else {
    emit('back');
  }
}

async function deleteRecord(id: string) {
  historyRecords.value = historyRecords.value.filter(r => r.id !== id);
  if (viewingRecord.value?.id === id) {
    viewingRecord.value = null;
  }
  await saveHistory();
}

// ─── Agent 控制 ──────────────────────────────────────────────

async function startAgent() {
  const task = taskInput.value.trim();
  if (!task || isRunning.value) return;

  // 切换回当前任务视图
  viewingRecord.value = null;

  isRunning.value = true;
  report.value = '';
  logEntries.value = [];
  resetStrategy();
  taskStartedAt.value = Date.now();

  addLog('planning', '正在提交研究任务…');

  try {
    const resp = await chrome.runtime.sendMessage({ type: 'START_WEB_AGENT', task });
    if (!resp?.success) {
      addLog('error', resp?.error || '启动失败');
      isRunning.value = false;
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    addLog('error', `启动失败: ${msg}`);
    isRunning.value = false;
  }
}

async function cancelAgent() {
  if (!isRunning.value) return;
  try {
    await chrome.runtime.sendMessage({ type: 'CANCEL_WEB_AGENT', taskId: currentTaskId.value });
  } catch { /* ignore */ }
  addLog('error', '任务已取消');
  await saveCurrentRun('cancelled');
  isRunning.value = false;
  currentTaskId.value = null;
}

// ─── 事件处理 ──────────────────────────────────────────────

function handleAgentEvent(msg: AgentEvent) {
  if (!msg || msg.type !== 'WEB_AGENT_EVENT') return;

  const { agentEventType, data, taskId } = msg;

  switch (agentEventType) {
    case 'web-agent-started':
      if (taskId) currentTaskId.value = taskId;
      addLog('planning', '研究任务已启动，Agent 正在工作…');
      break;

    case 'web-agent-progress':
      if (data) {
        if (data.phase === 'thinking') {
          const lastEntry = logEntries.value[logEntries.value.length - 1];
          if (lastEntry && lastEntry.phase === 'thinking') {
            lastEntry.detail = (lastEntry.detail || '') + (data.detail || '');
            return;
          }
        }
        addLog(data.phase, data.message, data.detail);
        trackStrategy(data.phase, data.message, data.detail);
      }
      break;

    case 'web-agent-complete':
      if (data?.report) {
        report.value = data.report;
      }
      addLog('complete', '研究任务完成');
      saveCurrentRun('complete');
      isRunning.value = false;
      currentTaskId.value = null;
      break;

    case 'web-agent-error':
      addLog('error', data?.error || '研究任务失败');
      saveCurrentRun('error');
      isRunning.value = false;
      currentTaskId.value = null;
      break;

    case 'web-agent-cancelled':
      addLog('error', '任务已取消');
      isRunning.value = false;
      currentTaskId.value = null;
      break;
  }
}

function onBackgroundMessage(msg: any) {
  if (msg?.type === 'WEB_AGENT_EVENT') {
    handleAgentEvent(msg);
  }
}

// ─── 生命周期 ──────────────────────────────────────────────

onMounted(() => {
  chrome.runtime.onMessage.addListener(onBackgroundMessage);
  loadHistory();
  nextTick(() => inputRef.value?.focus());
});

onUnmounted(() => {
  chrome.runtime.onMessage.removeListener(onBackgroundMessage);
});
</script>

<style scoped>
/* ========== 变量 ========== */
.agent-panel {
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

  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--bg-deep);
  color: var(--text-primary);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  overflow: hidden;
  position: relative;
}

/* ========== 顶栏 ========== */
.agent-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: linear-gradient(180deg, #1a2030 0%, #161b22 100%);
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.agent-header-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  flex: 1;
}

.agent-header-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.back-btn,
.icon-btn {
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
  transition: all 0.15s;
  padding: 0;
}

.back-btn:hover,
.icon-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.back-btn svg,
.icon-btn svg {
  width: 16px;
  height: 16px;
}

.agent-icon {
  width: 20px;
  height: 20px;
  color: var(--accent-teal);
}

/* ========== 查看历史 banner ========== */
.viewing-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  background: rgba(56, 139, 253, 0.06);
  border-bottom: 1px solid rgba(56, 139, 253, 0.15);
  flex-shrink: 0;
}

.viewing-banner-info {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.viewing-task {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.viewing-close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
}
.viewing-close-btn:hover { color: var(--text-primary); background: var(--bg-hover); }
.viewing-close-btn svg { width: 12px; height: 12px; }

/* ========== 策略区 ========== */
.strategy-section {
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.strategy-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  cursor: pointer;
  user-select: none;
  transition: background 0.15s;
}
.strategy-header:hover { background: var(--bg-hover); }
.strategy-header svg:first-child { width: 14px; height: 14px; flex-shrink: 0; }
.strategy-chevron { width: 14px; height: 14px; margin-left: auto; transition: transform 0.2s; }
.strategy-chevron.expanded { transform: rotate(180deg); }

.strategy-live-badge {
  font-size: 9px;
  font-weight: 700;
  color: #f87171;
  background: rgba(248, 113, 113, 0.12);
  border: 1px solid rgba(248, 113, 113, 0.25);
  padding: 1px 5px;
  border-radius: 3px;
  letter-spacing: 0.5px;
  animation: pulse 1.4s ease-in-out infinite;
}

.strategy-body {
  padding: 0 14px 10px;
}

.strategy-stats {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.stat-label {
  font-size: 10px;
  color: var(--text-muted);
}

.stat-value {
  font-size: 16px;
  font-weight: 600;
  color: var(--accent-blue);
}

.strategy-detail {
  margin-top: 6px;
}

.strategy-detail-title {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
}

.strategy-tag {
  display: inline-block;
  padding: 2px 8px;
  margin: 2px 4px 2px 0;
  background: rgba(56, 139, 253, 0.1);
  border: 1px solid rgba(56, 139, 253, 0.2);
  border-radius: 4px;
  font-size: 11px;
  color: #60a5fa;
}

.strategy-url {
  font-size: 11px;
  color: var(--text-secondary);
  padding: 2px 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.strategy-note {
  font-size: 11px;
  color: var(--accent-teal);
  padding: 2px 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ========== 输入区 ========== */
.agent-input-section {
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.agent-input {
  width: 100%;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: 13px;
  line-height: 1.5;
  padding: 10px 12px;
  resize: vertical;
  min-height: 60px;
  max-height: 200px;
  font-family: inherit;
  transition: border-color 0.15s;
  box-sizing: border-box;
}

.agent-input:focus { outline: none; border-color: var(--accent-blue); }
.agent-input:disabled { opacity: 0.5; cursor: not-allowed; }
.agent-input::placeholder { color: var(--text-muted); }

.agent-input-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}

.agent-start-btn,
.agent-cancel-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: all 0.15s;
}

.agent-start-btn { background: var(--accent-teal); color: #0f1117; }
.agent-start-btn:hover:not(:disabled) { background: #4ade80; }
.agent-start-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.agent-start-btn svg, .agent-cancel-btn svg { width: 12px; height: 12px; }
.agent-cancel-btn { background: #dc2626; color: white; }
.agent-cancel-btn:hover { background: #ef4444; }

/* ========== 日志区 ========== */
.agent-log {
  flex: 1;
  overflow-y: auto;
  padding: 12px 14px;
}

.agent-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 10px;
  padding: 40px 20px;
  color: var(--text-muted);
  font-size: 13px;
}

.agent-empty-icon { width: 48px; height: 48px; opacity: 0.5; }
.agent-empty ul { list-style: none; padding: 0; margin: 4px 0 0; text-align: left; }
.agent-empty li { padding: 3px 0; position: relative; padding-left: 16px; }
.agent-empty li::before {
  content: '';
  position: absolute;
  left: 0; top: 10px;
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--accent-teal);
  opacity: 0.5;
}

/* ========== 日志条目 ========== */
.log-entry {
  padding: 8px 10px;
  margin-bottom: 4px;
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  border-left: 3px solid var(--border-subtle);
  animation: fadeIn 0.2s ease;
}

.log-entry.log-planning { border-left-color: var(--accent-blue); }
.log-entry.log-tool_call { border-left-color: #f59e0b; }
.log-entry.log-tool_result { border-left-color: var(--accent-teal); }
.log-entry.log-thinking { border-left-color: var(--text-muted); }
.log-entry.log-report { border-left-color: #a78bfa; }
.log-entry.log-complete { border-left-color: var(--accent-teal); background: rgba(52, 211, 153, 0.05); }
.log-entry.log-error { border-left-color: #f87171; background: rgba(248, 113, 113, 0.05); }

.log-entry-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.log-phase-icon { display: flex; align-items: center; flex-shrink: 0; }
.log-phase-icon svg, .log-phase-icon :deep(svg) { width: 14px; height: 14px; }
.log-message { flex: 1; color: var(--text-primary); font-weight: 500; }
.log-time { font-size: 10px; color: var(--text-muted); flex-shrink: 0; }

.log-detail {
  margin-top: 6px;
  padding: 6px 8px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 4px;
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1.5;
  max-height: 120px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

/* ========== 报告 ========== */
.agent-report {
  margin-top: 12px;
  border: 1px solid rgba(167, 139, 250, 0.25);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.report-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: rgba(167, 139, 250, 0.08);
  color: #c4b5fd;
  font-size: 12px;
  font-weight: 600;
}
.report-header svg { width: 14px; height: 14px; }

.report-body { padding: 12px; font-size: 13px; line-height: 1.6; color: var(--text-primary); }
.report-body :deep(h1), .report-body :deep(h2), .report-body :deep(h3) { margin: 12px 0 6px; color: var(--text-primary); }
.report-body :deep(h1) { font-size: 16px; }
.report-body :deep(h2) { font-size: 14px; }
.report-body :deep(h3) { font-size: 13px; }
.report-body :deep(p) { margin: 6px 0; }
.report-body :deep(ul), .report-body :deep(ol) { padding-left: 20px; margin: 6px 0; }
.report-body :deep(a) { color: var(--accent-blue); text-decoration: none; }
.report-body :deep(a:hover) { text-decoration: underline; }
.report-body :deep(code) { background: rgba(255,255,255,0.06); padding: 1px 5px; border-radius: 3px; font-size: 12px; }
.report-body :deep(blockquote) { border-left: 3px solid var(--border-subtle); padding-left: 10px; margin: 8px 0; color: var(--text-secondary); }

/* ========== 历史抽屉 ========== */
.history-overlay {
  position: absolute;
  inset: 0;
  z-index: 100;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.history-drawer {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 85%;
  max-width: 320px;
  background: var(--bg-base);
  border-left: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  box-shadow: -4px 0 16px rgba(0, 0, 0, 0.3);
}

.history-drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.history-drawer-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}
.history-drawer-title svg { width: 16px; height: 16px; }

.drawer-close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0;
}
.drawer-close-btn:hover { color: var(--text-primary); background: var(--bg-hover); }
.drawer-close-btn svg { width: 14px; height: 14px; }

.history-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.history-empty {
  text-align: center;
  padding: 40px 20px;
  color: var(--text-muted);
  font-size: 13px;
}

.history-item {
  padding: 10px 12px;
  margin-bottom: 4px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.15s;
  border: 1px solid transparent;
}
.history-item:hover { background: var(--bg-hover); }
.history-item.active { background: var(--bg-hover); border-color: rgba(56, 139, 253, 0.3); }

.history-item-top {
  display: flex;
  align-items: center;
  gap: 8px;
}

.history-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.history-status-dot.status-complete { background: var(--accent-teal); }
.history-status-dot.status-error { background: #f87171; }
.history-status-dot.status-cancelled { background: #fbbf24; }

.history-item-task {
  flex: 1;
  font-size: 12px;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.history-item-delete {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  background: transparent;
  border: none;
  border-radius: 3px;
  color: var(--text-muted);
  cursor: pointer;
  opacity: 0;
  transition: all 0.15s;
  padding: 0;
  flex-shrink: 0;
}
.history-item:hover .history-item-delete { opacity: 1; }
.history-item-delete:hover { color: #f87171; background: rgba(248,113,113,0.1); }
.history-item-delete svg { width: 12px; height: 12px; }

.history-item-meta {
  display: flex;
  gap: 8px;
  margin-top: 4px;
  font-size: 10px;
  color: var(--text-muted);
}

.history-item-stats {
  margin-left: auto;
}

/* ========== 过渡 ========== */
.history-slide-enter-active,
.history-slide-leave-active {
  transition: opacity 0.2s ease;
}
.history-slide-enter-active .history-drawer,
.history-slide-leave-active .history-drawer {
  transition: transform 0.25s ease;
}
.history-slide-enter-from { opacity: 0; }
.history-slide-enter-from .history-drawer { transform: translateX(100%); }
.history-slide-leave-to { opacity: 0; }
.history-slide-leave-to .history-drawer { transform: translateX(100%); }

/* ========== 动画 ========== */
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

/* ========== 滚动条 ========== */
.agent-log::-webkit-scrollbar,
.history-list::-webkit-scrollbar { width: 6px; }
.agent-log::-webkit-scrollbar-track,
.history-list::-webkit-scrollbar-track { background: transparent; }
.agent-log::-webkit-scrollbar-thumb,
.history-list::-webkit-scrollbar-thumb { background: #2a3040; border-radius: 3px; }
.agent-log::-webkit-scrollbar-thumb:hover,
.history-list::-webkit-scrollbar-thumb:hover { background: #3a4258; }

.log-detail::-webkit-scrollbar { width: 4px; }
.log-detail::-webkit-scrollbar-track { background: transparent; }
.log-detail::-webkit-scrollbar-thumb { background: #2a3040; border-radius: 2px; }
</style>
