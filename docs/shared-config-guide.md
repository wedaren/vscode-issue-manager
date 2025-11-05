# 共享配置使用指南

本文档说明如何使用共享配置文件来管理 VSCode 插件和 Chrome 扩展之间的 WebSocket 连接配置。

## 📋 目录

- [配置文件说明](#配置文件说明)
- [配置流程](#配置流程)
- [配置选项](#配置选项)
- [端口自动发现](#端口自动发现)
- [开发环境最佳实践](#开发环境最佳实践)
- [故障排除](#故障排除)

## 配置文件说明

### .env 文件

项目支持使用 `.env` 文件来配置 WebSocket 服务。该文件位于项目根目录，用于集中管理配置。

**文件位置**: `/path/to/workspace/.env`

### 配置优先级

配置读取的优先级顺序（从高到低）：

1. **环境变量** - 系统或进程环境变量
2. **.env 文件** - 项目根目录的 `.env` 文件
3. **VSCode 配置** - VSCode 的 `settings.json`
4. **默认值** - 代码中的默认配置

## 配置流程

### 1. 创建配置文件

复制示例文件创建自己的配置：

```bash
cp .env.example .env
```

### 2. 编辑配置

根据需要修改 `.env` 文件中的配置：

```bash
# WebSocket 服务端口
VSCODE_WS_PORT=37892

# WebSocket 服务主机
VSCODE_WS_HOST=localhost

# 端口范围（用于自动发现）
VSCODE_WS_PORT_RANGE=37892-37899

# 是否启用端口自动发现
ENABLE_PORT_DISCOVERY=true
```

### 3. 重新加载 VSCode

修改配置后，需要重新加载 VSCode 窗口：

1. 按 `Cmd+Shift+P` (macOS) 或 `Ctrl+Shift+P` (Windows/Linux)
2. 输入 "Reload Window" 并回车

### 4. Chrome 扩展自动连接

Chrome 扩展会自动尝试连接到 VSCode 实例：
- 首次连接：尝试端口范围内的所有端口
- 连接成功后：VSCode 会发送配置信息
- 后续连接：优先使用保存的端口

## 配置选项

### WebSocket 服务配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `VSCODE_WS_PORT` | number | 37892 | WebSocket 服务监听端口 |
| `VSCODE_WS_HOST` | string | localhost | WebSocket 服务主机地址 |
| `VSCODE_WS_URL` | string | ws://localhost:37892/ws | 完整的 WebSocket URL（可选） |

### 端口发现配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `VSCODE_WS_PORT_RANGE` | string | 37892-37899 | 端口搜索范围 |
| `ENABLE_PORT_DISCOVERY` | boolean | true | 是否启用端口自动发现 |
| `PORT_DISCOVERY_TIMEOUT` | number | 1000 | 端口发现超时时间（毫秒）|

### 连接重试配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `WS_MAX_RETRIES` | number | 3 | 最大重试次数 |
| `WS_RETRY_DELAY` | number | 1000 | 重试延迟时间（毫秒）|

### 日志配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `LOG_LEVEL` | string | info | 日志级别：debug, info, warn, error |

## 端口自动发现

### 工作原理

当启用端口自动发现（`ENABLE_PORT_DISCOVERY=true`）时：

1. **VSCode 端**：
   - 尝试在配置的端口启动服务
   - 如果端口被占用，自动尝试端口范围内的下一个端口
   - 成功启动后，将实际使用的端口写入 `chrome-config.json`

2. **Chrome 扩展端**：
   - 优先读取 `chrome-config.json` 中的端口
   - 如果连接失败，自动尝试端口范围内的所有端口
   - 找到可用端口后自动连接

### 使用场景

端口自动发现适用于以下场景：

- **多个 VSCode 实例**：同时运行多个 VSCode 窗口
- **端口冲突**：配置的端口已被其他应用占用
- **开发测试**：需要在不同端口间快速切换
- **团队协作**：不同开发者使用不同的端口配置

## 开发环境最佳实践

### 1. 单一 VSCode 实例

如果只运行一个 VSCode 实例，使用固定端口：

```bash
# .env
VSCODE_WS_PORT=37892
ENABLE_PORT_DISCOVERY=false
```

### 2. 多个 VSCode 实例

运行多个 VSCode 时，启用端口自动发现：

```bash
# .env
VSCODE_WS_PORT=37892
VSCODE_WS_PORT_RANGE=37892-37899
ENABLE_PORT_DISCOVERY=true
```

### 3. 环境变量配置

使用 VSCode 的 launch.json 配置不同的开发环境：

```json
{
  "configurations": [
    {
      "name": "开发环境 - 端口 37892",
      "type": "extensionHost",
      "env": {
        "VSCODE_WS_PORT": "37892"
      }
    },
    {
      "name": "测试环境 - 端口 37893",
      "type": "extensionHost",
      "env": {
        "VSCODE_WS_PORT": "37893"
      }
    }
  ]
}
```

### 4. 团队协作

在 `.gitignore` 中排除 `.env` 文件，但保留 `.env.example`：

```gitignore
# 本地配置
.env

# 保留示例文件
!.env.example
```

## 故障排除

### 问题 1: Chrome 扩展无法连接

**症状**：Side Panel 显示"未连接"状态

**解决方案**：

1. 检查 VSCode 是否正在运行
2. 查看 VSCode 输出面板的日志：
   ```
   [ChromeIntegration] WebSocket 服务已启动: ws://127.0.0.1:37892/ws
   ```
3. 确认 Chrome 扩展使用的端口与 VSCode 一致
4. 尝试手动触发端口发现（重新加载 Chrome 扩展）

### 问题 2: 端口被占用

**症状**：VSCode 输出显示端口被占用的错误

**解决方案**：

1. **启用端口自动发现**：
   ```bash
   ENABLE_PORT_DISCOVERY=true
   ```

2. **手动释放端口**：
   ```bash
   # macOS/Linux
   lsof -ti:37892 | xargs kill -9
   
   # Windows
   netstat -ano | findstr :37892
   taskkill /PID <PID> /F
   ```

3. **使用其他端口**：
   ```bash
   VSCODE_WS_PORT=37893
   ```

### 问题 3: 配置未生效

**症状**：修改 `.env` 文件后配置没有更新

**解决方案**：

1. 重新加载 VSCode 窗口（`Reload Window`）
2. 检查 `.env` 文件格式是否正确
3. 确认配置项名称拼写正确
4. 查看是否有其他配置覆盖了 `.env` 的设置

### 问题 4: 端口发现失败

**症状**：Chrome 扩展尝试所有端口都失败

**解决方案**：

1. 检查端口范围配置是否正确
2. 增加端口发现超时时间：
   ```bash
   PORT_DISCOVERY_TIMEOUT=3000
   ```
3. 查看防火墙是否阻止了连接
4. 确认 VSCode 插件的 WebSocket 服务已启动

## 配置示例

### 开发环境示例

```bash
# .env
VSCODE_WS_PORT=37892
VSCODE_WS_HOST=localhost
VSCODE_WS_PORT_RANGE=37892-37899
ENABLE_PORT_DISCOVERY=true
PORT_DISCOVERY_TIMEOUT=1000
WS_MAX_RETRIES=3
WS_RETRY_DELAY=1000
LOG_LEVEL=debug
```

### 生产环境示例

```bash
# .env
VSCODE_WS_PORT=37892
VSCODE_WS_HOST=localhost
ENABLE_PORT_DISCOVERY=false
PORT_DISCOVERY_TIMEOUT=500
WS_MAX_RETRIES=5
WS_RETRY_DELAY=2000
LOG_LEVEL=info
```

### 团队协作示例

```bash
# .env.example (提交到 Git)
# WebSocket 配置
VSCODE_WS_PORT=37892
VSCODE_WS_HOST=localhost
VSCODE_WS_PORT_RANGE=37892-37899
ENABLE_PORT_DISCOVERY=true

# 开发人员复制此文件为 .env 并根据需要修改
```

## 相关文档

- [Chrome 扩展使用指南](./chrome-extension-wxt/README.md)
- [VSCode 插件配置](./README.md)
- [端口管理策略](./docs/chrome-extension-reconnect-fix.md)

## 反馈与支持

如果遇到问题或有改进建议，请：

1. 查看 [Issues](https://github.com/wedaren/vscode-issue-manager/issues)
2. 提交新的 Issue
3. 查看项目文档

---

**最后更新**: 2025年11月5日
