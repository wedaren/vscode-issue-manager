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
          <!-- 钥匙图标 -->
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
        <!-- 导出按钮 -->
        <button class="icon-btn" @click="exportAccounts" title="导出账号">
          <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M10 3v9M6.5 8.5L10 12l3.5-3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M3 14v1a2 2 0 002 2h10a2 2 0 002-2v-1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>
        <!-- 导入按钮 -->
        <button class="icon-btn" @click="triggerImport" title="导入账号">
          <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M10 14V5M6.5 8.5L10 5l3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M3 14v1a2 2 0 002 2h10a2 2 0 002-2v-1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>
        <!-- 添加账号按钮 -->
        <button class="add-btn" @click="showAddForm = true" title="添加账号">
          <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
          <span>添加账号</span>
        </button>
        <input
          ref="fileInput"
          type="file"
          accept=".json"
          @change="importAccounts"
          style="display: none;"
        />
      </div>
    </div>

    <!-- 账号列表 -->
    <div class="accounts-list">
      <!-- 空状态：有账号但当前页不适用 -->
      <div v-if="filteredAccounts.length === 0 && accounts.length > 0" class="empty-state">
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
        <p class="empty-title">当前页面没有适用的账号</p>
        <p class="empty-hint">该账号绑定了特定 URL，与当前页面不匹配</p>
      </div>

      <!-- 空状态：无任何账号 -->
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

      <!-- 账号卡片列表 -->
      <div
        v-for="account in filteredAccounts"
        :key="account.id"
        class="account-card"
      >
        <div class="account-info">
          <!-- 账号头像字母 -->
          <div class="account-avatar">{{ account.name.charAt(0).toUpperCase() }}</div>
          <div class="account-details">
            <div class="account-name">{{ account.name }}</div>
            <div class="account-meta">
              <span class="meta-item">
                <!-- 用户图标 -->
                <svg viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="5.5" r="2.5" stroke="currentColor" stroke-width="1.3"/>
                  <path d="M2.5 13.5c0-3.04 2.46-5.5 5.5-5.5s5.5 2.46 5.5 5.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
                </svg>
                {{ account.username }}
              </span>
              <span class="meta-item meta-password">
                <!-- 锁图标 -->
                <svg viewBox="0 0 16 16" fill="none">
                  <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" stroke-width="1.3"/>
                  <path d="M5 7V5.5a3 3 0 016 0V7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
                </svg>
                <span class="password-value">{{ visiblePasswords[account.id] ? account.password : '••••••••' }}</span>
                <button
                  class="toggle-pass-btn"
                  @click="togglePasswordVisibility(account.id)"
                  :title="visiblePasswords[account.id] ? '隐藏密码' : '显示密码'"
                >
                  <!-- 眼睛图标 -->
                  <svg v-if="!visiblePasswords[account.id]" viewBox="0 0 16 16" fill="none">
                    <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" stroke="currentColor" stroke-width="1.3"/>
                    <circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.3"/>
                  </svg>
                  <svg v-else viewBox="0 0 16 16" fill="none">
                    <path d="M2 2l12 12M6.5 6.6A2 2 0 0010 9.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
                    <path d="M4 4.7C2.3 6 1 8 1 8s2.5 5 7 5c1.3 0 2.5-.4 3.5-1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
                    <path d="M12.4 11.4C13.8 10 15 8 15 8s-2.5-5-7-5c-.7 0-1.4.1-2 .3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
                  </svg>
                </button>
              </span>
              <span v-if="account.url" class="meta-item meta-url">
                <!-- 链接图标 -->
                <svg viewBox="0 0 16 16" fill="none">
                  <path d="M6.5 9.5a3.5 3.5 0 005 0l2-2a3.5 3.5 0 00-5-5L7.5 3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
                  <path d="M9.5 6.5a3.5 3.5 0 00-5 0l-2 2a3.5 3.5 0 005 5l.5-.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
                </svg>
                {{ account.url }}
              </span>
              <span v-else class="meta-item meta-url">任意页面</span>
            </div>
          </div>
        </div>
        <div class="account-actions">
          <button class="act-btn act-use" @click="useAccount(account)" title="使用此账号登录">使用</button>
          <button class="act-btn act-switch" @click="switchAccount(account)" title="替换当前账号">替换</button>
          <button class="act-btn act-edit" @click="editAccount(account)" title="编辑账号">
            <svg viewBox="0 0 16 16" fill="none">
              <path d="M11.5 2.5l2 2L5 13H3v-2L11.5 2.5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
            </svg>
          </button>
          <button class="act-btn act-delete" @click="deleteAccount(account.id)" title="删除账号">
            <svg viewBox="0 0 16 16" fill="none">
              <path d="M3 4h10M6 4V2.5h4V4M5.5 4v8.5h5V4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
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
            <input
              v-model="newAccount.name"
              type="text"
              placeholder="例如: 公司账号 或 admin/password123"
              @input="parseAccountName"
              required
            />
            <small class="hint-text">支持快速格式: 用户名/密码（如: admin/mypass123）</small>
          </div>
          <div class="form-group">
            <label>用户名</label>
            <input
              v-model="newAccount.username"
              type="text"
              placeholder="请输入用户名"
              required
            />
          </div>
          <div class="form-group">
            <label>密码</label>
            <div class="password-input-wrapper">
              <input
                v-model="newAccount.password"
                :type="showPassword ? 'text' : 'password'"
                placeholder="请输入密码"
                required
              />
              <button
                type="button"
                class="toggle-password-btn"
                @click="showPassword = !showPassword"
                :title="showPassword ? '隐藏密码' : '显示密码'"
              >
                <svg v-if="!showPassword" viewBox="0 0 16 16" fill="none">
                  <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" stroke="currentColor" stroke-width="1.3"/>
                  <circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.3"/>
                </svg>
                <svg v-else viewBox="0 0 16 16" fill="none">
                  <path d="M2 2l12 12M6.5 6.6A2 2 0 0010 9.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
                  <path d="M4 4.7C2.3 6 1 8 1 8s2.5 5 7 5c1.3 0 2.5-.4 3.5-1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
                  <path d="M12.4 11.4C13.8 10 15 8 15 8s-2.5-5-7-5c-.7 0-1.4.1-2 .3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
                </svg>
              </button>
            </div>
          </div>
          <div class="form-group">
            <label>页面 URL（可选）</label>
            <input
              v-model="newAccount.url"
              type="text"
              placeholder="留空则适用于任意页面"
            />
            <small>填写后仅在该页面显示此账号</small>
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
import { ref, computed, onMounted } from 'vue';
import { isReceiverNotExistError } from '../utils/chromeErrorUtils';

