# WXT 环境变量支持说明

## 概述

WXT 框架完全支持通过 `.env` 文件来配置环境变量。这是基于 Vite 的功能实现的。

## 🎯 工作原理

### WXT + Vite 构建流程

```
.env 文件
   ↓
Vite 读取并处理
   ↓
以 VITE_ 开头的变量被注入
   ↓
通过 import.meta.env 访问
   ↓
编译到最终代码中
```

## 📝 使用方法

### 1. 创建 .env 文件

在 `chrome-extension-wxt` 目录下创建 `.env` 文件：

```bash
cd chrome-extension-wxt
cp .env.example .env
```

### 2. 配置环境变量

**重要**：所有暴露给客户端的环境变量必须以 `VITE_` 开头！

```bash
# chrome-extension-wxt/.env

# ✅ 正确：以 VITE_ 开头
VITE_VSCODE_WS_PORT=37892
VITE_VSCODE_WS_HOST=localhost

# ❌ 错误：不会被注入到客户端代码
VSCODE_WS_PORT=37892
```

### 3. 在代码中访问

使用 `import.meta.env` 访问环境变量：

```typescript
// ✅ 正确
const port = import.meta.env.VITE_VSCODE_WS_PORT;
const host = import.meta.env.VITE_VSCODE_WS_HOST;

// ❌ 错误：process.env 在浏览器环境中不可用
const port = process.env.VITE_VSCODE_WS_PORT;
```

### 4. 类型定义

在 `globals.d.ts` 中添加类型定义：

```typescript
interface ImportMetaEnv {
  readonly VITE_VSCODE_WS_PORT?: string;
  readonly VITE_VSCODE_WS_HOST?: string;
  // ... 其他环境变量
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

## 🔍 配置优先级

我们的配置系统支持多层配置：

```
1. Chrome Storage (最高优先级)
   ↓ 如果不存在
2. 环境变量 (.env 文件)
   ↓ 如果不存在
3. 默认配置
```

### 代码示例

```typescript
export class ChromeConfigManager {
  public async load(): Promise<ChromeConfig> {
    // 1. 尝试从 Chrome Storage 读取
    const storageConfig = await this.loadFromStorage();
    if (storageConfig) {
      return storageConfig;
    }

    // 2. 尝试从环境变量读取
    const envConfig = this.getEnvConfig();
    if (Object.keys(envConfig).length > 0) {
      return { websocket: { ...defaultConfig, ...envConfig } };
    }

    // 3. 使用默认配置
    return this.getDefaultConfig();
  }

  private getEnvConfig(): Partial<WebSocketConfig> {
    const env = import.meta.env;
    return {
      port: env.VITE_VSCODE_WS_PORT ? parseInt(env.VITE_VSCODE_WS_PORT) : undefined,
      host: env.VITE_VSCODE_WS_HOST,
      // ...
    };
  }
}
```

## 🚀 开发工作流

### 开发环境

1. 创建 `.env` 文件：
```bash
cp .env.example .env
```

2. 修改配置：
```bash
# .env
VITE_VSCODE_WS_PORT=37892
VITE_ENABLE_PORT_DISCOVERY=true
```

3. 启动开发服务器：
```bash
npm run chrome:dev
```

**注意**：修改 `.env` 后需要重新运行 `npm run chrome:dev`。

### 生产构建

环境变量会被编译到最终的代码中：

```bash
npm run chrome:build
```

构建后的代码中，`import.meta.env.VITE_XXX` 会被替换为实际的值。

## 📋 环境变量列表

| 变量名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `VITE_VSCODE_WS_PORT` | string | 37892 | WebSocket 端口 |
| `VITE_VSCODE_WS_HOST` | string | localhost | WebSocket 主机 |
| `VITE_VSCODE_WS_PORT_RANGE_START` | string | 37892 | 端口范围起始 |
| `VITE_VSCODE_WS_PORT_RANGE_END` | string | 37899 | 端口范围结束 |
| `VITE_ENABLE_PORT_DISCOVERY` | string | true | 是否启用端口自动发现 |
| `VITE_PORT_DISCOVERY_TIMEOUT` | string | 1000 | 端口发现超时（毫秒）|
| `VITE_WS_MAX_RETRIES` | string | 3 | 最大重试次数 |
| `VITE_WS_RETRY_DELAY` | string | 1000 | 重试延迟（毫秒）|
| `VITE_LOG_LEVEL` | string | info | 日志级别 |

## ⚠️ 注意事项

### 1. VITE_ 前缀是必须的

只有以 `VITE_` 开头的变量才会被注入到客户端代码中。这是 Vite 的安全机制。

### 2. 环境变量是字符串

所有通过 `import.meta.env` 获取的值都是字符串类型，需要手动转换：

```typescript
// ✅ 正确：转换类型
const port = parseInt(import.meta.env.VITE_VSCODE_WS_PORT || '37892');
const enabled = import.meta.env.VITE_ENABLE_PORT_DISCOVERY === 'true';

