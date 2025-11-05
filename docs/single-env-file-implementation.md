# 单个 .env 文件实现方案

## 概述

本文档说明了如何使 VSCode 插件与 Chrome 扩展共用一个 `.env` 配置文件的实现方案。

## 核心原理

### 环境差异

1. **VSCode 插件**:
   - 运行在 Node.js 环境
   - 可以直接访问文件系统
   - 使用 `dotenv` npm 包读取 `.env` 文件
   - 变量加载到 `process.env`

2. **Chrome 扩展**:
   - 运行在浏览器环境
   - 无法直接访问文件系统(安全限制)
   - 使用 WXT + Vite 构建系统
   - 通过 `import.meta.env` 读取环境变量
   - **要求**: 变量必须以 `VITE_` 为前缀

### 解决方案

使用**双前缀策略**,在同一个 `.env` 文件中定义两套变量:

```env
# VSCode 插件使用(通过 dotenv 读取)
VSCODE_WS_PORT=37892
VSCODE_WS_HOST=localhost

# Chrome 扩展使用(通过 Vite 注入)
VITE_VSCODE_WS_PORT=37892
VITE_VSCODE_WS_HOST=localhost
```

## 实现细节

### 1. VSCode 插件侧

#### 使用 dotenv 包

在 `src/config/SharedConfig.ts` 中:

```typescript
import { config as loadEnv } from 'dotenv';

private constructor() {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  this.envFilePath = workspaceRoot 
    ? path.join(workspaceRoot, '.env')
    : '';
  
  // 使用 dotenv 加载 .env 文件
  if (this.envFilePath && fs.existsSync(this.envFilePath)) {
    loadEnv({ path: this.envFilePath });
    console.log('[SharedConfig] 已加载 .env 文件:', this.envFilePath);
  }
}
```

#### 读取环境变量

```typescript
private getConfigValue<T>(
  envKey: string,  // 如 'VSCODE_WS_PORT'
  vscodeConfig: vscode.WorkspaceConfiguration,
  vscodeKey: string,
  defaultValue: T,
  transformer?: (value: any) => T
): T {
  // 1. 优先使用环境变量(dotenv 已加载到 process.env)
  if (process.env[envKey]) {
    const value = process.env[envKey]!;
    return transformer ? transformer(value) : (value as unknown as T);
  }
  
  // 2. 使用 VSCode 配置
  const vscodeValue = vscodeConfig.get<T>(vscodeKey);
  if (vscodeValue !== undefined) {
    return vscodeValue;
  }
  
  // 3. 使用默认值
  return defaultValue;
}
```

### 2. Chrome 扩展侧

#### WXT 自动读取 .env

WXT 基于 Vite,会自动读取项目根目录的 `.env` 文件,并将 `VITE_` 前缀的变量注入到 `import.meta.env`。

在 `chrome-extension-wxt/utils/ChromeConfigManager.ts` 中:

```typescript
private getEnvConfig(): Partial<ChromeConfig> {
  return {
    wsPort: import.meta.env.VITE_VSCODE_WS_PORT 
      ? parseInt(import.meta.env.VITE_VSCODE_WS_PORT) 
      : undefined,
    wsHost: import.meta.env.VITE_VSCODE_WS_HOST || undefined,
    wsPortRangeStart: import.meta.env.VITE_VSCODE_WS_PORT_RANGE_START
      ? parseInt(import.meta.env.VITE_VSCODE_WS_PORT_RANGE_START)
      : undefined,
    wsPortRangeEnd: import.meta.env.VITE_VSCODE_WS_PORT_RANGE_END
      ? parseInt(import.meta.env.VITE_VSCODE_WS_PORT_RANGE_END)
      : undefined,
  };
}
```

#### TypeScript 类型定义

在 `chrome-extension-wxt/globals.d.ts` 中:

```typescript
interface ImportMetaEnv {
  readonly VITE_VSCODE_WS_PORT: string;
  readonly VITE_VSCODE_WS_HOST: string;
  readonly VITE_VSCODE_WS_PORT_RANGE_START: string;
  readonly VITE_VSCODE_WS_PORT_RANGE_END: string;
  // ... 其他变量
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

## .env 文件结构

根目录的 `.env.example`:

```env
# ==============================================
# VSCode 插件配置 (使用 VSCODE_ 前缀)
# ==============================================

# WebSocket 服务配置
VSCODE_WS_PORT=37892
VSCODE_WS_HOST=localhost

# 端口范围(用于自动发现)
VSCODE_WS_PORT_RANGE_START=37892
VSCODE_WS_PORT_RANGE_END=37899

