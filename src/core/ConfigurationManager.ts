import * as vscode from 'vscode';
import { getIssueDir } from '../config';
import { ensureGitignoreForRSSState } from '../utils/fileUtils';
import { debounce } from '../utils/debounce';

/**
 * 配置监听管理器
 * 负责监听配置变化和文件系统变化
 */
export class ConfigurationManager {
    private context: vscode.ExtensionContext;
    private watcher?: vscode.FileSystemWatcher;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    /**
     * 初始化配置监听
     */
    public initializeConfiguration(): void {
        // 首次激活时，立即更新上下文
        this.updateContextAndGitignore();
        
        // 监听配置变化
        this.setupConfigurationListener();
        
        // 设置文件监听器
        this.setupFileWatcher();
    }

    /**
     * 更新上下文和.gitignore
     */
    private updateContextAndGitignore(): void {
        const issueDir = getIssueDir();
        vscode.commands.executeCommand('setContext', 'issueManager.isDirConfigured', !!issueDir);
        
        // 自动合并 .gitignore 忽略规则
        if (issueDir) {
            ensureGitignoreForRSSState();
        }
    }

    /**
     * 设置配置监听器
     */
    private setupConfigurationListener(): void {
        const configListener = vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('issueManager.issueDir')) {
                this.updateContextAndGitignore();
                this.setupFileWatcher(); // 重新设置文件监听器
                // 刷新所有视图以反映新目录的内容
                vscode.commands.executeCommand('issueManager.refreshAllViews');
            }
        });
        
        this.context.subscriptions.push(configListener);
    }

    /**
     * 设置文件监听器
     */
    private setupFileWatcher(): void {
        // 清理旧的监听器
        if (this.watcher) {
            this.watcher.dispose();
            // 从 subscriptions 中移除旧的引用
            const index = this.context.subscriptions.indexOf(this.watcher);
            if (index !== -1) {
                this.context.subscriptions.splice(index, 1);
            }
        }

        const issueDir = getIssueDir();
        if (issueDir) {
            this.watcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(issueDir, '**/*.md')
            );

            const debouncedRefresh = debounce(() => {
                console.log('Markdown file changed, refreshing views...');
                vscode.commands.executeCommand('issueManager.refreshAllViews');
            }, 500);

            this.watcher.onDidChange(debouncedRefresh);
            this.watcher.onDidCreate(debouncedRefresh);
            this.watcher.onDidDelete(debouncedRefresh);

            this.context.subscriptions.push(this.watcher);
        }
    }
}