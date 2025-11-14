<template>
  <div class="auto-login-container">
    <!-- 头部 -->
    <div class="header">
      <div class="title-section">
        <button class="back-btn" @click="goBack" title="返回">
          <span>←</span>
        </button>
        <h2>
          <span class="section-icon">🔐</span>
          自动登录工具
        </h2>
      </div>
      <div class="header-actions">
        <button class="header-btn export-btn" @click="exportAccounts" title="导出账号">
          📤 导出
        </button>
        <button class="header-btn import-btn" @click="triggerImport" title="导入账号">
          📥 导入
        </button>
        <button class="add-btn" @click="showAddForm = true" title="添加账号">
          添加账号
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
      <div v-if="filteredAccounts.length === 0 && accounts.length > 0" class="empty-message">
        当前页面没有适用的账号
      </div>
      <div v-else-if="accounts.length === 0" class="empty-message">
        暂无已保存的账号,点击右上角"添加账号"按钮添加
      </div>
      <div
        v-for="account in filteredAccounts"
        :key="account.id"
        class="account-item"
      >
        <div class="account-info">
          <div class="account-name">{{ account.name }}</div>
          <div class="account-username">用户名: {{ account.username }}</div>
          <div class="account-password">
            密码: 
            <span class="password-value">
              {{ visiblePasswords[account.id] ? account.password : '••••••••' }}
            </span>
            <button
              class="toggle-password-icon"
              @click="togglePasswordVisibility(account.id)"
              :title="visiblePasswords[account.id] ? '隐藏密码' : '显示密码'"
            >
              {{ visiblePasswords[account.id] ? '👁️' : '👁️‍🗨️' }}
            </button>
          </div>
          <div class="account-url">{{ account.url || '任意页面' }}</div>
        </div>
        <div class="account-actions">
          <button
            class="action-btn use-btn"
            @click="useAccount(account)"
            title="使用此账号登录"
          >
            使用
          </button>
          <button
            class="action-btn edit-btn"
            @click="editAccount(account)"
            title="编辑账号"
          >
            编辑
          </button>
          <button
            class="action-btn delete-btn"
            @click="deleteAccount(account.id)"
            title="删除账号"
          >
            删除
          </button>
        </div>
      </div>
    </div>

    <!-- 添加/编辑账号表单模态框 -->
    <div v-if="showAddForm" class="modal-overlay" @click="closeAddForm">
      <div class="modal-content" @click.stop>
        <div class="modal-header">
          <h3>{{ editingAccount ? '编辑账号' : '添加新账号' }}</h3>
          <button class="close-btn" @click="closeAddForm">✕</button>
        </div>
        <form @submit.prevent="editingAccount ? updateAccount() : addAccount()" class="account-form">
          <div class="form-group">
            <label>账号名称</label>
            <input
              v-model="newAccount.name"
              type="text"
              placeholder="例如:公司账号、测试账号"
              required
            />
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
                <span>{{ showPassword ? '👁️' : '👁️‍🗨️' }}</span>
              </button>
            </div>
          </div>
          <div class="form-group">
            <label>页面 URL (可选)</label>
            <input
              v-model="newAccount.url"
              type="text"
              placeholder="留空则适用于任意页面"
            />
            <small>如果填写URL,则只在该页面显示此账号</small>
          </div>
          <div class="form-actions">
            <button type="button" class="cancel-btn" @click="closeAddForm">
              取消
            </button>
            <button type="submit" class="submit-btn">
              {{ editingAccount ? '更新' : '保存' }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- 消息提示 -->
    <div v-if="message.show" class="message" :class="message.type">
      {{ message.text }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';

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
  } catch (error: any) {
    console.error('[AutoLogin] 保存账号失败:', error);
    const errorMsg = error?.message || '未知错误';
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
  } catch (error: any) {
    console.error('[AutoLogin] 添加账号失败:', error);
    const errorMsg = error?.message || '未知错误';
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
  } catch (error: any) {
    console.error('[AutoLogin] 更新账号失败:', error);
    const errorMsg = error?.message || '未知错误';
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
  } catch (error) {
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
      // 先尝试发送消息,如果失败则注入 content script
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: 'AUTO_LOGIN',
        username: account.username,
        password: account.password,
      });

      if (response?.success) {
        showMessage('✓ 自动登录成功', 'success');
      } else {
        showMessage(response?.error || '自动登录失败', 'error');
      }
    } catch (error: any) {
      // 如果是"接收端不存在"错误,尝试注入 content script
      if (error.message?.includes('Receiving end does not exist') || 
          error.message?.includes('Could not establish connection')) {
        console.log('Content script not found, injecting...');
        
        try {
          // 注入 content script
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content-scripts/content.js']
          });

          // 等待一下让 script 初始化
          await new Promise(resolve => setTimeout(resolve, 300));

          // 重试发送消息
          const retryResponse = await chrome.tabs.sendMessage(tab.id, {
            type: 'AUTO_LOGIN',
            username: account.username,
            password: account.password,
          });

          if (retryResponse?.success) {
            showMessage('✓ 自动登录成功', 'success');
          } else {
            showMessage(retryResponse?.error || '自动登录失败', 'error');
          }
        } catch (injectError: any) {
          console.error('Failed to inject content script:', injectError);
          showMessage('无法在此页面执行自动登录: ' + injectError.message, 'error');
        }
      } else {
        throw error;
      }
    }
  } catch (error: any) {
    console.error('Failed to use account:', error);
    const errorMsg = error.message || '未知错误';
    showMessage('自动登录失败: ' + errorMsg, 'error');
  }
}

