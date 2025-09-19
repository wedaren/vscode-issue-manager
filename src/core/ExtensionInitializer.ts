import * as vscode from 'vscode';
import { CommandRegistry } from './CommandRegistry';
import { ViewRegistry } from './ViewRegistry';
import { ServiceRegistry } from './ServiceRegistry';
import { ConfigurationManager } from './ConfigurationManager';
import { IViewRegistryResult, InitializationPhase } from './interfaces';

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
    private readonly context: vscode.ExtensionContext;
    private readonly commandRegistry: CommandRegistry;
    private readonly viewRegistry: ViewRegistry;
    private readonly serviceRegistry: ServiceRegistry;
    private readonly configurationManager: ConfigurationManager;

    /**
     * 创建扩展初始化器实例
     * 
     * @param context VS Code 扩展上下文，用于管理扩展生命周期
     */
    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.commandRegistry = new CommandRegistry(context);
        this.viewRegistry = new ViewRegistry(context);
        this.serviceRegistry = new ServiceRegistry(context);
        this.configurationManager = new ConfigurationManager(context);
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
        console.log('🚀 开始初始化问题管理器扩展...');

        try {
            // 1. 初始化配置监听
            console.log('📋 步骤 1/4: 初始化配置监听...');
            await this.initializeConfigurationSafely();

            // 2. 初始化服务
            console.log('⚙️ 步骤 2/4: 初始化核心服务...');
            await this.initializeServicesSafely();

            // 3. 注册所有视图
            console.log('📊 步骤 3/4: 注册视图组件...');
            const views = await this.registerViewsSafely();

            // 4. 注册所有命令
            console.log('⌨️ 步骤 4/4: 注册命令处理器...');
            await this.registerCommandsSafely(views);

            const duration = Date.now() - startTime;
            console.log(`✅ 扩展初始化完成 (耗时: ${duration}ms)`);
            
            // 发送激活完成的通知
            vscode.window.showInformationMessage('问题管理器扩展已成功激活！');
            
        } catch (error) {
            const duration = Date.now() - startTime;
            const errorMessage = this.formatErrorMessage(error);
            
            console.error(`❌ 扩展初始化失败 (耗时: ${duration}ms):`, error);
            
            // 显示用户友好的错误消息
            const userMessage = `问题管理器扩展初始化失败: ${errorMessage}`;
            const actions = ['查看日志', '重试', '报告问题'];
            
            vscode.window.showErrorMessage(userMessage, ...actions).then(selection => {
                switch (selection) {
                    case '查看日志':
                        vscode.commands.executeCommand('workbench.action.toggleDevTools');
                        break;
                    case '重试':
                        // 延迟重试，避免立即失败
                        setTimeout(() => this.initialize(), 2000);
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
            console.log('  ✓ 配置监听器初始化成功');
        } catch (error) {
            console.error('  ✗ 配置管理器初始化失败:', error);
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
            console.log('  ✓ 核心服务初始化成功');
        } catch (error) {
            console.error('  ✗ 服务注册失败:', error);
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
            console.log('  ✓ 视图组件注册成功');
            return views;
        } catch (error) {
            console.error('  ✗ 视图注册失败:', error);
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
                views.focusedView
            );
            console.log('  ✓ 命令处理器注册成功');
        } catch (error) {
            console.error('  ✗ 命令注册失败:', error);
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
}