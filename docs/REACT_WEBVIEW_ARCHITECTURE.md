# React Webview 架构指南

本项目使用一套通用的 React + TypeScript 架构来开发 VS Code Webview 面板。这使得我们可以像开发普通 SPA 应用一样开发 VS Code 扩展的 UI，并复用组件和通信逻辑。

## 目录结构

所有 React 相关的 Webview 代码都位于 `src/webview/` 目录下：

```
src/webview/
├── ReactWebviewHost.ts       # [核心] 生成 Webview HTML 的通用工具，负责注入 Bundle 和初始状态
├── webviewTypes.ts           # [核心] 前后端共享的消息类型定义
├── react/
│   ├── common/               # 通用 React Hooks 和工具
│   │   ├── vscodeApi.ts      # 封装 acquireVsCodeApi
│   │   └── useVsCodeMessages.ts # 封装消息通信 Hook
│   ├── entrypoints/          # 各 Webview 的入口文件（ReactDOM.render）
│   │   └── mindmapMain.tsx   # 示例：思维导图入口
│   └── mindmap/              # 具体业务的 React 组件
│       └── MindMapApp.tsx    # 示例：思维导图根组件
```

## 如何添加一个新的 React Webview

### 1. 定义消息类型
在 `src/webview/webviewTypes.ts` 中定义你的 Webview 需要的消息类型：

```typescript
// 定义前端 -> 扩展的消息
export type MyWebviewFromWebviewMessage = 
  | { type: 'myAction'; payload: string };

// 定义扩展 -> 前端的消息
export type MyWebviewToWebviewMessage = 
  | { type: 'updateData'; data: any };
```

### 2. 创建 React 组件
在 `src/webview/react/` 下新建你的业务目录（如 `myview/`），并创建根组件：

```tsx
// src/webview/react/myview/MyApp.tsx
import React from 'react';
import { useVsCodeMessages } from '../common/useVsCodeMessages';
import { MyWebviewToWebviewMessage, MyWebviewFromWebviewMessage } from '../../webviewTypes';

export const MyApp = () => {
  const { postMessage } = useVsCodeMessages<MyWebviewToWebviewMessage, MyWebviewFromWebviewMessage>(
    (message) => {
      if (message.type === 'updateData') {
        console.log('Received data:', message.data);
      }
    }
  );

  return <button onClick={() => postMessage({ type: 'myAction', payload: 'hello' })}>Click Me</button>;
};
```

### 3. 创建入口文件
在 `src/webview/react/entrypoints/` 下创建入口文件（如 `myViewMain.tsx`）：

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { MyApp } from '../myview/MyApp';

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<MyApp />);
```

### 4. 配置 Webpack
在 `webpack.config.js` 的 `webviewReactConfig.entry` 中添加你的入口：

```javascript
const webviewReactConfig = {
  // ...
  entry: {
    mindmapWebview: './src/webview/react/entrypoints/mindmapMain.tsx',
    myViewWebview: './src/webview/react/entrypoints/myViewMain.tsx', // 新增
  },
  // ...
};
```

### 5. 创建 Webview Panel 类
参考 `src/webview/MindMapPanel.ts`，使用 `getReactWebviewHtml` 工具：

```typescript
import { getReactWebviewHtml } from './ReactWebviewHost';

// ... 在你的 Panel 类中
private _getHtmlForWebview(webview: vscode.Webview) {
  return getReactWebviewHtml({
    webview,
    extensionUri: this._extensionUri,
    bundlePath: 'dist/webview/myViewWebview.js', // 对应 webpack output
    title: 'My View',
    initialState: { someData: 'initial value' } // 可选初始数据
  });
}
```

## 开发与调试

- 运行 `npm run watch` 即可同时监听扩展主进程和 Webview React 代码的变更。
- React 代码中的 `console.log` 会输出到 "Developer Tools" 控制台（`Help > Toggle Developer Tools`）。

