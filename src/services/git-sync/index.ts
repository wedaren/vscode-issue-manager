/**
 * Git同步服务模块入口文件
 * 
 * 本模块提供了完整的Git自动同步功能，用于管理VS Code问题管理器扩展的文件同步。
 * 
 * ## 核心功能
 * - 自动监听文件变更并同步到Git仓库
 * - 定期从远程仓库拉取更新
 * - 智能处理合并冲突
 * - 在状态栏显示同步状态
 * - 支持手动同步命令
 * 
 * ## 架构设计
 * 采用模块化设计，职责清晰分离：
 * - **GitSyncService**: 主服务类，协调各个模块，管理同步流程
 * - **GitOperations**: Git操作封装，提供底层Git命令的抽象
 * - **SyncErrorHandler**: 错误处理器，统一处理各类Git错误
 * - **FileWatcherManager**: 文件监听管理，处理文件变更事件
 * - **StatusBarManager**: 状态栏管理，显示同步状态
 * - **types**: 类型定义，提供类型安全
 * 
 * ## 使用示例
 * ```typescript
 * import { GitSyncService } from './services/git-sync';
 * 
 * // 在扩展激活时初始化
 * const gitSyncService = GitSyncService.getInstance();
 * gitSyncService.initialize();
 * context.subscriptions.push(gitSyncService);
 * 
 * // 服务会在扩展停用时自动清理资源
 * ```
 * 
 * ## 重构说明
 * 本模块经过重构，主要改进包括：
 * 1. 统一状态管理，减少重复的状态更新调用
 * 2. 改进依赖注入，确保单例模式正确工作
 * 3. 提取辅助方法，提高代码可读性和可测试性
 * 4. 优化错误处理，使用统一的错误创建方法
 * 5. 改进文件监听逻辑，提取方法减少复杂度
 * 6. 简化状态栏管理，使用映射表替代switch语句
 * 
 * @packageDocumentation
 */

// 主服务类
export { GitSyncService } from './GitSyncService';

// 类型定义
export { SyncStatus, SyncStatusInfo } from './types';

// 组件模块（如果需要单独使用）
export { GitOperations } from './GitOperations';
export { SyncErrorHandler } from './SyncErrorHandler';
export { FileWatcherManager } from './FileWatcherManager';
export { StatusBarManager } from './StatusBarManager';
