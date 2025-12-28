import * as vscode from 'vscode';
import { CommandRegistry } from './CommandRegistry';
import { ViewRegistry } from './ViewRegistry';
import { ServiceRegistry } from './ServiceRegistry';
import { ConfigurationManager } from './ConfigurationManager';
import { IViewRegistryResult, InitializationPhase } from './interfaces';
import { Logger } from './utils/Logger';
import { UnifiedFileWatcher } from '../services/UnifiedFileWatcher';
import { EditorContextService } from '../services/EditorContextService';

const INITIALIZATION_RETRY_DELAY_MS = 2000;

/**
 * 扩展初始化器
 * 
 * 负责协调和管理 VS Code 扩展的完整初始化流程，包括：
 * - 配置监听管理
 * - 服务初始化
 * - 视图注册
 * - 命令注册
 * 
 * 采用分阶段初始化策略，确保各个组件按正确顺序启动，
 * 并提供详细的错误处理和诊断信息。
 * 
 * @example
 * ```typescript
 * const initializer = new ExtensionInitializer(context);
 * await initializer.initialize();
 * ```
 */
export class ExtensionInitializer {
    private readonly commandRegistry: CommandRegistry;
    private readonly viewRegistry: ViewRegistry;
    private readonly serviceRegistry: ServiceRegistry;
    private readonly configurationManager: ConfigurationManager;
    private readonly logger: Logger;
    private readonly context: vscode.ExtensionContext;

    /**
     * 创建扩展初始化器实例
     * 
     * @param context VS Code 扩展上下文，用于管理扩展生命周期
     */
    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.logger = Logger.getInstance();
        this.logger.initialize(context.extensionMode); // 初始化Logger

        // 初始化统一文件监听器（全局单例）
        UnifiedFileWatcher.getInstance(context);

        // 构造 CommandRegistry 时注入常用服务实例，便于测试和管理
        // 延迟导入 WebviewManager/GraphDataService 类型实例以避免循环依赖问题
        // 使用运行时获取的单例实例传入 CommandRegistry
        // 注意：WebviewManager.getInstance 需要 context
        // GraphDataService 使用无参的单例获取
        // 这样在 CommandRegistry 中可以直接使用注入的实例，也兼容未注入时的回退逻辑
        const { WebviewManager } = require('../webview/WebviewManager');
        const { GraphDataService } = require('../services/GraphDataService');
        const webviewManager = WebviewManager.getInstance(context);
        const graphDataService = GraphDataService.getInstance();
        this.commandRegistry = new CommandRegistry(context, { webviewManager, graphDataService });
        this.viewRegistry = new ViewRegistry(context);
        this.serviceRegistry = new ServiceRegistry(context);
        this.configurationManager = new ConfigurationManager(context);
        