async function getCurrentUrl() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) {
      currentUrl.value = tab.url;
    }
  } catch (error) {
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
  } catch (error: any) {
    console.error('[AutoLogin] 导出账号失败:', error);
    showMessage('导出失败: ' + (error?.message || '未知错误'), 'error');
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
    const validAccounts = importData.accounts.filter((account: any) => {
      return account.name && account.username && account.password;
    });

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

    validAccounts.forEach((account: any) => {
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
  } catch (error: any) {
    console.error('[AutoLogin] 导入账号失败:', error);
    showMessage('导入失败: ' + (error?.message || '文件格式错误'), 'error');
  }
}

onMounted(() => {
  loadAccounts();
  getCurrentUrl();
});
</script>

<style scoped>
.auto-login-container {
  width: 100%;
  height: 100vh;
  background-color: #1e1e1e;
  color: #d4d4d4;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  background-color: #252526;
  border-bottom: 1px solid #3c3c3c;
  flex-shrink: 0;
}

.title-section {
  display: flex;
  align-items: center;
  gap: 12px;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.header-btn {
  background-color: #3c3c3c;
  color: #d4d4d4;
  border: none;
  border-radius: 4px;
  padding: 8px 12px;
  cursor: pointer;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 4px;
  transition: background-color 0.2s;
}

.header-btn:hover {
  background-color: #4e4e4e;
}

.export-btn:hover {
  background-color: #2d5a2d;
  color: #8dd68d;
}

.import-btn:hover {
  background-color: #5a4a2d;
  color: #d4a853;
}

.back-btn {
  background-color: #3c3c3c;
  color: #d4d4d4;
  border: none;
  border-radius: 4px;
  padding: 6px 12px;
  cursor: pointer;
  font-size: 18px;
  transition: background-color 0.2s;
}

.back-btn:hover {
  background-color: #4e4e4e;
}

.header h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
}

.section-icon {
  font-size: 20px;
}

.add-btn {
  background-color: #0e639c;
  color: #ffffff;
  border: none;
  border-radius: 4px;
  padding: 8px 16px;
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: background-color 0.2s;
}

.add-btn:hover {
  background-color: #1177bb;
}

.btn-icon {
  font-size: 16px;
}

.accounts-list {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.empty-message {
  text-align: center;
  padding: 40px 20px;
  color: #858585;
  font-size: 14px;
}

.account-item {
  background-color: #252526;
  border: 1px solid #3c3c3c;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  transition: border-color 0.2s;
}

.account-item:hover {
  border-color: #569cd6;
}

.account-info {
  flex: 1;
}

.account-name {
  font-size: 16px;
  font-weight: 600;
  color: #569cd6;
  margin-bottom: 6px;
}

.account-username {
  font-size: 14px;
  color: #d4d4d4;
  margin-bottom: 4px;
}

.account-password {
  font-size: 14px;
  color: #d4d4d4;
  margin-bottom: 4px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.password-value {
  font-family: monospace;
  color: #4ec9b0;
}

.toggle-password-icon {
  background: none;
  border: none;
  color: #858585;
  cursor: pointer;
  padding: 2px 4px;
  font-size: 16px;
  line-height: 1;
  transition: color 0.2s;
}

.toggle-password-icon:hover {
  color: #d4d4d4;
}

.account-url {
  font-size: 12px;
  color: #858585;
}

.account-actions {
  display: flex;
  gap: 8px;
}

.action-btn {
  border: none;
  border-radius: 4px;
  padding: 8px 12px;
  cursor: pointer;
  font-size: 13px;
  transition: background-color 0.2s;
  display: flex;
  align-items: center;
  gap: 4px;
}

.use-btn {
  background-color: #0e639c;
  color: #ffffff;
}

.use-btn:hover {
  background-color: #1177bb;
}

.edit-btn {
  background-color: #2d5a2d;
  color: #8dd68d;
}

.edit-btn:hover {
  background-color: #366836;
}

.delete-btn {
  background-color: #5a1e1e;
  color: #f48771;
}

.delete-btn:hover {
  background-color: #6e2323;
}

/* 模态框样式 */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background-color: #252526;
  border: 1px solid #3c3c3c;
  border-radius: 8px;
  width: 90%;
  max-width: 500px;
  max-height: 80vh;
  overflow-y: auto;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid #3c3c3c;
}

.modal-header h3 {
  margin: 0;
  font-size: 16px;
  color: #d4d4d4;
}

.close-btn {
  background: none;
  border: none;
  color: #858585;
  font-size: 20px;
  cursor: pointer;
  padding: 4px;
  line-height: 1;
}

.close-btn:hover {
  color: #d4d4d4;
}

.account-form {
  padding: 20px;
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  color: #d4d4d4;
}

.password-input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.password-input-wrapper input {
  flex: 1;
  padding-right: 45px;
}

.toggle-password-btn {
  position: absolute;
  right: 8px;
  background: none;
  border: none;
  color: #858585;
  cursor: pointer;
  padding: 4px 8px;
  font-size: 18px;
  line-height: 1;
  transition: color 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.toggle-password-btn:hover {
  color: #d4d4d4;
}

.form-group input {
  width: 100%;
  padding: 8px 12px;
  background-color: #3c3c3c;
  border: 1px solid #555555;
  border-radius: 4px;
  color: #d4d4d4;
  font-size: 14px;
  box-sizing: border-box;
}

.form-group input:focus {
  outline: none;
  border-color: #569cd6;
}

.form-group small {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  color: #858585;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 24px;
}

.cancel-btn,
.submit-btn {
  padding: 8px 20px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  transition: background-color 0.2s;
}

.cancel-btn {
  background-color: #3c3c3c;
  color: #d4d4d4;
}

.cancel-btn:hover {
  background-color: #4e4e4e;
}

.submit-btn {
  background-color: #0e639c;
  color: #ffffff;
}

.submit-btn:hover {
  background-color: #1177bb;
}

/* 消息提示 */
.message {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  padding: 12px 24px;
  border-radius: 6px;
  font-size: 14px;
  z-index: 2000;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  animation: slideDown 0.3s ease-out;
}

.message.success {
  background-color: #1e3a20;
  color: #4ec9b0;
  border: 1px solid #4ec9b0;
}

.message.error {
  background-color: #3a1e1e;
  color: #f48771;
  border: 1px solid #f48771;
}

.message.info {
  background-color: #1e2a3a;
  color: #569cd6;
  border: 1px solid #569cd6;
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(-20px);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
}

/* 自定义滚动条 */
.accounts-list::-webkit-scrollbar,
.modal-content::-webkit-scrollbar {
  width: 10px;
}

.accounts-list::-webkit-scrollbar-track,
.modal-content::-webkit-scrollbar-track {
  background: #1e1e1e;
}

.accounts-list::-webkit-scrollbar-thumb,
.modal-content::-webkit-scrollbar-thumb {
  background: #424242;
  border-radius: 5px;
}

.accounts-list::-webkit-scrollbar-thumb:hover,
.modal-content::-webkit-scrollbar-thumb:hover {
  background: #4e4e4e;
}
</style>
