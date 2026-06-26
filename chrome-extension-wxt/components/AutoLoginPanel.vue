<template>
  <div class="llm-panel auto-login-container">
    <!-- 头部 -->
    <div class="al-header">
      <button class="back-btn" @click="goBack" title="返回">
        <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12.5 5L7.5 10l5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <div class="header-title-group">
        <div class="header-icon">
          <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="8" cy="8" r="4.5" stroke="url(#keyGrad)" stroke-width="1.5"/>
            <path d="M11.5 11.5L17 17" stroke="url(#keyGrad)" stroke-width="1.5" stroke-linecap="round"/>
            <path d="M14 15l1.5-1.5M15.5 16.5L17 15" stroke="url(#keyGrad)" stroke-width="1.2" stroke-linecap="round"/>
            <defs>
              <linearGradient id="keyGrad" x1="3" y1="3" x2="17" y2="17" gradientUnits="userSpaceOnUse">
                <stop stop-color="#60a5fa"/>
                <stop offset="1" stop-color="#a78bfa"/>
              </linearGradient>
            </defs>
          </svg>
        </div>
        <h2>自动登录工具</h2>
      </div>
      <div class="header-actions">
        <button class="icon-btn" @click="exportAccounts" title="导出账号">
          <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M10 3v9M6.5 8.5L10 12l3.5-3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M3 14v1a2 2 0 002 2h10a2 2 0 002-2v-1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>
        <button class="icon-btn" @click="triggerImport" title="导入账号">
          <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M10 14V5M6.5 8.5L10 5l3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M3 14v1a2 2 0 002 2h10a2 2 0 002-2v-1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>
        <button class="add-btn" @click="showAddForm = true" title="添加账号">
          <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
          <span>添加账号</span>
        </button>
        <input ref="fileInput" type="file" accept=".json" @change="importAccounts" style="display: none;" />
      </div>
    </div>

    <!-- 搜索栏 -->
    <div class="search-bar" v-if="accounts.length > 0">
      <div class="search-input-wrapper">
        <svg class="search-icon" viewBox="0 0 14 14" fill="none">
          <circle cx="6" cy="6" r="4" stroke="currentColor" stroke-width="1.2"/>
          <path d="M9.5 9.5l3 3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
        </svg>
        <input v-model="searchQuery" type="text" placeholder="搜索账号 / #标签 / @网址 / url: / name:" class="search-input" />
        <button v-if="searchQuery" class="search-clear" @click="searchQuery = ''">
          <svg viewBox="0 0 14 14" fill="none">
            <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
      <!-- 标签筛选 -->
      <div class="tag-filter-scroll" v-if="allTags.length > 0">
        <div class="tag-filter-inner">
          <button v-for="tag in allTags" :key="tag" class="tag-filter-btn" :class="{ active: selectedTagFilter === tag }"
            @click="selectedTagFilter = selectedTagFilter === tag ? '' : tag"
            :style="{ backgroundColor: getTagColor(tag) + '20', borderColor: getTagColor(tag) + '50', color: getTagColor(tag) }">
            #{{ tag }}
          </button>
          <button v-if="selectedTagFilter" class="tag-filter-btn clear-btn" @click="selectedTagFilter = ''">✕ 清除</button>
        </div>
      </div>
    </div>

    <!-- 账号列表 -->
    <div class="accounts-list">
      <!-- 空状态 -->
      <div v-if="displayedAccounts.length === 0 && accounts.length > 0" class="empty-state">
        <div class="empty-icon">
          <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="24" cy="24" r="20" fill="url(#emptyGrad2)" opacity="0.12"/>
            <circle cx="18" cy="18" r="7" stroke="url(#emptyGrad2)" stroke-width="1.5"/>
            <path d="M23.5 23.5L32 32" stroke="url(#emptyGrad2)" stroke-width="1.5" stroke-linecap="round"/>
            <path d="M28 30l2.5-2.5M30 32.5L32.5 30" stroke="url(#emptyGrad2)" stroke-width="1.2" stroke-linecap="round"/>
            <defs>
              <linearGradient id="emptyGrad2" x1="8" y1="8" x2="40" y2="40" gradientUnits="userSpaceOnUse">
                <stop stop-color="#60a5fa"/>
                <stop offset="1" stop-color="#a78bfa"/>
              </linearGradient>
            </defs>
          </svg>
        </div>
        <p class="empty-title">未找到匹配账号</p>
        <p class="empty-hint">请尝试调整搜索词或标签筛选条件</p>
      </div>
      <div v-else-if="accounts.length === 0" class="empty-state">
        <div class="empty-icon">
          <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="24" cy="24" r="20" fill="url(#emptyGrad3)" opacity="0.12"/>
            <circle cx="20" cy="17" r="5.5" stroke="url(#emptyGrad3)" stroke-width="1.5"/>
            <path d="M10 36c0-5.52 4.48-10 10-10s10 4.48 10 10" stroke="url(#emptyGrad3)" stroke-width="1.5" stroke-linecap="round"/>
            <path d="M32 22v8M28 26h8" stroke="url(#emptyGrad3)" stroke-width="1.5" stroke-linecap="round"/>
            <defs>
              <linearGradient id="emptyGrad3" x1="8" y1="8" x2="40" y2="40" gradientUnits="userSpaceOnUse">
                <stop stop-color="#60a5fa"/>
                <stop offset="1" stop-color="#a78bfa"/>
              </linearGradient>
            </defs>
          </svg>
        </div>
        <p class="empty-title">暂无已保存的账号</p>
        <p class="empty-hint">点击右上角「添加账号」按钮开始添加</p>
      </div>

      <!-- 账号卡片 -->
      <div v-for="account in displayedAccounts" :key="account.id" class="account-card">
        <div class="account-card-main">
          <div class="account-info">
            <div class="account-avatar">{{ account.name.charAt(0).toUpperCase() }}</div>
            <div class="account-details">
              <div class="account-name">{{ account.name }}</div>
              <div class="account-tags" v-if="getTagsArray(account.tags).length > 0">
                <span v-for="tag in getTagsArray(account.tags)" :key="tag" class="tag-badge"
                  :style="{ backgroundColor: getTagColor(tag) + '20', borderColor: getTagColor(tag) + '50', color: getTagColor(tag) }">
                  #{{ tag }}
                </span>
              </div>
              <div class="account-meta">
                <span class="meta-item">
                  <svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="5.5" r="2.5" stroke="currentColor" stroke-width="1.3"/><path d="M2.5 13.5c0-3.04 2.46-5.5 5.5-5.5s5.5 2.46 5.5 5.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
                  {{ account.username }}
                </span>
                <span class="meta-item meta-password">
                  <svg viewBox="0 0 16 16" fill="none"><rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M5 7V5.5a3 3 0 016 0V7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
                  <span class="password-value">{{ account.password }}</span>
                  <button class="meta-copy-btn" @click.stop="copyAccountInfo(account)" title="复制账号密码">
                    <svg viewBox="0 0 14 14" fill="none"><rect x="2.5" y="2.5" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.2"/><rect x="5.5" y="5.5" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.2"/></svg>
                  </button>
                </span>
              </div>
            </div>
          </div>
          <div class="account-actions">
            <button class="act-btn act-icon" @click="duplicateAccount(account)" title="复制并新建">
              <svg viewBox="0 0 16 16" fill="none"><rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.3"/><rect x="6" y="6" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.3"/></svg>
            </button>
            <button class="act-btn act-icon" @click="editAccount(account)" title="编辑">
              <svg viewBox="0 0 16 16" fill="none"><path d="M11.5 2.5l2 2L5 13H3v-2L11.5 2.5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
            </button>
            <button class="act-btn act-icon act-delete" @click="deleteAccount(account.id)" title="删除">
              <svg viewBox="0 0 16 16" fill="none"><path d="M3 4h10M6 4V2.5h4V4M5.5 4v8.5h5V4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <button class="act-btn act-use" @click="useAccount(account)" title="使用">使用</button>
            <button class="act-btn act-switch" @click="switchAccount(account)" title="替换">替换</button>
          </div>
        </div>
        
        <!-- 链接区域 -->
        <div class="account-urls" v-if="getUrlsArray(account.urls).length > 0">
          <div class="url-label">
            <svg viewBox="0 0 14 14" fill="none"><path d="M5 9a2.5 2.5 0 003.5 0l2-2a2.5 2.5 0 00-3.5 0L6.5 6.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M9 5a2.5 2.5 0 00-3.5 0l-2 2a2.5 2.5 0 003.5 0l.5-.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
            链接
          </div>
          <div class="url-chips">
            <a v-for="(url, idx) in getUrlsArray(account.urls)" :key="idx" class="url-chip" @click.prevent="openUrlAndLogin(url, account)" :title="url">
              {{ formatUrlDisplay(url) }}
            </a>
            <button class="url-add-current" @click="addCurrentUrlToAccount(account)" title="添加当前页面 URL">
              <svg viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
              当前页
            </button>
          </div>
        </div>
        <div class="account-urls-empty" v-else>
          <span class="url-any">任意页面</span>
          <button class="url-add-current" @click="addCurrentUrlToAccount(account)" title="添加当前页面 URL">
            <svg viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            当前页
          </button>
        </div>
      </div>
    </div>

    <!-- 添加/编辑账号表单模态框 -->
    <div v-if="showAddForm" class="modal-overlay" @click="closeAddForm">
      <div class="modal-content" @click.stop>
        <div class="modal-header">
          <div class="modal-title-group">
            <div class="modal-title-icon">
              <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="8" cy="8" r="4.5" stroke="url(#modalKeyGrad)" stroke-width="1.5"/>
                <path d="M11.5 11.5L17 17" stroke="url(#modalKeyGrad)" stroke-width="1.5" stroke-linecap="round"/>
                <defs>
                  <linearGradient id="modalKeyGrad" x1="3" y1="3" x2="17" y2="17" gradientUnits="userSpaceOnUse">
                    <stop stop-color="#60a5fa"/>
                    <stop offset="1" stop-color="#a78bfa"/>
                  </linearGradient>
                </defs>
              </svg>
            </div>
            <h3>{{ editingAccount ? '编辑账号' : '添加新账号' }}</h3>
          </div>
          <button class="modal-close-btn" @click="closeAddForm">
            <svg viewBox="0 0 20 20" fill="none">
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
        <form @submit.prevent="editingAccount ? updateAccount() : addAccount()" class="account-form">
          <div class="form-group">
            <label>账号名称</label>
            <input v-model="newAccount.name" type="text" placeholder="例如: admin/password123" @input="parseAccountName" required />
            <small class="hint-text">支持快速格式: 用户名/密码</small>
          </div>
          <div class="form-group">
            <label>用户名</label>
            <input v-model="newAccount.username" type="text" placeholder="请输入用户名" required />
          </div>
          <div class="form-group">
            <label>密码</label>
            <input v-model="newAccount.password" type="text" placeholder="请输入密码" required />
          </div>
          <div class="form-group">
            <div class="url-input-header">
              <label>页面 URL（可选）</label>
              <button type="button" class="add-current-url-btn" @click="addCurrentUrl" title="添加当前页面 URL">
                <svg viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                当前页
              </button>
            </div>
            <div class="url-input-list">
              <div v-for="(url, idx) in urlInputs" :key="idx" class="url-input-row">
                <input v-model="urlInputs[idx]" type="text" placeholder="https://example.com" class="url-input-item" />
                <button type="button" class="url-remove-btn" @click="removeUrlInput(idx)" title="删除此 URL">
                  <svg viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8M10 2L2 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                </button>
              </div>
              <button type="button" class="url-add-btn" @click="addUrlInput">
                <svg viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                添加 URL
              </button>
            </div>
            <small>填写后仅在这些页面显示此账号，同一域名自动去重</small>
          </div>
          <div class="form-group">
            <label>标签（可选，用逗号分隔，支持 name:#color 格式）</label>
            <input v-model="newAccount.tags" type="text" placeholder="例如: test, dev, prod:#ff0000" />
            <small class="hint-text">支持自定义颜色: tagName:#hexColor</small>
          </div>
          <div class="form-actions">
            <button type="button" class="cancel-btn" @click="closeAddForm">取消</button>
            <button type="submit" class="submit-btn">{{ editingAccount ? '更新' : '保存' }}</button>
          </div>
        </form>
      </div>
    </div>

    <!-- 消息提示 -->
    <div v-if="message.show" class="al-message" :class="message.type">
      <span class="al-message-icon">
        <svg v-if="message.type === 'success'" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" fill="#34d399" opacity="0.2"/><path d="M5 8l2 2 4-4" stroke="#34d399" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <svg v-else-if="message.type === 'error'" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" fill="#f87171" opacity="0.2"/><path d="M10 6L6 10M6 6l4 4" stroke="#f87171" stroke-width="1.5" stroke-linecap="round"/></svg>
        <svg v-else viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" fill="#60a5fa" opacity="0.2"/><path d="M8 7v4M8 5.5v.5" stroke="#60a5fa" stroke-width="1.5" stroke-linecap="round"/></svg>
      </span>
      {{ message.text }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { isReceiverNotExistError } from '../utils/chromeErrorUtils';

interface Account {
  id: string;
  name: string;
  username: string;
  password: string;
  urls?: string[];
  tags?: string[];
}

interface Message {
  show: boolean;
  text: string;
  type: 'success' | 'error' | 'info';
}

const emit = defineEmits<{
  (e: 'back'): void;
}>();
const MESSAGE_DISPLAY_DURATION_MS = 3000;

async function sendMessageToContentScript(tabId: number, message: object): Promise<any> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, message);
    return response;
  } catch (error: unknown) {
    if (isReceiverNotExistError(error)) {
      try {
        await chrome.scripting.executeScript({ target: { tabId }, files: ['content-scripts/content.js'] });
        await new Promise(resolve => setTimeout(resolve, 300));
        const retryResponse = await chrome.tabs.sendMessage(tabId, message);
        return retryResponse;
      } catch (injectError: unknown) {
        const injectMsg = (injectError instanceof Error && injectError.message) || '未知错误';
        throw new Error('无法在此页面执行操作: ' + injectMsg);
      }
    } else {
      throw error;
    }
  }
}

