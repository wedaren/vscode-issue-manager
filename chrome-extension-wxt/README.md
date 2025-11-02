# Issue Manager Chrome 扩展 (WXT + Vue)

这是 Issue Manager VSCode 扩展的配套 Chrome 浏览器扩展，使用 WXT 框架和 Vue.js 构建，用于从网页选取内容并在 VSCode 中创建笔记。

## 🎯 技术栈

- **WXT**: 现代化的浏览器扩展开发框架
- **Vue 3**: 用于构建响应式 UI 组件
- **TypeScript**: 提供类型安全
- **Vite**: 快速的构建工具

## ✨ 功能特性

- 🖱️ 可视化 DOM 选取器，支持键盘导航
- ✨ 保留 HTML 样式并转换为 Markdown
- 🔄 通过 WebSocket 与 VSCode Issue Manager 无缝集成
- 📱 Side Panel 界面，不干扰浏览
- ⭐ 显示和管理关注问题列表

## 📁 项目结构

```
chrome-extension-wxt/
├── entrypoints/           # 扩展入口点
│   ├── background.ts      # 后台服务脚本
│   ├── content/           # Content Script
│   │   ├── index.ts       # DOM 选取逻辑
│   │   └── style.css      # 高亮样式
│   └── sidepanel/         # Side Panel
│       ├── index.html     # HTML 入口
│       ├── main.ts        # Vue 应用入口
│       └── style.css      # 基础样式
├── components/            # Vue 组件
│   └── SidePanel.vue      # Side Panel 主组件
├── public/                # 静态资源
│   └── icon.png           # 扩展图标
└── README.md             # 本文档
```

## 🚀 开发

### 前置条件

- Node.js >= 18
- npm >= 9

### 安装依赖

在项目根目录运行：

```bash
npm install
```

### 开发模式

开发模式会启动热重载服务器，实时预览更改：

```bash
npm run chrome:dev
```

然后：
1. 打开 Chrome 浏览器
2. 访问 `chrome://extensions/`
3. 开启"开发者模式"
4. 点击"加载已解压的扩展程序"
5. 选择项目根目录下的 `.output/chrome-mv3` 目录

### 生产构建

构建用于生产环境的扩展：

```bash
npm run chrome:build
```

构建产物位于 `.output/chrome-mv3/` 目录。

### 打包为 ZIP

生成可发布到 Chrome Web Store 的 ZIP 文件：

```bash
npm run chrome:zip
```

## 🔧 配置

### WXT 配置

配置文件位于项目根目录的 `wxt.config.ts`：

```typescript
export default defineConfig({
  srcDir: 'chrome-extension-wxt',  // 源代码目录
  outDir: '.output',                // 构建输出目录
  manifest: {
    // Chrome 扩展 manifest 配置
  },
  vite: () => ({
    plugins: [vue()],               // 启用 Vue 插件
  }),
});
```

### 图标配置

扩展使用多种尺寸的图标以适应不同的显示场景：

- `icon-16.png` (16×16) - 浏览器工具栏
- `icon.png` (32×32) - 扩展管理页面
- `icon-48.png` (48×48) - 扩展详情页
- `icon-128.png` (128×128) - Chrome Web Store

图标文件位于 `chrome-extension-wxt/public/` 目录。构建时会自动复制到输出目录。

**注意**: 当前所有尺寸使用同一图标文件。为获得最佳显示效果，建议为每个尺寸创建优化的图标。

### VSCode 连接配置

扩展通过 WebSocket 连接到 VSCode（默认端口 37892）。可以在扩展的存储中配置：

```javascript
chrome.storage.sync.set({
  'issueManager.vscodeWsUrl': 'ws://localhost:37892/ws'
});
```

## 📖 使用方法

### 前置条件

1. ✅ 已安装 VSCode
2. ✅ 已安装 Issue Manager VSCode 扩展
3. ✅ 已配置问题目录（`issueManager.issueDir`）
4. ✅ VSCode 正在运行
5. ✅ VSCode 扩展中已启用 WebSocket 服务

### 基本流程

1. **打开 Side Panel**
   - 点击 Chrome 工具栏中的扩展图标

