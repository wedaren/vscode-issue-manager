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
        
        // 获取错误详情（用于日志）
        const errorDetails = this.getErrorDetails(error);
        
        // 优先使用 simple-git 的特定错误类型进行判断
        if (error instanceof GitResponseError) {
            const result = this.handleGitResponseError(error);
            result.statusInfo.errorDetails = errorDetails;
            return result;
        }
        
        if (error instanceof GitError) {
            const result = this.handleGitError(error);
            result.statusInfo.errorDetails = errorDetails;
            return result;
        }
        
        // 后备方案：基于错误消息文本的检查（保持向后兼容）
        if (error instanceof Error) {
            const result = this.handleGenericError(error);
            result.statusInfo.errorDetails = errorDetails;
            return result;
        }
        
        // 通用错误处理
        return {
            statusInfo: { 
                status: SyncStatus.Conflict, 
                message: `同步失败: ${error instanceof Error ? error.message.split('\n')[0] : '未知错误'}`,
                shouldNotify: true,
                errorDetails: errorDetails
            },
            enterConflictMode: false
        };
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
        if (response && typeof response === 'object') {
            // 检查是否是合并相关的错误
            if ('conflicts' in response || 'failed' in response) {
                return {
                    statusInfo: { 
                        status: SyncStatus.Conflict, 
                        message: '存在合并冲突，需要手动解决',
                        shouldNotify: true
                    },
                    enterConflictMode: true
                };
            }
        }
        
        // 检查错误消息是否包含冲突信息
        if (error.message && (error.message.includes('conflict') || error.message.includes('merge') || 
            error.message.includes('冲突') || error.message.includes('合并'))) {
            return {
                statusInfo: { 
                    status: SyncStatus.Conflict, 
                    message: '存在合并冲突，需要手动解决',
                    shouldNotify: true
                },
                enterConflictMode: true
            };
        }

        return {
            statusInfo: { 
                status: SyncStatus.Conflict, 
                message: `Git操作错误: ${error.message.split('\n')[0]}`,
                shouldNotify: true
            },
            enterConflictMode: false
        };
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
            return {
                statusInfo: { 
                    status: SyncStatus.Conflict, 
                    message: `SSH连接错误: 无法连接到GitHub，请检查网络和SSH配置`,
                    shouldNotify: true
                },
                enterConflictMode: false
            };
        }
        
        // 检查网络相关错误
        if (this.isNetworkError(errorMessage)) {
            return {
                statusInfo: { 
                    status: SyncStatus.Conflict, 
                    message: `网络错误: ${error.message.split('\n')[0]}`,
                    shouldNotify: true
                },
                enterConflictMode: false
            };
        }
        
        // 检查认证相关错误
        if (this.isAuthenticationError(errorMessage)) {
            return {
                statusInfo: { 
                    status: SyncStatus.Conflict, 
                    message: `认证错误: ${error.message.split('\n')[0]}`,
                    shouldNotify: true
                },
                enterConflictMode: false
            };
        }

        return {
            statusInfo: { 
                status: SyncStatus.Conflict, 
                message: `Git错误: ${error.message.split('\n')[0]}`,
                shouldNotify: true
            },
            enterConflictMode: false
        };
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
            return {
                statusInfo: { 
                    status: SyncStatus.Conflict, 
                    message: '存在合并冲突，需要手动解决',
                    shouldNotify: true
                },
                enterConflictMode: true
            };
        }
        
        // 检查SSH连接错误
        if (this.isSSHConnectionError(errorMessage)) {
            return {
                statusInfo: { 
                    status: SyncStatus.Conflict, 
                    message: `SSH连接错误: 无法连接到GitHub，请检查网络和SSH配置`,
                    shouldNotify: true
                },
                enterConflictMode: false
            };
        }
        
        // 检查是否是网络错误
        if (this.isNetworkError(errorMessage)) {
            return {
                statusInfo: { 
                    status: SyncStatus.Conflict, 
                    message: `网络错误: ${error.message.split('\n')[0]}`,
                    shouldNotify: true
                },
                enterConflictMode: false
            };
        }
        
        // 检查是否是认证错误
        if (this.isAuthenticationError(errorMessage)) {
            return {
                statusInfo: { 
                    status: SyncStatus.Conflict, 
                    message: `认证错误: ${error.message.split('\n')[0]}`,
                    shouldNotify: true
                },
                enterConflictMode: false
            };
        }
        
        // 检查是否是Git配置错误
        if (this.isGitConfigError(errorMessage)) {
            return {
                statusInfo: { 
                    status: SyncStatus.Conflict, 
                    message: `Git操作错误，请检查仓库状态`,
                    shouldNotify: true
                },
                enterConflictMode: false
            };
        }

        return {
            statusInfo: { 
                status: SyncStatus.Conflict, 
                message: `同步失败: ${error.message.split('\n')[0]}`,
                shouldNotify: true
            },
            enterConflictMode: false
        };
    }

    /**
     * 显示冲突处理对话框
     * 
     * 当检测到合并冲突时，向用户显示处理选项和详细指引。
     */
    public static async showConflictDialog(): Promise<void> {
        const message = `Git 自动同步失败：检测到合并冲突

自动化功能已暂停，需要您手动解决冲突后才能继续。

解决步骤：
1. 打开问题目录，找到有冲突的文件
2. 编辑文件，解决冲突标记（<<<<<<< HEAD）
3. 保存文件后，使用"手动同步"按钮完成同步

提示：冲突通常发生在多设备同时编辑同一文件时。`;

        const selection = await vscode.window.showErrorMessage(
            message,
            { modal: true },
            '打开问题目录',
            '查看帮助文档',
            '手动同步'
        );
        
        switch (selection) {
            case '打开问题目录':
                await vscode.commands.executeCommand('issueManager.openIssueDir');
                break;
            case '查看帮助文档':
                // 打开 GitHub README 中的相关章节
                vscode.env.openExternal(
                    vscode.Uri.parse('https://github.com/wedaren/vscode-issue-manager#git自动同步')
                );
                break;
            case '手动同步':
                await vscode.commands.executeCommand('issueManager.synchronizeNow');
                break;
        }
    }

    // 私有方法：错误类型检查
    private static isConflictError(errorMessage: string): boolean {
        return errorMessage.includes('conflict') || errorMessage.includes('merge') ||
               errorMessage.includes('冲突') || errorMessage.includes('合并');
    }

    private static isSSHConnectionError(errorMessage: string): boolean {
        return errorMessage.includes('ssh: connect to host') || 
               errorMessage.includes('undefined error: 0') ||
               errorMessage.includes('无法读取远程仓库') ||
               errorMessage.includes('could not read from remote repository') ||
               (errorMessage.includes('ssh') && (errorMessage.includes('port 22') || errorMessage.includes('github.com')));
    }

    private static isNetworkError(errorMessage: string): boolean {
        return errorMessage.includes('network') || errorMessage.includes('connection') ||
               errorMessage.includes('econnreset') || errorMessage.includes('timeout') ||
               errorMessage.includes('网络') || errorMessage.includes('连接') ||
               errorMessage.includes('超时');
    }

    private static isAuthenticationError(errorMessage: string): boolean {
        return errorMessage.includes('authentication') || errorMessage.includes('permission') ||
               errorMessage.includes('access denied') || errorMessage.includes('unauthorized') ||
               errorMessage.includes('认证') || errorMessage.includes('权限') ||
               errorMessage.includes('拒绝访问') || errorMessage.includes('未授权');
    }

    private static isGitConfigError(errorMessage: string): boolean {
        return errorMessage.includes('无法变基') || errorMessage.includes('rebase') ||
               errorMessage.includes('cannot rebase') || errorMessage.includes('变基');
    }

    /**
     * 获取错误详情（用于日志记录）
     * 
     * @param error 错误对象
     * @returns 错误详情字符串
     */
    private static getErrorDetails(error: unknown): string {
        if (error instanceof Error) {
            let details = `${error.name}: ${error.message}`;
            if (error.stack) {
                details += `\n堆栈:\n${error.stack}`;
            }
            return details;
        } else if (typeof error === 'string') {
            return error;
        }
        return JSON.stringify(error);
    }
}