        // 注册logger到context订阅中，确保扩展停用时清理资源
        context.subscriptions.push({
            dispose: () => this.logger.dispose()
        });
    }

    /**
     * 初始化扩展
     * 
     * 按照预定义的顺序初始化各个组件：
     * 1. 配置监听 - 建立配置变化监听和文件系统监听
     * 2. 服务初始化 - 启动核心服务（Git同步、文件跟踪等）
     * 3. 视图注册 - 创建所有树视图和拖拽控制器
     * 4. 命令注册 - 注册所有VS Code命令
     * 
     * @returns Promise<void> 初始化完成后的Promise
     * @throws {Error} 当任何初始化阶段失败时抛出详细错误信息
     */
    public async initialize(): Promise<void> {
        const startTime = Date.now();
        this.logger.info('🚀 开始初始化问题管理器扩展...');

        // 监控内存使用情况
        const initialMemory = this.getMemoryUsage();
        this.logger.debug('初始内存使用情况', { heapUsed: `${initialMemory.heapUsed.toFixed(2)}MB` });

        try {
            // 1. 初始化配置监听
            this.logger.info('📋 步骤 1/4: 初始化配置监听...');
            await this.initializeConfigurationSafely();

            // 2. 初始化服务
            this.logger.info('⚙️ 步骤 2/4: 初始化核心服务...');
            await this.initializeServicesSafely();
            EditorContextService.initialize(this.context);

            // 3. 注册所有视图
            this.logger.info('📊 步骤 3/4: 注册视图组件...');
            const views = await this.registerViewsSafely();

            // 4. 注册所有命令
            this.logger.info('⌨️ 步骤 4/4: 注册命令处理器...');
            await this.registerCommandsSafely(views);

            const duration = Date.now() - startTime;
            const finalMemory = this.getMemoryUsage();
            const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
            
            this.logger.info('✅ 扩展初始化完成', {
                duration: `${duration}ms`,
                memoryIncrease: `${memoryIncrease.toFixed(2)}MB`,
                finalMemoryUsage: `${finalMemory.heapUsed.toFixed(2)}MB`
            });
        } catch (error) {
            const duration = Date.now() - startTime;
            const errorMessage = this.formatErrorMessage(error);
            
            this.logger.error(`❌ 扩展初始化失败 (耗时: ${duration}ms)`, { error, errorMessage });
            
            // 清理可能的部分初始化状态
            this.cleanupPartialInitialization();
            
            // 显示用户友好的错误消息
            const userMessage = `问题管理器扩展初始化失败: ${errorMessage}`;
            const actions = ['查看日志', '重试', '报告问题'];
            
            vscode.window.showErrorMessage(userMessage, ...actions).then(selection => {
                switch (selection) {
                    case '查看日志':
                        this.logger.show();
                        break;
                    case '重试':
                        // 延迟重试，避免立即失败
                        setTimeout(() => this.initialize(), INITIALIZATION_RETRY_DELAY_MS);
                        break;
                    case '报告问题':
                        vscode.env.openExternal(vscode.Uri.parse('https://github.com/wedaren/vscode-issue-manager/issues/new'));
                        break;
                }
            });
            
            // 重新抛出错误，让调用者知道初始化失败
            throw new Error(`扩展初始化失败: ${errorMessage}`);
        }
    }

    /**
     * 安全地初始化配置监听
     * 
     * 建立配置变化监听器和文件系统监听器，
     * 确保扩展能够响应用户配置的变化。
     * 
     * @throws {Error} 配置管理器初始化失败时抛出
     */
    private async initializeConfigurationSafely(): Promise<void> {
        try {
            this.configurationManager.initializeConfiguration();
            this.logger.info('  ✓ 配置监听器初始化成功');
        } catch (error) {
            this.logger.error('  ✗ 配置管理器初始化失败:', error);
            const phase = InitializationPhase.CONFIGURATION;
            throw new Error(`${phase}阶段失败: ${this.formatErrorMessage(error)}`);
        }
    }

    /**
     * 安全地初始化服务
     * 
     * 启动所有核心服务，包括：
     * - Git同步服务
     * - 文件访问跟踪服务
     * - Language Model工具
     * 
     * @throws {Error} 服务注册失败时抛出
     */
    private async initializeServicesSafely(): Promise<void> {
        try {
            this.serviceRegistry.initializeServices();
            this.logger.info('  ✓ 核心服务初始化成功');
        } catch (error) {
            this.logger.error('  ✗ 服务注册失败:', error);
            const phase = InitializationPhase.SERVICES;
            throw new Error(`${phase}阶段失败: ${this.formatErrorMessage(error)}`);
        }
    }

    /**
     * 安全地注册视图
     * 
     * 创建和注册所有树视图组件，包括：
     * - 问题总览视图
     * - 关注问题视图
     * - 最近问题视图
     * - RSS问题视图
     * - 问题结构视图
     * 
     * @returns {Promise<IViewRegistryResult>} 注册的视图实例
     * @throws {Error} 视图注册失败时抛出
     */
    private async registerViewsSafely(): Promise<IViewRegistryResult> {
        try {
            const views = this.viewRegistry.registerAllViews();
            this.logger.info('  ✓ 视图组件注册成功');
            return views;
        } catch (error) {
            this.logger.error('  ✗ 视图注册失败:', error);
            const phase = InitializationPhase.VIEWS;
            throw new Error(`${phase}阶段失败: ${this.formatErrorMessage(error)}`);
        }
    }

    /**
     * 安全地注册命令
     * 
     * 注册所有VS Code命令处理器，包括：
     * - 基础命令（创建、打开、刷新等）
     * - 视图操作命令
     * - 问题管理命令
     * - 工具命令
     * 
     * @param views 已注册的视图实例
     * @throws {Error} 命令注册失败时抛出
     */
    private async registerCommandsSafely(views: IViewRegistryResult): Promise<void> {
        try {
            this.commandRegistry.registerAllCommands(
                views.focusedIssuesProvider,
                views.issueOverviewProvider,
                views.recentIssuesProvider,
                views.overviewView,
                views.focusedView,
                // views.issueStructureProvider,
                // views.issueLogicalTreeProvider,
                views.paraViewProvider,
                views.paraView
            );
            this.logger.info('  ✓ 命令处理器注册成功');
        } catch (error) {
            this.logger.error('  ✗ 命令注册失败:', error);
            const phase = InitializationPhase.COMMANDS;
            throw new Error(`${phase}阶段失败: ${this.formatErrorMessage(error)}`);
        }
    }

    /**
     * 格式化错误消息
     * 
     * 将各种类型的错误转换为用户友好的字符串消息
     * 
     * @param error 要格式化的错误对象
     * @returns {string} 格式化后的错误消息
     */
    private formatErrorMessage(error: unknown): string {
        if (error instanceof Error) {
            return error.message;
        } else if (typeof error === 'string') {
            return error;
        } else {
            return '未知错误类型';
        }
    }

    /**
     * 获取当前内存使用情况
     * 
     * @returns 内存使用统计信息
     */
    private getMemoryUsage(): { heapUsed: number; heapTotal: number } {
        if (typeof process !== 'undefined' && process.memoryUsage) {
            const usage = process.memoryUsage();
            return {
                heapUsed: usage.heapUsed / 1024 / 1024, // 转换为MB
                heapTotal: usage.heapTotal / 1024 / 1024
            };
        }
        return { heapUsed: 0, heapTotal: 0 };
    }

    /**
     * 清理部分初始化状态
     * 
     * 在初始化失败时清理可能的部分状态，防止内存泄漏
     */
    private cleanupPartialInitialization(): void {
        try {
            // 这里可以添加清理逻辑，如果将来需要的话
            // 目前所有的清理都由VS Code的dispose机制处理
            this.logger.info('🧹 清理部分初始化状态...');
        } catch (error) {
            this.logger.error('清理部分初始化状态时出错:', error);
        }
    }
}