import * as vscode from 'vscode';
import { GitError, GitResponseError } from 'simple-git';
import { SyncStatus, SyncStatusInfo } from './types';

/**
 * Git同步错误处理器
 * 
 * 负责处理Git同步过程中的各种错误类型，包括：
 * - 合并冲突
 * - 网络连接错误
 * - SSH认证错误
 * - Git操作错误
 * 
 * 根据错误类型设置相应的状态信息，并在必要时进入冲突模式。
 */
export class SyncErrorHandler {
    /**
     * 处理同步错误
     * 
     * 分析错误类型并返回相应的状态信息。
     * 支持的错误类型识别：
     * - GitResponseError: Git操作成功但结果被视为错误（如合并冲突）
     * - GitError: Git进程级别的错误
     * - Error: 通用错误类型
     * 
     * @param error 要处理的错误
     * @returns 错误处理结果，包含状态信息和是否需要进入冲突模式
     */
    public static handleSyncError(error: unknown): { 
        statusInfo: SyncStatusInfo, 
        enterConflictMode: boolean 
    } {
        console.error('Git sync error:', error);
        
        // 优先使用 simple-git 的特定错误类型进行判断
        if (error instanceof GitResponseError) {
            return this.handleGitResponseError(error);
        }
        
        if (error instanceof GitError) {
            return this.handleGitError(error);
        }
        
        // 后备方案：基于错误消息文本的检查（保持向后兼容）
        if (error instanceof Error) {
            return this.handleGenericError(error);
        }
        
        // 通用错误处理
        return this.createErrorResult(
            '同步失败: 未知错误',
            false
        );
    }

    /**
     * 创建错误结果对象
     * 
     * @param message 错误消息
     * @param enterConflictMode 是否需要进入冲突模式
     * @returns 错误处理结果
     */
    private static createErrorResult(
        message: string, 
        enterConflictMode: boolean
    ): { statusInfo: SyncStatusInfo, enterConflictMode: boolean } {
        return {
            statusInfo: { 
                status: SyncStatus.Conflict, 
                message 
            },
            enterConflictMode
        };
    }

    /**
     * 提取错误消息的第一行
     * 
     * @param message 完整错误消息
     * @returns 第一行消息
     */
    private static getFirstLine(message: string): string {
        return message.split('\n')[0];
    }

    /**
     * 处理GitResponseError类型的错误
     * 
     * GitResponseError通常表示Git操作成功但结果被视为错误（如合并冲突）
     */
    private static handleGitResponseError(error: GitResponseError): { 
        statusInfo: SyncStatusInfo, 
        enterConflictMode: boolean 
    } {
        const response = error.git;
        
        // 检查是否是合并相关的错误
        if (response && typeof response === 'object' && 
            ('conflicts' in response || 'failed' in response)) {
            return this.createErrorResult('存在合并冲突，需要手动解决', true);
        }
        
        // 检查错误消息是否包含冲突信息
        if (error.message && this.isConflictError(error.message.toLowerCase())) {
            return this.createErrorResult('存在合并冲突，需要手动解决', true);
        }

        return this.createErrorResult(
            `Git操作错误: ${this.getFirstLine(error.message)}`,
            false
        );
    }

    /**
     * 处理GitError类型的错误
     * 
     * GitError表示Git进程级别的错误
     */
    private static handleGitError(error: GitError): { 
        statusInfo: SyncStatusInfo, 
        enterConflictMode: boolean 
    } {
        const errorMessage = error.message?.toLowerCase() || '';
        
        // 检查SSH连接错误
        if (this.isSSHConnectionError(errorMessage)) {
            return this.createErrorResult(
                'SSH连接错误: 无法连接到GitHub，请检查网络和SSH配置',
                false
            );
        }
        
        // 检查网络相关错误
        if (this.isNetworkError(errorMessage)) {
            return this.createErrorResult(
                `网络错误: ${this.getFirstLine(error.message)}`,
                false
            );
        }
        
        // 检查认证相关错误
        if (this.isAuthenticationError(errorMessage)) {
            return this.createErrorResult(
                `认证错误: ${this.getFirstLine(error.message)}`,
                false
            );
        }

        return this.createErrorResult(
            `Git错误: ${this.getFirstLine(error.message)}`,
            false
        );
    }

