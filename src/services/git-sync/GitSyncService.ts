import * as vscode from 'vscode';
import { getIssueDir, isAutoSyncEnabled, getPeriodicPullInterval, getChangeDebounceInterval } from '../../config';
import { SyncStatus, SyncStatusInfo } from './types';
import { GitOperations } from './GitOperations';
import { SyncErrorHandler } from './SyncErrorHandler';
import { StatusBarManager } from './StatusBarManager';
import { SyncNotificationManager } from './SyncNotificationManager';
import { SyncRetryManager } from './SyncRetryManager';
import { UnifiedFileWatcher } from '../UnifiedFileWatcher';
import { debounce, DebouncedFunction } from '../../utils/debounce';
import { Logger } from '../../core/utils/Logger';

/**
 * Git自动同步服务（重构版）
 * 
 * 提供问题管理扩展的Git自动同步功能，包括：
 * - 监听问题文件和配置文件的变化
 * - 自动提交和推送本地更改
 * - 定期从远程仓库拉取更新
 * - 处理合并冲突和网络错误
 * - 在状态栏显示同步状态
 * 
 * 采用单例模式，确保全局只有一个同步服务实例。
 * 实现了vscode.Disposable接口，可以被添加到扩展的subscriptions中进行资源管理。
 * 
 * 重构后的版本将职责分离到不同的模块：
 * - GitOperations: 底层Git操作
 * - SyncErrorHandler: 错误处理
 * - UnifiedFileWatcher: 统一文件监听
 * - StatusBarManager: 状态栏管理
 * 
 * @example
 * ```typescript
 * // 在扩展激活时初始化
 * const gitSyncService = GitSyncService.getInstance();
 * gitSyncService.initialize();
 * context.subscriptions.push(gitSyncService);
 * 
 * // 服务会在扩展停用时自动清理资源
 * ```
 */
export class GitSyncService implements vscode.Disposable {
    private static instance: GitSyncService;
    private periodicTimer?: NodeJS.Timeout;
    private isConflictMode = false;
    private currentStatus: SyncStatusInfo;
    
    // 分离不同生命周期的资源管理
    private fileWatcherDisposables: vscode.Disposable[] = []; // 文件监听订阅，setupAutoSync 时重建
    private serviceDisposables: vscode.Disposable[] = []; // 服务级资源（命令、配置监听），仅在 dispose 时清理
    
    // 防抖函数
    private debouncedAutoCommitAndPush: DebouncedFunction<() => void>;

    // 依赖注入组件
    private constructor(
        private readonly statusBarManager: StatusBarManager,
        private readonly notificationManager: SyncNotificationManager,
        private readonly retryManager: SyncRetryManager
    ) {
        this.currentStatus = { status: SyncStatus.Disabled, message: '自动同步已禁用' };
        this.updateStatusBar();
        
        // 初始化防抖函数
        this.debouncedAutoCommitAndPush = debounce(
            () => this.performAutoCommitAndPush(),
            getChangeDebounceInterval() * 1000
        );
    }

    /**
     * 获取GitSyncService的单例实例
     * 
     * @returns GitSyncService的唯一实例
     * @example
     * ```typescript
     * const syncService = GitSyncService.getInstance();
     * syncService.initialize();
     * ```
     */
    public static getInstance(): GitSyncService {
        if (!GitSyncService.instance) {
            GitSyncService.instance = new GitSyncService(
                new StatusBarManager(),
                new SyncNotificationManager(),
                new SyncRetryManager()
            );
        }
        return GitSyncService.instance;
    }