// ========== State ==========

const accounts = ref<Account[]>([]);
const currentUrl = ref('');
const showAddForm = ref(false);
const showPassword = ref(false);
const editingAccount = ref<Account | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const searchQuery = ref('');
const selectedTagFilter = ref('');
const tagColors = ref<Record<string, string>>({});
const newAccount = ref({ name: '', username: '', password: '', urls: '', tags: '' });
const message = ref<Message>({ show: false, text: '', type: 'info' });
const urlInputs = ref<string[]>(['']);

// ========== Tag Color Functions ==========

const DEFAULT_TAG_COLORS: Record<string, string> = {
  test: '#f97316', dev: '#f97316', '开发': '#f97316',
  prod: '#ef4444', '生产': '#ef4444', '正式': '#ef4444',
  security: '#3b82f6', rizhiyi: '#22c55e', '日志': '#22c55e',
};

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash);
}

function hashToHslColor(str: string): string {
  const hash = hashString(str);
  return `hsl(${hash % 360}, ${65 + (hash % 25)}%, ${45 + (hash % 15)}%)`;
}

function getTagColor(tag: string): string {
  if (tagColors.value[tag]) return tagColors.value[tag];
  if (DEFAULT_TAG_COLORS[tag]) return DEFAULT_TAG_COLORS[tag];
  return hashToHslColor(tag);
}

