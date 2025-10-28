/**
 * Git同步服务模块入口文件
 * 
 * 导出重构后的Git同步服务及相关组件。
 * 为了保持向后兼容性，主要导出GitSyncService类。
 */

// 主服务类
export { GitSyncService } from './GitSyncService';

// 类型定义
export { SyncStatus, SyncStatusInfo, RetryConfig } from './types';

// 组件模块（如果需要单独使用）
export { GitOperations } from './GitOperations';
export { SyncErrorHandler } from './SyncErrorHandler';
export { StatusBarManager } from './StatusBarManager';
export { SyncNotificationManager } from './SyncNotificationManager';
export { SyncRetryManager } from './SyncRetryManager';
