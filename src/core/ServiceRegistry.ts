import * as vscode from 'vscode';
import { GitSyncService } from '../services/GitSyncService';
import { FileAccessTracker } from '../services/FileAccessTracker';
import { RecordContentTool } from '../llm/RecordContentTool';

/**
 * 服务注册管理器
 * 负责初始化和注册所有服务
 */
export class ServiceRegistry {
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    /**
     * 初始化所有服务
     */
    public initializeServices(): void {
        // 初始化Git同步服务
        this.initializeGitSyncService();
        
        // 初始化文件访问跟踪服务
        this.initializeFileAccessTracker();
        
        // 注册Language Model Tool
        this.registerLanguageModelTool();
    }

    /**
     * 初始化Git同步服务
     */
    private initializeGitSyncService(): void {
        const gitSyncService = GitSyncService.getInstance();
        gitSyncService.initialize();
        this.context.subscriptions.push(gitSyncService);
    }

    /**
     * 初始化文件访问跟踪服务
     */
    private initializeFileAccessTracker(): void {
        const fileAccessTracker = FileAccessTracker.initialize(this.context);
        // FileAccessTracker会自动处理其生命周期管理
    }

    /**
     * 注册Language Model Tool
     */
    private registerLanguageModelTool(): void {
        if (vscode.lm && vscode.lm.registerTool) {
            this.context.subscriptions.push(
                vscode.lm.registerTool('issueManager_recordContent', new RecordContentTool())
            );
        }
    }
}