# 功能开关
ENABLE_PORT_DISCOVERY=true
PORT_DISCOVERY_TIMEOUT=1000

# 重试配置
WS_MAX_RETRIES=3
WS_RETRY_DELAY=1000

# 日志级别
LOG_LEVEL=info

# ==============================================
# Chrome 扩展配置 (使用 VITE_ 前缀)
# ==============================================

# WebSocket 连接配置
VITE_VSCODE_WS_PORT=37892
VITE_VSCODE_WS_HOST=localhost
VITE_VSCODE_WS_PORT_RANGE_START=37892
VITE_VSCODE_WS_PORT_RANGE_END=37899

# Chrome 特定功能
VITE_ENABLE_DEBUG=false
VITE_ENABLE_AUTO_SYNC=true
VITE_SYNC_INTERVAL=5000
```

## 配置优先级

### VSCode 插件

1. **环境变量** (process.env, 含 .env 文件)
2. **VSCode 设置** (settings.json)
3. **默认值** (代码中定义)

### Chrome 扩展

1. **Chrome Storage** (运行时存储)
2. **环境变量** (import.meta.env, 构建时注入)
3. **默认值** (代码中定义)

## 使用方式

### 开发流程

1. 复制 `.env.example` 为 `.env`:
   ```bash
   cp .env.example .env
   ```

2. 根据需要修改 `.env` 中的配置

3. **VSCode 插件**:
   - 重启 VSCode 或重新加载窗口使配置生效
   - SharedConfig 会在启动时自动加载

4. **Chrome 扩展**:
   - 重新构建扩展: `npm run dev` (开发) 或 `npm run build` (生产)
   - Vite 会在构建时注入环境变量

### 动态配置

除了 `.env` 文件,两个系统还支持动态配置:

- **VSCode**: 可通过 VSCode 设置面板修改
- **Chrome**: 通过 WebSocket 接收 VSCode 的运行时配置

## 技术要点

### 为什么需要双前缀?

1. **Node.js 环境**: `dotenv` 可以读取任何前缀的变量
2. **Vite 环境**: 出于安全考虑,只注入 `VITE_` 前缀的变量到客户端代码

### WXT 如何读取 .env?

WXT 基于 Vite 的构建系统:

1. **自动查找**: WXT/Vite 自动从项目根目录读取 `.env` 文件
2. **构建时注入**: 将 `VITE_` 前缀的变量替换为实际值
3. **类型安全**: 通过 `globals.d.ts` 提供 TypeScript 类型

### 不需要 chrome-config.json

之前的设计导出 `chrome-config.json` 文件,现在不再需要:

- **.env 文件**: 提供构建时配置
- **WebSocket 同步**: 提供运行时配置
- **Chrome Storage**: 持久化用户设置

## 文件清单

```
vscode-issue-manager/
├── .env.example                          # 配置模板
├── .env                                   # 实际配置(不纳入版本控制)
├── src/
│   └── config/
│       └── SharedConfig.ts                # VSCode 配置管理器(使用 dotenv)
└── chrome-extension-wxt/
    ├── utils/
    │   └── ChromeConfigManager.ts         # Chrome 配置管理器
    └── globals.d.ts                       # TypeScript 类型定义
```

## 常见问题

### Q: 为什么要保留值重复(37892 写两次)?

A: 两个系统读取不同的变量名:
- VSCode 读取 `VSCODE_WS_PORT`
- Chrome 读取 `VITE_VSCODE_WS_PORT`

虽然值相同,但变量名不同,这是由技术限制决定的。

### Q: 能否让 Chrome 直接读取 VSCODE_ 前缀的变量?

A: 不能。Vite 出于安全考虑,只会注入 `VITE_` 前缀的变量。这是 Vite 的设计决策,防止意外暴露敏感环境变量到客户端代码。

### Q: 修改 .env 后需要重启什么?

A: 
- **VSCode 插件**: 重启 VSCode 或重新加载窗口
- **Chrome 扩展**: 重新构建(`npm run dev` 或 `npm run build`)

### Q: 可以只使用 .env 不用 VSCode 设置吗?

A: 可以。配置优先级中 `.env` 优先级高于 VSCode 设置。但建议保留 VSCode 设置作为备用方案。

## 总结

通过双前缀策略,我们成功实现了:

1. ✅ **单一配置源**: 一个 `.env` 文件
2. ✅ **技术兼容**: 兼容 Node.js 和浏览器环境
3. ✅ **类型安全**: TypeScript 完整支持
4. ✅ **开发便利**: 统一管理,减少重复

这个方案充分利用了现有工具链的能力(dotenv 和 Vite),避免了自定义复杂的配置同步机制。
