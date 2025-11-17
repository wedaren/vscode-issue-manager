# Chrome Runtime 错误处理重构

**日期**: 2025-11-18  
**类型**: 代码质量改进  

## 背景

在 Chrome 扩展开发中,当尝试向未注入 Content Script 的页面或未打开的 Side Panel 发送消息时,Chrome Runtime API 会抛出特定的错误。原有代码使用硬编码的错误消息字符串来识别这些错误,存在以下问题:

1. **脆弱性**: 如果 Chrome 更新了错误消息,代码逻辑会失效
2. **重复代码**: 相同的错误检查逻辑分散在多个地方
3. **可维护性差**: 缺少文档说明,未来维护者难以理解这种依赖关系

## 改进方案

### 1. 创建共享工具函数

创建了独立的工具模块 `utils/chromeErrorUtils.ts`,包含统一的错误检查函数:

```typescript
/**
 * 检查是否是 Chrome Runtime 接收端不存在导致的错误
 * 
 * ⚠️ 维护注意事项:
 * 此函数依赖于 Chrome Runtime API 抛出的特定错误消息字符串。
 * 如果未来 Chrome/Edge 浏览器更新了这些错误消息,此检测可能会失效。
 * 
 * 已知的错误消息模式:
 * - "Receiving end does not exist" (Chrome)
 * - "Could not establish connection" (Chrome/Edge)
 * 
 * 常见场景:
 * 1. Content Script 未注入到目标页面
 * 2. Side Panel 或 Popup 未打开
 * 3. Extension 页面已关闭
 * 
 * Chrome Runtime API 目前没有提供特定的错误代码或错误类型来标识此类错误,
 * 因此只能依赖消息字符串匹配。这是 Chrome 扩展开发中的常见做法。
 * 
 * 如果发现此检测失效,请:
 * 1. 检查 chrome.runtime.lastError 或控制台中的实际错误消息
 * 2. 更新下面的错误消息模式列表
 * 3. 考虑添加新的错误消息模式
 * 
 * @param error - 捕获的错误对象
 * @returns 如果是接收端不存在错误则返回 true
 */
export function isReceiverNotExistError(error: unknown): boolean {
  if (!(error instanceof Error) || !error.message) {
    return false;
  }

  // 已知的错误消息模式列表
  const ERROR_PATTERNS = [
    'Receiving end does not exist',
    'Could not establish connection',
  ];

  return ERROR_PATTERNS.some(pattern => error.message.includes(pattern));
}
```

### 2. 在各模块中导入使用

**AutoLoginPanel.vue**:
```typescript
import { isReceiverNotExistError } from '../utils/chromeErrorUtils';
```

**background.ts**:
```typescript
import { isReceiverNotExistError } from '../utils/chromeErrorUtils';
```

### 3. 重构错误处理代码

#### 之前的代码:
```typescript
if ((error instanceof Error && error.message?.includes('Receiving end does not exist')) ||
    (error instanceof Error && error.message?.includes('Could not establish connection'))) {
  // 处理逻辑
}
```

#### 重构后的代码:
```typescript
if (isReceiverNotExistError(error)) {
  // 处理逻辑
}
```

### 4. 影响范围

重构涉及以下位置:

1. **新增文件**: `chrome-extension-wxt/utils/chromeErrorUtils.ts`
   - 包含共享的 `isReceiverNotExistError()` 函数

2. **AutoLoginPanel.vue**
   - 导入并使用共享函数
   - `useAccount()` 函数中的错误处理
   - `switchAccount()` 函数中的错误处理

3. **background.ts**
   - 导入并使用共享函数
   - `notifySidePanel()` 函数中的错误处理

## 优势

1. **集中管理**: 错误消息模式集中在 `chromeErrorUtils.ts`,只需在一处维护
2. **代码复用**: 多个模块共享同一个工具函数,避免重复代码
3. **清晰的文档**: 详细的 JSDoc 注释说明了:
   - 为什么需要这样做
   - 潜在的风险是什么
   - 如果失效应该如何处理
   - 常见的使用场景
4. **可扩展性**: 通过 `ERROR_PATTERNS` 数组,可以轻松添加新的错误模式
5. **代码可读性**: 函数名清晰表达了检查的目的
6. **易于测试**: 独立的工具函数可以单独进行单元测试

## 项目结构

```
chrome-extension-wxt/
├── components/
│   └── AutoLoginPanel.vue          # 使用 isReceiverNotExistError
├── entrypoints/
│   └── background.ts                # 使用 isReceiverNotExistError
└── utils/
    └── chromeErrorUtils.ts          # 定义 isReceiverNotExistError (新增)
```

## 技术说明

### 为什么不能使用错误代码?

Chrome Runtime API 的错误对象通常只包含:
- `message`: 错误消息字符串
- `stack`: 调用栈信息

它们**不提供**:
- 特定的 `name` 属性(如 `ContentScriptNotInjectedError`)
- 错误代码(如 `ERR_RECEIVER_NOT_EXIST`)

因此,依赖消息字符串匹配是当前 Chrome 扩展开发的标准做法。

### 未来改进方向

如果 Chrome 未来提供了更稳健的错误识别机制,应该:

1. 优先使用官方提供的错误类型或代码
2. 保留字符串匹配作为降级方案
3. 更新文档说明新的最佳实践

## 测试建议

1. **正常场景测试**:
   - 在已注入 Content Script 的页面使用自动登录功能
   - 确认功能正常工作

2. **错误场景测试**:
   - 在新打开的页面(未注入 Content Script)使用自动登录功能
   - 确认能正确检测到错误并自动注入 Content Script
   - 验证重试机制正常工作

3. **Side Panel 场景测试**:
   - 在 Side Panel 未打开时触发通知
   - 确认能正常忽略错误(不应抛出异常)

## 参考资料

- [Chrome Extension Messaging API](https://developer.chrome.com/docs/extensions/mv3/messaging/)
- [Chrome Runtime API](https://developer.chrome.com/docs/extensions/reference/runtime/)