interface Account {
  id: string;
  name: string;
  username: string;
  password: string;
  url?: string;
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

/**
 * 向 Content Script 发送消息,如果失败则自动注入并重试
 * 
 * 封装了完整的"尝试-失败-注入-重试"流程:
 * 1. 尝试向目标标签页发送消息
 * 2. 如果失败且是"接收端不存在"错误,则注入 content script
 * 3. 等待脚本初始化后重试发送消息
 * 
 * @param tabId - 目标标签页 ID
 * @param message - 要发送的消息对象
 * @returns Promise<响应对象>
 * @throws 如果不是"接收端不存在"错误,则重新抛出原始错误
 */
async function sendMessageToContentScript(tabId: number, message: object): Promise<any> {
  try {
    // 第一次尝试:直接发送消息
    const response = await chrome.tabs.sendMessage(tabId, message);
    return response;
  } catch (error: unknown) {
    // 如果是"接收端不存在"错误,尝试注入 content script
    if (isReceiverNotExistError(error)) {
      console.log('[sendMessage] Content script not found, injecting...');
      
      try {
        // 注入 content script
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content-scripts/content.js']
        });

        // 等待一下让 script 初始化
        await new Promise(resolve => setTimeout(resolve, 300));

        // 第二次尝试:重试发送消息
        const retryResponse = await chrome.tabs.sendMessage(tabId, message);
        return retryResponse;
      } catch (injectError: unknown) {
        console.error('[sendMessage] Failed to inject content script:', injectError);
        const injectMsg = (injectError instanceof Error && injectError.message) || '未知错误';
        throw new Error('无法在此页面执行操作: ' + injectMsg);
      }
    } else {
      // 不是"接收端不存在"错误,直接抛出
      throw error;
    }
  }
}

const accounts = ref<Account[]>([]);
const currentUrl = ref('');
const showAddForm = ref(false);
const showPassword = ref(false);
const editingAccount = ref<Account | null>(null);
const visiblePasswords = ref<Record<string, boolean>>({});
const fileInput = ref<HTMLInputElement | null>(null);
const newAccount = ref({
  name: '',
  username: '',
  password: '',
  url: '',
});
const message = ref<Message>({ show: false, text: '', type: 'info' });

