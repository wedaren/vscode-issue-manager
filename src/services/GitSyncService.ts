import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { simpleGit, SimpleGit, SimpleGitOptions, GitError, GitResponseError } from 'simple-git';
import { getIssueDir, isAutoSyncEnabled, getAutoCommitMessage, getChangeDebounceInterval, getPeriodicPullInterval } from '../config';

export enum SyncStatus {
    Synced = 'synced',           // 已同步，最新状态
    Syncing = 'syncing',         // 正在同步中
    HasLocalChanges = 'local',   // 有本地更改待推送
    /**
     * 暂时用不到
     */
    HasRemoteChanges = 'remote', // 有远程更新待拉取
    Conflict = 'conflict',       // 同步失败或冲突
    Disabled = 'disabled'        // 自动同步已禁用
}

export interface SyncStatusInfo {
    status: SyncStatus;
    message: string;
    lastSync?: Date;
}

export class GitSyncService {
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

    public static getInstance(): GitSyncService {
        if (!GitSyncService.instance) {
            GitSyncService.instance = new GitSyncService();
        }
        return GitSyncService.instance;
    }

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

    private handleSyncError(error: any): void {
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
            // 如果拉取失败，尝试简单的拉取
            try {
                await git.pull();
            } catch (fallbackError) {
                // 如果仍然失败，抛出原始错误
                throw error;
            }
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

    public dispose(): void {
        this.cleanup();
        this.statusBarItem.dispose();
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
    }

    // VS Code关闭前的最终同步
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
