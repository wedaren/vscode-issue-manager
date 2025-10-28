import * as vscode from 'vscode';
import { SyncStatus, SyncStatusInfo } from './types';
import { isSyncNotificationEnabled } from '../../config';
import { Logger } from '../../core/utils/Logger';

/**
 * 同步通知管理器
 * 
 * 负责管理Git同步过程中的用户通知，包括：
 * - 桌面通知（仅在重要事件时显示）
 * - 日志记录（使用统一的 Logger）
 * - 通知频率控制（避免过度打扰）
 */
export class SyncNotificationManager {
    private logger: Logger;
    private lastNotificationTime: Map<string, number> = new Map();
    private readonly NOTIFICATION_THROTTLE_MS = 60000; // 1分钟内相同类型的通知只显示一次

    constructor() {
        this.logger = Logger.getInstance();
    }

    /**
     * 记录信息日志
     */
    public info(message: string, details?: any): void {
        this.logger.info(`[Git同步] ${message}`, details);
    }

    /**
     * 记录警告日志
     */
    public warn(message: string, details?: any): void {
        this.logger.warn(`[Git同步] ${message}`, details);
    }

    /**
     * 记录错误日志
     */
    public error(message: string, error?: unknown): void {
        this.logger.error(`[Git同步] ${message}`, error);
    }

    /**
     * 显示输出通道
     */
    public show(): void {
        this.logger.show();
    }

    /**
     * 通知状态变化
     * 
     * 根据状态的严重程度和配置决定是否显示桌面通知
     */
    public notifyStatusChange(statusInfo: SyncStatusInfo): void {
        const { status, message, shouldNotify, errorDetails } = statusInfo;

        // 记录到输出通道
        switch (status) {
            case SyncStatus.Synced:
                this.info(message);
                break;
            case SyncStatus.Syncing:
                this.info(message);
                break;
            case SyncStatus.HasLocalChanges:
                this.info(message);
                break;
            case SyncStatus.Conflict:
                this.error(message, errorDetails);
                break;
            case SyncStatus.Disabled:
                this.info(message);
                break;
        }

        // 判断是否需要显示桌面通知
        if (!shouldNotify || !isSyncNotificationEnabled()) {
            return;
        }

        // 检查通知频率限制
        const notificationKey = `${status}-${message}`;
        const now = Date.now();
        const lastTime = this.lastNotificationTime.get(notificationKey) || 0;
        
        if (now - lastTime < this.NOTIFICATION_THROTTLE_MS) {
            // 距离上次相同通知不到1分钟，跳过
            return;
        }

        this.lastNotificationTime.set(notificationKey, now);

        // 根据状态显示不同级别的通知
        switch (status) {
            case SyncStatus.Conflict:
                this.showErrorNotification(message);
                break;
            case SyncStatus.Synced:
                // 成功状态不显示通知，避免打扰
                break;
            default:
                this.showInfoNotification(message);
                break;
        }
    }

    /**
     * 显示错误通知（带操作按钮）
     */
    private async showErrorNotification(message: string): Promise<void> {
        const selection = await vscode.window.showErrorMessage(
            `Git自动同步失败: ${message}`,
            '查看日志',
            '立即重试',
            '打开问题目录'
        );

        switch (selection) {
            case '查看日志':
                this.show();
                break;
            case '立即重试':
                await vscode.commands.executeCommand('issueManager.synchronizeNow');
                break;
            case '打开问题目录':
                await vscode.commands.executeCommand('issueManager.openIssueDir');
                break;
        }
    }

    /**
     * 显示信息通知
     */
    private showInfoNotification(message: string): void {
        vscode.window.showInformationMessage(`Git自动同步: ${message}`);
    }

    /**
     * 显示重试通知
     */
    public notifyRetry(attempt: number, maxRetries: number, nextDelay: number): void {
        const message = `同步失败，将在 ${nextDelay} 秒后进行第 ${attempt}/${maxRetries} 次重试`;
        this.warn(message);
        
        // 仅在第一次重试时显示通知
        if (attempt === 1 && isSyncNotificationEnabled()) {
            vscode.window.showWarningMessage(
                `Git自动同步失败，将自动重试 (${attempt}/${maxRetries})`,
                '查看日志'
            ).then(selection => {
                if (selection === '查看日志') {
                    this.show();
                }
            });
        }
    }

    /**
     * 通知重试全部失败
     */
    public notifyRetryExhausted(maxRetries: number, lastError: unknown): void {
        const message = `同步失败，已达到最大重试次数 (${maxRetries})`;
        this.error(message, lastError);
        
        if (isSyncNotificationEnabled()) {
            const errorMessage = lastError instanceof Error ? lastError.message : String(lastError);
            vscode.window.showErrorMessage(
                `Git自动同步失败: ${errorMessage}`,
                '查看日志',
                '手动同步',
                '禁用自动同步'
            ).then(selection => {
                switch (selection) {
                    case '查看日志':
                        this.show();
                        break;
                    case '手动同步':
                        vscode.commands.executeCommand('issueManager.synchronizeNow');
                        break;
                    case '禁用自动同步':
                        vscode.workspace.getConfiguration('issueManager').update(
                            'sync.enableAutosync',
                            false,
                            vscode.ConfigurationTarget.Global
                        );
                        break;
                }
            });
        }
    }

    /**
     * 清理资源
     */
    public dispose(): void {
        // Logger 由扩展统一管理，无需单独释放
    }
}
