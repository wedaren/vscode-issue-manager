import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { simpleGit, SimpleGit, SimpleGitOptions, GitError, GitResponseError } from 'simple-git';
import { getIssueDir, isAutoSyncEnabled, getAutoCommitMessage, getChangeDebounceInterval, getPeriodicPullInterval } from '../config';

/**
 * Git同步状态枚举
 * 
 * 定义Git自动同步服务的各种状态，用于状态栏显示和内部状态管理。
 */
export enum SyncStatus {
    /** 已同步，本地和远程仓库保持最新状态 */
    Synced = 'synced',
    /** 正在同步中，正在执行Git操作 */
    Syncing = 'syncing',
    /** 有本地更改待推送到远程仓库 */
    HasLocalChanges = 'local',
    /** 有远程更新待拉取到本地（暂时用不到） */
    HasRemoteChanges = 'remote',
    /** 同步失败或存在合并冲突 */
    Conflict = 'conflict',
    /** 自动同步功能已禁用 */
    Disabled = 'disabled'
}

/**
 * 同步状态信息接口
 * 
 * 包含同步状态的详细信息，用于状态栏显示和错误处理。
 */
export interface SyncStatusInfo {
    /** 当前同步状态 */
    status: SyncStatus;
    /** 状态描述消息，显示给用户 */
    message: string;
    /** 上次同步时间，用于显示时间间隔 */
    lastSync?: Date;
}