2. **查看关注问题**
   - Side Panel 会自动显示您在 VSCode 中标记为关注的问题
   - 点击问题可以在 VSCode 中打开

3. **开始选取内容**
   - 点击 Side Panel 中的"新建笔记"按钮（✨图标）
   - 页面将进入选取模式（半透明背景）

4. **选择内容**
   - **鼠标操作**：鼠标悬停在要选取的内容上，选中的元素会高亮显示
   - **键盘导航**：
     - `方向键 ↑/→`：扩大选取范围（选中父元素）
     - `方向键 ↓/←`：缩小选取范围（选中子元素）
     - `Enter`：确认选取
     - `ESC`：取消选取模式
   - 点击确定或按回车确认选取

5. **创建笔记**
   - 选中的内容会自动发送到 VSCode
   - VSCode 将 HTML 转换为 Markdown
   - 自动创建并打开新笔记文件

## 🏗️ 架构说明

### 通信流程

```
Side Panel (Vue.js)
    ↓ 用户点击"新建笔记"
Background Script
    ↓ 发送消息
Content Script (网页中)
    ↓ 用户选取内容
Background Script
    ↓ WebSocket
VSCode Extension (本地服务器 :37892)
    ↓ HTML → Markdown
新建笔记文件
```

### WXT 框架优势

1. **类型安全**: 完整的 TypeScript 支持
2. **热重载**: 开发时自动重载扩展
3. **模块化**: 清晰的入口点结构
4. **现代工具链**: 使用 Vite 进行快速构建
5. **跨浏览器**: 支持 Chrome、Firefox 等多个浏览器

### Vue.js 组件化

- **响应式数据**: 使用 Vue 3 Composition API
- **类型提示**: TypeScript + Vue 提供完整的类型检查
- **可维护性**: 组件化架构便于维护和扩展

## 🐛 故障排除

### 扩展无法连接到 VSCode

**问题**: Side Panel 显示"未连接"状态

**解决方案**:
1. 确保 VSCode 正在运行
2. 确保 Issue Manager 扩展已启用
3. 检查 VSCode 扩展设置中 WebSocket 服务已启用
4. 检查端口（默认 37892）未被占用
5. 检查防火墙设置

### 开发模式热重载不工作

**问题**: 修改代码后扩展没有更新

**解决方案**:
1. 在 `chrome://extensions/` 页面手动点击"重新加载"
2. 刷新正在使用扩展的网页
3. 重新打开 Side Panel

### 构建失败

**问题**: `npm run chrome:build` 失败

**解决方案**:
1. 删除 `node_modules` 和 `package-lock.json`
2. 运行 `npm install`
3. 清理构建缓存: `rm -rf .output .wxt`
4. 重新构建

## 🔄 从旧版本迁移

旧版本使用原生 JavaScript + HTML，新版本使用 WXT + Vue：

### 主要变化

1. **文件结构**: 从 `chrome-extension/` 迁移到 `chrome-extension-wxt/`
2. **构建系统**: 从无构建到使用 WXT + Vite
3. **UI 框架**: 从原生 JS 到 Vue 3
4. **类型安全**: 全面使用 TypeScript

### 功能保持

所有原有功能都得到保留：
- ✅ DOM 选取功能
- ✅ WebSocket 通信
- ✅ 关注问题列表
- ✅ 与 VSCode 的集成

## 📝 开发注意事项

1. **修改 manifest**: 修改 `wxt.config.ts` 而不是直接修改 manifest.json
2. **添加依赖**: 在项目根目录运行 `npm install`，而不是在 `chrome-extension-wxt/` 目录
3. **调试**: 使用 Chrome DevTools 调试各个部分：
   - Background: `chrome://extensions/` → 详细信息 → "检查视图：service worker"
   - Side Panel: 右键 Side Panel → 检查
   - Content Script: 在网页上按 F12

## 📚 相关文档

- [WXT 文档](https://wxt.dev/)
- [Vue 3 文档](https://vuejs.org/)
- [Chrome 扩展开发文档](https://developer.chrome.com/docs/extensions/)
- [VSCode Issue Manager](https://github.com/wedaren/vscode-issue-manager)

## 📄 许可证

与 VSCode Issue Manager 扩展相同
