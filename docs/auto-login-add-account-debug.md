# 添加账号失败 - 调试指南

## 问题诊断步骤

### 步骤 1: 检查浏览器控制台

1. 打开 Side Panel(点击扩展图标)
2. 点击 🔐 进入自动登录工具
3. **右键点击** Side Panel 的空白区域
4. 选择 **"检查"** 或 **"审查元素"**
5. 切换到 **Console** 标签

### 步骤 2: 尝试添加账号

1. 点击"添加账号"按钮
2. 填写表单信息:
   - 账号名称: `测试账号`
   - 用户名: `test123`
   - 密码: `password123`
   - URL: (留空)
3. 点击"保存"按钮
4. **立即查看 Console** 中的日志

### 步骤 3: 查看日志输出

**成功的日志序列**:
```
[AutoLogin] 开始添加账号...
[AutoLogin] 新账号: {id: "1234567890", name: "测试账号", username: "test123", password: "***", url: undefined}
[AutoLogin] 开始保存账号,数量: 1
[AutoLogin] 账号保存成功
[AutoLogin] 账号添加成功
```

**失败的日志示例**:

#### 情况 A: 表单验证失败
```
[AutoLogin] 开始添加账号...
(页面显示: "请输入账号名称" 或 "请输入用户名" 或 "请输入密码")
```
→ **解决**: 确保填写了所有必填字段

#### 情况 B: 保存失败
```
[AutoLogin] 开始添加账号...
[AutoLogin] 新账号: {...}
[AutoLogin] 开始保存账号,数量: 1
[AutoLogin] 保存账号失败: QuotaExceededError
[AutoLogin] 添加账号失败: 保存账号失败: QuotaExceededError
```
→ **解决**: 存储空间已满,删除旧账号或清理浏览器存储

#### 情况 C: 权限问题
```
[AutoLogin] 开始添加账号...
[AutoLogin] 新账号: {...}
[AutoLogin] 开始保存账号,数量: 1
[AutoLogin] 保存账号失败: Error: ...
```
→ **解决**: 检查扩展权限

### 步骤 4: 手动测试存储

在 Side Panel 的 Console 中执行:

```javascript
// 测试写入
chrome.storage.local.set({ test: 'hello' }, () => {
  console.log('写入成功');
  
  // 测试读取
  chrome.storage.local.get('test', (result) => {
    console.log('读取结果:', result);
  });
});
```

**预期输出**:
```
写入成功
读取结果: {test: "hello"}
```

如果失败,可能是 chrome.storage 权限问题。

### 步骤 5: 检查扩展权限

1. 打开 `chrome://extensions/`
2. 找到 **Issue Manager** 扩展
3. 点击 **"详细信息"**
4. 检查权限列表,应该包含:
   - ✅ `storage` - 存储数据
   - ✅ `activeTab` - 访问当前标签页
   - ✅ `tabs` - 访问标签页信息

如果缺少权限,需要重新构建和加载扩展。

## 常见问题及解决方案

### 问题 1: 点击"保存"后没有任何反应

**诊断**:
1. 检查 Console 是否有任何日志
2. 检查是否填写了所有必填字段

**解决方案**:
- 确保填写了账号名称、用户名和密码
- 查看 Console 的错误信息
- 尝试刷新 Side Panel (关闭后重新打开)

### 问题 2: 显示"添加账号失败"但没有详细错误

**诊断**:
查看 Console 中的完整错误栈

**解决方案**:
1. 截图完整的错误信息
2. 重新加载扩展
3. 清空浏览器缓存后重试

### 问题 3: QuotaExceededError - 存储空间已满

**原因**: 
Chrome 的 `storage.local` 有容量限制(约 10MB)

**解决方案**:
```javascript
// 在 Console 中查看当前使用量
chrome.storage.local.getBytesInUse(null, (bytes) => {
  console.log('已使用:', bytes, '字节');
  console.log('约', (bytes / 1024).toFixed(2), 'KB');
});

// 清理所有账号(慎用!)
chrome.storage.local.remove('autoLoginAccounts', () => {
  console.log('已清空账号数据');
});
```

### 问题 4: 添加成功但列表中看不到

