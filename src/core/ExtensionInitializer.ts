import * as vscode from 'vscode';
import { CommandRegistry } from './CommandRegistry';
import { ViewRegistry } from './ViewRegistry';
import { ServiceRegistry } from './ServiceRegistry';
import { ConfigurationManager } from './ConfigurationManager';
import { IViewRegistryResult } from './interfaces';

/**
 * 扩展初始化器
 * 统一协调各个管理器的初始化
 */
export class ExtensionInitializer {
    private readonly context: vscode.ExtensionContext;
    private readonly commandRegistry: CommandRegistry;
    private readonly viewRegistry: ViewRegistry;
    private readonly serviceRegistry: ServiceRegistry;
    private readonly configurationManager: ConfigurationManager;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.commandRegistry = new CommandRegistry(context);
        this.viewRegistry = new ViewRegistry(context);
        this.serviceRegistry = new ServiceRegistry(context);
        this.configurationManager = new ConfigurationManager(context);
    }

    /**
     * 初始化扩展
     */
    public async initialize(): Promise<void> {
        console.log('恭喜，您的扩展"issue-manager"现已激活！');

        try {
            // 1. 初始化配置监听
            this.initializeConfigurationSafely();

            // 2. 初始化服务
            this.initializeServicesSafely();

            // 3. 注册所有视图
            const views = this.registerViewsSafely();

            // 4. 注册所有命令
            this.registerCommandsSafely(views);

            console.log('扩展初始化完成');
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : '未知错误';
            console.error('扩展初始化失败:', error);
            vscode.window.showErrorMessage(`问题管理器扩展初始化失败: ${errorMessage}`);
            throw error; // 重新抛出错误，让调用者知道初始化失败
        }
    }

    /**
     * 安全地初始化配置监听
     */
    private initializeConfigurationSafely(): void {
        try {
            this.configurationManager.initializeConfiguration();
        } catch (error) {
            console.error('配置管理器初始化失败:', error);
            throw new Error('配置管理器初始化失败');
        }
    }

    /**
     * 安全地初始化服务
     */
    private initializeServicesSafely(): void {
        try {
            this.serviceRegistry.initializeServices();
        } catch (error) {
            console.error('服务注册失败:', error);
            throw new Error('服务注册失败');
        }
    }

    /**
     * 安全地注册视图
     */
    private registerViewsSafely(): IViewRegistryResult {
        try {
            return this.viewRegistry.registerAllViews();
        } catch (error) {
            console.error('视图注册失败:', error);
            throw new Error('视图注册失败');
        }
    }

    /**
     * 安全地注册命令
     */
    private registerCommandsSafely(views: IViewRegistryResult): void {
        try {
            this.commandRegistry.registerAllCommands(
                views.focusedIssuesProvider,
                views.issueOverviewProvider,
                views.recentIssuesProvider,
                views.overviewView,
                views.focusedView
            );
        } catch (error) {
            console.error('命令注册失败:', error);
            throw new Error('命令注册失败');
        }
    }
}