// 计算过滤后的账号列表
const filteredAccounts = computed(() => {
  if (!currentUrl.value) return accounts.value;
  
  return accounts.value.filter(account => {
    // 如果账号没有指定 URL,则在所有页面都显示
    if (!account.url) return true;
    
    // 如果指定了 URL,则只在匹配的页面显示
    try {
      const accountUrl = new URL(account.url);
      const pageUrl = new URL(currentUrl.value);
      
      // 比较 origin (协议 + 域名 + 端口)
      return accountUrl.origin === pageUrl.origin;
    } catch {
      // URL 解析失败,不显示该账号  
      return false;  
    }
  });
});

function showMessage(text: string, type: 'success' | 'error' | 'info' = 'info') {
  message.value = { show: true, text, type };
  setTimeout(() => {
    message.value.show = false;
  }, MESSAGE_DISPLAY_DURATION_MS);
}

function goBack() {
  emit('back');
}

function closeAddForm() {
  showAddForm.value = false;
  showPassword.value = false;
  editingAccount.value = null;
  newAccount.value = {
    name: '',
    username: '',
    password: '',
    url: '',
  };
}

// 自动解析账号名称格式: 用户名/密码
function parseAccountName() {
  const nameValue = newAccount.value.name.trim();
  
  // 检查是否包含 / 分隔符
  const slashIndex = nameValue.indexOf('/');
  if (slashIndex > 0 && slashIndex < nameValue.length - 1) {
    const username = nameValue.substring(0, slashIndex);
    const password = nameValue.substring(slashIndex + 1);
    
    // 只在用户名和密码字段为空时才自动填充
    if (!newAccount.value.username && !newAccount.value.password) {
      newAccount.value.username = username;
      newAccount.value.password = password;
      console.log('[AutoLogin] 自动解析账号:', { username, password: '***' });
    }
  }
}

function togglePasswordVisibility(accountId: string) {
  visiblePasswords.value[accountId] = !visiblePasswords.value[accountId];
}

function editAccount(account: Account) {
  editingAccount.value = account;
  newAccount.value = {
    name: account.name,
    username: account.username,
    password: account.password,
    url: account.url || '',
  };
  showAddForm.value = true;
}

async function loadAccounts() {
  try {
    console.log('[AutoLogin] 开始加载账号...');
    const result = await chrome.storage.local.get('autoLoginAccounts');
    const loadedAccounts = result.autoLoginAccounts || [];
    console.log('[AutoLogin] 从存储加载的账号数据:', JSON.stringify(loadedAccounts, null, 2));
    // 确保是数组
    accounts.value = Array.isArray(loadedAccounts) ? loadedAccounts : [];
    console.log('[AutoLogin] 账号加载成功,数量:', accounts.value.length);
    console.log('[AutoLogin] accounts.value 类型:', typeof accounts.value, Array.isArray(accounts.value));
  } catch (error: unknown) {
    console.error('[AutoLogin] 加载账号失败:', error);
    const errorMsg = (error as Error)?.message || '未知错误';
    showMessage('加载账号失败: ' + errorMsg, 'error');
  }
}

async function saveAccounts() {
  try {
    console.log('[AutoLogin] 开始保存账号,数量:', accounts.value.length,JSON.stringify(accounts.value, null, 2));
    await chrome.storage.local.set({ autoLoginAccounts: [...accounts.value] });
    console.log('[AutoLogin] 账号保存成功');
  } catch (error: unknown) {
    console.error('[AutoLogin] 保存账号失败:', error);
    const errorMsg = (error instanceof Error && error.message) || '未知错误';
    throw new Error('保存账号失败: ' + errorMsg);
  }
}