async function loadTagColors() {
  try {
    const result = await chrome.storage.local.get('autoLoginTagColors');
    tagColors.value = result.autoLoginTagColors || {};
  } catch (error) {
    console.error('[AutoLogin] 加载标签颜色失败:', error);
  }
}

async function saveTagColors() {
  try {
    await chrome.storage.local.set({ autoLoginTagColors: tagColors.value });
  } catch (error) {
    console.error('[AutoLogin] 保存标签颜色失败:', error);
  }
}

interface ParsedTag { name: string; color?: string; }

function parseTagInput(input: string): ParsedTag[] {
  if (!input.trim()) return [];
  return input.split(',').map(t => t.trim()).filter(Boolean).map(tagStr => {
    const match = tagStr.match(/^(.+):#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/);
    if (match) return { name: match[1], color: '#' + match[2].toLowerCase() };
    return { name: tagStr };
  });
}

function updateTagColorsFromInput(parsedTags: ParsedTag[]) {
  let hasChanges = false;
  parsedTags.forEach(tag => {
    if (tag.color && tag.color !== (tagColors.value[tag.name] || DEFAULT_TAG_COLORS[tag.name])) {
      tagColors.value[tag.name] = tag.color;
      hasChanges = true;
    }
  });
  if (hasChanges) saveTagColors();
}

function tagsToInputString(tags: string[] | string | undefined): string {
  if (!tags) return '';
  if (Array.isArray(tags)) {
    return tags.map(tag => {
      const color = tagColors.value[tag] || DEFAULT_TAG_COLORS[tag];
      return color ? `${tag}:${color}` : tag;
    }).join(', ');
  }
  return typeof tags === 'string' ? tags : '';
}

// ========== URL Functions ==========

function getUrlsArray(urls: string[] | string | undefined): string[] {
  if (!urls) return [];
  if (Array.isArray(urls)) return urls;
  return typeof urls === 'string' ? (urls ? [urls] : []) : [];
}

function migrateUrlToUrls(account: any): Account {
  const urls = account.urls || (account.url ? [account.url] : undefined);
  const { url, ...rest } = account;
  return { ...rest, urls } as Account;
}

function urlMatchesCurrent(url: string): boolean {
  if (!currentUrl.value) return true;
  try {
    return new URL(url).origin === new URL(currentUrl.value).origin;
  } catch { return false; }
}

function extractDomain(url: string): string {
  try {
    const u = new URL(url);
    // 包含端口（如果有），如 192.168.1.1:8080
    return u.host;
  } catch { return url; }
}

function formatUrlDisplay(url: string): string {
  try {
    const u = new URL(url);
    // 显示协议 + 主机（含端口），如 http://192.168.1.1:8080
    return `${u.protocol}//${u.host}`;
  } catch { return url; }
}

function getUrlKey(url: string): string {
  try {
    const u = new URL(url);
    // 协议 + 主机 + 端口，用于去重区分 http/https 和不同端口
    return `${u.protocol}//${u.host}`;
  } catch { return url; }
}

function deduplicateUrlsByDomain(urls: string[]): string[] {
  const seen = new Set<string>();
  return urls.filter(url => {
    const key = getUrlKey(url);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function addUrlInput() { urlInputs.value.push(''); }
function removeUrlInput(idx: number) {
  urlInputs.value.splice(idx, 1);
  if (urlInputs.value.length === 0) urlInputs.value.push('');
}

async function addCurrentUrl() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url && tab.url.startsWith('http')) {
      const newDomain = extractDomain(tab.url);
      const existingDomains = urlInputs.value.filter(u => u.trim()).map(u => extractDomain(u));
      if (existingDomains.includes(newDomain)) { showMessage('该域名已存在', 'info'); return; }
      const emptyIdx = urlInputs.value.findIndex(u => !u.trim());
      if (emptyIdx >= 0) urlInputs.value[emptyIdx] = tab.url;
      else urlInputs.value.push(tab.url);
      showMessage('✓ 已添加当前页面 URL', 'success');
    } else { showMessage('无法获取当前页面 URL', 'error'); }
  } catch (error) { showMessage('获取当前页面 URL 失败', 'error'); }
}

async function addCurrentUrlToAccount(account: Account) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || !tab.url.startsWith('http')) { showMessage('无法获取当前页面 URL', 'error'); return; }
    currentUrl.value = tab.url;
    const urls = getUrlsArray(account.urls);
    const newDomain = extractDomain(tab.url);
    const existingDomains = urls.map(u => extractDomain(u));
    if (existingDomains.includes(newDomain)) { showMessage('该域名已存在', 'info'); return; }
    const index = accounts.value.findIndex(acc => acc.id === account.id);
    if (index === -1) { showMessage('未找到账号', 'error'); return; }
    accounts.value[index].urls = deduplicateUrlsByDomain([...urls, tab.url]);
    await saveAccounts();
    showMessage('✓ 已添加当前页面 URL', 'success');
  } catch (error) { showMessage('获取当前页面 URL 失败', 'error'); }
}

