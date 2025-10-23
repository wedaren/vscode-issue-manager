# Chrome Extension URI Handler 功能说明

## 概述

本功能使用 `vscode.window.registerUriHandler` 实现了从 Chrome 扩展的 Side Panel 直接打开 VSCode 问题目录的能力。

## 实现细节

### 1. VSCode 扩展端

在 `src/integration/ChromeIntegrationServer.ts` 中注册了 URI handler：

```typescript
const uriHandler: vscode.UriHandler = {
  handleUri: async (uri: vscode.Uri) => {
    // 处理打开问题目录
    if (uri.path === '/open-issue-dir') {
      await vscode.commands.executeCommand('issueManager.openIssueDir');
      return;
    }
    // ... 其他路径处理
  }
};
```

支持的 URI 路径：
- `/open-issue-dir` - 打开问题目录
- `/create-from-html` - 创建笔记（原有功能）

### 2. Chrome 扩展端

在 `chrome-extension/sidepanel/sidepanel.html` 中添加了新按钮：

```html
<button id="open-issue-dir-btn" class="primary-btn">
  <span class="btn-icon">📁</span>
  打开问题目录
</button>
```

在 `chrome-extension/sidepanel/sidepanel.js` 中添加了处理函数：

```javascript
function handleOpenIssueDir() {
  const vscodeUri = 'vscode://wedaren.issue-manager/open-issue-dir';
  window.open(vscodeUri, '_blank');
  showMessage('正在打开 VSCode 问题目录...', 'success');
}
```

## URI Scheme 格式

```
vscode://<publisher>.<extensionName>/<path>
```

示例：
- `vscode://wedaren.issue-manager/open-issue-dir`
- `vscode://wedaren.issue-manager/create-from-html?data=...`

## 使用方法

1. 在 Chrome 浏览器中打开 Issue Manager 扩展的 Side Panel
2. 点击"打开问题目录"按钮
3. 浏览器会自动打开 VSCode 并执行 `issueManager.openIssueDir` 命令

## 优势

- **无需 WebSocket 连接**：URI handler 不依赖 WebSocket 服务，更加稳定
- **系统级集成**：利用操作系统的 URI scheme 注册机制
- **用户友好**：点击按钮即可直接跳转到 VSCode

## 技术要点

1. URI handler 在扩展激活时自动注册
2. 支持多个路径的路由处理
3. 错误处理和日志记录
4. 与现有的 WebSocket 服务并存，互不干扰

## 测试

1. 确保 VSCode 中已安装并激活 Issue Manager 扩展
2. 确保已配置问题目录
3. 在 Chrome 中打开扩展的 Side Panel
4. 点击"打开问题目录"按钮
5. 验证 VSCode 是否正确打开并显示问题目录

## 未来扩展

可以添加更多的 URI 路径，例如：
- `/search?query=...` - 搜索问题
- `/create-issue?title=...` - 创建新问题
- `/open-issue?path=...` - 打开特定问题