function validateNewAccount(){
  
  // 验证必填字段
  if (!newAccount.value.name.trim()) {
    showMessage('请输入账号名称', 'error');
    return false;
  }
  
  if (!newAccount.value.username.trim()) {
    showMessage('请输入用户名', 'error');
    return false;
  }
  
  if (!newAccount.value.password.trim()) {
    showMessage('请输入密码', 'error');
    return false;
  }
  
  return true;
}
async function addAccount() {
  try {
    console.log('[AutoLogin] 开始添加账号...');
    console.log('[AutoLogin] accounts.value 类型检查:', typeof accounts.value, Array.isArray(accounts.value));
    
    // 确保 accounts.value 是数组
    if (!Array.isArray(accounts.value)) {
      console.warn('[AutoLogin] accounts.value 不是数组,重置为空数组');
      accounts.value = [];
    }

    if (!validateNewAccount()) {
      return;
    }

    const account: Account = {
      id: crypto.randomUUID(),
      name: newAccount.value.name.trim(),
      username: newAccount.value.username.trim(),
      password: newAccount.value.password.trim(),
      url: newAccount.value.url.trim() || undefined,
    };

    console.log('[AutoLogin] 新账号:', { ...account, password: '***' });

    accounts.value.push(account);
    await saveAccounts();
    
    console.log('[AutoLogin] 账号添加成功');
    closeAddForm();
    showMessage('✓ 账号添加成功', 'success');
  } catch (error: unknown) {
    console.error('[AutoLogin] 添加账号失败:', error);
    const errorMsg = (error instanceof Error && error.message) || '未知错误';
    showMessage('添加账号失败: ' + errorMsg, 'error');
  }
}

async function updateAccount() {
  try {
    console.log('[AutoLogin] 开始更新账号...');
    console.log('[AutoLogin] accounts.value 类型检查:', typeof accounts.value, Array.isArray(accounts.value));
    
    // 确保 accounts.value 是数组
    if (!Array.isArray(accounts.value)) {
      console.warn('[AutoLogin] accounts.value 不是数组,重置为空数组');
      accounts.value = [];
      showMessage('数据异常,请重新添加账号', 'error');
      closeAddForm();
      return;
    }
    
    if (!editingAccount.value) {
      showMessage('未找到要编辑的账号', 'error');
      return;
    }
    
    // 验证必填字段
    if(!validateNewAccount()){
      return;
    }

    // 更新账号信息
    const index = accounts.value.findIndex(acc => acc.id === editingAccount.value!.id);
    if (index !== -1) {
      accounts.value[index] = {
        ...accounts.value[index],
        name: newAccount.value.name.trim(),
        username: newAccount.value.username.trim(),
        password: newAccount.value.password.trim(),
        url: newAccount.value.url.trim() || undefined,
      };
      
      await saveAccounts();
      console.log('[AutoLogin] 账号更新成功');
      closeAddForm();
      showMessage('✓ 账号更新成功', 'success');
    } else {
      showMessage('未找到要编辑的账号', 'error');
    }
  } catch (error: unknown) {
    console.error('[AutoLogin] 更新账号失败:', error);
    const errorMsg = (error instanceof Error && error.message) || '未知错误';
    showMessage('更新账号失败: ' + errorMsg, 'error');
  }
}

async function deleteAccount(id: string) {
  if (!confirm('确定要删除这个账号吗?')) {
    return;
  }

  try {
    // 确保 accounts.value 是数组
    if (!Array.isArray(accounts.value)) {
      console.warn('[AutoLogin] accounts.value 不是数组,重置为空数组');
      accounts.value = [];
      showMessage('数据异常', 'error');
      return;
    }
    
    accounts.value = accounts.value.filter(acc => acc.id !== id);
    await saveAccounts();
    showMessage('账号已删除', 'success');
  } catch (error: unknown) {
    console.error('Failed to delete account:', error);
    showMessage('删除账号失败', 'error');
  }
}

async function useAccount(account: Account) {
  try {
    // 获取当前活动标签页
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab?.id) {
      showMessage('无法获取当前标签页', 'error');
      return;
    }

    // 检查页面 URL 是否支持
    if (tab.url && /^(chrome|chrome-extension|edge|about):/i.test(tab.url)) {
      showMessage('该页面不支持自动登录功能', 'error');
      return;
    }

    try {
      // 发送自动登录消息(自动处理注入逻辑)
      const response = await sendMessageToContentScript(tab.id, {
        type: 'AUTO_LOGIN',
        username: account.username,
        password: account.password,
      });

      if (response?.success) {
        showMessage('✓ 自动登录成功', 'success');
      } else {
        showMessage(response?.error || '自动登录失败', 'error');
      }
    } catch (error: unknown) {
      console.error('[useAccount] Failed:', error);
      const errorMsg = (error instanceof Error && error.message) || '未知错误';
      showMessage('自动登录失败: ' + errorMsg, 'error');
    }
  } catch (error: unknown) {
    console.error('[useAccount] Failed to get tab:', error);
    const errorMsg = (error instanceof Error && error.message) || '未知错误';
    showMessage('自动登录失败: ' + errorMsg, 'error');
  }
}

