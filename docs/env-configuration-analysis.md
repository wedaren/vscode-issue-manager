# 环境配置文件分析与开发环境支持方案

## 📊 当前架构分析

### 1. VSCode 插件端环境变量使用

#### 配置加载流程
```
.env 文件 (项目根目录)
    ↓
dotenv 包加载到 process.env
    ↓
SharedConfig.getConfigValue()
    ↓
配置优先级: process.env > VSCode Settings > 默认值
```

#### 关键文件
- **配置文件**: `/Users/wedaren/.../vscode-issue-manager/.env`
- **管理类**: `src/config/SharedConfig.ts`
- **加载方式**: 使用 `dotenv` npm 包
- **访问方式**: `process.env.WS_PORT` 等

#### 配置优先级
1. 🥇 **环境变量** (`process.env`，包括 `.env` 文件内容)
2. 🥈 **VSCode 设置** (`settings.json`)
3. 🥉 **默认值** (硬编码在 `SharedConfig.ts`)

#### 支持的变量前缀
- `WS_*` - WebSocket 相关配置
- `ENABLE_*` - 功能开关
- `PORT_*` - 端口相关配置
- `LOG_*` - 日志相关配置
- `CHROME_*` - Chrome 扩展特定配置

### 2. Chrome 扩展端环境变量使用

#### 配置加载流程
```
.env 文件 (项目根目录)
    ↓
WXT/Vite 构建时读取
    ↓
envPrefix 过滤 (wxt.config.ts)
    ↓
注入到 import.meta.env
    ↓
ChromeConfigManager.getEnvConfig()
    ↓
配置优先级: Chrome Storage > import.meta.env > 默认值
```

#### 关键文件
- **配置文件**: 同样是根目录的 `.env`
- **管理类**: `chrome-extension-wxt/utils/ChromeConfigManager.ts`
- **构建配置**: `wxt.config.ts`
- **类型定义**: `chrome-extension-wxt/globals.d.ts`
- **访问方式**: `import.meta.env.WS_PORT` 等

#### 配置优先级
1. 🥇 **Chrome Storage** (运行时保存的用户配置)
2. 🥈 **环境变量** (`import.meta.env`，构建时注入)
3. 🥉 **默认值** (硬编码在 `ChromeConfigManager.ts`)

#### envPrefix 配置
```typescript
// wxt.config.ts
envPrefix: ['VITE_', 'WS_', 'ENABLE_', 'PORT_', 'LOG_', 'CHROME_']
```

只有这些前缀的环境变量会被注入到 Chrome 扩展。

### 3. 当前 .env 文件特点

#### 文件位置
- 📁 **路径**: 项目根目录 `/vscode-issue-manager/.env`
- ✅ **提交到 Git**: 是（因为只包含默认配置，无敏感信息）
- 🔄 **共享**: VSCode 插件和 Chrome 扩展共用

#### 配置内容
```env
# WebSocket 服务配置
WS_PORT=37895
WS_HOST=localhost
WS_PORT_RANGE_START=37895
WS_PORT_RANGE_END=37899

# 功能开关
ENABLE_PORT_DISCOVERY=true
PORT_DISCOVERY_TIMEOUT=1000

# 连接与重试配置
WS_MAX_RETRIES=3
WS_RETRY_DELAY=1000

# 日志配置
LOG_LEVEL=info
```

#### 设计特点
- ✅ 使用语义化前缀避免冲突
- ✅ 不包含敏感信息
- ✅ 两端共用，避免重复配置
- ✅ 清晰的注释和分组

## 🎯 增加开发环境支持的需求分析

### 典型开发场景需求
1. **端口区分**: 开发环境使用不同的端口，避免与生产环境冲突
2. **日志级别**: 开发时使用 `debug` 级别，生产使用 `info`
3. **调试功能**: 开发时启用额外的调试功能
4. **个人配置**: 每个开发者可能需要不同的配置

### Vite 环境文件支持

Vite 原生支持多个环境文件，加载顺序：

```
.env                  # 所有环境加载
.env.local            # 所有环境加载，git 忽略
.env.[mode]           # 指定模式加载
.env.[mode].local     # 指定模式加载，git 忽略
```

优先级: `.env.[mode].local` > `.env.[mode]` > `.env.local` > `.env`

