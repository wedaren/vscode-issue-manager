# 自动登录工具功能文档

## 功能概述

自动登录工具允许用户保存常用的账号密码信息,并在需要登录的网页上快速自动填充和登录。

## 功能特性

### 1. 账号管理
- ✅ 添加新账号:保存账号名称、用户名、密码
- ✅ 指定 URL:可选择性地为特定 URL 配置账号
- ✅ 删除账号:支持删除不再需要的账号
- ✅ 本地存储:所有账号信息存储在浏览器本地,安全私密

### 2. 自动登录
- ✅ 智能识别:自动识别页面中的用户名和密码输入框
- ✅ 自动填充:一键填充账号密码信息
- ✅ 自动点击:自动点击登录按钮完成登录
- ✅ 多种匹配:支持多种表单结构的识别

## 使用指南

### 打开自动登录工具

1. 点击 Chrome 扩展图标打开侧边栏
2. 在侧边栏顶部找到 🔐 图标按钮
3. 点击进入自动登录工具页面

### 添加账号

1. 点击右上角"添加账号"按钮
2. 填写账号信息:
   - **账号名称**:为这个账号起一个易于识别的名称(如:公司账号、测试账号)
   - **用户名**:登录时使用的用户名
   - **密码**:登录时使用的密码
   - **页面 URL**(可选):如果只想在特定页面显示此账号,可填写完整的 URL
3. 点击"保存"按钮

### 使用账号登录

1. 打开需要登录的网页
2. 打开 Chrome 扩展侧边栏
3. 点击 🔐 图标进入自动登录工具
4. 在账号列表中找到要使用的账号
5. 点击"使用"按钮
6. 扩展会自动填充用户名和密码,并点击登录按钮

### 删除账号

1. 在账号列表中找到要删除的账号
2. 点击 🗑 图标
3. 确认删除操作

## 支持的表单类型

该工具能够识别以下类型的登录表单:

### 用户名输入框
- `<input name="username">`
- `<input yotta-test="login-username-input">`
- `<input type="text" placeholder="*用户名*">`

### 密码输入框
- `<input name="password">`
- `<input yotta-test="login-password-input">`
- `<input type="password">`

### 登录按钮
- `<button type="submit">`
- `<button yotta-test="login-login-button">`
- 包含"登录"文字的按钮
- `.yotta-button-primary` 类的按钮

## 技术实现

### 组件结构

```
AutoLoginPanel.vue          # 自动登录工具主界面
├── 账号列表显示
├── 添加账号表单
└── 账号操作(使用/删除)

SidePanel.vue              # 主侧边栏
└── 工具入口按钮

content/index.ts           # Content Script
└── handleAutoLogin()     # 自动填充和登录逻辑
```

### 数据存储

账号信息存储在 `chrome.storage.local` 中,键名为 `autoLoginAccounts`:

```typescript
interface Account {
  id: string;           // 唯一标识符
  name: string;         // 账号名称
  username: string;     // 用户名
  password: string;     // 密码
  url?: string;         // 可选的 URL 限制
}
```

### 消息通信

使用 Chrome Extension Message Passing:

```typescript
// Side Panel → Content Script
chrome.tabs.sendMessage(tabId, {
  type: 'AUTO_LOGIN',
  username: account.username,
  password: account.password,
});

// Content Script 处理
case 'AUTO_LOGIN':
  handleAutoLogin(message.username, message.password)
```

## 安全注意事项

1. **本地存储**:所有账号信息仅存储在本地浏览器中,不会上传到任何服务器
2. **明文存储**:密码以明文形式存储在本地,请确保设备安全
3. **使用建议**:建议仅保存测试账号或非敏感账号
4. **定期清理**:定期删除不再使用的账号信息

## 故障排查

### 问题:点击"使用"后没有反应
**解决方案**:
- 确保页面已完全加载
- 检查页面是否包含登录表单
- 刷新页面后重试

### 问题:自动填充后未能点击登录
**解决方案**:
- 某些网站可能需要手动点击登录按钮
- 填充完成后请手动点击登录

### 问题:无法识别登录表单
**解决方案**:
- 该网站的表单结构可能不在支持范围内
- 可以手动复制账号密码进行登录

## 未来改进计划

- [ ] 支持更多表单结构的自动识别
- [ ] 添加密码加密存储
- [ ] 支持账号分组管理
- [ ] 支持导入/导出账号信息
- [ ] 添加账号搜索功能
- [ ] 支持自定义选择器配置

## 版本历史

### v1.0.0 (2025-11-06)
- ✅ 初始版本发布
- ✅ 支持基本的账号管理功能
- ✅ 支持自动填充和登录
- ✅ 支持 URL 过滤
