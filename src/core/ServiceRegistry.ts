import * as vscode from 'vscode';
import { GitSyncService } from '../services/GitSyncService';
import { FileAccessTracker } from '../services/FileAccessTracker';
import { RecordContentTool } from '../llm/RecordContentTool';

/**
 * 服务注册管理器
 * 
 * 负责初始化和管理扩展的核心服务组件，包括：
 * - Git同步服务：自动同步本地更改到远程仓库
 * - 文件访问跟踪服务：跟踪文件访问模式和使用情况
 * - Language Model工具：集成AI助手功能
 * 
 * 所有服务的生命周期都与扩展上下文绑定，确保在扩展
 * 停用时能够正确清理资源。
 * 
 * @example
 * ```typescript
 * const registry = new ServiceRegistry(context);
 * registry.initializeServices();
 * ```
 */
export class ServiceRegistry {
    private readonly context: vscode.ExtensionContext;

    /**
     * 创建服务注册管理器实例
     * 
     * @param context VS Code 扩展上下文，用于服务生命周期管理
     */
    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    /**
     * 初始化所有服务
     * 
     * 按照依赖关系和重要性顺序初始化各个服务组件，
     * 确保关键服务优先启动。
     * 
     * @throws {Error} 当关键服务初始化失败时抛出错误
     */
    public initializeServices(): void {
        try {
            // 1. 初始化Git同步服务（核心功能）
            this.initializeGitSyncService();
            
            // 2. 初始化文件访问跟踪服务（性能监控）
            this.initializeFileAccessTracker();
            
            // 3. 注册Language Model Tool（增强功能）
            this.registerLanguageModelTool();
            
            console.log('    ✓ 所有服务初始化完成');
        } catch (error) {
            console.error('    ✗ 服务初始化过程中出现错误:', error);
            throw error;
        }
    }

    /**
     * 初始化Git同步服务
     * 
     * Git同步服务使用单例模式，负责监听文件变化并
     * 自动执行Git操作（添加、提交、推送）。
     * 
     * @throws {Error} Git服务初始化失败时抛出
     */
    private initializeGitSyncService(): void {
        try {
            const gitSyncService = GitSyncService.getInstance();
            gitSyncService.initialize();
            this.context.subscriptions.push(gitSyncService);
            console.log('      ✓ Git同步服务已启动');
        } catch (error) {
            console.error('      ✗ Git同步服务启动失败:', error);
            // Git服务失败不应该阻止整个扩展启动
            console.warn('      ⚠️ 继续启动扩展，但Git自动同步功能将不可用');
        }
    }

    /**
     * 初始化文件访问跟踪服务
     * 
     * 跟踪用户对问题文件的访问模式，用于优化
     * 最近问题列表和提供使用统计。
     */
    private initializeFileAccessTracker(): void {
        try {
            FileAccessTracker.initialize(this.context);
            console.log('      ✓ 文件访问跟踪服务已启动');
            // FileAccessTracker会自动处理其生命周期管理
        } catch (error) {
            console.error('      ✗ 文件访问跟踪服务启动失败:', error);
            // 非关键服务，失败不影响主要功能
        }
    }

    /**
     * 注册Language Model Tool
     * 
     * 如果VS Code支持Language Model API，注册扩展的
     * AI工具，允许AI助手调用扩展功能。
     */
    private registerLanguageModelTool(): void {
        try {
            if (vscode.lm && vscode.lm.registerTool) {
                this.context.subscriptions.push(
                    vscode.lm.registerTool('issueManager_recordContent', new RecordContentTool())
                );
                console.log('      ✓ Language Model工具已注册');
            } else {
                console.log('      ℹ️ Language Model API不可用，跳过AI工具注册');
            }
        } catch (error) {
            console.error('      ✗ Language Model工具注册失败:', error);
            // AI功能是可选的，失败不影响核心功能
        }
    }
}