### dotenv 多环境支持

dotenv 也支持多个文件，但需要手动指定：

```typescript
// 可以手动加载多个文件
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local', override: true });
dotenv.config({ path: '.env.development', override: true });
```

## 💡 推荐方案：多环境 env 文件支持

### 方案概述

采用 Vite 标准的多环境文件方案，支持以下文件：

```
.env                    # 基础配置（提交到 Git）
.env.local              # 本地覆盖配置（不提交）
.env.development        # 开发环境配置（提交到 Git）
.env.development.local  # 开发环境本地覆盖（不提交）
.env.production         # 生产环境配置（提交到 Git）
```

### 文件规划

#### .env (基础配置)
```env
# ============================================
# Issue Manager 基础配置
# ============================================
# 此文件包含所有环境共用的默认配置
# 提交到 Git

# WebSocket 服务配置
WS_PORT=37892
WS_HOST=localhost
WS_PORT_RANGE_START=37892
WS_PORT_RANGE_END=37899

# 功能开关
ENABLE_PORT_DISCOVERY=true
PORT_DISCOVERY_TIMEOUT=1000

# 连接与重试配置
WS_MAX_RETRIES=3
WS_RETRY_DELAY=1000

# 日志配置
LOG_LEVEL=info
```

#### .env.development (开发环境)
```env
# ============================================
# Issue Manager 开发环境配置
# ============================================
# 此文件用于开发环境的特定配置
# 提交到 Git，团队共享

# 开发环境使用不同的端口，避免冲突
WS_PORT=37895
WS_PORT_RANGE_START=37895
WS_PORT_RANGE_END=37899

# 开发环境启用详细日志
LOG_LEVEL=debug

# 开发环境的调试功能
ENABLE_DEBUG_PANEL=true
ENABLE_HOT_RELOAD=true

# 更快的超时时间（开发时更快失败）
PORT_DISCOVERY_TIMEOUT=500
WS_RETRY_DELAY=500
```

#### .env.production (生产环境)
```env
# ============================================
# Issue Manager 生产环境配置
# ============================================
# 此文件用于生产环境（打包发布）的配置
# 提交到 Git

# 生产环境使用标准端口
WS_PORT=37892

# 生产环境使用较少的日志
LOG_LEVEL=warn

# 生产环境禁用调试功能
ENABLE_DEBUG_PANEL=false
ENABLE_HOT_RELOAD=false

# 更长的超时时间（更稳定）
PORT_DISCOVERY_TIMEOUT=2000
WS_RETRY_DELAY=1000
WS_MAX_RETRIES=5
```

#### .env.local (个人配置 - 示例)
```env
# ============================================
# Issue Manager 本地配置
# ============================================
# 此文件用于个人开发配置
# 不提交到 Git (在 .gitignore 中排除)
# 复制 .env.local.example 并根据需要修改

# 个人开发端口（如果与团队默认端口冲突）
WS_PORT=37900

# 个人日志级别偏好
LOG_LEVEL=debug

# 个人调试偏好
ENABLE_VERBOSE_LOGGING=true
```

#### .env.local.example (本地配置模板)
```env
# ============================================
# Issue Manager 本地配置示例
# ============================================
# 复制此文件为 .env.local 并根据需要修改
# .env.local 不会提交到 Git

# 示例：使用不同的端口
# WS_PORT=37900

# 示例：启用详细日志
# LOG_LEVEL=debug

# 示例：启用额外调试功能
# ENABLE_VERBOSE_LOGGING=true
```

### 实现步骤

#### 步骤 1: 更新 .gitignore

```gitignore
# 环境配置文件
# 基础配置和环境特定配置提交到 Git
# 本地覆盖配置不提交
*.local
.env.local
.env.*.local

# 保留示例文件
!.env.local.example
```

#### 步骤 2: 修改 VSCode 插件配置加载

更新 `src/config/SharedConfig.ts`:

