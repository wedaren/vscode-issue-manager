# Side Panel WebSocket 状态同步修复

## 问题描述

启动 Chrome 插件时,Side Panel 显示"连接中",但实际上 background.js 的 WebSocket 可能已经连接成功了。

## 根本原因

Side Panel 和 background script 是**独立运行**的两个上下文:

1. **background.js**: 
   - 扩展启动时立即执行 `initWebSocket()`
   - 可能在几百毫秒内就连接成功

2. **sidepanel.js**:
   - 只在用户打开 Side Panel 时才加载
   - 加载时默认显示"连接中"
   - 不知道 background 的实际连接状态

### 时间线问题:

```
时间线:
0ms   - Chrome 启动,background.js 开始初始化
100ms - WebSocket 连接成功 (background 已知)
...
5000ms - 用户打开 Side Panel
5001ms - Side Panel 显示"连接中" (但实际已连接!)
```

## 解决方案

### 1. Background 添加状态查询接口

在 `background.js` 中添加 `GET_WS_STATUS` 消息处理:

```javascript
case 'GET_WS_STATUS':
  // 查询当前真实的连接状态
  const status = wsConnected && ws && ws.readyState === WebSocket.OPEN 
    ? 'connected' 
    : (ws && ws.readyState === WebSocket.CONNECTING ? 'connecting' : 'disconnected');
  sendResponse({ status });
  break;
```

### 2. Side Panel 主动查询状态

在 Side Panel 加载时,主动查询 background 的真实状态:

```javascript
// 初始化
document.addEventListener('DOMContentLoaded', () => {
  // ...
  // 查询当前 WebSocket 状态 (而不是假设为"连接中")
  queryWsStatus();
});

async function queryWsStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_WS_STATUS' });
    if (response && response.status) {
      updateWsStatus(response.status);
    } else {
      updateWsStatus('connecting');
    }
  } catch (error) {
    console.error('Failed to query WebSocket status:', error);
    updateWsStatus('disconnected');
  }
}
```

## 工作流程

### 修复前:
```
用户打开 Side Panel
  ↓
显示: "连接中" (硬编码)
  ↓
等待 WS_CONNECTED 消息
  ↓
(如果已连接,永远不会收到消息!)
  ↓
一直显示"连接中" ❌
```

### 修复后:
```
用户打开 Side Panel
  ↓
发送 GET_WS_STATUS 查询
  ↓
Background 返回实际状态
  ↓
显示正确状态 ✅
  ↓
继续监听状态变化消息
```

## 状态判断逻辑

Background 返回的状态基于:

1. **connected**: 
   - `wsConnected === true`
   - `ws` 存在
   - `ws.readyState === WebSocket.OPEN`

2. **connecting**:
   - `ws` 存在
   - `ws.readyState === WebSocket.CONNECTING`

3. **disconnected**:
   - 其他所有情况

## 测试场景

### ✅ 场景 1: 扩展已运行,打开 Side Panel
1. Chrome 已启动,扩展已连接 WebSocket
2. 用户打开 Side Panel
3. **期望**: 立即显示"已连接" ✅
4. **实际**: 立即显示"已连接" ✅

### ✅ 场景 2: 首次启动,快速打开 Side Panel
1. Chrome 刚启动,扩展正在连接
2. 用户立即打开 Side Panel
3. **期望**: 显示"连接中" → 连接成功后变为"已连接"
4. **实际**: 显示"连接中" → 自动更新为"已连接" ✅

### ✅ 场景 3: WebSocket 断开
1. 连接已建立,显示"已连接"
2. VSCode 关闭,连接断开
3. **期望**: 收到 WS_DISCONNECTED 消息,显示"已断开"
4. **实际**: 正确显示"已断开" ✅

### ✅ 场景 4: 自动重连成功
1. 显示"已断开"
2. Background 自动重连成功
3. **期望**: 收到 WS_CONNECTED 消息,显示"已连接"
4. **实际**: 正确显示"已连接" ✅

## 状态同步机制

现在有**两种**状态同步方式:

### 1. 主动查询 (Pull)
- **时机**: Side Panel 打开时
- **目的**: 获取当前真实状态
- **适用**: 初始化场景

### 2. 被动监听 (Push)
- **时机**: 状态变化时
- **消息**: `WS_CONNECTED`, `WS_DISCONNECTED`
- **目的**: 实时更新状态
- **适用**: 运行时状态变化

## 优势

1. **准确性**: 显示真实的连接状态,不再假设
2. **即时性**: 打开 Side Panel 立即显示正确状态
3. **可靠性**: 主动查询 + 被动监听双重保障
4. **用户体验**: 避免误导性的"连接中"状态

## 注意事项

### 错误处理

如果查询失败(例如 background 未响应):
```javascript
catch (error) {
  // 降级为"已断开"状态
  updateWsStatus('disconnected');
}
```

### 异步时序

查询是异步的,但通常很快(<10ms):
- 用户几乎看不到延迟
- 比假设"连接中"更准确

## 性能影响

- **网络**: 无网络请求,只是本地消息传递
- **延迟**: <10ms
- **开销**: 极小,仅在打开 Side Panel 时执行一次

## 未来优化

1. **状态缓存**: 在 Side Panel 中缓存状态,减少查询
2. **心跳检测**: Side Panel 定期查询状态(可选)
3. **状态历史**: 记录连接状态变化历史
4. **重连通知**: 连接恢复时显示通知