    /**
     * 初始化Git同步服务
     * 
     * 设置自动同步功能，包括：
     * - 注册VS Code命令
     * - 设置文件监听器
     * - 配置周期性拉取
     * - 监听配置变更
     * - 执行初始同步（如果启用）
     * 
     * 应在扩展激活时调用此方法。
     * 
     * @example
     * ```typescript
     * const syncService = GitSyncService.getInstance();
     * syncService.initialize();
     * context.subscriptions.push(syncService);
     * ```
     */
    public initialize(): void {
        this.setupAutoSync();
        this.registerCommands();
        
        // 监听配置变更（服务级资源，只在 dispose 时清理）
        const configWatcher = vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('issueManager.sync')) {
                this.setupAutoSync(); // 配置变更时重新设置
            }
        });
        this.serviceDisposables.push(configWatcher);

        // VS Code启动时执行初始同步
        if (isAutoSyncEnabled()) {
            this.performInitialSync();
        }
    }

    /**
     * 设置自动同步功能
     * 
     * 根据当前配置初始化或重新配置自动同步功能。
     * 如果自动同步被禁用或配置不正确，会更新状态并停止自动化功能。
     */
    private setupAutoSync(): void {
        // 清理现有的监听器和定时器
        this.cleanup();
        
        if (!isAutoSyncEnabled()) {
            this.currentStatus = { status: SyncStatus.Disabled, message: '自动同步已禁用' };
            this.updateStatusBar();
            return;
        }

        const issueDir = getIssueDir();
        if (!issueDir) {
            this.currentStatus = { status: SyncStatus.Disabled, message: '请先配置问题目录' };
            this.updateStatusBar();
            return;
        }

        // 检查是否为Git仓库
        if (!GitOperations.isGitRepository(issueDir)) {
            this.currentStatus = { status: SyncStatus.Disabled, message: '问题目录不是Git仓库' };
            this.updateStatusBar();
            return;
        }

        // 设置文件监听器
        this.setupFileWatcher();
        
        // 设置周期性拉取
        this.setupPeriodicPull();
        
        this.currentStatus = { status: SyncStatus.Synced, message: '自动同步已启用' };
        this.updateStatusBar();
    }

    /**
     * 设置文件监听器
     * 
     * 使用 UnifiedFileWatcher 监听问题文件和配置文件的变化。
     */
    private setupFileWatcher(): void {
        // 清理旧的监听器
        this.cleanupFileWatcher();

        const fileWatcher = UnifiedFileWatcher.getInstance();

        const onFileChange = () => {
            this.handleFileChange();
        };

        // 订阅 Markdown 文件变更（文件监听资源，setupAutoSync 时重建）
        this.fileWatcherDisposables.push(
            fileWatcher.onMarkdownChange(onFileChange)
        );

        // 订阅 .issueManager 目录下所有文件变更
        this.fileWatcherDisposables.push(
            fileWatcher.onIssueManagerChange(onFileChange)
        );
    }

    /**
     * 处理文件变更事件
     * 
     * 当文件发生变化时：
     * 1. 检查是否处于冲突模式，如果是则忽略
     * 2. 更新状态为"有本地更改待同步"
     * 3. 触发防抖的自动同步操作
     */
    private handleFileChange(): void {
        if (this.isConflictMode) {
            return;
        }
        
        // 立即更新状态，提供即时反馈
        this.currentStatus = { 
            status: SyncStatus.HasLocalChanges, 
            message: '有本地更改待同步' 
        };
        this.updateStatusBar();

        // 触发防抖的同步操作
        this.debouncedAutoCommitAndPush();
    }

    /**
     * 清理文件监听器
     */
    private cleanupFileWatcher(): void {
        // 取消待处理的防抖调用
        Logger.getInstance().debug('清理文件监听器,取消待处理的防抖调用');
        this.debouncedAutoCommitAndPush.cancel();

        // 只清理文件监听相关的订阅
        this.fileWatcherDisposables.forEach(d => d.dispose());
        this.fileWatcherDisposables = [];
    }

    /**
     * 设置周期性拉取
     * 
     * 根据配置的时间间隔定期从远程仓库拉取更新。
     */
    private setupPeriodicPull(): void {
        const interval = getPeriodicPullInterval();
        if (interval <= 0) {
            return;
        }

        this.periodicTimer = setInterval(() => {
            if (!this.isConflictMode && this.currentStatus.status !== SyncStatus.Syncing) {
                this.performPull();
            }
        }, interval * 60 * 1000);
    }

    /**
     * 注册VS Code命令
     * 
     * 注册手动同步命令，用户可以通过命令面板或状态栏点击触发。
     */
    private registerCommands(): void {
        const syncCommand = vscode.commands.registerCommand('issueManager.synchronizeNow', () => {
            this.performManualSync();
        });
        // 命令注册是服务级资源，只在 dispose 时清理
        this.serviceDisposables.push(syncCommand);
    }

    /**
     * 执行初始同步
     * 
     * 在服务启动时执行一次同步，确保本地仓库是最新状态。
     */
    private async performInitialSync(): Promise<void> {
        const issueDir = getIssueDir();
        if (!issueDir || !GitOperations.isGitRepository(issueDir)) {
            return;
        }

        this.currentStatus = { status: SyncStatus.Syncing, message: '正在初始化同步...' };
        this.updateStatusBar();

        try {
            await GitOperations.pullChanges(issueDir);
            this.currentStatus = { 
                status: SyncStatus.Synced, 
                message: '初始化同步完成', 
                lastSync: new Date() 
            };
        } catch (error) {
            this.handleSyncError(error);
        }
        this.updateStatusBar();
    }

    /**
     * 执行自动提交和推送
     * 
     * 当检测到文件变化时自动触发的同步操作。
     */
    private async performAutoCommitAndPush(): Promise<void> {
        const issueDir = getIssueDir();
        if (!issueDir || this.isConflictMode) {
            return;
        }

        this.currentStatus = { status: SyncStatus.Syncing, message: '正在自动同步...' };
        this.updateStatusBar();

        try {
            // 使用重试机制执行同步操作
            await this.retryManager.executeWithRetry(
                'auto-sync',
                async () => {
                    // 先拉取
                    await GitOperations.pullChanges(issueDir);
                    
                    // 检查是否有本地更改
                    if (await GitOperations.hasLocalChanges(issueDir)) {
                        // 提交并推送
                        await GitOperations.commitAndPushChanges(issueDir);
                    }
                },
                (attempt, nextDelay) => {
                    // 重试回调
                    this.notificationManager.notifyRetry(
                        attempt,
                        this.retryManager.getRetryCount('auto-sync'),
                        nextDelay
                    );
                }
            );

            // 同步成功
            this.currentStatus = { 
                status: SyncStatus.Synced, 
                message: '自动同步完成', 
                lastSync: new Date() 
            };
        } catch (error) {
            // 所有重试都失败了
            const maxRetries = this.retryManager.getRetryCount('auto-sync');
            if (maxRetries > 0) {
                this.notificationManager.notifyRetryExhausted(
                    maxRetries,
                    error instanceof Error ? error.message : String(error)
                );
            }
            this.handleSyncError(error);
        }
        this.updateStatusBar();
    }

    /**
     * 执行周期性拉取
     * 
     * 定期从远程仓库拉取更新，确保本地仓库保持最新状态。
     */
    private async performPull(): Promise<void> {
        const issueDir = getIssueDir();
        if (!issueDir) {
            return;
        }

        try {
            // 使用重试机制执行拉取操作
            await this.retryManager.executeWithRetry(
                'periodic-pull',
                async () => {
                    await GitOperations.pullChanges(issueDir);
                },
                (attempt, nextDelay) => {
                    // 周期性拉取失败时的重试，不需要显示通知
                    this.notificationManager.info(
                        `周期性拉取失败，将在 ${nextDelay} 秒后重试 (${attempt} 次)`
                    );
                }
            );

            if (this.currentStatus.status !== SyncStatus.HasLocalChanges) {
                this.currentStatus = { 
                    status: SyncStatus.Synced, 
                    message: '已是最新状态', 
                    lastSync: new Date() 
                };
                this.updateStatusBar();
            }
        } catch (error) {
            // 周期性拉取失败不应该触发冲突模式，只记录错误
            this.notificationManager.error('周期性拉取失败', error);
            // 不调用 handleSyncError，避免进入冲突模式
        }
    }

    /**
     * 执行手动Git同步
     * 
     * 用户手动触发的同步操作，执行以下步骤：
     * 1. 验证问题目录配置和Git仓库状态
     * 2. 检查并处理任何现有的合并冲突
     * 3. 从远程仓库拉取最新更改
     * 4. 提交并推送本地更改（如果有）
     * 5. 更新同步状态并显示结果消息
     * 
     * 此方法通过VS Code命令"issueManager.synchronizeNow"调用，
     * 也可以通过点击状态栏的同步按钮触发。
     * 
     * @returns Promise，在同步完成或失败时解决
     * 
     * @example
     * ```typescript
     * const syncService = GitSyncService.getInstance();
     * await syncService.performManualSync();
     * ```
     */
    public async performManualSync(): Promise<void> {
        const issueDir = getIssueDir();
        if (!issueDir) {
            vscode.window.showWarningMessage('请先配置问题目录');
            return;
        }

        if (!GitOperations.isGitRepository(issueDir)) {
            vscode.window.showWarningMessage('问题目录不是Git仓库');
            return;
        }

        // 如果处于冲突模式，检查是否已解决
        if (this.isConflictMode) {
            if (await GitOperations.hasConflicts(issueDir)) {
                vscode.window.showWarningMessage('请先解决合并冲突');
                return;
            } else {
                // 冲突已解决，恢复自动化
                this.isConflictMode = false;
                this.setupAutoSync();
                vscode.window.showInformationMessage('冲突已解决，自动同步已恢复');
                return;
            }
        }

        this.currentStatus = { status: SyncStatus.Syncing, message: '正在手动同步...' };
        this.updateStatusBar();

        try {
            // 拉取
            await GitOperations.pullChanges(issueDir);
            
            // 提交并推送（如果有更改）
            if (await GitOperations.hasLocalChanges(issueDir)) {
                await GitOperations.commitAndPushChanges(issueDir);
            }
            
            this.currentStatus = { 
                status: SyncStatus.Synced, 
                message: '手动同步完成', 
                lastSync: new Date() 
            };
            vscode.window.showInformationMessage('同步完成');
        } catch (error) {
            this.handleSyncError(error);
            vscode.window.showErrorMessage(`同步失败: ${error instanceof Error ? error.message : '未知错误'}`);
        }
        this.updateStatusBar();
    }

    /**
     * 处理同步错误
     * 
     * 使用SyncErrorHandler分析错误并设置相应的状态。
     * 如果需要进入冲突模式，会停止自动化功能并显示处理对话框。
     */
    private handleSyncError(error: unknown): void {
        const result = SyncErrorHandler.handleSyncError(error);
        this.currentStatus = result.statusInfo;
        
        if (result.enterConflictMode) {
            this.enterConflictMode();
        }
    }

    /**
     * 进入冲突模式
     * 
     * 当检测到合并冲突时，停止所有自动化操作并显示处理对话框。
     */
    private enterConflictMode(): void {
        this.isConflictMode = true;
        this.cleanup(); // 停止所有自动化操作
        this.updateStatusBar();
        SyncErrorHandler.showConflictDialog();
    }

    /**
     * 更新状态栏显示并发送通知
     * 
     * 使用StatusBarManager更新状态栏的显示内容，
     * 并通过NotificationManager发送必要的通知。
     */
    private updateStatusBar(): void {
        this.statusBarManager.updateStatusBar(this.currentStatus);
        this.notificationManager.notifyStatusChange(this.currentStatus);
    }

    /**
     * 清理资源
     * 
     * 清理定时器和文件监听器，但保留状态栏。
     */
    private cleanup(): void {
        if (this.periodicTimer) {
            clearInterval(this.periodicTimer);
            this.periodicTimer = undefined;
        }
        
        this.cleanupFileWatcher();
        this.retryManager.cleanup();
    }

    /**
     * 释放Git同步服务的所有资源
     * 
     * 执行清理操作，包括：
     * - 清除所有定时器和监听器
     * - 释放状态栏项目
     * - 销毁所有可释放资源
     * 
     * 此方法应在扩展停用时调用，确保没有资源泄漏。
     * 实现了VS Code的Disposable接口。
     * 
     * @example
     * ```typescript
     * // 在扩展的deactivate函数中调用
     * const syncService = GitSyncService.getInstance();
     * syncService.dispose();
     * ```
     */
    public dispose(): void {
        this.cleanup();
        this.statusBarManager.dispose();
        this.notificationManager.dispose();
        
        // 清理服务级资源（命令、配置监听器）
        this.serviceDisposables.forEach(d => d.dispose());
        this.serviceDisposables = [];
    }

    /**
     * 执行VS Code关闭前的最终同步
     * 
     * 在扩展停用前尝试同步任何未保存的本地更改，确保工作不会丢失。
     * 此方法执行以下检查：
     * 1. 验证自动同步已启用且不在冲突模式
     * 2. 检查问题目录和Git仓库状态
     * 3. 如果有本地更改，尝试提交并推送
     * 
     * 如果同步失败，会记录错误但不会阻塞扩展的关闭流程。
     * 这是一个"尽力而为"的操作，不应该影响用户体验。
     * 
     * @returns Promise，在同步尝试完成后解决（无论成功或失败）
     * 
     * @example
     * ```typescript
     * // 在扩展的deactivate函数中调用
     * export async function deactivate() {
     *     const syncService = GitSyncService.getInstance();
     *     await syncService.performFinalSync();
     * }
     * ```
     */
    public async performFinalSync(): Promise<void> {
        if (!isAutoSyncEnabled() || this.isConflictMode) {
            return;
        }
        
        const issueDir = getIssueDir();
        if (!issueDir || !GitOperations.isGitRepository(issueDir)) {
            return;
        }

        try {
            if (await GitOperations.hasLocalChanges(issueDir)) {
                await GitOperations.commitAndPushChanges(issueDir);
            }
        } catch (error) {
            console.error('Final sync failed:', error);
            // 关闭前的同步失败不显示错误，避免阻塞关闭流程
        }
    }
}