function getUrlsFromInputs(): string[] {
  return urlInputs.value.map(u => u.trim()).filter(Boolean);
}

function setUrlInputs(urls: string[] | string | undefined) {
  const arr = getUrlsArray(urls);
  urlInputs.value = arr.length > 0 ? [...arr] : [''];
}

// ========== Tag Array Helpers ==========

function getTagsArray(tags: string[] | Record<string, string> | string | undefined): string[] {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags;
  if (typeof tags === 'string') return tags ? [tags] : [];
  if (typeof tags === 'object') return Object.values(tags).filter((v): v is string => typeof v === 'string');
  return [];
}

// ========== Computed ==========

const allTags = computed(() => {
  const tagSet = new Set<string>();
  accounts.value.forEach(account => getTagsArray(account.tags).forEach(tag => tagSet.add(tag)));
  return Array.from(tagSet).sort();
});

const sortedAccounts = computed(() => {
  const list = [...accounts.value];
  if (!currentUrl.value) return list.sort((a, b) => a.name.localeCompare(b.name));

  const items = list.map(account => {
    const urls = getUrlsArray(account.urls);
    const hasMatch = urls.some(url => urlMatchesCurrent(url));
    const priority = hasMatch ? 2 : (urls.length === 0 ? 1 : 0);
    return { account, urls, hasMatch, priority };
  });

  return items.sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    return a.account.name.localeCompare(b.account.name);
  }).map(i => i.account);
});

const displayedAccounts = computed(() => {
  let result = sortedAccounts.value;
  if (selectedTagFilter.value) {
    result = result.filter(account => getTagsArray(account.tags).includes(selectedTagFilter.value));
  }
  const rawQuery = searchQuery.value.trim();
  if (rawQuery) {
    const query = rawQuery.toLowerCase();

    if (query.startsWith('#')) {
      // #标签过滤
      const tagQuery = query.slice(1).trim();
      result = result.filter(account => getTagsArray(account.tags).some(tag => tag.toLowerCase().includes(tagQuery)));
    } else if (query.startsWith('@')) {
      // @URL 过滤
      const urlQuery = query.slice(1).trim();
      result = result.filter(account => getUrlsArray(account.urls).join(' ').toLowerCase().includes(urlQuery));
    } else {
      // 支持 url: / u: / name: / n: 前缀（兼容中英文冒号）
      const prefixMatch = query.match(/^(url|u|name|n)[:：](.*)$/);
      if (prefixMatch) {
        const [, prefix, rest] = prefixMatch;
        const restQuery = rest.trim();
        if (prefix === 'url' || prefix === 'u') {
          result = result.filter(account => getUrlsArray(account.urls).join(' ').toLowerCase().includes(restQuery));
        } else if (prefix === 'name' || prefix === 'n') {
          result = result.filter(account => account.name.toLowerCase().includes(restQuery));
        }
      } else {
        // 默认全局模糊搜索
        result = result.filter(account => {
          const tags = getTagsArray(account.tags).join(' ').toLowerCase();
          const urls = getUrlsArray(account.urls).join(' ').toLowerCase();
          return account.name.toLowerCase().includes(query) || account.username.toLowerCase().includes(query)
            || urls.includes(query) || tags.includes(query);
        });
      }
    }
  }
  return result;
});

// ========== UI Functions ==========

function showMessage(text: string, type: 'success' | 'error' | 'info' = 'info') {
  message.value = { show: true, text, type };
  setTimeout(() => message.value.show = false, MESSAGE_DISPLAY_DURATION_MS);
}