**可能原因**:
1. URL 过滤:账号配置了 URL,但当前页面不匹配
2. 界面未刷新

**解决方案**:

#### 检查是否被 URL 过滤
```javascript
// 在 Console 中查看所有账号
chrome.storage.local.get('autoLoginAccounts', (result) => {
  console.log('所有账号:', result.autoLoginAccounts);
});
```

如果能看到账号,说明被 URL 过滤了:
- 不填写 URL,账号会在所有页面显示
- 填写了 URL,只在匹配的页面显示

#### 刷新界面
1. 关闭 Side Panel
2. 重新打开
3. 点击 🔐 进入自动登录工具

### 问题 5: 表单无法输入

**可能原因**:
1. 浏览器兼容性问题
2. v-model 绑定失效

**解决方案**:
1. 检查 Console 是否有 Vue 相关错误
2. 重新加载扩展
3. 尝试在不同的浏览器中测试

## 调试命令集合

在 Side Panel 的 Console 中执行:

```javascript
// 1. 查看所有已保存的账号
chrome.storage.local.get('autoLoginAccounts', (result) => {
  console.table(result.autoLoginAccounts || []);
});

// 2. 查看存储使用情况
chrome.storage.local.getBytesInUse(null, (bytes) => {
  console.log(`已使用: ${bytes} 字节 (${(bytes/1024).toFixed(2)} KB)`);
});

// 3. 手动添加测试账号
const testAccount = {
  id: Date.now().toString(),
  name: '测试账号',
  username: 'test',
  password: 'test123'
};

chrome.storage.local.get('autoLoginAccounts', (result) => {
  const accounts = result.autoLoginAccounts || [];
  accounts.push(testAccount);
  chrome.storage.local.set({ autoLoginAccounts: accounts }, () => {
    console.log('测试账号添加成功');
    location.reload(); // 刷新界面
  });
});

// 4. 清空所有账号(慎用!)
chrome.storage.local.remove('autoLoginAccounts', () => {
  console.log('所有账号已清空');
  location.reload();
});

// 5. 检查 Vue 响应式状态(需要 Vue DevTools)
console.log('当前账号数量:', document.querySelector('#app').__vue_app__);
```

## 检查清单

使用此清单排查问题:

- [ ] Console 中是否有 `[AutoLogin]` 开头的日志?
- [ ] 是否填写了所有必填字段(账号名称、用户名、密码)?
- [ ] Console 中是否有红色错误信息?
- [ ] 扩展是否有 `storage` 权限?
- [ ] 是否尝试手动测试 `chrome.storage.local`?
- [ ] 存储空间是否已满?
- [ ] 是否尝试重新加载扩展?
- [ ] 是否尝试重新打开 Side Panel?

## 获取帮助

如果以上方法都无法解决,请提供:

1. **完整的 Console 日志** (截图)
2. **扩展权限列表** (截图)
3. **存储使用情况**:
   ```javascript
   chrome.storage.local.getBytesInUse(null, console.log)
   ```
4. **尝试添加的账号信息** (隐藏密码)
5. **浏览器版本** 和 **操作系统**

## 临时解决方案

如果无法通过 UI 添加账号,可以手动添加:

```javascript
// 在 Side Panel 的 Console 中执行
const newAccount = {
  id: Date.now().toString(),
  name: '手动添加的账号',
  username: 'your_username',
  password: 'your_password',
  // url: 'https://example.com' // 可选
};

chrome.storage.local.get('autoLoginAccounts', (result) => {
  const accounts = result.autoLoginAccounts || [];
  accounts.push(newAccount);
  
  chrome.storage.local.set({ autoLoginAccounts: accounts }, () => {
    console.log('✓ 账号添加成功');
    // 刷新页面以显示新账号
    location.reload();
  });
});
```

## 版本信息

**最新修复**: v1.0.3 (2025-11-06)
- ✅ 添加详细的日志输出
- ✅ 添加表单验证提示
- ✅ 改进错误处理和错误信息
- ✅ 添加字段去除空格处理

**升级方法**:
1. 运行 `npm run chrome:build`
2. 在 `chrome://extensions/` 中重新加载扩展
3. 刷新 Side Panel