// ❌ 错误：直接使用
const port = import.meta.env.VITE_VSCODE_WS_PORT; // 类型是 string
```

### 3. 构建时替换

环境变量在构建时会被替换为实际的值，所以：

```typescript
// 这样的代码不会工作
const key = 'VITE_VSCODE_WS_PORT';
const value = import.meta.env[key]; // ❌ 不会被 Vite 处理

// 必须直接访问
const value = import.meta.env.VITE_VSCODE_WS_PORT; // ✅ 正确
```

### 4. 敏感信息

不要在 `.env` 文件中存储敏感信息！这些值会被编译到客户端代码中，用户可以在浏览器中查看。

```bash
# ❌ 不要这样做
VITE_API_SECRET=my-secret-key

# ✅ 可以存储公开信息
VITE_API_URL=https://api.example.com
```

## 🔗 参考资源

- [WXT 环境变量文档](https://wxt.dev/guide/essentials/config.html#environment-variables)
- [Vite 环境变量文档](https://vitejs.dev/guide/env-and-mode.html)
- [Chrome 扩展最佳实践](https://developer.chrome.com/docs/extensions/mv3/getstarted/)

## 📦 完整示例

### .env 文件

```bash
# chrome-extension-wxt/.env
VITE_VSCODE_WS_PORT=37892
VITE_VSCODE_WS_HOST=localhost
VITE_VSCODE_WS_PORT_RANGE_START=37892
VITE_VSCODE_WS_PORT_RANGE_END=37899
VITE_ENABLE_PORT_DISCOVERY=true
VITE_PORT_DISCOVERY_TIMEOUT=1000
VITE_WS_MAX_RETRIES=3
VITE_WS_RETRY_DELAY=1000
VITE_LOG_LEVEL=debug
```

### 配置管理器

```typescript
// utils/ChromeConfigManager.ts
private getEnvConfig(): Partial<WebSocketConfig> {
  const env = import.meta.env;
  
  const config: Partial<WebSocketConfig> = {};
  
  if (env.VITE_VSCODE_WS_PORT) {
    config.port = parseInt(env.VITE_VSCODE_WS_PORT);
  }
  
  if (env.VITE_VSCODE_WS_HOST) {
    config.host = env.VITE_VSCODE_WS_HOST;
  }
  
  if (env.VITE_ENABLE_PORT_DISCOVERY === 'true') {
    config.enablePortDiscovery = true;
  }
  
  return config;
}
```

### 类型定义

```typescript
// globals.d.ts
interface ImportMetaEnv {
  readonly VITE_VSCODE_WS_PORT?: string;
  readonly VITE_VSCODE_WS_HOST?: string;
  readonly VITE_ENABLE_PORT_DISCOVERY?: string;
  // ...
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

---

**最后更新**: 2025年11月5日
