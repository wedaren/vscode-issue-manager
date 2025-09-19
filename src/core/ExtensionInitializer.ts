import * as vscode from 'vscode';
import { CommandRegistry } from './CommandRegistry';
import { ViewRegistry } from './ViewRegistry';
import { ServiceRegistry } from './ServiceRegistry';
import { ConfigurationManager } from './ConfigurationManager';

/**
 * 扩展初始化器
 * 统一协调各个管理器的初始化
 */
export class ExtensionInitializer {
    private context: vscode.ExtensionContext;
    private commandRegistry: CommandRegistry;
    private viewRegistry: ViewRegistry;
    private serviceRegistry: ServiceRegistry;
    private configurationManager: ConfigurationManager;

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
            this.configurationManager.initializeConfiguration();

            // 2. 初始化服务
            this.serviceRegistry.initializeServices();

            // 3. 注册所有视图
            const views = this.viewRegistry.registerAllViews();

            // 4. 注册所有命令
            this.commandRegistry.registerAllCommands(
                views.focusedIssuesProvider,
                views.issueOverviewProvider,
                views.recentIssuesProvider,
                views.overviewView,
                views.focusedView
            );

            console.log('扩展初始化完成');
        } catch (error) {
            console.error('扩展初始化失败:', error);
            vscode.window.showErrorMessage('问题管理器扩展初始化失败，请检查控制台输出。');
        }
    }
}