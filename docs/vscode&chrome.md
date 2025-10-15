# VSCode 与 Chrome 扩展集成架构文档

## 概述

本文档描述 VSCode Issue Manager 扩展与 Chrome 浏览器扩展之间的集成方案，实现从网页选取内容并在 VSCode 中创建笔记的功能。

## 功能流程

1. **用户在 Chrome 浏览器中浏览网页**
2. **打开 Chrome 扩展的 Side Panel**
3. **点击"新建笔记"按钮**
4. **进入 DOM 选取模式**
   - 鼠标悬停时高亮显示可选取的元素
   - 点击选中目标元素
   - 选中的内容保留原始样式（HTML格式）
5. **将选中的 HTML 内容发送到 VSCode**
6. **VSCode 接收 HTML 内容并转换为 Markdown**
   - 保留重要的格式信息（标题、列表、链接、强调等）
   - 转换为阅读友好的 Markdown 格式
7. **创建新笔记文件**
   - 使用转换后的 Markdown 内容
   - 自动打开新创建的文件

## 技术架构

### VSCode 扩展端

#### 新增命令

- `issueManager.createIssueFromHtml` - 接收 HTML 内容并创建笔记
  - 参数：`{ html: string, title?: string, url?: string }`

#### 新增服务

- `HtmlToMarkdownService` - HTML 转 Markdown 转换服务
  - 基于现有的 `RSSMarkdownConverter` 和 `ContentProcessors`
  - 支持常见 HTML 元素的转换
  - 保留重要的样式信息

#### 通信机制

VSCode 扩展通过命令 API 接收外部调用：
```typescript
vscode.commands.executeCommand('issueManager.createIssueFromHtml', {
  html: '<div>...</div>',
  title: '文章标题',
  url: 'https://example.com/article'
});
```

### Chrome 扩展端

#### 文件结构

```
chrome-extension/
├── manifest.json          # 扩展配置
├── sidepanel/
│   ├── sidepanel.html    # Side Panel UI
│   ├── sidepanel.js      # Side Panel 逻辑
│   └── sidepanel.css     # Side Panel 样式
├── content/
│   ├── content.js        # 内容脚本（DOM 选取）
│   └── content.css       # 选取高亮样式
└── background.js         # 后台脚本（通信协调）
```

#### 核心功能模块

1. **Side Panel UI** (`sidepanel/`)
   - 显示"新建笔记"按钮
   - 显示操作提示和状态

2. **DOM 选取器** (`content/content.js`)
   - 监听鼠标移动事件，高亮悬停的元素
   - 监听点击事件，选取目标元素
   - 提取选中元素的 HTML 内容（包含样式）

3. **通信模块** (`background.js`)
   - 接收来自 Side Panel 的消息
   - 将 Content Script 中选取的内容传递给 VSCode
   - 通过 Native Messaging 或 Local Storage 与 VSCode 通信

### 通信协议

#### Chrome 扩展内部通信

```javascript
// Side Panel -> Background
chrome.runtime.sendMessage({
  type: 'START_SELECTION'
});

// Content Script -> Background
chrome.runtime.sendMessage({
  type: 'CONTENT_SELECTED',
  data: {
    html: '<div>...</div>',
    title: '页面标题',
    url: 'https://...'
  }
});
```

#### Chrome 扩展 -> VSCode 通信方案

**方案一：使用 VSCode URI Handler**

