/**
 * Chrome Runtime API 错误处理工具
 * 
 * 提供统一的错误识别和处理功能
 */

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
 * 
 * @example
 * ```typescript
 * try {
 *   await chrome.tabs.sendMessage(tabId, { type: 'HELLO' });
 * } catch (error) {
 *   if (isReceiverNotExistError(error)) {
 *     console.log('Receiver not found, trying to inject content script...');
 *   } else {
 *     throw error;
 *   }
 * }
 * ```
 */
export function isReceiverNotExistError(error: unknown): boolean {
  if (!(error instanceof Error) || !error.message) {
    return false;
  }

  // 已知的错误消息模式列表
  // 如果需要添加新的模式,请在这里添加并更新上面的文档
  const ERROR_PATTERNS = [
    'Receiving end does not exist',
    'Could not establish connection',
  ];

  return ERROR_PATTERNS.some(pattern => error.message.includes(pattern));
}
