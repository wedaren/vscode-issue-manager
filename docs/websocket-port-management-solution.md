# WebSocket 端口管理解决方案总结

## 📌 问题背景

在开发 VSCode 插件和 Chrome 扩展时，WebSocket 服务的默认端口 37892 可能会被占用，导致：

- VSCode 插件无法启动 WebSocket 服务
- Chrome 扩展无法连接到 VSCode
- 多个 VSCode 实例无法同时运行

## 🎯 解决方案

我们实现了一套**零配置**的端口自动发现机制。

### 核心理念

**VSCode 插件读取 `.env` 文件，Chrome 扩展通过端口发现自动连接。**

这样设计的原因：
1. ✅ **简单**：Chrome 扩展无需访问文件系统
2. ✅ **灵活**：VSCode 端可以读取 `.env` 文件
3. ✅ **解耦**：两端通过 WebSocket 通信，配置通过网络同步

### 核心特性

1. **VSCode 端配置管理** (`.env` 文件)
   - VSCode 插件读取 `.env` 文件获取配置
   - 支持环境变量覆盖
   - 配置优先级明确

2. **端口自动发现**
   - VSCode 端：自动寻找可用端口（避免冲突）
   - Chrome 端：自动尝试连接端口范围内的所有端口
   - 连接成功后通过 WebSocket 同步配置

3. **多实例支持**
   - 支持同时运行多个 VSCode 实例
   - 每个实例使用不同端口
   - Chrome 扩展自动找到正确的实例

## 📁 新增文件

### 1. 配置文件

```
.env.example                           # 配置文件示例
src/config/SharedConfig.ts             # VSCode 端共享配置管理器
chrome-extension-wxt/utils/ChromeConfigManager.ts  # Chrome 端配置管理器
docs/shared-config-guide.md            # 配置使用指南
```

### 2. 更新文件

```
src/integration/ChromeIntegrationServer.ts  # 添加端口自动发现
chrome-extension-wxt/entrypoints/background.ts  # 使用配置管理器
chrome-extension-wxt/README.md         # 更新配置说明
.gitignore                             # 排除 .env 文件
```

## 🔧 实现细节

### VSCode 端

#### 1. SharedConfig 类

```typescript
// 配置优先级
1. 环境变量 (process.env.VSCODE_WS_PORT)
2. .env 文件 (VSCODE_WS_PORT=37892)
3. VSCode 配置 (issueManager.chromeIntegration.port)
4. 默认值 (37892)
```

#### 2. 端口自动发现

```typescript
// ChromeIntegrationServer.ts
private async findAvailablePort(startPort: number, endPort: number): Promise<number> {
  for (let port = startPort; port <= endPort; port++) {
    if (await this.isPortAvailable(port)) {
      return port;
    }
  }
  return startPort;
}
```

#### 3. 配置通过 WebSocket 同步

```typescript
// 连接成功后发送配置信息
ws.send(JSON.stringify({
  type: 'connected',
  message: '已连接到 VSCode Issue Manager',
  config: {
    port: actualPort,
    host: config.host,
    portRange: config.portRange
  }
}));
```

### Chrome 扩展端

#### 1. ChromeConfigManager 类

```typescript
// 配置来源
1. Chrome Storage API
2. 默认配置
```

#### 2. 端口自动发现

```typescript
public async discoverPort(): Promise<number | null> {
  const { portRange } = config.websocket;
  
  for (let port = portRange.start; port <= portRange.end; port++) {
    if (await this.testPort(port, timeout)) {
      return port;
    }
  }
  
  return null;
}
```

#### 3. 自动连接