```javascript
// Chrome 扩展发起调用
const vscodeUri = `vscode://wedaren.issue-manager/create-from-html?html=${encodeURIComponent(html)}`;
window.location.href = vscodeUri;
```

VSCode 端注册 URI Handler：
```typescript
vscode.window.registerUriHandler({
  handleUri(uri: vscode.Uri) {
    if (uri.path === '/create-from-html') {
      const html = uri.query.html;
      // 处理创建逻辑
    }
  }
});
```

**方案二：使用本地 HTTP 服务器**

VSCode 扩展启动一个本地 HTTP 服务器监听请求：
```typescript
const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/create-note') {
    // 接收 HTML 内容并创建笔记
  }
});
server.listen(37892); // 固定端口
```

Chrome 扩展发送 POST 请求：
```javascript
fetch('http://localhost:37892/create-note', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ html, title, url })
});
```

## HTML 到 Markdown 转换规则

### 支持的元素

| HTML 元素 | Markdown 转换 |
|-----------|---------------|
| `<h1>` - `<h6>` | `#` - `######` |
| `<p>` | 段落（空行分隔）|
| `<strong>`, `<b>` | `**粗体**` |
| `<em>`, `<i>` | `*斜体*` |
| `<a>` | `[文本](链接)` |
| `<ul>`, `<ol>` | 列表（`-` 或 `1.`）|
| `<li>` | 列表项 |
| `<code>` | `` `代码` `` |
| `<pre>` | `` ```代码块``` `` |
| `<blockquote>` | `> 引用` |
| `<img>` | `![alt](src)` |
| `<br>` | 换行（双空格 + 换行）|

### 样式保留策略

- **保留**：文本语义（标题、强调、链接等）
- **转换**：布局结构（段落、列表、引用等）
- **忽略**：CSS 样式、颜色、字体等视觉样式

## 使用示例

### 用户操作流程

1. 在 Chrome 中打开网页
2. 点击 Issue Manager 扩展图标，打开 Side Panel
3. 点击"新建笔记"按钮
4. 页面进入选取模式（背景半透明覆盖）
5. 鼠标悬停在想要选取的内容上（元素高亮显示）
6. 点击选中目标内容
7. 自动跳转到 VSCode 并创建新笔记
8. 笔记内容为转换后的 Markdown

### 预期效果

**原始网页 HTML：**
```html
<article>
  <h1>深入理解 TypeScript</h1>
  <p>TypeScript 是一种由 <strong>Microsoft</strong> 开发的编程语言。</p>
  <ul>
    <li>静态类型检查</li>
    <li>现代 ES 特性支持</li>
  </ul>
  <a href="https://www.typescriptlang.org/">官方网站</a>
</article>
```

**转换后的 Markdown：**
```markdown
# 深入理解 TypeScript

TypeScript 是一种由 **Microsoft** 开发的编程语言。

- 静态类型检查
- 现代 ES 特性支持

[官方网站](https://www.typescriptlang.org/)
```

## 实现计划

### 阶段一：VSCode 端基础功能

- [x] 创建 `HtmlToMarkdownService` 服务
- [x] 实现 HTML 到 Markdown 的转换逻辑
- [x] 创建 `createIssueFromHtml` 命令
- [x] 注册命令到 `package.json`

### 阶段二：Chrome 扩展基础结构

- [ ] 创建 Chrome 扩展 manifest.json
- [ ] 实现 Side Panel UI 和基本交互
- [ ] 实现 Content Script 的 DOM 选取功能
- [ ] 实现内部消息传递机制

### 阶段三：跨应用通信

- [ ] 选择并实现通信方案（URI Handler 或 HTTP 服务器）
- [ ] 测试端到端的数据传输
- [ ] 处理错误和边缘情况

### 阶段四：优化和完善

- [ ] 优化选取体验（更好的高亮效果）
- [ ] 支持选取多个元素
- [ ] 添加预览功能
- [ ] 改进转换质量

## 配置项

### VSCode 扩展配置

```json
{
  "issueManager.chromeIntegration.enabled": true,
  "issueManager.chromeIntegration.port": 37892,
  "issueManager.chromeIntegration.autoOpen": true
}
```

### Chrome 扩展配置

- 是否自动打开 VSCode
- 是否保留图片
- 是否包含元信息（URL、时间等）

## 安全考虑

1. **XSS 防护**：清理接收到的 HTML 内容，移除潜在的恶意脚本
2. **CORS**：如果使用 HTTP 服务器，需要配置适当的 CORS 策略
3. **端口冲突**：检测并处理端口占用情况
4. **内容验证**：验证接收到的 HTML 内容的合法性

## 未来扩展

- 支持其他浏览器（Firefox, Edge）
- 支持选取整个页面
- 支持批量选取和创建
- 集成 LLM 生成摘要和标题
- 支持保存网页快照