async function switchAccount(account: Account) {
  try {
    // 获取当前活动标签页
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab?.id) {
      showMessage('无法获取当前标签页', 'error');
      return;
    }

    // 检查页面 URL 是否支持
    if (tab.url && /^(chrome|chrome-extension|edge|about):/i.test(tab.url)) {
      showMessage('该页面不支持账号替换功能', 'error');
      return;
    }

    // 确认操作
    if (!confirm(`确定要替换为账号 "${account.name}" 吗?\n\n此操作将:\n1. 退出当前账号\n2. 跳转到登录页\n3. 自动登录新账号\n4. 返回当前页面`)) {
      return;
    }

    showMessage('正在替换账号...', 'info');

    try {
      // 发送账号替换消息(自动处理注入逻辑)
      const response = await sendMessageToContentScript(tab.id, {
        type: 'ACCOUNT_SWITCH',
        username: account.username,
        password: account.password,
      });

      if (response?.success) {
        showMessage('✓ 账号替换成功', 'success');
      } else {
        showMessage(response?.error || '账号替换失败', 'error');
      }
    } catch (error: unknown) {
      console.error('[switchAccount] Failed:', error);
      const errorMsg = (error instanceof Error && error.message) || '未知错误';
      showMessage('账号替换失败: ' + errorMsg, 'error');
    }
  } catch (error: unknown) {
    console.error('[switchAccount] Failed to get tab:', error);
    const errorMsg = (error instanceof Error && error.message) || '未知错误';
    showMessage('账号替换失败: ' + errorMsg, 'error');
  }
}

async function getCurrentUrl() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) {
      currentUrl.value = tab.url;
    }
  } catch (error: unknown) {
    console.error('Failed to get current URL:', error);
  }
}