function goBack() { emit('back'); }

function closeAddForm() {
  showAddForm.value = false;
  showPassword.value = false;
  editingAccount.value = null;
  newAccount.value = { name: '', username: '', password: '', urls: '', tags: '' };
  urlInputs.value = [''];
}

function parseAccountName() {
  const nameValue = newAccount.value.name.trim();
  const slashIndex = nameValue.indexOf('/');
  if (slashIndex > 0 && slashIndex < nameValue.length - 1) {
    const username = nameValue.substring(0, slashIndex);
    const password = nameValue.substring(slashIndex + 1);
    if (!newAccount.value.username && !newAccount.value.password) {
      newAccount.value.username = username;
      newAccount.value.password = password;
    }
  }
}

async function copyToClipboard(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    showMessage(`✓ ${label}已复制`, 'success');
  } catch (error) {
    showMessage('复制失败', 'error');
  }
}

function duplicateAccount(account: Account) {
  editingAccount.value = null;
  newAccount.value = {
    name: `${account.name} (复制)`,
    username: account.username,
    password: account.password,
    urls: '',
    tags: tagsToInputString(account.tags)
  };
  setUrlInputs(account.urls);
  showAddForm.value = true;
}

async function copyAccountInfo(account: Account) {
  try {
    await navigator.clipboard.writeText(`账号：${account.username}，密码：${account.password}`);
    showMessage('✓ 账号信息已复制', 'success');
  } catch (error) { showMessage('复制失败', 'error'); }
}

function editAccount(account: Account) {
  editingAccount.value = account;
  newAccount.value = { name: account.name, username: account.username, password: account.password, urls: '', tags: tagsToInputString(account.tags) };
  setUrlInputs(account.urls);
  showAddForm.value = true;
}

async function openUrlAndLogin(url: string, account: Account) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) { showMessage('无法获取当前标签页', 'error'); return; }
    await chrome.tabs.update(tab.id, { url });
    showMessage('正在打开页面...', 'info');
    let attempts = 0;
    const checkAndLogin = async () => {
      attempts++;
      if (attempts > 20) { showMessage('页面加载超时，请手动点击「使用」按钮', 'error'); return; }
      try {
        const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (currentTab?.status === 'complete' && currentTab.url?.includes(new URL(url).hostname)) {
          await sendMessageToContentScript(currentTab.id!, { type: 'AUTO_LOGIN', username: account.username, password: account.password });
          showMessage('✓ 已自动登录', 'success');
        } else { setTimeout(checkAndLogin, 500); }
      } catch (error) { setTimeout(checkAndLogin, 500); }
    };
    setTimeout(checkAndLogin, 1000);
  } catch (error) { showMessage('打开页面失败', 'error'); }
}

async function useAccount(account: Account) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) { showMessage('无法获取当前标签页', 'error'); return; }
    if (tab.url && /^(chrome|chrome-extension|edge|about):/i.test(tab.url)) { showMessage('该页面不支持自动登录', 'error'); return; }
    try {
      const response = await sendMessageToContentScript(tab.id, { type: 'AUTO_LOGIN', username: account.username, password: account.password });
      showMessage(response?.success ? '✓ 已自动登录' : (response?.error || '登录失败'), response?.success ? 'success' : 'error');
    } catch (error: unknown) { showMessage('登录失败', 'error'); }
  } catch (error: unknown) { showMessage('登录失败', 'error'); }
}

async function switchAccount(account: Account) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) { showMessage('无法获取当前标签页', 'error'); return; }
    if (tab.url && /^(chrome|chrome-extension|edge|about):/i.test(tab.url)) { showMessage('该页面不支持账号替换', 'error'); return; }
    if (!confirm(`确定要替换为 "${account.name}" 吗？\n将退出当前账号并重新登录。`)) return;
    showMessage('正在替换账号...', 'info');
    try {
      const response = await sendMessageToContentScript(tab.id, { type: 'ACCOUNT_SWITCH', username: account.username, password: account.password });
      showMessage(response?.success ? '✓ 账号已替换' : (response?.error || '替换失败'), response?.success ? 'success' : 'error');
    } catch (error: unknown) { showMessage('替换失败', 'error'); }
  } catch (error: unknown) { showMessage('替换失败', 'error'); }
}

async function getCurrentUrl() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) currentUrl.value = tab.url;
  } catch (error) { console.error('Failed to get current URL:', error); }
}

// ========== Storage Functions ==========

async function loadAccounts() {
  try {
    const result = await chrome.storage.local.get('autoLoginAccounts');
    const rawAccounts = result.autoLoginAccounts;
    if (!Array.isArray(rawAccounts)) { accounts.value = []; return; }
    accounts.value = rawAccounts.map((acc: any) => {
      const normalized = migrateUrlToUrls(acc);
      return { ...normalized, tags: getTagsArray(normalized.tags) };
    });
  } catch (error: unknown) {
    showMessage('加载账号失败', 'error');
  }
}

async function saveAccounts() {
  try {
    const accountsToSave = accounts.value.map(acc => {
      const clean: Account = { id: acc.id, name: acc.name, username: acc.username, password: acc.password };
      const urls = deduplicateUrlsByDomain(getUrlsArray(acc.urls));
      if (urls.length > 0) clean.urls = urls;
      const tags = getTagsArray(acc.tags);
      if (tags.length > 0) clean.tags = tags;
      return clean;
    });
    await chrome.storage.local.set({ autoLoginAccounts: accountsToSave });
  } catch (error: unknown) { throw new Error('保存账号失败'); }
}

function validateNewAccount(){
  if (!newAccount.value.name.trim()) { showMessage('请输入账号名称', 'error'); return false; }
  if (!newAccount.value.username.trim()) { showMessage('请输入用户名', 'error'); return false; }
  if (!newAccount.value.password.trim()) { showMessage('请输入密码', 'error'); return false; }
  return true;
}

