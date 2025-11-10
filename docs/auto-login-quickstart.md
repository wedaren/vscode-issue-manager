# 自动登录工具 - 快速开始

## 🚀 5 分钟上手指南

### 步骤 1: 构建扩展

```bash
cd /Users/wedaren/repositoryDestinationOfGithub/vscode-issue-manager
npm run chrome:build
```

### 步骤 2: 加载扩展到 Chrome

1. 打开 Chrome 浏览器
2. 访问 `chrome://extensions/`
3. 打开右上角的"开发者模式"
4. 点击"加载已解压的扩展程序"
5. 选择 `.output/chrome-mv3` 目录

### 步骤 3: 测试自动登录功能

#### 使用测试页面

1. 在浏览器中打开测试页面:
   ```
   file:///Users/wedaren/repositoryDestinationOfGithub/vscode-issue-manager/test-auto-login.html
   ```

2. 点击 Chrome 扩展图标,打开侧边栏

3. 点击侧边栏顶部的 🔐 图标

4. 点击"添加账号"按钮

5. 填写账号信息:
   - **账号名称**: 测试账号
   - **用户名**: admin
   - **密码**: password123
   - **页面 URL**: (留空)

6. 点击"保存"

7. 点击账号列表中的"使用"按钮

8. 观察页面自动填充并登录! ✨

#### 测试实际网站

在你提供的登录页面 HTML 中,自动登录工具能够识别:

```html
<!-- 用户名输入框 -->
<input yotta-test="login-username-input" 
       name="username" 
       type="text" 
       placeholder="请输入用户名">

<!-- 密码输入框 -->
<input yotta-test="login-password-input" 
       name="password" 
       type="password" 
       placeholder="请输入密码">

<!-- 登录按钮 -->
<button yotta-test="login-login-button" 
        type="submit">登录</button>
```

## 📋 功能清单

- ✅ 账号管理 (添加/删除)
- ✅ 自动填充用户名和密码
- ✅ 自动点击登录按钮
- ✅ URL 智能过滤
- ✅ 友好的消息提示
- ✅ 本地安全存储

## 🔧 故障排查

### 问题: 点击"使用"后没反应

**可能原因**:
1. Content Script 未注入
2. 页面未完全加载
3. 表单结构不在支持范围内

**快速解决**:
1. 刷新页面后重试
2. 重新加载扩展(`chrome://extensions/` → 重新加载)
3. 检查浏览器控制台(F12)是否有错误信息
4. 确保不是在 `chrome://` 等特殊页面

**详细排查**: 查看 [故障排查指南](./auto-login-troubleshooting.md)

### 问题: "自动登录失败,请确保页面已加载完成"

**解决方法**:
1. 确保页面已完全加载(等待所有内容显示)
2. 尝试刷新页面
3. 重新加载扩展
4. 查看控制台日志获取详细错误信息

新版本已自动处理 Content Script 注入,如果仍有问题:
- 检查是否在特殊页面(如 chrome://)
- 查看 [故障排查指南](./auto-login-troubleshooting.md) 获取详细帮助

### 问题: 无法识别登录表单

**解决方法**:
1. 检查表单元素是否包含 `name="username"` 或 `name="password"` 属性
2. 如果是自定义表单,可能需要扩展选择器支持
3. 手动复制账号密码作为临时方案
4. 反馈表单结构以添加支持

### 调试技巧

打开浏览器控制台(F12),查看自动登录日志:
```
[Auto Login] 开始自动登录...
[Auto Login] 页面已加载,查找表单元素...
[Auto Login] 找到用户名输入框: input[name="username"]
[Auto Login] 找到密码输入框: input[name="password"]
[Auto Login] 开始填充表单...
[Auto Login] 表单填充完成,等待...
[Auto Login] 找到登录按钮: button[type="submit"]
[Auto Login] 点击登录按钮...
[Auto Login] 自动登录完成
```

如果没有看到这些日志,说明 Content Script 未正确运行。

## 📚 相关文档

- [功能文档](./auto-login-feature.md) - 完整功能说明
- [实现总结](./auto-login-implementation-summary.md) - 技术实现细节
- [故障排查指南](./auto-login-troubleshooting.md) - 详细的问题解决方案 ⭐

## 🎯 下一步

1. 在实际登录页面测试功能
2. 添加常用账号
3. 享受一键登录的便利!

---

**提示**: 建议仅保存测试账号或非敏感账号,确保账号安全。
