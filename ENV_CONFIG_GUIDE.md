# 环境配置指南

本文档说明如何使用环境变量配置开发和生产环境。

## 概述

Issue Manager 支持通过 `.env` 文件管理不同环境的配置参数，主要用于配置 Chrome 扩展与 VSCode 扩展之间的 WebSocket 连接端口。

## 为什么需要环境配置？

在开发过程中，你可能需要：

1. **避免端口冲突**: 开发环境和生产环境使用不同的端口
2. **团队协作**: 不同开发者可以使用各自的端口配置而不影响 Git 仓库
3. **简化部署**: 生产环境配置独立于代码，便于部署管理

## 配置文件说明

### 文件类型

| 文件名 | 用途 | 是否提交到 Git | 说明 |
|--------|------|----------------|------|
| `.env.example` | 配置示例 | ✅ 是 | 提供配置参数的模板和说明 |
| `.env.development` | 开发环境 | ✅ 是 | 运行 `npm run chrome:dev` 时使用 |
| `.env` | 生产/本地环境 | ❌ 否 | 运行 `npm run chrome:build` 时使用 |

### 支持的环境变量

#### `VITE_VSCODE_WS_PORT`

- **说明**: VSCode WebSocket 服务监听端口
- **默认值**: `37892`
- **使用位置**: Chrome 扩展的 background.ts 
- **相关配置**: VSCode 扩展的 `issueManager.chromeIntegration.port` 设置

## 使用方法

### 1. 开发环境配置

#### 步骤 1: 修改开发环境配置

编辑 `.env.development` 文件（如需要更改端口）:

```env
# 开发环境 WebSocket 端口
VITE_VSCODE_WS_PORT=37892
```

#### 步骤 2: 配置 VSCode 端

在 VSCode 的设置中配置相同的端口:

1. 打开 VSCode 设置 (`Ctrl+,` 或 `Cmd+,`)
2. 搜索 `issueManager.chromeIntegration.port`
3. 设置为与 `.env.development` 中相同的端口值

或者直接编辑 `settings.json`:

```json
{
  "issueManager.chromeIntegration.port": 37892
}
```

#### 步骤 3: 启动开发模式

```bash
npm run chrome:dev
```

此命令会自动使用 `.env.development` 中的配置。

### 2. 生产环境配置

#### 步骤 1: 创建生产环境配置

```bash
# 从示例文件复制
cp .env.example .env

# 编辑 .env 文件
# VITE_VSCODE_WS_PORT=37892
```

#### 步骤 2: 构建生产版本

```bash
# 构建扩展
npm run chrome:build

# 或者构建并打包为 ZIP
npm run chrome:zip
```

构建时会自动使用 `.env` 文件（如果存在）的配置。

## 配置示例

### 场景 1: 默认配置（推荐）

使用默认端口 37892，无需修改任何配置文件。

**开发环境** (`.env.development`):
```env
VITE_VSCODE_WS_PORT=37892
```

**VSCode 设置**:
```json
{
  "issueManager.chromeIntegration.port": 37892
}
```

### 场景 2: 自定义端口

假设你想在开发时使用端口 38000:

**开发环境** (`.env.development`):
```env
VITE_VSCODE_WS_PORT=38000
```

**VSCode 设置**:
```json
{
  "issueManager.chromeIntegration.port": 38000
}
```

然后重新运行 `npm run chrome:dev`。

### 场景 3: 多环境切换

如果你需要在多个环境之间切换，可以创建多个环境文件:

```bash
.env.development     # 开发环境
.env.staging         # 预发布环境
.env.production      # 生产环境
```

通过指定 mode 参数来使用不同的环境:

```bash
# 开发环境
npm run chrome:dev

# 预发布环境
npx wxt build --mode staging

# 生产环境
npm run chrome:build
```

## 故障排除

### 问题 1: Chrome 扩展无法连接到 VSCode

**症状**: Side Panel 显示"未连接"状态

**解决方案**:
1. 检查 `.env.development` 或 `.env` 中的 `VITE_VSCODE_WS_PORT` 值
2. 检查 VSCode 设置中的 `issueManager.chromeIntegration.port` 值
3. 确保两者端口一致
4. 重新构建 Chrome 扩展: `npm run chrome:dev`
5. 在 Chrome 扩展页面重新加载扩展
6. 重启 VSCode 窗口以应用新端口配置

### 问题 2: 修改环境变量后不生效

**原因**: 环境变量在构建时被注入到代码中，需要重新构建。

**解决方案**:
1. 停止当前运行的开发服务器 (Ctrl+C)
2. 重新运行 `npm run chrome:dev`
3. 在 Chrome 扩展页面点击"重新加载"

### 问题 3: .env 文件不生效

**检查清单**:
- [ ] 文件名正确 (`.env` 而不是 `env.txt` 或其他)
- [ ] 文件位置正确 (项目根目录)
- [ ] 变量名以 `VITE_` 开头 (WXT/Vite 要求)
- [ ] 已重新构建扩展
- [ ] 已在 Chrome 重新加载扩展

## 安全注意事项

1. **不要提交 .env 文件**: `.env` 文件已被添加到 `.gitignore`，请勿手动提交
2. **不要在 .env 中存储敏感信息**: 虽然 .env 不会被提交，但环境变量会被构建到扩展代码中
3. **团队配置**: `.env.development` 提供团队默认配置，个人可通过 `.env.development.local` 覆盖

## 相关文档

- [WXT 环境变量文档](https://wxt.dev/guide/essentials/config.html#environment-variables)
- [Vite 环境变量文档](https://vitejs.dev/guide/env-and-mode.html)
- [Chrome 扩展 README](./chrome-extension-wxt/README.md)

## 技术细节

### 环境变量工作原理

1. **构建时注入**: 环境变量在构建时通过 Vite 注入到代码中
2. **import.meta.env**: 在代码中通过 `import.meta.env.VITE_*` 访问
3. **模式切换**: `--mode` 参数决定加载哪个 `.env.*` 文件

### 优先级顺序

环境变量的优先级（从高到低）:

1. `.env.[mode].local` (如 `.env.development.local`)
2. `.env.[mode]` (如 `.env.development`)
3. `.env.local`
4. `.env`

### 代码中的使用

在 TypeScript 代码中访问环境变量:

```typescript
// Chrome 扩展 background.ts
const WS_PORT = import.meta.env.VITE_VSCODE_WS_PORT || '37892';
const DEFAULT_VSCODE_WS_URL = `ws://localhost:${WS_PORT}/ws`;
```
