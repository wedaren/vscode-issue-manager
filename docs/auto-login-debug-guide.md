# 自动登录调试指南

## 问题诊断

当收到错误 "自动登录失败" 时,按以下步骤排查:

### 步骤 1: 检查 Content Script 是否注入

在目标页面打开开发者工具(F12),在 Console 中执行:

```javascript
// 检查 content script 是否已注入
window.__ISSUE_MANAGER_CONTENT_INJECTED__
// 应该返回 true
```

如果返回 `undefined`,说明 content script 未注入。

### 步骤 2: 手动测试消息通信

在 Console 中执行:

```javascript
// 测试发送消息
chrome.runtime.sendMessage({
  type: 'AUTO_LOGIN',
  username: 'admin',
  password: 'test123'
}, (response) => {
  console.log('Response:', response);
});
```

**预期结果**:
- 成功: `{success: true}`
- 失败: `{success: false, error: "错误信息"}`

### 步骤 3: 查看详细日志

打开开发者工具,查看 Console 中的日志:

**成功的日志序列**:
```
Content Script received message: {type: "AUTO_LOGIN", username: "admin", password: "***"}
[Auto Login] 开始自动登录...
[Auto Login] 页面已加载,查找表单元素...
[Auto Login] 找到用户名输入框: input[name="username"]
[Auto Login] 找到密码输入框: input[name="password"]
[Auto Login] 开始填充表单...
[Auto Login] 表单填充完成,等待...
[Auto Login] 找到登录按钮: button[type="submit"]
[Auto Login] 点击登录按钮...
[Auto Login] 自动登录完成
[Auto Login] 发送成功响应
```

**失败的日志示例**:
```
Content Script received message: {type: "AUTO_LOGIN", ...}
[Auto Login] 开始自动登录...
[Auto Login] 页面已加载,查找表单元素...
[Auto Login] 自动登录失败: Error: 未找到用户名输入框
[Auto Login] 发送失败响应: 未找到用户名输入框
```

### 步骤 4: 检查表单元素

在 Console 中执行,查找表单元素:

```javascript
// 查找用户名输入框
const usernameSelectors = [
  'input[name="username"]',
  'input[yotta-test="login-username-input"]',
  'input[type="text"][placeholder*="用户名"]',
  'input[autocomplete="username"]'
];

usernameSelectors.forEach(selector => {
  const el = document.querySelector(selector);
  if (el) {
    console.log('找到用户名输入框:', selector, el);
  }
});

// 查找密码输入框
const passwordSelectors = [
  'input[name="password"]',
  'input[yotta-test="login-password-input"]',
  'input[type="password"]'
];

passwordSelectors.forEach(selector => {
  const el = document.querySelector(selector);
  if (el) {
    console.log('找到密码输入框:', selector, el);
  }
});

// 查找登录按钮
const buttonSelectors = [
  'button[type="submit"]',
  'button[yotta-test="login-login-button"]',
  'button.yotta-button-primary'
];

buttonSelectors.forEach(selector => {
  const el = document.querySelector(selector);
  if (el) {
    console.log('找到登录按钮:', selector, el);
  }
});
```

### 步骤 5: 手动模拟自动登录

在 Console 中手动执行填充流程:

```javascript
// 1. 找到输入框
const usernameInput = document.querySelector('input[name="username"]');
const passwordInput = document.querySelector('input[name="password"]');

// 2. 填充值
usernameInput.value = 'admin';
passwordInput.value = 'rzy@Security2025';

// 3. 触发事件
usernameInput.dispatchEvent(new Event('input', { bubbles: true }));
usernameInput.dispatchEvent(new Event('change', { bubbles: true }));
passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
passwordInput.dispatchEvent(new Event('change', { bubbles: true }));

// 4. 查找并点击登录按钮
const loginButton = document.querySelector('button[type="submit"]');
if (loginButton) {
  loginButton.click();
  console.log('已点击登录按钮');
} else {
  console.log('未找到登录按钮');
}
```

