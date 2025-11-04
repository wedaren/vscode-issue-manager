# Chrome 扩展迁移指南

本文档说明从旧版 Chrome 扩展（原生 JavaScript）到新版（WXT + Vue）的迁移过程。

## 📊 变化概览

### 技术栈对比

| 方面 | 旧版 | 新版 |
|------|------|------|
| 框架 | 无框架 | WXT 0.20.11 |
| UI 库 | 原生 JavaScript + HTML | Vue 3 + Composition API |
| 语言 | JavaScript | TypeScript |
| 构建工具 | 无 | Vite |
| 目录 | `chrome-extension/` | `chrome-extension-wxt/` |
| 开发体验 | 手动刷新 | 热重载 |

### 文件结构对比

#### 旧版结构
```
chrome-extension/
├── manifest.json
├── background.js
├── content/
│   ├── content.js
│   └── content.css
├── sidepanel/
│   ├── sidepanel.html
│   ├── sidepanel.js
│   └── sidepanel.css
└── icons/
    └── icon32.png
```

#### 新版结构
```
chrome-extension-wxt/
├── entrypoints/
│   ├── background.ts          (← background.js)
│   ├── content/
│   │   ├── index.ts          (← content.js)
│   │   └── style.css         (← content.css)
│   └── sidepanel/
│       ├── index.html
│       ├── main.ts
│       └── style.css
├── components/
│   └── SidePanel.vue         (← sidepanel.js + sidepanel.html)
├── public/
│   └── icon.png
└── README.md
```

## 🔧 主要改进

### 1. 类型安全

**旧版** (JavaScript):
```javascript
function sendWebSocketMessage(message, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    // ...
  });
}
```

**新版** (TypeScript):
```typescript
function sendWebSocketMessage(message: any, timeoutMs = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    // ...
  });
}
```

### 2. 响应式 UI

**旧版** (原生 JavaScript):
```javascript
// 手动 DOM 操作
const statusText = document.getElementById('status-text');
statusText.textContent = '已连接';

// 需要手动管理状态更新
function updateStatus() {
  const status = getStatus();
  statusText.textContent = status;
}
```

**新版** (Vue 3):
```vue
<script setup lang="ts">
import { ref, computed } from 'vue';

// 响应式数据
const wsStatus = ref<'connected' | 'connecting' | 'disconnected'>('connecting');

// 计算属性自动更新
const wsStatusText = computed(() => {
  switch (wsStatus.value) {
    case 'connected': return '已连接';
    case 'connecting': return '连接中...';
    case 'disconnected': return '未连接';
  }
});
</script>

<template>
  <span>{{ wsStatusText }}</span>
</template>
```

### 3. 组件化架构

**旧版**: 所有逻辑混在一个文件中

**新版**: 清晰的组件结构
- `SidePanel.vue`: 主 UI 组件
- `background.ts`: 后台逻辑
- `content/index.ts`: 内容脚本逻辑

### 4. 开发体验

**旧版**:
- 修改代码后需要手动在 `chrome://extensions/` 点击刷新
- 刷新后需要重新打开 Side Panel
- 刷新正在使用的网页

**新版**:
```bash
npm run chrome:dev
```
- 代码修改后自动热重载
- 保留应用状态
- 开发效率提升 10 倍+

## 🚀 迁移步骤

如果您需要从旧版迁移自定义修改：

### 1. 迁移 Background Script 逻辑

将 `chrome-extension/background.js` 中的自定义逻辑迁移到 `chrome-extension-wxt/entrypoints/background.ts`。

注意事项：
- 使用 TypeScript 语法
- 使用 `defineBackground()` 包装代码
- 保持相同的消息处理逻辑

### 2. 迁移 Content Script 逻辑

将 `chrome-extension/content/content.js` 中的自定义逻辑迁移到 `chrome-extension-wxt/entrypoints/content/index.ts`。

