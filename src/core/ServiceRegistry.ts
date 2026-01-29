import * as vscode from 'vscode';
import { GitSyncService } from '../services/GitSyncService';
import { EditorEventManager } from '../services/EditorEventManager';
import { RecordContentTool } from '../llm/RecordContentTool';
import { IssueChatParticipant } from '../chat/IssueChatParticipant';
import { Logger } from './utils/Logger';

/**
 * 服务注册管理器
 * 
 * 负责初始化和管理扩展的核心服务组件，包括：
 * - Git同步服务：自动同步本地更改到远程仓库
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
    private readonly logger: Logger;

    /**
     * 创建服务注册管理器实例
     * 
     * @param context VS Code 扩展上下文，用于服务生命周期管理
     */
    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.logger = Logger.getInstance();
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
            // 0. 初始化编辑器事件管理器（基础服务，其他服务依赖它）
            this.initializeEditorEventManager();
            
            // 1. 初始化Git同步服务（核心功能）
            this.initializeGitSyncService();
            
            // 2. 注册Language Model Tool（增强功能）
            this.registerLanguageModelTool();
            
            // 3. 注册Chat Participant（AI 聊天集成）
            this.registerChatParticipant();
            
            this.logger.info('    ✓ 所有服务初始化完成');
        } catch (error) {
            this.logger.error('    ✗ 服务初始化过程中出现错误:', error);
            throw error;
        }
    }

    /**
     * 初始化编辑器事件管理器
     * 
     * 编辑器事件管理器统一管理编辑器相关的事件监听，
     * 避免重复订阅。必须在其他依赖编辑器事件的服务之前初始化。
     */
    private initializeEditorEventManager(): void {
        try {
            EditorEventManager.initialize(this.context);
            this.logger.info('      ✓ 编辑器事件管理器已启动');
        } catch (error) {
            this.logger.error('      ✗ 编辑器事件管理器启动失败:', error);
            throw error; // 这是基础服务，失败应该中断初始化
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
            this.logger.info('      ✓ Git同步服务已启动');
        } catch (error) {
            this.logger.error('      ✗ Git同步服务启动失败:', error);
            // Git服务失败不应该阻止整个扩展启动
            this.logger.warn('      ⚠️ 继续启动扩展，但Git自动同步功能将不可用');
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
                this.logger.info('      ✓ Language Model工具已注册');
            } else {
                this.logger.info('      ℹ️ Language Model API不可用，跳过AI工具注册');
            }
        } catch (error) {
            this.logger.error('      ✗ Language Model工具注册失败:', error);
            // AI功能是可选的，失败不影响核心功能
        }
    }

    /**
     * 注册Chat Participant
     * 
     * 如果VS Code支持Chat API,注册问题管理器聊天参与者,
     * 允许用户通过 @issueManager 在聊天中管理问题。
     */
    private registerChatParticipant(): void {
        try {
            const chatParticipant = new IssueChatParticipant();
            chatParticipant.register(this.context);
            this.logger.info('      ✓ Chat Participant已注册');
        } catch (error) {
            // IssueChatParticipant.register 内部已经做了 API 检查
            this.logger.error('      ✗ Chat Participant注册失败:', error);
        }
    }
}