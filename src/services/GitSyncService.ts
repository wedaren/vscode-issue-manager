/**
 * Git同步服务 - 向后兼容入口文件
 *
 * 重构结构：
 * - GitSyncService: 主服务类，协调各个模块
 * - GitOperations: Git操作封装（支持 LLM 智能提交消息）
 * - SyncErrorHandler: 错误处理
 * - StatusBarManager: 状态栏管理
 * - SyncRetryManager: 重试管理
 * - SyncNotificationManager: 通知管理
 * - types: 类型定义
 */

// 重新导出主服务类以保持向后兼容
export { GitSyncService, SyncStatus, SyncStatusInfo } from './git-sync';