```typescript
// background.ts
async function getWsUrl(): Promise<string> {
  const config = await configManager.getWebSocketConfig();
  
  if (config.enablePortDiscovery) {
    const discoveredPort = await configManager.discoverPort();
    if (discoveredPort) {
      return `ws://${config.host}:${discoveredPort}/ws`;
    }
  }
  
  return config.url;
}
```

## 📋 使用方法

### 基本配置

1. **创建配置文件**

```bash
cp .env.example .env
```

2. **编辑配置**

```bash
# .env
VSCODE_WS_PORT=37892
VSCODE_WS_HOST=localhost
VSCODE_WS_PORT_RANGE=37892-37899
ENABLE_PORT_DISCOVERY=true
```

3. **重新加载 VSCode**

按 `Cmd+Shift+P` → `Reload Window`

### 多实例开发

启用端口自动发现后，可以同时运行多个 VSCode 实例：

```bash
# .env
ENABLE_PORT_DISCOVERY=true
VSCODE_WS_PORT_RANGE=37892-37899
```

每个实例会自动使用不同的端口。

### 团队协作

1. 提交 `.env.example` 到 Git
2. 本地创建 `.env` 文件（不提交）
3. 团队成员根据自己的需求修改配置

## 🎨 配置策略对比

| 策略 | 实现方式 | 优点 | 缺点 | 适用场景 |
|------|----------|------|------|----------|
| 固定端口 | 硬编码端口号 | 简单 | 容易冲突 | 单一环境 |
| 环境变量 | process.env | 灵活 | 需要设置 | 多环境部署 |
| .env 文件 | 本地配置文件 | 易于管理 | 需要创建 | 开发环境 |
| 动态端口分配 | 自动寻找可用端口 | 自动化 | 需要通知客户端 | 开发环境 |
| 端口自动发现 | 客户端主动尝试 | 无需配置 | 有延迟 | 开发+生产 |
| 服务注册 | 文件系统/API | 解耦 | 依赖外部 | 大型项目 |

## ✅ 本方案采用的策略

我们采用了以下组合策略：

1. **.env 文件配置** - 便于管理
2. **动态端口分配** - VSCode 端自动寻找可用端口
3. **端口自动发现** - Chrome 扩展自动连接
4. **配置导出同步** - 自动同步配置到 Chrome 扩展

这个组合既保证了开发时的灵活性，又能在生产环境中提供稳定的服务。

## 🚀 进一步优化建议

### 1. 端口管理服务

可以创建一个专门的端口管理服务，统一管理所有实例的端口分配：

```typescript
class PortRegistry {
  private static registryPath = path.join(os.tmpdir(), 'vscode-ports.json');
  
  async allocate(workspaceId: string): Promise<number> {
    // 分配端口并注册
  }
  
  async release(workspaceId: string): Promise<void> {
    // 释放端口
  }
}
```

### 2. 健康检查机制

添加定期的健康检查，确保连接状态：

```typescript
setInterval(async () => {
  if (!isConnected()) {
    await reconnect();
  }
}, 30000);
```

### 3. 配置 UI 界面

提供图形化配置界面，方便用户设置：

```typescript
vscode.commands.registerCommand('issueManager.configureWebSocket', () => {
  // 显示配置 WebView
});
```

### 4. 远程服务支持

支持连接到远程 VSCode 实例：

```bash
# .env
VSCODE_WS_HOST=192.168.1.100
VSCODE_WS_PORT=37892
```

## 📊 性能考虑

### 端口扫描性能

端口自动发现的性能取决于：

- **端口范围大小**：范围越大，扫描时间越长
- **超时时间**：超时越短，扫描越快，但可能误判
- **并发检测**：可以并行检测多个端口

**优化建议**：

```typescript
// 并行检测多个端口
async function discoverPortParallel(): Promise<number | null> {
  const ports = Array.from(
    { length: portRange.end - portRange.start + 1 }, 
    (_, i) => portRange.start + i
  );
  
  const results = await Promise.all(
    ports.map(port => this.testPort(port, timeout))
  );
  
  const index = results.findIndex(available => available);
  return index >= 0 ? ports[index] : null;
}
```

## 🔒 安全考虑

### 1. 本地连接限制

WebSocket 服务只监听本地地址：

```typescript
this.httpServer.listen(port, '127.0.0.1');
```

### 2. 配置文件安全

`.env` 文件不提交到 Git，避免泄露敏感配置：

```gitignore
.env
!.env.example
```

### 3. 端口范围限制

限制端口扫描范围，避免滥用：

```typescript
const MAX_PORT_RANGE = 100;
if (portRange.end - portRange.start > MAX_PORT_RANGE) {
  throw new Error('端口范围过大');
}
```

## 📖 相关文档

- [共享配置使用指南](./shared-config-guide.md)
- [Chrome 扩展 README](../chrome-extension-wxt/README.md)
- [WebSocket 端口占用解决策略](../README.md#端口占用问题)

## 🤝 贡献

欢迎提出改进建议和 Pull Request！

---

**实现日期**: 2025年11月5日
**实现人员**: GitHub Copilot