注意事项：
- 使用 `defineContentScript()` 定义入口
- 导入 CSS: `import './style.css'`
- TypeScript 类型定义

### 3. 迁移 Side Panel UI

将 `chrome-extension/sidepanel/` 中的 UI 逻辑迁移到 `chrome-extension-wxt/components/SidePanel.vue`。

步骤：
1. HTML 模板 → `<template>` 部分
2. JavaScript 逻辑 → `<script setup>` 部分
3. CSS 样式 → `<style scoped>` 部分

示例：

**旧版 HTML**:
```html
<button id="start-selection-btn">开始选取</button>
```

**旧版 JavaScript**:
```javascript
const startBtn = document.getElementById('start-selection-btn');
startBtn.addEventListener('click', handleStartSelection);
```

**新版 Vue**:
```vue
<template>
  <button @click="handleStartSelection">开始选取</button>
</template>

<script setup lang="ts">
function handleStartSelection() {
  // ...
}
</script>
```

### 4. 迁移样式

CSS 文件基本保持不变，可以直接复制：
- `content.css` → `entrypoints/content/style.css`
- `sidepanel.css` → 集成到 `SidePanel.vue` 的 `<style scoped>` 中

### 5. 测试

```bash
# 开发模式测试
npm run chrome:dev

# 生产构建测试
npm run chrome:build

# 在 Chrome 中加载
# chrome://extensions/ → 开发者模式 → 加载已解压的扩展程序
# 选择 .output/chrome-mv3/ 目录
```

## ✅ 功能检查清单

迁移后请验证以下功能：

- [ ] 扩展图标显示正常
- [ ] 点击图标打开 Side Panel
- [ ] Side Panel 显示关注问题列表
- [ ] WebSocket 连接状态正确显示
- [ ] 点击"新建笔记"按钮进入选取模式
- [ ] 鼠标悬停高亮元素
- [ ] 键盘导航（方向键）
- [ ] 点击确认选取内容
- [ ] 内容成功发送到 VSCode
- [ ] VSCode 创建新笔记文件

## 🐛 常见问题

### Q: 构建失败，提示找不到 Vue
**A**: 确保已安装依赖：
```bash
npm install
```

### Q: 热重载不工作
**A**: 确保使用开发模式：
```bash
npm run chrome:dev
```
不要使用 `npm run chrome:build`（生产模式）

### Q: Side Panel 空白
**A**: 检查浏览器控制台是否有错误。常见原因：
1. Vue 组件语法错误
2. WebSocket 连接失败
3. 权限配置问题

### Q: 无法连接 VSCode
**A**: 
1. 确保 VSCode 正在运行
2. 确保 Issue Manager 扩展已启用
3. 检查 VSCode 设置中 WebSocket 服务已启用（端口 37892）

## 📚 参考资源

- [WXT 文档](https://wxt.dev/)
- [Vue 3 文档](https://vuejs.org/)
- [TypeScript 手册](https://www.typescriptlang.org/docs/)
- [Chrome 扩展 API](https://developer.chrome.com/docs/extensions/reference/)

## 💡 最佳实践

1. **使用 TypeScript 类型**: 为所有函数和变量添加类型注解
2. **组件化**: 将复杂的 UI 拆分为多个 Vue 组件
3. **响应式数据**: 使用 Vue 的响应式 API 管理状态
4. **错误处理**: 使用 try-catch 处理异步操作
5. **代码格式化**: 使用 ESLint 和 Prettier 保持代码风格一致

## 🎉 总结

新版 Chrome 扩展使用现代化的技术栈，提供了：
- ✅ 更好的开发体验（热重载、类型安全）
- ✅ 更易维护的代码结构（组件化、响应式）
- ✅ 更快的构建速度（Vite）
- ✅ 相同的功能和用户体验

如有问题，请查阅 [Chrome 扩展 README](chrome-extension-wxt/README.md) 或提交 [Issue](https://github.com/wedaren/vscode-issue-manager/issues)。