```typescript
private constructor() {
  let extensionEnvPath = '';
  
  if (SharedConfig.extensionContext) {
    const extensionPath = SharedConfig.extensionContext.extensionPath;
    
    // 确定运行模式（开发/生产）
    const mode = this.getMode();
    
    // 按优先级加载多个 .env 文件
    // Vite 标准: .env.[mode].local > .env.[mode] > .env.local > .env
    const envFiles = [
      path.join(extensionPath, '.env'),
      path.join(extensionPath, '.env.local'),
      path.join(extensionPath, `.env.${mode}`),
      path.join(extensionPath, `.env.${mode}.local`)
    ];
    
    // 按顺序加载，后面的会覆盖前面的
    for (const envFile of envFiles) {
      if (fs.existsSync(envFile)) {
        loadEnv({ path: envFile, override: true });
        this.logger.info(`[SharedConfig] 已加载配置文件: ${path.basename(envFile)}`);
      }
    }
    
    extensionEnvPath = extensionPath;
  } else {
    // 开发模式：向上查找
    // ...现有代码...
  }
  
  this.envFilePath = extensionEnvPath;
}

/**
 * 获取运行模式
 */
private getMode(): string {
  // 1. 环境变量指定
  if (process.env.NODE_ENV) {
    return process.env.NODE_ENV;
  }
  
  // 2. 根据扩展上下文判断
  if (SharedConfig.extensionContext) {
    const extensionMode = SharedConfig.extensionContext.extensionMode;
    // vscode.ExtensionMode.Development = 2
    // vscode.ExtensionMode.Production = 1
    return extensionMode === 2 ? 'development' : 'production';
  }
  
  // 3. 默认为开发模式
  return 'development';
}
```

#### 步骤 3: 更新 Chrome 扩展配置

Vite/WXT 已经原生支持多环境文件，不需要修改 `wxt.config.ts`。

但需要在 `package.json` 中指定模式:

```json
{
  "scripts": {
    "chrome:dev": "wxt --mode development",
    "chrome:build": "wxt build --mode production",
    "chrome:build:dev": "wxt build --mode development"
  }
}
```

#### 步骤 4: 添加环境检测工具

创建 `src/utils/EnvironmentDetector.ts`:

```typescript
import * as vscode from 'vscode';

export class EnvironmentDetector {
  /**
   * 获取当前运行模式
   */
  static getMode(context: vscode.ExtensionContext): 'development' | 'production' {
    // 1. 环境变量
    if (process.env.NODE_ENV === 'production') {
      return 'production';
    }
    if (process.env.NODE_ENV === 'development') {
      return 'development';
    }
    
    // 2. 扩展模式
    if (context.extensionMode === vscode.ExtensionMode.Development) {
      return 'development';
    }
    
    // 3. 默认生产模式（已打包发布）
    return 'production';
  }
  
  /**
   * 是否为开发模式
   */
  static isDevelopment(context: vscode.ExtensionContext): boolean {
    return this.getMode(context) === 'development';
  }
  
  /**
   * 是否为生产模式
   */
  static isProduction(context: vscode.ExtensionContext): boolean {
    return this.getMode(context) === 'production';
  }
}
```

### 配置优先级总结

#### VSCode 插件端
```
命令行环境变量 (NODE_ENV)
    ↓
.env.[mode].local (如 .env.development.local)
    ↓
.env.[mode] (如 .env.development)
    ↓
.env.local
    ↓
.env
    ↓
VSCode Settings (settings.json)
    ↓
默认值 (代码中)
```

#### Chrome 扩展端
```
Chrome Storage (用户运行时保存)
    ↓
.env.[mode].local (构建时)
    ↓
.env.[mode] (构建时)
    ↓
.env.local (构建时)
    ↓
.env (构建时)
    ↓
默认值 (代码中)
```

## 🔧 使用指南

### 开发者工作流

#### 首次设置
```bash
# 1. 克隆仓库后，复制本地配置模板
cp .env.local.example .env.local

# 2. 根据需要修改 .env.local
vim .env.local  # 或使用其他编辑器

# 3. 启动开发环境
npm run watch           # VSCode 插件开发
npm run chrome:dev      # Chrome 扩展开发
```

#### 切换环境
```bash
# 开发模式（使用 .env.development）
npm run chrome:dev

# 生产构建（使用 .env.production）
npm run chrome:build
```

#### 个人配置
如果需要覆盖团队配置，编辑 `.env.local`:
```env
# 使用不同的端口避免冲突
WS_PORT=37900

# 启用详细日志
LOG_LEVEL=debug
```

### 团队协作

