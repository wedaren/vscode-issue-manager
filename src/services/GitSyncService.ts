/**
 * Git同步服务 - 向后兼容入口文件
 * 
 * 为了保持向后兼容性，此文件重新导出重构后的Git同步服务。
 * 原始的单一文件已被拆分为多个模块，提高了代码的可维护性。
 * 
 * 重构结构：
 * - GitSyncService: 主服务类，协调各个模块
 * - GitOperations: Git操作封装
 * - SyncErrorHandler: 错误处理
 * - FileWatcherManager: 文件监听管理
 * - StatusBarManager: 状态栏管理
 * - types: 类型定义
 */

// 重新导出主服务类以保持向后兼容
export { GitSyncService, SyncStatus, SyncStatusInfo } from './git-sync';