async function addAccount() {
  try {
    if (!Array.isArray(accounts.value)) accounts.value = [];
    if (!validateNewAccount()) return;
    const parsedTags = parseTagInput(newAccount.value.tags);
    const parsedUrls = deduplicateUrlsByDomain(getUrlsFromInputs());
    updateTagColorsFromInput(parsedTags);
    const account: Account = {
      id: crypto.randomUUID(), name: newAccount.value.name.trim(), username: newAccount.value.username.trim(),
      password: newAccount.value.password.trim(), urls: parsedUrls.length > 0 ? parsedUrls : undefined,
      tags: parsedTags.length > 0 ? parsedTags.map(t => t.name) : undefined,
    };
    accounts.value.push(account);
    await saveAccounts();
    closeAddForm();
    showMessage('✓ 账号已添加', 'success');
  } catch (error: unknown) { showMessage('添加失败', 'error'); }
}

async function updateAccount() {
  try {
    if (!Array.isArray(accounts.value)) { accounts.value = []; showMessage('数据异常', 'error'); closeAddForm(); return; }
    if (!editingAccount.value) { showMessage('未找到要编辑的账号', 'error'); return; }
    if (!validateNewAccount()) return;
    const index = accounts.value.findIndex(acc => acc.id === editingAccount.value!.id);
    if (index !== -1) {
      const parsedTags = parseTagInput(newAccount.value.tags);
      const parsedUrls = deduplicateUrlsByDomain(getUrlsFromInputs());
      updateTagColorsFromInput(parsedTags);
      accounts.value[index] = {
        ...accounts.value[index], name: newAccount.value.name.trim(), username: newAccount.value.username.trim(),
        password: newAccount.value.password.trim(), urls: parsedUrls.length > 0 ? parsedUrls : undefined,
        tags: parsedTags.length > 0 ? parsedTags.map(t => t.name) : undefined,
      };
      await saveAccounts();
      closeAddForm();
      showMessage('✓ 账号已更新', 'success');
    } else { showMessage('未找到要编辑的账号', 'error'); }
  } catch (error: unknown) { showMessage('更新失败', 'error'); }
}

async function deleteAccount(id: string) {
  if (!confirm('确定要删除此账号吗？')) return;
  try {
    if (!Array.isArray(accounts.value)) { accounts.value = []; showMessage('数据异常', 'error'); return; }
    accounts.value = accounts.value.filter(acc => acc.id !== id);
    await saveAccounts();
    showMessage('账号已删除', 'success');
  } catch (error: unknown) { showMessage('删除失败', 'error'); }
}

// ========== Import/Export ==========