/**
 * Git自动同步服务
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
    private statusBarItem: vscode.StatusBarItem;
    private fileWatcher?: vscode.FileSystemWatcher;
    private configWatcher?: vscode.FileSystemWatcher;
    private debounceTimer?: NodeJS.Timeout;
    private periodicTimer?: NodeJS.Timeout;
    private isConflictMode = false;
    private currentStatus: SyncStatusInfo;
    private disposables: vscode.Disposable[] = [];

    private constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.statusBarItem.command = 'issueManager.synchronizeNow';
        this.currentStatus = { status: SyncStatus.Disabled, message: '自动同步已禁用' };
        this.updateStatusBar();
        this.statusBarItem.show();
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
            GitSyncService.instance = new GitSyncService();
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
        
        // 监听配置变更
        const configWatcher = vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('issueManager.sync')) {
                this.setupAutoSync();
            }
        });
        this.disposables.push(configWatcher);

        // VS Code启动时执行初始同步
        if (isAutoSyncEnabled()) {
            this.performInitialSync();
        }
    }

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
        if (!this.isGitRepository(issueDir)) {
            this.currentStatus = { status: SyncStatus.Disabled, message: '问题目录不是Git仓库' };
            this.updateStatusBar();
            return;
        }

        // 设置文件监听器
        this.setupFileWatcher(issueDir);
        
        // 设置周期性拉取
        this.setupPeriodicPull();
        
        this.currentStatus = { status: SyncStatus.Synced, message: '自动同步已启用' };
        this.updateStatusBar();
    }

    private setupFileWatcher(issueDir: string): void {
        // 监听问题文件（.md文件）
        const mdPattern = new vscode.RelativePattern(issueDir, '**/*.md');
        this.fileWatcher = vscode.workspace.createFileSystemWatcher(mdPattern);

        // 监听配置目录（.issueManager目录下的所有文件）
        const configPattern = new vscode.RelativePattern(path.join(issueDir, '.issueManager'), '**/*');
        this.configWatcher = vscode.workspace.createFileSystemWatcher(configPattern);

        const onFileChange = () => {
            if (this.isConflictMode) {
                return;
            }
            
            // 防抖处理
            if (this.debounceTimer) {
                clearTimeout(this.debounceTimer);
            }
            
            this.currentStatus = { status: SyncStatus.HasLocalChanges, message: '有本地更改待同步' };
            this.updateStatusBar();

            const debounceInterval = getChangeDebounceInterval() * 1000;
            this.debounceTimer = setTimeout(() => {
                this.performAutoCommitAndPush();
            }, debounceInterval);
        };

        // 为问题文件监听器绑定事件
        this.fileWatcher.onDidChange(onFileChange);
        this.fileWatcher.onDidCreate(onFileChange);
        this.fileWatcher.onDidDelete(onFileChange);

        // 为配置文件监听器绑定事件
        this.configWatcher.onDidChange(onFileChange);
        this.configWatcher.onDidCreate(onFileChange);
        this.configWatcher.onDidDelete(onFileChange);

        this.disposables.push(this.fileWatcher);
        this.disposables.push(this.configWatcher);
    }

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

    private registerCommands(): void {
        const syncCommand = vscode.commands.registerCommand('issueManager.synchronizeNow', () => {
            this.performManualSync();
        });
        this.disposables.push(syncCommand);
    }

    private async performInitialSync(): Promise<void> {
        const issueDir = getIssueDir();
        if (!issueDir || !this.isGitRepository(issueDir)) {
            return;
        }

        this.currentStatus = { status: SyncStatus.Syncing, message: '正在初始化同步...' };
        this.updateStatusBar();

        try {
            await this.pullChanges(issueDir);
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

    private async performAutoCommitAndPush(): Promise<void> {
        const issueDir = getIssueDir();
        if (!issueDir || this.isConflictMode) {
            return;
        }

        this.currentStatus = { status: SyncStatus.Syncing, message: '正在自动同步...' };
        this.updateStatusBar();

        try {
            // 先拉取
            await this.pullChanges(issueDir);
            
            // 检查是否有本地更改
            if (await this.hasLocalChanges(issueDir)) {
                // 提交并推送
                await this.commitAndPushChanges(issueDir);
                this.currentStatus = { 
                    status: SyncStatus.Synced, 
                    message: '自动同步完成', 
                    lastSync: new Date() 
                };
            } else {
                this.currentStatus = { 
                    status: SyncStatus.Synced, 
                    message: '没有变更需要同步', 
                    lastSync: new Date() 
                };
            }
        } catch (error) {
            this.handleSyncError(error);
        }
        this.updateStatusBar();
    }

    private async performPull(): Promise<void> {
        const issueDir = getIssueDir();
        if (!issueDir) {
            return;
        }

        try {
            await this.pullChanges(issueDir);
            if (this.currentStatus.status !== SyncStatus.HasLocalChanges) {
                this.currentStatus = { 
                    status: SyncStatus.Synced, 
                    message: '已是最新状态', 
                    lastSync: new Date() 
                };
                this.updateStatusBar();
            }
        } catch (error) {
            this.handleSyncError(error);
            this.updateStatusBar();
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

        if (!this.isGitRepository(issueDir)) {
            vscode.window.showWarningMessage('问题目录不是Git仓库');
            return;
        }

        // 如果处于冲突模式，检查是否已解决
        if (this.isConflictMode) {
            if (await this.hasConflicts(issueDir)) {
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
            await this.pullChanges(issueDir);
            
            // 提交并推送（如果有更改）
            if (await this.hasLocalChanges(issueDir)) {
                await this.commitAndPushChanges(issueDir);
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

    private handleSyncError(error: unknown): void {  
        console.error('Git sync error:', error);
        
        // 优先使用 simple-git 的特定错误类型进行判断
        if (error instanceof GitResponseError) {
            // GitResponseError 通常表示Git操作成功但结果被视为错误（如合并冲突）
            const response = error.git;
            if (response && typeof response === 'object') {
                // 检查是否是合并相关的错误
                if ('conflicts' in response || 'failed' in response) {
                    this.enterConflictMode();
                    return;
                }
            }
            
            // 检查错误消息是否包含冲突信息
            if (error.message && (error.message.includes('conflict') || error.message.includes('merge') || 
                error.message.includes('冲突') || error.message.includes('合并'))) {
                this.enterConflictMode();
                return;
            }
        }
        
        if (error instanceof GitError) {
            // GitError 表示 Git 进程级别的错误
            const errorMessage = error.message?.toLowerCase() || '';
            
            // 检查SSH连接错误
            if (errorMessage.includes('ssh: connect to host') || 
                errorMessage.includes('undefined error: 0') ||
                errorMessage.includes('无法读取远程仓库') ||
                errorMessage.includes('could not read from remote repository') ||
                (errorMessage.includes('ssh') && (errorMessage.includes('port 22') || errorMessage.includes('github.com')))) {
                this.currentStatus = { 
                    status: SyncStatus.Conflict, 
                    message: `SSH连接错误: 无法连接到GitHub，请检查网络和SSH配置` 
                };
                return;
            }
            
            // 检查网络相关错误
            if (errorMessage.includes('network') || errorMessage.includes('connection') ||
                errorMessage.includes('econnreset') || errorMessage.includes('timeout') ||
                errorMessage.includes('网络') || errorMessage.includes('连接') ||
                errorMessage.includes('超时')) {
                this.currentStatus = { 
                    status: SyncStatus.Conflict, 
                    message: `网络错误: ${error.message.split('\n')[0]}` 
                };
                return;
            }
            
            // 检查认证相关错误
            if (errorMessage.includes('authentication') || errorMessage.includes('permission') ||
                errorMessage.includes('access denied') || errorMessage.includes('unauthorized') ||
                errorMessage.includes('认证') || errorMessage.includes('权限') ||
                errorMessage.includes('拒绝访问') || errorMessage.includes('未授权')) {
                this.currentStatus = { 
                    status: SyncStatus.Conflict, 
                    message: `认证错误: ${error.message.split('\n')[0]}` 
                };
                return;
            }
        }
        
        // 后备方案：基于错误消息文本的检查（保持向后兼容）
        if (error instanceof Error) {
            const errorMessage = error.message.toLowerCase();
            
            // 检查是否是冲突错误
            if (errorMessage.includes('conflict') || errorMessage.includes('merge') ||
                errorMessage.includes('冲突') || errorMessage.includes('合并')) {
                this.enterConflictMode();
                return;
            }
            
            // 检查SSH连接错误
            if (errorMessage.includes('ssh: connect to host') || 
                errorMessage.includes('undefined error: 0') ||
                errorMessage.includes('无法读取远程仓库') ||
                errorMessage.includes('could not read from remote repository') ||
                (errorMessage.includes('ssh') && (errorMessage.includes('port 22') || errorMessage.includes('github.com')))) {
                this.currentStatus = { 
                    status: SyncStatus.Conflict, 
                    message: `SSH连接错误: 无法连接到GitHub，请检查网络和SSH配置` 
                };
                return;
            }
            
            // 检查是否是网络错误
            if (errorMessage.includes('network') || errorMessage.includes('connection') || 
                errorMessage.includes('econnreset') || errorMessage.includes('timeout') ||
                errorMessage.includes('网络') || errorMessage.includes('连接') ||
                errorMessage.includes('超时')) {
                this.currentStatus = { 
                    status: SyncStatus.Conflict, 
                    message: `网络错误: ${error.message.split('\n')[0]}` 
                };
                return;
            }
            
            // 检查是否是认证错误
            if (errorMessage.includes('authentication') || errorMessage.includes('permission') ||
                errorMessage.includes('认证') || errorMessage.includes('权限')) {
                this.currentStatus = { 
                    status: SyncStatus.Conflict, 
                    message: `认证错误: ${error.message.split('\n')[0]}` 
                };
                return;
            }
            
            // 检查是否是Git配置错误
            if (errorMessage.includes('无法变基') || errorMessage.includes('rebase') ||
                errorMessage.includes('cannot rebase') || errorMessage.includes('变基')) {
                this.currentStatus = { 
                    status: SyncStatus.Conflict, 
                    message: `Git操作错误，请检查仓库状态` 
                };
                return;
            }
        }
        
        // 通用错误处理
        this.currentStatus = { 
            status: SyncStatus.Conflict, 
            message: `同步失败: ${error instanceof Error ? error.message.split('\n')[0] : '未知错误'}` 
        };
    }

    private enterConflictMode(): void {
        this.isConflictMode = true;
        this.cleanup(); // 停止所有自动化操作
        
        this.currentStatus = { status: SyncStatus.Conflict, message: '存在合并冲突，需要手动解决' };
        this.updateStatusBar();

        // 显示冲突处理对话框
        vscode.window.showErrorMessage(
            '自动同步失败，因为存在合并冲突。自动化功能已暂停，请手动解决冲突。',
            '打开文件以解决冲突'
        ).then(selection => {
            if (selection === '打开文件以解决冲突') {
                vscode.commands.executeCommand('git.openMergeEditor');
            }
        });
    }

    private updateStatusBar(): void {
        const { status, message } = this.currentStatus;
        
        switch (status) {
            case SyncStatus.Synced:
                this.statusBarItem.text = '同步问题 $(sync)';
                break;
            case SyncStatus.Syncing:
                this.statusBarItem.text = '同步问题 $(sync~spin)';
                break;
            case SyncStatus.HasLocalChanges:
                this.statusBarItem.text = '同步问题 $(cloud-upload)';
                break;
            case SyncStatus.HasRemoteChanges:
                this.statusBarItem.text = '同步问题 $(cloud-download)';
                break;
            case SyncStatus.Conflict:
                this.statusBarItem.text = '同步问题 $(error)';
                break;
            case SyncStatus.Disabled:
                this.statusBarItem.text = '同步问题 $(sync-ignored)';
                break;
        }

        let tooltip = message;
        if (this.currentStatus.lastSync) {
            const timeAgo = this.getTimeAgo(this.currentStatus.lastSync);
            tooltip += `\n上次同步: ${timeAgo}`;
        }
        if (isAutoSyncEnabled()) {
            tooltip += '\n点击立即同步';
        }
        
        this.statusBarItem.tooltip = tooltip;
    }

    private getTimeAgo(date: Date): string {
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / (1000 * 60));
        
        if (diffMins < 1) {
            return '刚刚';
        }
        if (diffMins < 60) {
            return `${diffMins}分钟前`;
        }
        
        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) {
            return `${diffHours}小时前`;
        }
        
        const diffDays = Math.floor(diffHours / 24);
        return `${diffDays}天前`;
    }

    // Git操作方法
    private isGitRepository(dir: string): boolean {
        return fs.existsSync(path.join(dir, '.git'));
    }

    private getGit(cwd: string): SimpleGit {
        const options: Partial<SimpleGitOptions> = {
            baseDir: cwd,
            binary: 'git',
            maxConcurrentProcesses: 1,
        };
        return simpleGit(options);
    }

    private async pullChanges(cwd: string): Promise<void> {
        const git = this.getGit(cwd);
        try {
            // 先检查当前分支
            const branchSummary = await git.branch();
            const currentBranch = branchSummary.current;
            
            // 获取远程分支状态
            await git.fetch('origin');
            
            // 拉取当前分支的更新，使用merge而非rebase避免复杂情况
            await git.pull('origin', currentBranch, { '--no-rebase': null });  
        } catch (error) {
            // 直接抛出错误，由上层统一处理。  
            // 简单的 git.pull() 可能会根据用户配置意外触发 rebase，  
            // 导致自动化流程中出现非预期的行为。  
            // 保持明确的错误处理路径更为安全。  
            throw error;
        }
    }

    private async hasLocalChanges(cwd: string): Promise<boolean> {
        const git = this.getGit(cwd);
        const status = await git.status();
        return !status.isClean();
    }

    private async hasConflicts(cwd: string): Promise<boolean> {
        const git = this.getGit(cwd);
        const status = await git.status();
        return status.conflicted.length > 0;
    }

    private async commitAndPushChanges(cwd: string): Promise<void> {
        const git = this.getGit(cwd);
        
        // 添加所有更改
        await git.add('.');
        
        // 生成提交消息
        const template = getAutoCommitMessage();
        const commitMessage = template.replace('{date}', new Date().toISOString());  
        
        // 提交
        await git.commit(commitMessage);
        
        // 获取当前分支并推送
        const branchSummary = await git.branch();
        const currentBranch = branchSummary.current;
        await git.push('origin', currentBranch);
    }

    private async testGitConnectivity(cwd: string): Promise<boolean> {
        try {
            const git = this.getGit(cwd);
            // 尝试简单的远程操作来测试连接性
            await git.listRemote(['--heads', 'origin']);
            return true;
        } catch (error) {
            console.log('Git connectivity test failed:', error);
            return false;
        }
    }

    private cleanup(): void {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = undefined;
        }
        
        if (this.periodicTimer) {
            clearInterval(this.periodicTimer);
            this.periodicTimer = undefined;
        }
        
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
            this.fileWatcher = undefined;
        }

        if (this.configWatcher) {
            this.configWatcher.dispose();
            this.configWatcher = undefined;
        }
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
        this.statusBarItem.dispose();
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
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
        if (!issueDir || !this.isGitRepository(issueDir)) {
            return;
        }

        try {
            if (await this.hasLocalChanges(issueDir)) {
                await this.commitAndPushChanges(issueDir);
            }
        } catch (error) {
            console.error('Final sync failed:', error);
            // 关闭前的同步失败不显示错误，避免阻塞关闭流程
        }
    }
}
