# Issue Manager Chrome 扩展

这是 Issue Manager VSCode 扩展的配套 Chrome 浏览器扩展，用于从网页选取内容并在 VSCode 中创建笔记。

## 功能特性

- 🖱️ 可视化 DOM 选取器
- ✨ 保留 HTML 样式并转换为 Markdown
- 🔄 与 VSCode Issue Manager 无缝集成
- 📱 Side Panel 界面，不干扰浏览

## 安装方法

### 方式一：从 Chrome Web Store 安装（推荐）

1. 访问 Chrome Web Store（待发布）
2. 点击"添加到 Chrome"
3. 确认安装

### 方式二：开发者模式安装

1. 打开 Chrome 浏览器
2. 访问 `chrome://extensions/`
3. 开启右上角的"开发者模式"
4. 点击"加载已解压的扩展程序"
5. 选择此 `chrome-extension` 目录

## 使用方法

### 前置条件

1. ✅ 已安装 VSCode
2. ✅ 已安装 Issue Manager VSCode 扩展
3. ✅ 已配置问题目录（`issueManager.issueDir`）
4. ✅ VSCode 正在运行

### 基本流程

1. **打开 Side Panel**
   - 点击 Chrome 工具栏中的扩展图标
   - 或使用快捷键（可自定义）

2. **开始选取**
   - 点击"新建笔记"按钮
   - 页面将进入选取模式（半透明背景）

3. **选择内容**
   - 鼠标悬停在要选取的内容上
   - 选中的元素会高亮显示
   - 点击确认选取

4. **创建笔记**
   - 选中的内容会自动发送到 VSCode
   - VSCode 将 HTML 转换为 Markdown
   - 自动创建并打开新笔记文件

### 键盘快捷键

- `ESC` - 取消选取模式

## 技术架构

### 通信流程

```
Chrome Extension (Side Panel)
    ↓ (用户点击"新建笔记")
Background Script
    ↓ (发送消息)
Content Script (网页中)
    ↓ (选取内容)
Background Script
    ↓ (HTTP POST)
VSCode Extension (本地服务器 :37892)
    ↓ (HTML → Markdown)
新建笔记文件
```

### 文件结构

```
chrome-extension/
├── manifest.json          # 扩展配置
├── background.js          # 后台脚本（协调通信）
├── sidepanel/
│   ├── sidepanel.html    # Side Panel UI
│   ├── sidepanel.js      # Side Panel 逻辑
│   └── sidepanel.css     # Side Panel 样式
├── content/
│   ├── content.js        # DOM 选取逻辑
│   └── content.css       # 高亮样式
└── icons/                # 扩展图标
    ├── icon16.png
    ├── icon32.png
    ├── icon48.png
    └── icon128.png
```

## 配置选项

暂无需额外配置，扩展将自动连接到本地运行的 VSCode 实例。

## 故障排除

### 扩展无法连接到 VSCode

**问题**: 点击"新建笔记"后显示"无法连接到 VSCode"错误

**解决方案**:
1. 确保 VSCode 正在运行
2. 确保 Issue Manager 扩展已启用
3. 检查 VSCode 扩展是否正常启动了本地服务器（端口 37892）
4. 检查防火墙是否阻止了本地连接

### 选取的内容无法转换

**问题**: 选中内容后，VSCode 中创建的笔记是空的或格式不正确

**解决方案**:
1. 确保选中的是包含文本内容的元素
2. 避免选中 `<script>` 或 `<style>` 等特殊元素
3. 尝试选取更大的父元素

### 页面无法进入选取模式

**问题**: 点击"新建笔记"后，页面没有变化

**解决方案**:
1. 刷新页面后重试
2. 检查浏览器控制台是否有错误信息
3. 某些特殊页面（如 Chrome 设置页）无法使用 Content Script

## 已知限制

- ⚠️ 部分需要登录的网站可能无法正常选取内容
- ⚠️ 某些使用 Shadow DOM 的网站可能无法选取
- ⚠️ Chrome 内部页面（如 `chrome://` 开头的页面）无法使用

## 开发说明

### 调试方法

1. 打开 `chrome://extensions/`
2. 找到"Issue Manager"扩展
3. 点击"详细信息"
4. 点击"检查视图：background page"查看后台脚本日志
5. 点击"检查视图：sidepanel.html"查看 Side Panel 日志
6. 在网页中按 F12 查看 Content Script 日志

### 本地开发

1. 修改代码后，在 `chrome://extensions/` 页面点击"重新加载"
2. 刷新正在使用扩展的网页
3. 重新打开 Side Panel

## 许可证

与 VSCode Issue Manager 扩展相同

## 相关链接

- [VSCode Issue Manager](https://github.com/wedaren/vscode-issue-manager)
- [文档：VSCode 与 Chrome 集成架构](../docs/vscode&chrome.md)
