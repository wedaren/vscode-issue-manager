# 多环境配置使用指南

## 📁 配置文件说明

项目现在支持多环境配置文件，遵循 Vite 标准：

```
.env                    # 基础配置（提交到 Git）
.env.development        # 开发环境配置（提交到 Git）- ✨ 新增
.env.local              # 本地覆盖配置（不提交）
.env.local.example      # 本地配置模板（提交到 Git）- ✨ 新增
```

## 🎯 开发环境特性

`.env.development` 文件为开发环境提供了以下特性：

### 1. 使用不同端口
```env
WS_PORT=37895  # 开发端口，避免与生产环境冲突
```

### 2. 启用 debug 日志
```env
LOG_LEVEL=debug  # 输出详细的调试日志
```

### 3. 更快的超时设置
```env
PORT_DISCOVERY_TIMEOUT=500  # 500ms (生产环境: 1000ms)
WS_RETRY_DELAY=500          # 500ms (生产环境: 1000ms)
```

### 4. 启用开发功能
```env
ENABLE_VERBOSE_LOGGING=true         # 详细日志
ENABLE_PERFORMANCE_MONITORING=true  # 性能监控
```

## 🔧 使用方法

### VSCode 插件开发

开发时会自动加载 `.env.development`：

```bash
# 启动开发监视
npm run watch

# 在 VSCode 中按 F5 启动调试
# 插件会自动检测到开发模式并加载 .env.development
```

### Chrome 扩展开发

```bash
# 开发模式（使用 .env.development）
npm run chrome:dev

# 生产构建（使用 .env）
npm run chrome:build

# 开发构建（使用 .env.development）
npm run chrome:build:dev
```

### 个人配置

如果需要覆盖团队配置，创建 `.env.local` 文件：

```bash
# 1. 复制模板
cp .env.local.example .env.local

# 2. 编辑配置（去掉 # 号启用）
vim .env.local

# 3. 示例配置
WS_PORT=37900           # 使用不同端口
LOG_LEVEL=debug         # 启用 debug 日志
```

**注意**: `.env.local` 不会提交到 Git，仅用于个人开发配置。

## 📊 配置优先级

### VSCode 插件端

```
命令行环境变量 (NODE_ENV)
    ↓
.env.development.local (个人开发配置)
    ↓
.env.development (团队开发配置) ← 当前使用
    ↓
.env.local (个人配置)
    ↓
.env (基础配置)
    ↓
VSCode Settings (settings.json)
    ↓
默认值
```

### Chrome 扩展端

```
Chrome Storage (运行时保存)
    ↓
.env.development (构建时注入) ← 当前使用
    ↓
.env (构建时注入)
    ↓
默认值
```

## 🔍 如何判断当前环境

### VSCode 插件

插件会在启动时输出当前模式：

```
[SharedConfig] 已加载配置文件: .env
[SharedConfig] 已加载配置文件: .env.development
[SharedConfig] 当前运行模式: development
```

### Chrome 扩展

在浏览器控制台查看：

```javascript
console.log('Current mode:', import.meta.env.MODE);
console.log('WS_PORT:', import.meta.env.WS_PORT);
console.log('LOG_LEVEL:', import.meta.env.LOG_LEVEL);
```

## 🚀 快速开始

### 新开发者设置流程

```bash
# 1. 克隆仓库
git clone <repository-url>
cd vscode-issue-manager

# 2. 安装依赖
npm install

# 3. (可选) 创建个人配置
cp .env.local.example .env.local
# 然后编辑 .env.local

# 4. 启动开发
npm run watch           # VSCode 插件
npm run chrome:dev      # Chrome 扩展
```

开发环境会自动使用：
- ✅ 端口 37895（而不是生产的 37892）
- ✅ debug 日志级别
- ✅ 更快的超时设置
- ✅ 开发调试功能

## ⚙️ 配置文件详解

### .env (基础配置)
包含所有环境共用的默认配置，已提交到 Git。

### .env.development (开发环境)
包含开发环境特定的配置：
- 使用端口 37895
- 启用 debug 日志
- 更快的超时时间
- 启用开发功能

### .env.local (个人配置)
用于个人开发配置，不提交到 Git。
复制 `.env.local.example` 创建。

### .env.local.example (配置模板)
个人配置的模板文件，包含示例配置。

## ❓ 常见问题

### Q: 如何切换到生产模式？

A: VSCode 插件会自动检测扩展模式。对于 Chrome 扩展：
```bash
npm run chrome:build  # 生产构建
```

### Q: 配置没有生效怎么办？

A: 检查以下几点：
1. 文件名是否正确（`.env` 不是 `env`）
2. 变量前缀是否正确（如 `WS_PORT` 不是 `PORT`）
3. 是否重启了 VSCode 或重新构建了 Chrome 扩展
4. 检查配置优先级，是否被更高优先级的配置覆盖

### Q: 开发时端口冲突怎么办？

A: 创建 `.env.local` 并使用不同端口：
```env
WS_PORT=37900
WS_PORT_RANGE_START=37900
WS_PORT_RANGE_END=37909
```

### Q: 如何查看当前使用的配置？

A: VSCode 插件会在输出面板显示加载的配置文件。
Chrome 扩展可以在控制台查看 `import.meta.env`。

## 📝 最佳实践

1. ✅ **不要修改 .env** - 它是团队共享的基础配置
2. ✅ **提交 .env.development** - 团队成员需要相同的开发配置
3. ✅ **不要提交 .env.local** - 这是个人配置
4. ✅ **使用 .env.local.example** - 为团队成员提供配置模板
5. ✅ **添加注释** - 在配置文件中说明每个配置项的用途
6. ❌ **不要存储敏感信息** - env 文件中的内容会被打包到扩展中

## 🔐 安全提醒

⚠️ **重要**: 环境变量会被注入到 Chrome 扩展的代码中，是公开可见的。

不要在 .env 文件中存储：
- ❌ API 密钥
- ❌ 密码
- ❌ 私钥
- ❌ 任何敏感信息

敏感信息应该使用 VSCode 的 SecretStorage API 或其他安全机制。

## 📚 更多信息

- 详细分析文档: [env-configuration-analysis.md](./env-configuration-analysis.md)
- Vite 环境变量文档: https://vitejs.dev/guide/env-and-mode.html
- dotenv 文档: https://github.com/motdotla/dotenv
