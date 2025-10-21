# Chrome 扩展 WebSocket 自动重连修复

## 问题描述

Chrome 扩展重启后无法自动连接 WebSocket 服务。

## 根本原因

Chrome 扩展使用 Service Worker 作为 background script,Service Worker 有以下特性:

1. **非持久性**: 在不活动一段时间后会被 Chrome 自动停止
2. **按需唤醒**: 只在需要时才会被唤醒执行
3. **状态丢失**: 停止后所有内存状态(包括 WebSocket 连接)都会丢失

原有代码只在脚本首次加载时调用一次 `initWebSocket()`,导致:
- Service Worker 被停止后,WebSocket 连接丢失
- Service Worker 重新唤醒时,没有重新建立连接
- 用户需要手动重新加载扩展才能恢复连接

## 解决方案

### 1. 多重初始化触发点

添加了多个 WebSocket 初始化触发点,确保在各种情况下都能建立连接:

```javascript
// 扩展启动时
initWebSocket();

// 扩展安装或更新时
chrome.runtime.onInstalled.addListener(() => {
  initWebSocket();
});

// 浏览器启动时
chrome.runtime.onStartup.addListener(() => {
  initWebSocket();
});

// Service Worker 激活时
self.addEventListener('activate', () => {
  if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
    initWebSocket();
  }
});
```

### 2. 消息处理前连接检查

在处理每个消息前检查连接状态,必要时重新连接:

```javascript
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 确保 WebSocket 连接活跃
  if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
    console.log('[WebSocket] 检测到连接未建立,尝试重新连接');
    initWebSocket();
  }
  
  // 处理消息...
});
```

### 3. 定期连接状态检查

添加定期检查机制,每 10 秒检查一次连接状态:

```javascript
function startConnectionCheck() {
  setInterval(() => {
    if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
      console.log('[WebSocket] 定期检查发现连接已断开,尝试重连');
      initWebSocket();
    }
  }, 10000);
}
```

### 4. 已有的自动重连机制

保留了原有的断线重连机制:

```javascript
ws.onclose = () => {
  // ...
  scheduleReconnect(); // 3 秒后重连
};
```

## 连接保障机制总结

现在扩展拥有**四层连接保障**:

1. **事件驱动重连**: 
   - 扩展安装/更新
   - 浏览器启动
   - Service Worker 激活

2. **消息触发检查**: 
   - 每次用户操作前检查连接
   - 未连接时立即尝试连接

3. **定期状态检查**: 
   - 每 10 秒主动检查
   - 发现断开立即重连

4. **断线自动重连**: 
   - 连接断开时 3 秒后重连
   - 心跳检测维持连接

## 测试场景

### ✅ 已解决的场景:

1. **扩展重启**
   - 禁用后重新启用扩展 → 自动连接

2. **浏览器重启**
   - 关闭浏览器后重新打开 → 自动连接

3. **Service Worker 休眠唤醒**
   - 长时间不使用后第一次操作 → 自动连接

4. **网络波动**
   - VSCode 重启导致连接断开 → 自动重连

5. **定期检查恢复**
   - 即使所有事件都错过,10 秒内也会检测并重连

## 用户体验改进

- ✅ **无需手动干预**: 用户不需要重新加载扩展
- ✅ **快速恢复**: 多种触发机制确保快速建立连接
- ✅ **状态可见**: Side Panel 显示实时连接状态
- ✅ **降级处理**: WebSocket 失败时自动使用 URI Handler

## 调试建议

### 查看连接日志:

1. 打开 Chrome 扩展管理页面 `chrome://extensions/`
2. 找到 Issue Manager 扩展
3. 点击 "Service Worker" 查看控制台
4. 观察以下日志:
   - `[WebSocket] 连接已建立`
   - `[WebSocket] 尝试重连...`
   - `[WebSocket] 定期检查发现连接已断开`

### 测试重连:

```javascript
// 在 Service Worker 控制台执行
if (ws) {
  ws.close();  // 手动关闭连接
}
// 应该在 3 秒内看到重连日志
```

## 注意事项

1. **定期检查的开销**: 
   - 每 10 秒检查一次,开销极小
   - 只在连接断开时才会执行重连逻辑

2. **连接竞争**: 
   - `initWebSocket()` 内部已有检查,防止重复连接
   - 多次调用是安全的

3. **Service Worker 生命周期**:
   - 即使有定时器,Service Worker 仍可能被停止
   - 但下次唤醒时会重新执行初始化代码

## 性能影响

- **内存**: 无额外内存开销
- **CPU**: 定期检查几乎无 CPU 消耗
- **网络**: 只在需要时才建立连接,心跳保持最小化

## 未来优化方向

1. **智能重连间隔**: 根据失败次数调整重连间隔
2. **连接健康度监控**: 记录连接质量指标
3. **用户主动重连**: 添加手动重连按钮
4. **连接状态持久化**: 使用 chrome.storage 记录连接历史
