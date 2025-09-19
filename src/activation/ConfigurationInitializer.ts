import * as vscode from 'vscode';
import { getIssueDir } from '../config';
import { ensureGitignoreForRSSState } from '../utils/fileUtils';

/**
 * 配置初始化器
 * 负责处理扩展激活时的配置相关初始化工作
 */
export class ConfigurationInitializer {
    /**
     * 初始化配置和上下文
     */
    static initialize(context: vscode.ExtensionContext): void {
        console.log('恭喜，您的扩展"issue-manager"现已激活！');
        
        // 首次激活时，立即更新上下文
        const issueDir = getIssueDir();
        vscode.commands.executeCommand('setContext', 'issueManager.isDirConfigured', !!issueDir);
        
        // 自动合并 .gitignore 忽略规则
        if (issueDir) {
            ensureGitignoreForRSSState();
        }

        // 监听配置变化，以便在用户更改设置后再次更新上下文
        context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('issueManager.issueDir')) {
                const issueDir = getIssueDir();
                vscode.commands.executeCommand('setContext', 'issueManager.isDirConfigured', !!issueDir);
            }
        }));
    }
}