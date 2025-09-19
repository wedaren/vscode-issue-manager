import * as vscode from 'vscode';
import { getIssueDir } from '../config';
import { ensureGitignoreForRSSState } from '../utils/fileUtils';
import { debounce } from '../utils/debounce';

/**
 * 配置监听管理器
 * 
 * 负责监听和响应VS Code配置变化以及文件系统变化，
 * 确保扩展能够实时响应用户设置的更新和问题文件的变化。
 * 
 * 主要功能：
 * - 监听 issueManager.issueDir 配置变化
 * - 自动更新VS Code上下文状态
 * - 管理 .gitignore 文件的RSS状态规则
 * - 监听问题目录下Markdown文件的变化
 * - 防抖处理文件变化事件，避免频繁刷新
 * 
 * @example
 * ```typescript
 * const manager = new ConfigurationManager(context);
 * manager.initializeConfiguration();
 * ```
 */
export class ConfigurationManager {
    private readonly context: vscode.ExtensionContext;
    private watcher?: vscode.FileSystemWatcher;

    /**
     * 创建配置监听管理器实例
     * 
     * @param context VS Code 扩展上下文
     */
    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    /**
     * 初始化配置监听
     * 
     * 设置所有必要的监听器，包括配置变化监听和文件系统监听。
     * 确保扩展在启动时就能正确响应当前配置状态。
     * 
     * @throws {Error} 当关键监听器设置失败时抛出错误
     */
    public initializeConfiguration(): void {
        try {
            // 1. 首次激活时，立即更新上下文和Git配置
            this.updateContextAndGitignore();
            
            // 2. 监听配置变化
            this.setupConfigurationListener();
            
            // 3. 设置文件监听器
            this.setupFileWatcher();
            
            console.log('    ✓ 配置监听器设置完成');
        } catch (error) {
            console.error('    ✗ 配置监听器设置失败:', error);
            throw new Error(`配置监听器初始化失败: ${error instanceof Error ? error.message : '未知错误'}`);
        }
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