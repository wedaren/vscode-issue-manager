# WebSocket 集成迁移说明

## 概述

本次改动将 Chrome 扩展与 VSCode 的集成方式从 **HTTP POST 请求**升级为 **WebSocket 长连接**,提供更快速、更可靠的实时通信。

## 主要改动

### 1. VSCode 端 (`ChromeIntegrationServer.ts`)

#### 改动内容:
- **引入 WebSocket 支持**: 添加 `ws` 库和类型定义
- **服务架构变更**:
  - 创建 HTTP 服务器作为 WebSocket 升级的基础
  - 在 `/ws` 路径上创建 WebSocket 服务器
  - 保留 URI Handler 作为备用方案

#### 新增功能:
1. **WebSocket 连接管理**
   - 自动处理客户端连接和断开
   - 发送欢迎消息确认连接
   
2. **消息处理**
   - `create-note`: 创建笔记请求
   - `ping/pong`: 心跳检测
   - 消息 ID 跟踪,支持请求-响应模式

3. **错误处理**
   - 内容大小限制(5MB)
   - JSON 解析错误处理
   - 详细的错误消息返回

#### 服务端点:
```
ws://127.0.0.1:37892/ws
```

### 2. Chrome 扩展端 (`background.js`)

#### 改动内容:
- **WebSocket 客户端**: 实现完整的 WebSocket 连接管理
- **自动重连机制**: 连接断开后每 3 秒尝试重连
- **心跳检测**: 每 30 秒发送 ping 消息保持连接活跃
- **消息队列**: 使用 Promise 跟踪每个消息的响应

#### 新增功能:
1. **连接生命周期管理**
   ```javascript
   initWebSocket()      // 初始化连接
   scheduleReconnect()  // 自动重连
   startPing()          // 启动心跳
   stopPing()           // 停止心跳
   ```

2. **消息发送**
   ```javascript
   sendWebSocketMessage({ type: 'create-note', data: {...} })
   ```
   - 自动生成消息 ID
   - 支持超时控制(默认 5 秒)
   - Promise 化的异步调用

3. **降级策略**
   - WebSocket 连接失败时自动降级到 URI Handler
   - 用户友好的错误提示

### 3. 配置更新 (`package.json`)

#### 依赖变更:
```json
{
  "dependencies": {
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/ws": "^8.5.13"
  }
}
```

#### 配置项更新:
- `issueManager.chromeIntegration.enableServer`: 启用 WebSocket 服务
- `issueManager.chromeIntegration.port`: WebSocket 服务端口(默认 37892)

## 技术优势

### 相比 HTTP 请求的优势:

1. **性能提升**
   - ✅ 持久连接,无需每次建立 TCP 连接
   - ✅ 更低的延迟
   - ✅ 减少网络开销

2. **可靠性**
   - ✅ 自动重连机制
   - ✅ 心跳检测维持连接
   - ✅ 连接状态实时感知

3. **实时性**
   - ✅ 双向通信能力
   - ✅ 服务端可主动推送消息
   - ✅ 即时的连接状态反馈

4. **可扩展性**
   - ✅ 支持多种消息类型
   - ✅ 易于添加新功能
   - ✅ 请求-响应模式便于追踪

## 向后兼容

### URI Handler 备用方案
当 WebSocket 连接不可用时,系统会自动降级到 URI Handler:
```
vscode://wedaren.issue-manager/create-from-html?data=...
```

### 配置兼容
- 现有配置项保持不变
- 只需运行 `npm install` 安装新依赖
- 无需修改用户配置

## 使用指南

### VSCode 端
1. 安装依赖: `npm install`
2. 重新编译扩展
3. 重新加载 VSCode 窗口
4. WebSocket 服务将自动启动

### Chrome 扩展端
1. 重新加载扩展
2. WebSocket 会自动连接到 VSCode
3. 在开发者工具中可以看到连接日志

### 调试
- **VSCode**: 查看输出面板 -> "扩展主机"
- **Chrome**: 打开扩展的 Service Worker 控制台

## 错误处理

### 常见问题

1. **连接失败**
   - 检查 VSCode Issue Manager 扩展是否已启动
   - 检查端口 37892 是否被占用
   - 查看防火墙设置

2. **自动重连**
   - 扩展会每 3 秒自动尝试重连
   - 无需手动干预

3. **降级到 URI Handler**
   - 当 WebSocket 完全不可用时自动触发
   - 适用于网络受限环境

## 消息协议

### 请求消息格式
```json
{
  "type": "create-note",
  "id": "msg_1234567890_1",
  "data": {
    "html": "<div>...</div>",
    "title": "页面标题",
    "url": "https://example.com"
  }
}
```

### 响应消息格式
```json
{
  "type": "success",
  "id": "msg_1234567890_1",
  "path": "file:///path/to/note.md"
}
```

### 错误消息格式
```json
{
  "type": "error",
  "id": "msg_1234567890_1",
  "error": "错误描述"
}
```

### 心跳消息
```json
// 请求
{ "type": "ping", "id": "msg_1234567890_2" }

// 响应
{ "type": "pong", "id": "msg_1234567890_2" }
```

## 测试清单

- [ ] VSCode 扩展启动时 WebSocket 服务正常启动
- [ ] Chrome 扩展能成功连接到 WebSocket
- [ ] 选取网页内容后能成功创建笔记
- [ ] 连接断开后能自动重连
- [ ] 心跳检测正常工作
- [ ] WebSocket 失败时能降级到 URI Handler
- [ ] 错误消息正确显示给用户

## 未来扩展

WebSocket 架构为以下功能预留了空间:

1. **服务端推送**
   - VSCode 可主动通知 Chrome 扩展
   - 实时同步状态

2. **批量操作**
   - 一次连接处理多个请求
   - 提高效率

3. **进度反馈**
   - 实时显示笔记创建进度
   - 更好的用户体验

4. **扩展功能**
   - 笔记搜索
   - 笔记列表同步
   - 双向内容同步