#### 提交规则
- ✅ 提交 `.env` - 基础默认配置
- ✅ 提交 `.env.development` - 开发环境配置
- ✅ 提交 `.env.production` - 生产环境配置
- ✅ 提交 `.env.local.example` - 本地配置模板
- ❌ 不提交 `.env.local` - 个人配置
- ❌ 不提交 `.env.*.local` - 个人环境配置

#### 新增配置项流程
1. 在 `.env` 中添加默认值和注释
2. 如果开发/生产环境需要不同值，分别在 `.env.development` 和 `.env.production` 中设置
3. 如果是可选配置，在 `.env.local.example` 中添加示例
4. 更新文档说明新配置项

## 📋 配置项清单

### 当前支持的配置项

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `WS_PORT` | number | 37892 | WebSocket 服务端口 |
| `WS_HOST` | string | localhost | WebSocket 服务主机 |
| `WS_PORT_RANGE_START` | number | 37892 | 端口范围起始 |
| `WS_PORT_RANGE_END` | number | 37899 | 端口范围结束 |
| `ENABLE_PORT_DISCOVERY` | boolean | true | 启用端口自动发现 |
| `PORT_DISCOVERY_TIMEOUT` | number | 1000 | 端口发现超时(ms) |
| `WS_MAX_RETRIES` | number | 3 | WebSocket 最大重试次数 |
| `WS_RETRY_DELAY` | number | 1000 | 重试延迟(ms) |
| `LOG_LEVEL` | string | info | 日志级别 |

### 建议新增的开发配置项

| 配置项 | 类型 | 开发默认值 | 生产默认值 | 说明 |
|--------|------|-----------|-----------|------|
| `ENABLE_DEBUG_PANEL` | boolean | true | false | 启用调试面板 |
| `ENABLE_HOT_RELOAD` | boolean | true | false | 启用热重载 |
| `ENABLE_VERBOSE_LOGGING` | boolean | true | false | 启用详细日志 |
| `WS_HEARTBEAT_INTERVAL` | number | 5000 | 30000 | 心跳间隔(ms) |

## ⚠️ 注意事项

### 安全性
1. ❌ **不要在 .env 文件中存储敏感信息**（API 密钥、密码等）
2. ✅ 敏感信息应使用 VSCode 的 SecretStorage API
3. ✅ `.env` 文件中的所有内容在 Chrome 扩展中都是公开的

### Git 管理
1. ✅ 基础配置文件提交到 Git，方便团队协作
2. ❌ 个人配置文件（`.local`）不提交，避免冲突
3. ✅ 提供 `.example` 文件作为模板

### 构建和部署
1. VSCode 插件构建时会将 `.env` 文件打包到扩展中
2. Chrome 扩展构建时会将环境变量注入到代码中
3. 生产构建应使用 `.env.production` 配置

### 调试
如果配置没有生效，检查：
1. 文件名是否正确（`.env` 不是 `env`）
2. 变量前缀是否在 `envPrefix` 中
3. 是否重启了 VSCode 或重新构建了 Chrome 扩展
4. 配置优先级是否被更高优先级的配置覆盖

## 🚀 实施计划

### 阶段 1: 基础支持 (v1)
- [ ] 创建 `.env.development` 文件
- [ ] 创建 `.env.production` 文件
- [ ] 创建 `.env.local.example` 文件
- [ ] 更新 `.gitignore`
- [ ] 更新 `SharedConfig.ts` 支持多文件加载
- [ ] 更新 `package.json` 脚本

### 阶段 2: 增强功能 (v2)
- [ ] 添加 `EnvironmentDetector` 工具类
- [ ] 在 VSCode 插件中显示当前环境
- [ ] 在 Chrome 扩展中显示当前环境
- [ ] 添加环境切换命令

### 阶段 3: 文档和测试 (v3)
- [ ] 编写完整的配置文档
- [ ] 添加环境配置测试
- [ ] 更新 README.md
- [ ] 团队培训

## 📚 参考资料

- [Vite 环境变量文档](https://vitejs.dev/guide/env-and-mode.html)
- [dotenv 文档](https://github.com/motdotla/dotenv)
- [WXT 配置文档](https://wxt.dev/guide/essentials/config.html)
- [VSCode 扩展开发文档](https://code.visualstudio.com/api)
