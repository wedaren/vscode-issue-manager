import * as vscode from 'vscode';
import { GitSyncService } from '../services/GitSyncService';
import { FileAccessTracker } from '../services/FileAccessTracker';
import { RecordContentTool } from '../llm/RecordContentTool';

/**
 * 服务初始化器
 * 负责初始化各种服务和工具
 */
export class ServiceInitializer {
    /**
     * 初始化所有服务
     */
    static initialize(context: vscode.ExtensionContext): void {
        // 初始化Git同步服务
        const gitSyncService = GitSyncService.getInstance();
        gitSyncService.initialize();
        context.subscriptions.push(gitSyncService);

        // 初始化文件访问跟踪服务
        const fileAccessTracker = FileAccessTracker.initialize(context);

        // 注册 Language Model Tool
        if (vscode.lm && vscode.lm.registerTool) {
            context.subscriptions.push(
                vscode.lm.registerTool('issueManager_recordContent', new RecordContentTool())
            );
        }
    }
}