// 导出账号到 JSON 文件
function exportAccounts() {
  try {
    if (accounts.value.length === 0) {
      showMessage('没有账号可导出', 'error');
      return;
    }

    // 创建导出数据
    const exportData = {
      version: '1.0',
      exportDate: new Date().toISOString(),
      accounts: accounts.value,
    };

    // 转换为 JSON 字符串
    const jsonStr = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    // 创建下载链接
    const a = document.createElement('a');
    a.href = url;
    a.download = `auto-login-accounts-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showMessage(`✓ 成功导出 ${accounts.value.length} 个账号`, 'success');
  } catch (error: unknown) {  
    console.error('[AutoLogin] 导出账号失败:', error);  
    const message = (error instanceof Error && error.message) || '未知错误';  
    showMessage('导出失败: ' + message, 'error');  
  }  
}

// 触发文件选择
function triggerImport() {
  if (fileInput.value) {
    fileInput.value.click();
  }
}

// 导入账号从 JSON 文件
async function importAccounts(event: Event) {
  try {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    
    if (!file) {
      return;
    }

    // 读取文件内容
    const text = await file.text();
    const importData = JSON.parse(text);

    // 验证数据格式
    if (!importData.accounts || !Array.isArray(importData.accounts)) {
      showMessage('文件格式不正确', 'error');
      return;
    }

    // 验证每个账号的数据结构
    const validAccounts = (importData.accounts as any[]).filter(  
      (account): account is { name: string; username: string; password: string; url?: string } => {  
        return account &&  
          typeof account.name === 'string' && account.name &&  
          typeof account.username === 'string' && account.username &&  
          typeof account.password === 'string' && account.password &&  
          (account.url === undefined || typeof account.url === 'string');  
      }  
    );  

    if (validAccounts.length === 0) {
      showMessage('文件中没有有效的账号数据', 'error');
      return;
    }

    // 去重处理 - 基于 username 和 url 组合
    const existingKeys = new Set(
      accounts.value.map(acc => `${acc.username}::${acc.url || ''}`)
    );

    let addedCount = 0;
    let skippedCount = 0;

    validAccounts.forEach((account) => {
      const key = `${account.username}::${account.url || ''}`;
      
      if (!existingKeys.has(key)) {
        // 添加新账号,生成新的 ID
        accounts.value.push({
          id: crypto.randomUUID(),
          name: account.name,
          username: account.username,
          password: account.password,
          url: account.url || undefined,
        });
        existingKeys.add(key);
        addedCount++;
      } else {
        skippedCount++;
      }
    });

    if (addedCount > 0) {
      await saveAccounts();
      showMessage(
        `✓ 成功导入 ${addedCount} 个账号${skippedCount > 0 ? `, 跳过 ${skippedCount} 个重复账号` : ''}`,
        'success'
      );
    } else {
      showMessage('没有新账号需要导入(全部重复)', 'info');
    }

    // 清空文件选择
    if (input) {
      input.value = '';
    }
  } catch (error: unknown) {  
    console.error('[AutoLogin] 导入账号失败:', error);  
    const message = (error instanceof Error && error.message) || '文件格式错误';  
    showMessage('导入失败: ' + message, 'error');  
  }  
}

onMounted(() => {
  loadAccounts();
  getCurrentUrl();
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
  --text-primary: #e6edf3;
  --text-secondary: #8b949e;
  --text-muted: #484f58;
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 16px;

  width: 100%;
  height: calc(100vh - 28px); /* 28px 为底部状态栏高度 */
  background-color: var(--bg-deep);
  color: var(--text-primary);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* ========== 头部 ========== */
.al-header {
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
  width: 22px;
  height: 22px;
  flex-shrink: 0;
}

.header-icon svg {
  width: 100%;
  height: 100%;
}

.al-header h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

/* 图标按钮（导出/导入） */
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
  transition: all 0.15s ease;
  padding: 0;
}

.icon-btn svg {
  width: 15px;
  height: 15px;
}

.icon-btn:hover {
  background: var(--bg-hover);
  border-color: var(--border-subtle);
  color: var(--text-primary);
}

.icon-btn:active {
  transform: scale(0.92);
}

/* 添加账号按钮 */
.add-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  background: rgba(56, 139, 253, 0.12);
  border: 1px solid rgba(56, 139, 253, 0.3);
  border-radius: var(--radius-sm);
  color: #60a5fa;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}

.add-btn svg {
  width: 13px;
  height: 13px;
}

.add-btn:hover {
  background: rgba(56, 139, 253, 0.2);
  border-color: rgba(56, 139, 253, 0.55);
  color: #93c5fd;
}

.add-btn:active {
  transform: scale(0.96);
}

/* ========== 账号列表 ========== */
.accounts-list {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* 空状态 */
.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 48px 20px;
}

.empty-icon {
  width: 72px;
  height: 72px;
}

.empty-icon svg {
  width: 100%;
  height: 100%;
}

.empty-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
  margin: 0;
}

.empty-hint {
  font-size: 12px;
  color: var(--text-muted);
  margin: 0;
  text-align: center;
}

/* 账号卡片 */
.account-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: 12px 14px;
  display: flex;
  align-items: center;
  gap: 12px;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.account-card:hover {
  border-color: rgba(56, 139, 253, 0.4);
  background: var(--bg-hover);
}

.account-info {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  flex: 1;
  min-width: 0;
}

/* 账号头像字母 */
.account-avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: linear-gradient(135deg, rgba(56, 139, 253, 0.2), rgba(167, 139, 250, 0.2));
  border: 1px solid rgba(96, 165, 250, 0.25);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 600;
  color: #60a5fa;
  flex-shrink: 0;
}

.account-details {
  flex: 1;
  min-width: 0;
}

.account-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.account-meta {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--text-secondary);
}

.meta-item svg {
  width: 11px;
  height: 11px;
  flex-shrink: 0;
  opacity: 0.7;
}

.meta-password {
  color: var(--text-secondary);
}

.password-value {
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 11px;
  color: #4ec9b0;
  letter-spacing: 0.5px;
}

.toggle-pass-btn {
  display: flex;
  align-items: center;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 1px 3px;
  border-radius: 3px;
  transition: color 0.15s ease;
}

.toggle-pass-btn svg {
  width: 11px;
  height: 11px;
}

.toggle-pass-btn:hover {
  color: var(--text-secondary);
}

.meta-url {
  color: var(--text-muted);
  font-size: 10px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 160px;
}

/* 账号操作按钮 */
.account-actions {
  display: flex;
  gap: 5px;
  flex-shrink: 0;
}

.act-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 11px;
  font-weight: 500;
  transition: all 0.15s ease;
  padding: 0;
}

/* 使用 & 替换：文字按钮 */
.act-use,
.act-switch {
  padding: 5px 9px;
}

.act-use {
  background: rgba(56, 139, 253, 0.12);
  border-color: rgba(56, 139, 253, 0.3);
  color: #60a5fa;
}

.act-use:hover {
  background: rgba(56, 139, 253, 0.22);
  border-color: rgba(56, 139, 253, 0.55);
}

.act-switch {
  background: rgba(251, 191, 36, 0.1);
  border-color: rgba(251, 191, 36, 0.25);
  color: #fbbf24;
}

.act-switch:hover {
  background: rgba(251, 191, 36, 0.2);
  border-color: rgba(251, 191, 36, 0.45);
}

/* 编辑 & 删除：图标按钮 */
.act-edit,
.act-delete {
  width: 27px;
  height: 27px;
}

.act-edit {
  background: rgba(52, 211, 153, 0.08);
  border-color: rgba(52, 211, 153, 0.2);
  color: #34d399;
}

.act-edit svg {
  width: 13px;
  height: 13px;
}

.act-edit:hover {
  background: rgba(52, 211, 153, 0.18);
  border-color: rgba(52, 211, 153, 0.4);
}

.act-delete {
  background: rgba(248, 113, 113, 0.08);
  border-color: rgba(248, 113, 113, 0.2);
  color: #f87171;
}

.act-delete svg {
  width: 13px;
  height: 13px;
}

.act-delete:hover {
  background: rgba(248, 113, 113, 0.18);
  border-color: rgba(248, 113, 113, 0.4);
}

.act-btn:active {
  transform: scale(0.9);
}

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
  max-width: 420px;
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
  padding: 14px 18px;
  background: linear-gradient(180deg, #1a2030 0%, #161b22 100%);
  border-bottom: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
}

.modal-title-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.modal-title-icon {
  width: 20px;
  height: 20px;
}

.modal-title-icon svg {
  width: 100%;
  height: 100%;
}

.modal-header h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.modal-close-btn {
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

.modal-close-btn svg {
  width: 14px;
  height: 14px;
}

.modal-close-btn:hover {
  background: var(--bg-hover);
  border-color: var(--border-subtle);
  color: var(--text-primary);
}

/* ========== 表单 ========== */
.account-form {
  padding: 18px;
}

.form-group {
  margin-bottom: 14px;
}

.form-group label {
  display: block;
  margin-bottom: 5px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  letter-spacing: 0.2px;
}

.form-group input {
  width: 100%;
  padding: 8px 12px;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: 13px;
  box-sizing: border-box;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.form-group input:focus {
  outline: none;
  border-color: rgba(56, 139, 253, 0.5);
  box-shadow: 0 0 0 3px rgba(56, 139, 253, 0.08);
}

.form-group input::placeholder {
  color: var(--text-muted);
}

.form-group small {
  display: block;
  margin-top: 4px;
  font-size: 11px;
  color: var(--text-muted);
}

.form-group .hint-text {
  color: rgba(96, 165, 250, 0.7);
}

.password-input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.password-input-wrapper input {
  flex: 1;
  padding-right: 38px;
}

.toggle-password-btn {
  position: absolute;
  right: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  transition: color 0.15s ease;
}

.toggle-password-btn svg {
  width: 14px;
  height: 14px;
}

.toggle-password-btn:hover {
  color: var(--text-secondary);
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}

.cancel-btn,
.submit-btn {
  padding: 7px 18px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}

.cancel-btn {
  background: transparent;
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
}

.cancel-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.submit-btn {
  background: var(--accent-blue);
  border: 1px solid transparent;
  color: #fff;
}

.submit-btn:hover {
  background: #4d9bff;
}

.submit-btn:active,
.cancel-btn:active {
  transform: scale(0.96);
}

/* ========== 消息提示 ========== */
.al-message {
  position: fixed;
  top: 58px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-radius: var(--radius-md);
  font-size: 12px;
  font-weight: 500;
  z-index: 2000;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255,255,255,0.04);
  animation: slideDown 0.22s ease-out;
  white-space: nowrap;
  backdrop-filter: blur(12px);
}

.al-message-icon {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.al-message-icon svg {
  width: 15px;
  height: 15px;
}

.al-message.success {
  background: rgba(20, 50, 35, 0.92);
  color: #4ade80;
  border: 1px solid rgba(52, 211, 153, 0.3);
}

.al-message.error {
  background: rgba(50, 20, 20, 0.92);
  color: #fb7185;
  border: 1px solid rgba(248, 113, 113, 0.3);
}

.al-message.info {
  background: rgba(20, 30, 55, 0.92);
  color: #60a5fa;
  border: 1px solid rgba(96, 165, 250, 0.3);
}

@keyframes slideDown {
  from { opacity: 0; transform: translateX(-50%) translateY(-10px); }
  to   { opacity: 1; transform: translateX(-50%) translateY(0); }
}

/* ========== 自定义滚动条 ========== */
.accounts-list::-webkit-scrollbar,
.modal-content::-webkit-scrollbar {
  width: 6px;
}

.accounts-list::-webkit-scrollbar-track,
.modal-content::-webkit-scrollbar-track {
  background: transparent;
}

.accounts-list::-webkit-scrollbar-thumb,
.modal-content::-webkit-scrollbar-thumb {
  background: #2a3040;
  border-radius: 3px;
}

.accounts-list::-webkit-scrollbar-thumb:hover,
.modal-content::-webkit-scrollbar-thumb:hover {
  background: #3a4258;
}
</style>

<style scoped>
/* 使 AutoLoginPanel 风格与 LLMPanel 统一的变量与基础布局 */
.llm-panel.auto-login-container {
  --bg-deep: #0f1117;
  --bg-base: #161b22;
  --bg-card: #1c2130;
  --bg-hover: #242938;
  --border-subtle: #2a3040;
  --accent-blue: #388bfd;
  --accent-green: #4ec9b0;
  --accent-purple: #a78bfa;
  --text-primary: #e6edf3;
  --text-secondary: #8b949e;
  --text-muted: #484f58;
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 16px;

  display: flex;
  flex-direction: column;
  height: 100vh;
  min-height: 0;
  background-color: var(--bg-deep);
  color: var(--text-primary);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}

/* 头部样式，参考 LLMPanel 的 llm-header */
.llm-panel .al-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: linear-gradient(180deg, #1a2030 0%, #161b22 100%);
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.llm-panel .title-section,
.llm-panel .header-title-group {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
}

.llm-panel .al-header h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.llm-panel .back-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s ease;
  padding: 0;
  flex-shrink: 0;
}

.llm-panel .back-btn:hover { background: var(--bg-hover); border-color: var(--border-subtle); color: var(--text-primary); }

.llm-panel .header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.llm-panel .header-btn,
.llm-panel .add-btn,
.llm-panel .icon-btn {
  background-color: transparent;
  color: var(--text-primary);
  border: none;
  border-radius: 6px;
  padding: 8px 12px;
  cursor: pointer;
  font-size: 13px;
}

.llm-panel .add-btn {
  background: linear-gradient(135deg, var(--accent-blue), var(--accent-purple));
  color: #fff;
  border-radius: 8px;
  padding: 8px 14px;
}

/* 列表主体 */
.llm-panel .accounts-list {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.llm-panel .empty-state { color: var(--text-secondary); }

.llm-panel .account-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: 14px;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 12px;
}

.llm-panel .account-card:hover { box-shadow: 0 6px 18px rgba(0,0,0,0.35); border-color: rgba(56,139,253,0.12); }

.llm-panel .account-avatar { background: linear-gradient(135deg, rgba(56,139,253,0.2), rgba(167,139,250,0.2)); color: #60a5fa; }
.llm-panel .password-value { color: var(--accent-green); }

.llm-panel .account-actions .act-use { background: var(--accent-blue); color: white; border-radius: 8px; padding: 6px 10px; }
.llm-panel .account-actions .act-switch { background: #6b4b2e; color: #f3d6a1; border-radius: 8px; padding: 6px 10px; }
.llm-panel .act-edit { background: rgba(52,211,153,0.08); }
.llm-panel .act-delete { background: rgba(248,113,113,0.08); }

/* 模态框与消息提示 */
.llm-panel .modal-overlay { background-color: rgba(0,0,0,0.65); }
.llm-panel .modal-content { background: var(--bg-card); border: 1px solid var(--border-subtle); }
.llm-panel .modal-header h3 { color: var(--text-primary); }

.llm-panel .form-group input { background: #222631; border: 1px solid #3b3f4a; color: var(--text-primary); }

.llm-panel .al-message { left: 50%; transform: translateX(-50%); top: 18px; }
.llm-panel .al-message.success { background: #12321f; color: var(--accent-green); border: 1px solid var(--accent-green); }
.llm-panel .al-message.error { background: #3a1e1e; }
.llm-panel .al-message.info { background: #162332; color: var(--accent-blue); border: 1px solid var(--accent-blue); }

.llm-panel .accounts-list::-webkit-scrollbar { width: 8px; }
.llm-panel .accounts-list::-webkit-scrollbar-thumb { background: #2a3040; border-radius: 4px; }

</style>
