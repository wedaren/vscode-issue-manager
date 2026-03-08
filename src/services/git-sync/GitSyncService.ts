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
 * Git自动同步服务
 *
 * 同步策略: commit → pull → push
 * - 先 commit 保证本地数据安全
 * - 再 pull 合并远程更新
 * - 最后 push 推送到远程
 * - 网络不可用时本地 commit 仍会执行，push 延迟到下次
 *
 * 采用单例模式，实现 vscode.Disposable 接口。
 */
export class GitSyncService implements vscode.Disposable {
    private static instance: GitSyncService;
    private periodicTimer?: NodeJS.Timeout;
    private isConflictMode = false;
    private currentStatus: SyncStatusInfo = { status: SyncStatus.Disabled, message: '初始化中...' };

    // 分离不同生命周期的资源管理
    private fileWatcherDisposables: vscode.Disposable[] = [];
    private serviceDisposables: vscode.Disposable[] = [];

    // 防抖函数
    private debouncedAutoCommitAndPush: DebouncedFunction<() => void>;

    private constructor(
        private readonly statusBarManager: StatusBarManager,
        private readonly notificationManager: SyncNotificationManager,
        private readonly retryManager: SyncRetryManager
    ) {
        this.debouncedAutoCommitAndPush = debounce(
            () => this.performAutoCommitAndPush(),
            getChangeDebounceInterval() * 1000
        );

        this.setStatus({ status: SyncStatus.Disabled, message: '自动同步已禁用' });
    }

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
     */
    public initialize(): void {
        this.setupAutoSync();
        this.registerCommands();

        const configWatcher = vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('issueManager.sync')) {
                this.setupAutoSync();
            }
        });
        this.serviceDisposables.push(configWatcher);

        if (isAutoSyncEnabled()) {
            this.performInitialSync();
        }
    }

    /**
     * 设置自动同步功能
     */
    private setupAutoSync(): void {
        this.cleanup();

        if (!isAutoSyncEnabled()) {
            this.setStatus({ status: SyncStatus.Disabled, message: '自动同步已禁用' });
            this.statusBarManager.setVisible(false);
            return;
        }

        this.statusBarManager.setVisible(true);

        const issueDir = getIssueDir();
        if (!issueDir) {
            this.setStatus({ status: SyncStatus.Disabled, message: '请先配置问题目录' });
            return;
        }

        if (!GitOperations.isGitRepository(issueDir)) {
            this.setStatus({ status: SyncStatus.Disabled, message: '问题目录不是Git仓库' });
            return;
        }

        this.setupFileWatcher();
        this.setupPeriodicPull();

        this.setStatus({ status: SyncStatus.Synced, message: '自动同步已启用' });
    }

    /**
     * 设置文件监听器
     */
    private setupFileWatcher(): void {
        this.cleanupFileWatcher();

        const fileWatcher = UnifiedFileWatcher.getInstance();

        const onFileChange = () => {
            if (this.isConflictMode) {
                // 冲突模式下，文件变更时自动检测冲突是否已解决
                this.checkConflictResolved();
                return;
            }
            this.triggerSync();
        };

        this.fileWatcherDisposables.push(
            fileWatcher.onMarkdownChange(onFileChange)
        );

        this.fileWatcherDisposables.push(
            fileWatcher.onIssueManagerChange(onFileChange)
        );
    }

    /**
     * 触发同步操作（用于程序化调用）
     */
    public triggerSync(): void {
        if (!isAutoSyncEnabled()) {
            return;
        }

        const issueDir = getIssueDir();
        if (!issueDir || !GitOperations.isGitRepository(issueDir)) {
            return;
        }

        if (this.isConflictMode) {
            return;
        }

        this.setStatus({
            status: SyncStatus.HasLocalChanges,
            message: '有本地更改待同步'
        });

        this.debouncedAutoCommitAndPush();
    }

    /**
     * 清理文件监听器
     */
    private cleanupFileWatcher(): void {
        Logger.getInstance().debug('清理文件监听器,取消待处理的防抖调用');
        this.debouncedAutoCommitAndPush.cancel();

        this.fileWatcherDisposables.forEach(d => d.dispose());
        this.fileWatcherDisposables = [];
    }

    /**
     * 设置周期性拉取
     */
    private setupPeriodicPull(): void {
        const interval = getPeriodicPullInterval();
        if (interval <= 0) {
            return;
        }

        this.periodicTimer = setInterval(() => {
            if (!this.isConflictMode && this.currentStatus.status !== SyncStatus.Syncing) {
                this.performPeriodicSync();
            }
        }, interval * 60 * 1000);
    }

    private registerCommands(): void {
        const syncCommand = vscode.commands.registerCommand('issueManager.synchronizeNow', () => {
            this.performManualSync();
        });
        this.serviceDisposables.push(syncCommand);
    }

    /**
     * 执行初始同步
     */
    private async performInitialSync(): Promise<void> {
        const issueDir = getIssueDir();
        if (!issueDir || !GitOperations.isGitRepository(issueDir)) {
            return;
        }

        this.notificationManager.info('开始初始化同步...');
        this.setStatus({ status: SyncStatus.Syncing, message: '正在初始化同步...' });

        try {
            // 初始同步：如果有未推送的本地 commit，先推送；然后 pull
            if (await GitOperations.hasLocalChanges(issueDir)) {
                await GitOperations.commitAndPushChanges(issueDir);
            } else {
                await GitOperations.pullChanges(issueDir);
            }

            this.setStatus({
                status: SyncStatus.Synced,
                message: '初始化同步完成',
                lastSync: new Date()
            });
            this.notificationManager.info('初始化同步完成');
        } catch (error) {
            this.notificationManager.error('初始化同步失败', error);
            this.handleSyncError(error);
        }
    }

    /**
     * 执行自动提交和推送
     *
     * 同步策略: commit → pull → push（由 GitOperations.commitAndPushChanges 实现）
     * 网络不可用时，commitAndPushChanges 内部已完成本地 commit，不会丢数据。
     */
    private async performAutoCommitAndPush(): Promise<void> {
        const issueDir = getIssueDir();
        if (!issueDir || this.isConflictMode) {
            return;
        }

        this.setStatus({ status: SyncStatus.Syncing, message: '正在自动同步...' });

        try {
            const pushed = await this.retryManager.executeWithRetry(
                'auto-sync',
                async () => {
                    if (await GitOperations.hasLocalChanges(issueDir)) {
                        // commit → pull → push 一体化操作
                        await GitOperations.commitAndPushChanges(issueDir);
                        return true;
                    }
                    // 没有本地变更，只做 pull 获取远程更新
                    await GitOperations.pullChanges(issueDir);
                    return false;
                },
                (attempt, nextDelay) => {
                    this.notificationManager.notifyRetry(
                        attempt,
                        this.retryManager.getRetryCount('auto-sync'),
                        nextDelay
                    );
                }
            );

            this.setStatus({
                status: SyncStatus.Synced,
                message: pushed ? '自动同步完成' : '已是最新状态',
                lastSync: new Date()
            });
        } catch (error) {
            // 所有重试都失败后，尝试至少做一次本地 commit
            await this.tryLocalCommitFallback(issueDir);

            const maxRetries = this.retryManager.getRetryCount('auto-sync');
            if (maxRetries > 0) {
                this.notificationManager.notifyRetryExhausted(maxRetries, error);
            }
            this.handleSyncError(error);
        }
    }

    /**
     * 周期性同步：pull 远程更新，如果有未推送的本地 commit 则一并推送
     */
    private async performPeriodicSync(): Promise<void> {
        const issueDir = getIssueDir();
        if (!issueDir) {
            return;
        }

        try {
            await this.retryManager.executeWithRetry(
                'periodic-pull',
                async () => {
                    // 如果有本地变更（包括之前断网未推送的 commit），执行完整同步
                    if (await GitOperations.hasLocalChanges(issueDir)) {
                        await GitOperations.commitAndPushChanges(issueDir);
                    } else {
                        await GitOperations.pullChanges(issueDir);
                    }
                },
                (attempt, nextDelay) => {
                    this.notificationManager.info(
                        `周期性同步失败，将在 ${nextDelay} 秒后重试 (${attempt} 次)`
                    );
                }
            );

            if (this.currentStatus.status !== SyncStatus.HasLocalChanges) {
                this.setStatus({
                    status: SyncStatus.Synced,
                    message: '已是最新状态',
                    lastSync: new Date()
                });
            }
        } catch (error) {
            this.notificationManager.error('周期性同步失败', error);
        }
    }

    /**
     * 执行手动同步
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

        // 冲突模式下检查是否已解决
        if (this.isConflictMode) {
            if (await GitOperations.hasConflicts(issueDir)) {
                vscode.window.showWarningMessage('请先解决合并冲突');
                return;
            } else {
                this.isConflictMode = false;
                this.setupAutoSync();
                vscode.window.showInformationMessage('冲突已解决，自动同步已恢复');
                return;
            }
        }

        this.setStatus({ status: SyncStatus.Syncing, message: '正在手动同步...' });

        try {
            if (await GitOperations.hasLocalChanges(issueDir)) {
                // commit → pull → push
                await GitOperations.commitAndPushChanges(issueDir);
            } else {
                await GitOperations.pullChanges(issueDir);
            }

            this.setStatus({
                status: SyncStatus.Synced,
                message: '手动同步完成',
                lastSync: new Date()
            });
            vscode.window.showInformationMessage('同步完成');
        } catch (error) {
            this.handleSyncError(error);
            vscode.window.showErrorMessage(`同步失败: ${error instanceof Error ? error.message : '未知错误'}`);
        }
    }

    /**
     * 网络失败时的本地 commit 兜底
     */
    private async tryLocalCommitFallback(issueDir: string): Promise<void> {
        try {
            const committed = await GitOperations.commitLocalChanges(issueDir);
            if (committed) {
                this.notificationManager.info('网络不可用，已将变更保存到本地 Git（推送将在网络恢复后自动完成）');
            }
        } catch {
            // 兜底操作失败不再抛出
        }
    }

    /**
     * 冲突模式下自动检测冲突是否已解决
     */
    private async checkConflictResolved(): Promise<void> {
        const issueDir = getIssueDir();
        if (!issueDir) {
            return;
        }

        try {
            if (!(await GitOperations.hasConflicts(issueDir))) {
                Logger.getInstance().info('[GitSync] 检测到冲突已解决，自动恢复同步');
                this.isConflictMode = false;
                this.setupAutoSync();
                vscode.window.showInformationMessage('冲突已解决，自动同步已恢复');
            }
        } catch {
            // 检测失败不做处理，等待下次触发
        }
    }

    private handleSyncError(error: unknown): void {
        const result = SyncErrorHandler.handleSyncError(error);
        this.setStatus(result.statusInfo);

        if (result.enterConflictMode) {
            this.enterConflictMode();
        }
    }

    private enterConflictMode(): void {
        this.isConflictMode = true;
        // 冲突模式：停止定时器和重试，但保留文件监听器以检测冲突解决
        if (this.periodicTimer) {
            clearInterval(this.periodicTimer);
            this.periodicTimer = undefined;
        }
        this.debouncedAutoCommitAndPush.cancel();
        this.retryManager.cleanup();

        SyncErrorHandler.showConflictDialog();
    }

    private setStatus(statusInfo: SyncStatusInfo): void {
        this.currentStatus = statusInfo;
        this.statusBarManager.updateStatusBar(this.currentStatus);
        this.notificationManager.notifyStatusChange(this.currentStatus);
    }

    private cleanup(): void {
        if (this.periodicTimer) {
            clearInterval(this.periodicTimer);
            this.periodicTimer = undefined;
        }

        this.cleanupFileWatcher();
        this.retryManager.cleanup();
    }

    public dispose(): void {
        this.cleanup();
        this.statusBarManager.dispose();
        this.notificationManager.dispose();
        GitOperations.cleanup();

        this.serviceDisposables.forEach(d => d.dispose());
        this.serviceDisposables = [];
    }

    /**
     * VS Code 关闭前的最终同步
     *
     * 采用 commit → pull → push 策略。如果 push 失败，本地 commit 已保存。
     * 下次启动时 performInitialSync 会检测未推送的 commit 并补推。
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
                // commit → pull → push，push 失败也不影响关闭
                await GitOperations.commitAndPushChanges(issueDir);
            }
        } catch (error) {
            // 如果 commitAndPushChanges 失败（比如 push 失败），
            // 本地 commit 已经在 commitAndPushChanges 内部完成，数据安全
            Logger.getInstance().warn('Final sync push failed (local commit preserved):', error);
        }
    }
}