function exportAccounts() {
  try {
    if (accounts.value.length === 0) { showMessage('没有账号可导出', 'error'); return; }
    const exportData = { version: '2.0', exportDate: new Date().toISOString(), accounts: accounts.value, tagColors: tagColors.value };
    const jsonStr = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `accounts-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    showMessage(`✓ 已导出 ${accounts.value.length} 个账号`, 'success');
  } catch (error: unknown) { showMessage('导出失败', 'error'); }
}

function triggerImport() { if (fileInput.value) fileInput.value.click(); }

async function importAccounts(event: Event) {
  try {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0]; if (!file) return;
    const text = await file.text();
    const importData = JSON.parse(text);
    if (!importData.accounts || !Array.isArray(importData.accounts)) { showMessage('文件格式不正确', 'error'); return; }
    if (importData.tagColors && typeof importData.tagColors === 'object') {
      tagColors.value = { ...tagColors.value, ...importData.tagColors };
      await saveTagColors();
    }
    let addedCount = 0, skippedCount = 0;
    const existingKeys = new Set(accounts.value.map(acc => `${acc.username}::${getUrlsArray(acc.urls).join(',')}`));
    importData.accounts.forEach((acc: any) => {
      const migrated = migrateUrlToUrls(acc);
      const key = `${migrated.username}::${getUrlsArray(migrated.urls).join(',')}`;
      if (!existingKeys.has(key)) {
        accounts.value.push({ ...migrated, id: crypto.randomUUID(), tags: getTagsArray(migrated.tags) });
        existingKeys.add(key); addedCount++;
      } else { skippedCount++; }
    });
    if (addedCount > 0) {
      await saveAccounts();
      showMessage(`✓ 导入 ${addedCount} 个账号${skippedCount > 0 ? `, 跳过 ${skippedCount} 个重复` : ''}`, 'success');
    } else { showMessage('没有新账号可导入（全部重复）', 'info'); }
    input.value = '';
  } catch (error: unknown) { showMessage('导入失败', 'error'); }
}

// ========== Lifecycle ==========

function updateCurrentUrlFromActiveTab() {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (tab?.url) currentUrl.value = tab.url;
  });
}

onMounted(() => {
  loadAccounts();
  loadTagColors();
  getCurrentUrl();
  chrome.tabs.onActivated.addListener(updateCurrentUrlFromActiveTab);
  chrome.tabs.onUpdated.addListener(updateCurrentUrlFromActiveTab);
});

onUnmounted(() => {
  chrome.tabs.onActivated.removeListener(updateCurrentUrlFromActiveTab);
  chrome.tabs.onUpdated.removeListener(updateCurrentUrlFromActiveTab);
});
</script>

<style scoped>
/* ========== 设计变量 ========== */
.auto-login-container {
  --bg-deep: #0f1117;
  --bg-base: #161b22;
  --bg-card: #1c2130;
  --bg-hover: #242938;
  --border-subtle: #2a3040;
  --accent-blue: #388bfd;
  --accent-purple: #a78bfa;
  --accent-green: #4ec9b0;
  --accent-yellow: #fbbf24;
  --accent-red: #f87171;
  --text-primary: #e6edf3;
  --text-secondary: #8b949e;
  --text-muted: #484f58;
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 10px;

  width: 100%;
  height: calc(100vh - 28px);
  background-color: var(--bg-deep);
  color: var(--text-primary);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  font-size: 12px;
}

/* ========== 头部 ========== */
.al-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: linear-gradient(180deg, #1a2030 0%, #161b22 100%);
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.back-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s ease;
  padding: 0;
  flex-shrink: 0;
}
.back-btn svg { width: 14px; height: 14px; }
.back-btn:hover { background: var(--bg-hover); border-color: var(--border-subtle); color: var(--text-primary); }
.back-btn:active { transform: scale(0.92); }

.header-title-group {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.header-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}
.header-icon svg { width: 100%; height: 100%; }

.al-header h2 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
}

.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s ease;
  padding: 0;
}
.icon-btn svg { width: 14px; height: 14px; }
.icon-btn:hover { background: var(--bg-hover); border-color: var(--border-subtle); color: var(--text-primary); }
.icon-btn:active { transform: scale(0.92); }

.add-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: rgba(56, 139, 253, 0.15);
  border: 1px solid rgba(56, 139, 253, 0.35);
  border-radius: var(--radius-sm);
  color: #60a5fa;
  cursor: pointer;
  transition: all 0.15s ease;
  font-size: 11px;
  font-weight: 500;
}
.add-btn svg { width: 14px; height: 14px; }
.add-btn:hover { background: rgba(56, 139, 253, 0.25); border-color: rgba(56, 139, 253, 0.55); color: #93c5fd; }
.add-btn:active { transform: scale(0.95); }

/* ========== 搜索栏 ========== */
.search-bar {
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;
}

.search-input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.search-icon {
  position: absolute;
  left: 8px;
  width: 12px;
  height: 12px;
  color: var(--text-muted);
  pointer-events: none;
}

.search-input {
  width: 100%;
  padding: 5px 22px 5px 24px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: 11px;
  outline: none;
  transition: border-color 0.15s ease;
  box-sizing: border-box;
}
.search-input:focus { border-color: rgba(56, 139, 253, 0.5); }
.search-input::placeholder { color: var(--text-muted); }

.search-clear {
  position: absolute;
  right: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0;
  border-radius: 2px;
}
.search-clear svg { width: 10px; height: 10px; }
.search-clear:hover { color: var(--text-secondary); }

/* 标签筛选 - 横向滚动 */
.tag-filter-scroll {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  margin: 0 -2px;
  padding: 0 2px;
}
.tag-filter-scroll::-webkit-scrollbar { display: none; }

.tag-filter-inner {
  display: flex;
  gap: 5px;
  flex-wrap: nowrap;
  min-width: min-content;
}

.tag-filter-btn {
  padding: 3px 10px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 12px;
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
  line-height: 1.4;
  flex-shrink: 0;
}
.tag-filter-btn:hover { filter: brightness(1.2); }
.tag-filter-btn.active { background: rgba(56, 139, 253, 0.15); border-color: rgba(56, 139, 253, 0.5); color: #60a5fa; }
.tag-filter-btn.clear-btn { background: rgba(248, 113, 113, 0.08); border-color: rgba(248, 113, 113, 0.25); color: #f87171; padding: 3px 8px; }
.tag-filter-btn.clear-btn:hover { background: rgba(248, 113, 113, 0.15); border-color: rgba(248, 113, 113, 0.4); }

/* ========== 账号列表 ========== */
.accounts-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 10px 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* 空状态 */
.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 32px 16px;
}
.empty-icon { width: 48px; height: 48px; color: var(--text-muted); opacity: 0.5; }
.empty-title { font-size: 12px; font-weight: 500; color: var(--text-secondary); margin: 0; }
.empty-hint { font-size: 11px; color: var(--text-muted); margin: 0; text-align: center; }

/* ========== 账号卡片 ========== */
.account-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.account-card:hover { border-color: rgba(56, 139, 253, 0.3); background: var(--bg-hover); }

.account-card-main {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
}

.account-info {
  display: flex;
  gap: 10px;
  flex: 1;
  min-width: 0;
}

.account-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: linear-gradient(135deg, rgba(56, 139, 253, 0.2), rgba(167, 139, 250, 0.2));
  border: 1px solid rgba(96, 165, 250, 0.25);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  color: #60a5fa;
  flex-shrink: 0;
}

.account-details {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.account-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.account-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.tag-badge {
  padding: 1px 6px;
  border: 1px solid transparent;
  border-radius: 10px;
  font-size: 10px;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
  line-height: 1.3;
}
.tag-badge:hover { filter: brightness(1.2); }

.account-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 11px;
  color: var(--text-secondary);
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 3px;
}
.meta-item svg { width: 12px; height: 12px; flex-shrink: 0; color: var(--text-muted); }

.meta-password .password-value {
  color: var(--accent-green);
  font-family: 'SF Mono', 'Fira Code', monospace;
}

.meta-copy-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-left: 4px;
  padding: 2px;
  background: transparent;
  border: none;
  border-radius: 3px;
  cursor: pointer;
  color: var(--text-muted);
  opacity: 0.7;
  transition: opacity 0.15s, background-color 0.15s;
}
.meta-copy-btn:hover {
  opacity: 1;
  background-color: rgba(255, 255, 255, 0.08);
  color: var(--text-secondary);
}
.meta-copy-btn svg { width: 12px; height: 12px; }

/* 链接区域 */
.account-urls {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  background: rgba(56, 139, 253, 0.04);
  border: 1px solid rgba(56, 139, 253, 0.1);
  border-radius: var(--radius-sm);
}

.url-label {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  color: var(--text-muted);
  flex-shrink: 0;
}
.url-label svg { width: 11px; height: 11px; }

.url-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  flex: 1;
}

.url-chip {
  padding: 2px 8px;
  background: rgba(56, 139, 253, 0.1);
  border: 1px solid rgba(56, 139, 253, 0.2);
  border-radius: 10px;
  font-size: 10px;
  color: var(--accent-blue);
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}
.url-chip:hover { background: rgba(56, 139, 253, 0.2); border-color: rgba(56, 139, 253, 0.4); }

.account-urls-empty {
  padding: 4px 8px;
  font-size: 10px;
  color: var(--text-muted);
}

.url-any {
  font-style: italic;
}

.url-add-current {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px 8px;
  background: transparent;
  border: 1px dashed var(--border-subtle);
  border-radius: 10px;
  font-size: 10px;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}
.url-add-current svg { width: 10px; height: 10px; }
.url-add-current:hover { border-color: var(--accent-blue); color: var(--accent-blue); background: rgba(56, 139, 253, 0.08); }

/* ========== 账号操作按钮 ========== */
.account-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.act-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 5px 10px;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}
.act-btn svg { width: 13px; height: 13px; }

.act-use {
  background: var(--accent-blue);
  color: #fff;
}
.act-use:hover { background: #4d9bff; }

.act-switch {
  background: rgba(251, 191, 36, 0.15);
  color: #fbbf24;
  border: 1px solid rgba(251, 191, 36, 0.3);
}
.act-switch:hover { background: rgba(251, 191, 36, 0.25); }

.act-icon {
  background: transparent;
  border: 1px solid var(--border-subtle);
  color: var(--text-muted);
  padding: 5px 7px;
}
.act-icon:hover { border-color: rgba(56, 139, 253, 0.4); color: #60a5fa; background: rgba(56, 139, 253, 0.08); }

.act-delete:hover { border-color: rgba(248, 113, 113, 0.4); color: var(--accent-red); background: rgba(248, 113, 113, 0.08); }

/* ========== 模态框 ========== */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: var(--bg-base);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  width: 92%;
  max-width: 360px;
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  animation: modalIn 0.2s ease-out;
}

@keyframes modalIn {
  from { opacity: 0; transform: scale(0.95) translateY(-8px); }
  to   { opacity: 1; transform: scale(1) translateY(0); }
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  background: linear-gradient(180deg, #1a2030 0%, #161b22 100%);
  border-bottom: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
}

.modal-title-group {
  display: flex;
  align-items: center;
  gap: 6px;
}

.modal-title-icon {
  width: 18px;
  height: 18px;
}
.modal-title-icon svg { width: 100%; height: 100%; }

.modal-header h3 {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}

.modal-close-btn {
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
  transition: all 0.15s ease;
  padding: 0;
}
.modal-close-btn svg { width: 12px; height: 12px; }
.modal-close-btn:hover { background: var(--bg-hover); border-color: var(--border-subtle); color: var(--text-primary); }

/* ========== 表单 ========== */
.account-form {
  padding: 12px 14px;
}

.form-group {
  margin-bottom: 10px;
}

.form-group label {
  display: block;
  margin-bottom: 3px;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-secondary);
}

.form-group input,
.form-group textarea {
  width: 100%;
  padding: 6px 10px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: 12px;
  box-sizing: border-box;
  transition: border-color 0.15s ease;
}
.form-group input:focus,
.form-group textarea:focus { outline: none; border-color: rgba(56, 139, 253, 0.5); }
.form-group input::placeholder,
.form-group textarea::placeholder { color: var(--text-muted); }

.form-group small {
  display: block;
  margin-top: 3px;
  font-size: 10px;
  color: var(--text-muted);
}
.form-group .hint-text { color: rgba(96, 165, 250, 0.7); }

/* URL 输入 */
.url-input-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 3px;
}

.add-current-url-btn {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 2px 8px;
  background: rgba(56, 139, 253, 0.1);
  border: 1px solid rgba(56, 139, 253, 0.3);
  border-radius: var(--radius-sm);
  color: #60a5fa;
  font-size: 10px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.add-current-url-btn svg { width: 10px; height: 10px; }
.add-current-url-btn:hover { background: rgba(56, 139, 253, 0.2); }

.url-input-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.url-input-row {
  display: flex;
  gap: 4px;
  align-items: center;
}

.url-input-item {
  flex: 1;
}

.url-remove-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  background: transparent;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
}
.url-remove-btn svg { width: 10px; height: 10px; }
.url-remove-btn:hover { color: var(--accent-red); border-color: rgba(248, 113, 113, 0.3); }

.url-add-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 5px;
  background: transparent;
  border: 1px dashed var(--border-subtle);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.url-add-btn svg { width: 12px; height: 12px; }
.url-add-btn:hover { border-color: var(--accent-blue); color: var(--accent-blue); }

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 14px;
}

.cancel-btn, .submit-btn {
  padding: 5px 14px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}

.cancel-btn {
  background: transparent;
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
}
.cancel-btn:hover { background: var(--bg-hover); color: var(--text-primary); }

.submit-btn {
  background: var(--accent-blue);
  border: 1px solid transparent;
  color: #fff;
}
.submit-btn:hover { background: #4d9bff; }

/* ========== 消息提示 ========== */
.al-message {
  position: fixed;
  top: 52px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: var(--radius-md);
  font-size: 11px;
  font-weight: 500;
  z-index: 2000;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255,255,255,0.04);
  animation: slideDown 0.2s ease-out;
  white-space: nowrap;
  backdrop-filter: blur(12px);
}

.al-message-icon { display: flex; align-items: center; flex-shrink: 0; }
.al-message-icon svg { width: 13px; height: 13px; }

.al-message.success { background: rgba(20, 50, 35, 0.92); color: #4ade80; border: 1px solid rgba(52, 211, 153, 0.3); }
.al-message.error { background: rgba(50, 20, 20, 0.92); color: #fb7185; border: 1px solid rgba(248, 113, 113, 0.3); }
.al-message.info { background: rgba(20, 30, 55, 0.92); color: #60a5fa; border: 1px solid rgba(96, 165, 250, 0.3); }

@keyframes slideDown {
  from { opacity: 0; transform: translateX(-50%) translateY(-8px); }
  to   { opacity: 1; transform: translateX(-50%) translateY(0); }
}

/* ========== 自定义滚动条 ========== */
.accounts-list::-webkit-scrollbar,
.modal-content::-webkit-scrollbar {
  width: 4px;
}
.accounts-list::-webkit-scrollbar-track,
.modal-content::-webkit-scrollbar-track {
  background: transparent;
}
.accounts-list::-webkit-scrollbar-thumb,
.modal-content::-webkit-scrollbar-thumb {
  background: #2a3040;
  border-radius: 2px;
}
.accounts-list::-webkit-scrollbar-thumb:hover,
.modal-content::-webkit-scrollbar-thumb:hover {
  background: #3a4258;
}
</style>
