import * as vscode from 'vscode';
import { getIssueDir } from '../config';
import { titleCache } from '../data/titleCache';
import { ensureGitignoreForRSSState } from '../utils/fileUtils';
import { Logger } from './utils/Logger';
import { UnifiedFileWatcher } from '../services/UnifiedFileWatcher';

const DEBOUNCE_REFRESH_DELAY_MS = 500;

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
    private readonly logger: Logger;
    
    // 文件监听订阅（配置变更时需要重建）
    private fileWatcherDisposables: vscode.Disposable[] = [];

    /**
     * 创建配置监听管理器实例
     * 
     * @param context VS Code 扩展上下文
     */
    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.logger = Logger.getInstance();
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
            
            this.logger.info('✓ 配置监听器设置完成');
        } catch (error) {
            this.logger.error('✗ 配置监听器设置失败:', error);
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
     * 
     * 清理旧的订阅并创建新的文件监听订阅。
     * 当 issueDir 配置变更时会被调用。
     */
    private setupFileWatcher(): void {
        // 清理旧的文件监听订阅，避免重复订阅导致内存泄漏
        this.cleanupFileWatcher();
        
        const issueDir = getIssueDir();
        if (!issueDir) {
            return;
        }

        const fileWatcher = UnifiedFileWatcher.getInstance(this.context);
        fileWatcher.onMarkdownChange((e) => {
            titleCache.get(e.uri); // 预热标题缓存
        });

        // 订阅内存标题缓存写入/更新事件，触发刷新所有视图（加短延迟以合并快速连续更新）
        this.fileWatcherDisposables.push(titleCache.onDidUpdate(() => {
            setTimeout(() => {
                vscode.commands.executeCommand('issueManager.refreshAllViews');
            }, 100);
        }));
    }

    /**
     * 清理文件监听器订阅
     * 
     * 在配置变更时调用，释放旧的文件监听订阅以避免内存泄漏。
     */
    private cleanupFileWatcher(): void {
        this.fileWatcherDisposables.forEach(d => d.dispose());
        this.fileWatcherDisposables = [];
    }
}