    /**
     * 处理通用Error类型的错误
     */
    private static handleGenericError(error: Error): { 
        statusInfo: SyncStatusInfo, 
        enterConflictMode: boolean 
    } {
        const errorMessage = error.message.toLowerCase();
        
        // 检查是否是冲突错误
        if (this.isConflictError(errorMessage)) {
            return this.createErrorResult('存在合并冲突，需要手动解决', true);
        }
        
        // 检查SSH连接错误
        if (this.isSSHConnectionError(errorMessage)) {
            return this.createErrorResult(
                'SSH连接错误: 无法连接到GitHub，请检查网络和SSH配置',
                false
            );
        }
        
        // 检查是否是网络错误
        if (this.isNetworkError(errorMessage)) {
            return this.createErrorResult(
                `网络错误: ${this.getFirstLine(error.message)}`,
                false
            );
        }
        
        // 检查是否是认证错误
        if (this.isAuthenticationError(errorMessage)) {
            return this.createErrorResult(
                `认证错误: ${this.getFirstLine(error.message)}`,
                false
            );
        }
        
        // 检查是否是Git配置错误
        if (this.isGitConfigError(errorMessage)) {
            return this.createErrorResult('Git操作错误，请检查仓库状态', false);
        }

        return this.createErrorResult(
            `同步失败: ${this.getFirstLine(error.message)}`,
            false
        );
    }

    /**
     * 显示冲突处理对话框
     * 
     * 当检测到合并冲突时，向用户显示处理选项。
     */
    public static async showConflictDialog(): Promise<void> {
        const selection = await vscode.window.showErrorMessage(
            '自动同步失败，因为存在合并冲突。自动化功能已暂停，请手动解决冲突。',
            '打开文件以解决冲突'
        );
        if (selection === '打开文件以解决冲突') {
            await vscode.commands.executeCommand('issueManager.openIssueDir');
        }
    }

    // ========== 错误类型检查辅助方法 ==========

    /**
     * 检查是否为冲突错误
     */
    private static isConflictError(errorMessage: string): boolean {
        return errorMessage.includes('conflict') || 
               errorMessage.includes('merge') ||
               errorMessage.includes('冲突') || 
               errorMessage.includes('合并');
    }

    /**
     * 检查是否为SSH连接错误
     */
    private static isSSHConnectionError(errorMessage: string): boolean {
        return errorMessage.includes('ssh: connect to host') || 
               errorMessage.includes('undefined error: 0') ||
               errorMessage.includes('无法读取远程仓库') ||
               errorMessage.includes('could not read from remote repository') ||
               (errorMessage.includes('ssh') && 
                (errorMessage.includes('port 22') || errorMessage.includes('github.com')));
    }

    /**
     * 检查是否为网络错误
     */
    private static isNetworkError(errorMessage: string): boolean {
        return errorMessage.includes('network') || 
               errorMessage.includes('connection') ||
               errorMessage.includes('econnreset') || 
               errorMessage.includes('timeout') ||
               errorMessage.includes('网络') || 
               errorMessage.includes('连接') ||
               errorMessage.includes('超时');
    }

    /**
     * 检查是否为认证错误
     */
    private static isAuthenticationError(errorMessage: string): boolean {
        return errorMessage.includes('authentication') || 
               errorMessage.includes('permission') ||
               errorMessage.includes('access denied') || 
               errorMessage.includes('unauthorized') ||
               errorMessage.includes('认证') || 
               errorMessage.includes('权限') ||
               errorMessage.includes('拒绝访问') || 
               errorMessage.includes('未授权');
    }

    /**
     * 检查是否为Git配置错误
     */
    private static isGitConfigError(errorMessage: string): boolean {
        return errorMessage.includes('无法变基') || 
               errorMessage.includes('rebase') ||
               errorMessage.includes('cannot rebase') || 
               errorMessage.includes('变基');
    }
}