## 常见问题

### 问题 1: "Receiving end does not exist"

**原因**: Content Script 未注入到页面

**解决方案**:
1. 刷新页面
2. 重新加载扩展 (`chrome://extensions/` → 重新加载)
3. 新版本会自动注入,但需要重新加载扩展

### 问题 2: 消息发送成功但无响应

**原因**: 异步消息通道已关闭

**解决方案**:
- 已在最新版本中修复
- 确保使用最新构建的扩展
- `AUTO_LOGIN` case 必须返回 `true` 以保持通道开启

### 问题 3: 表单元素找不到

**原因**: 页面使用了自定义的表单结构

**解决方案**:
1. 在开发者工具中检查实际的表单结构
2. 复制用户名和密码输入框的 HTML
3. 检查是否有匹配的选择器
4. 如果没有,可能需要添加新的选择器

**示例**:
```html
<!-- 如果你的表单是这样的 -->
<input class="custom-username-field" type="text">
<input class="custom-password-field" type="password">

<!-- 需要添加选择器 -->
'input.custom-username-field'
'input.custom-password-field'
```

### 问题 4: 填充成功但未点击登录

**可能原因**:
1. 登录按钮被 JavaScript 禁用
2. 需要额外的验证步骤
3. 按钮的选择器不匹配

**调试**:
```javascript
// 查找所有按钮
const allButtons = document.querySelectorAll('button');
console.log('所有按钮:', allButtons);

// 查找包含"登录"文字的按钮
const loginButtons = Array.from(allButtons).filter(btn => 
  btn.textContent.includes('登录')
);
console.log('登录按钮:', loginButtons);
```

## 修复记录

### v1.0.2 (2025-11-06) - 重要修复

**问题**: `sendResponse` 在异步操作完成前失效

**原因**: 
- Chrome Extension 的消息监听器默认是同步的
- 对于异步操作,必须返回 `true` 来保持消息通道开启
- 之前的代码在所有 case 后统一返回 `true`,但在 `AUTO_LOGIN` case 的 Promise 完成前,消息通道已经被正确保持

**修复**:
```javascript
// 修复前
case 'AUTO_LOGIN':
  handleAutoLogin(message.username, message.password)
    .then(() => sendResponse({ success: true }))
    .catch((error) => sendResponse({ success: false, error: error.message }));
  break;
// ... 最后统一 return true

// 修复后
case 'AUTO_LOGIN':
  handleAutoLogin(message.username, message.password)
    .then(() => {
      console.log('[Auto Login] 发送成功响应');
      sendResponse({ success: true });
    })
    .catch((error) => {
      console.error('[Auto Login] 发送失败响应:', error.message);
      sendResponse({ success: false, error: error.message });
    });
  return true; // 立即返回 true 保持通道开启
```

**效果**:
- ✅ 异步操作完成后能正确发送响应
- ✅ 不会再出现 "The message port closed before a response was received" 错误
- ✅ 增加了详细的日志输出

## 测试清单

使用此清单验证修复:

- [ ] 重新构建扩展 (`npm run chrome:build`)
- [ ] 重新加载扩展到 Chrome
- [ ] 打开测试登录页面
- [ ] 打开开发者工具查看 Console
- [ ] 在侧边栏点击"使用"按钮
- [ ] 检查 Console 是否有完整的日志
- [ ] 确认是否收到 `[Auto Login] 发送成功响应` 日志
- [ ] 确认表单是否被填充
- [ ] 确认登录按钮是否被点击

## 下一步

如果问题仍然存在:

1. **收集信息**:
   - 完整的 Console 日志截图
   - 登录页面的 HTML 结构
   - 扩展的版本信息

2. **临时方案**:
   - 手动复制账号密码
   - 使用浏览器自带的密码管理器

3. **报告问题**:
   - 提供详细的复现步骤
   - 附上收集的信息
