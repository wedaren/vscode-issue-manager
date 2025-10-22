import * as vscode from 'vscode';
import { SyncStatus, SyncStatusInfo } from './types';
import { isAutoSyncEnabled } from '../../config';

/**
 * 状态栏管理器
 * 
 * 负责管理Git同步状态在VS Code状态栏中的显示，包括：
 * - 根据同步状态更新状态栏图标和文本
 * - 显示详细的工具提示信息
 * - 计算并显示时间间隔
 * - 处理用户点击事件
 */
export class StatusBarManager {
    private statusBarItem: vscode.StatusBarItem;

    // 状态图标映射
    private static readonly STATUS_ICONS: Record<SyncStatus, string> = {
        [SyncStatus.Synced]: '$(sync)',
        [SyncStatus.Syncing]: '$(sync~spin)',
        [SyncStatus.HasLocalChanges]: '$(cloud-upload)',
        [SyncStatus.HasRemoteChanges]: '$(cloud-download)',
        [SyncStatus.Conflict]: '$(error)',
        [SyncStatus.Disabled]: '$(sync-ignored)'
    };

    constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right, 
            100
        );
        this.statusBarItem.command = 'issueManager.synchronizeNow';
        this.statusBarItem.show();
    }

    /**
     * 更新状态栏显示
     * 
     * 根据当前同步状态更新状态栏的图标、文本和工具提示。
     * 不同状态对应不同的图标：
     * - Synced: $(sync) - 已同步
     * - Syncing: $(sync~spin) - 正在同步（带旋转动画）
     * - HasLocalChanges: $(cloud-upload) - 待上传
     * - HasRemoteChanges: $(cloud-download) - 待下载
     * - Conflict: $(error) - 错误状态
     * - Disabled: $(sync-ignored) - 已禁用
     * 
     * @param statusInfo 当前状态信息
     */
    public updateStatusBar(statusInfo: SyncStatusInfo): void {
        this.updateStatusBarText(statusInfo.status);
        this.updateStatusBarTooltip(statusInfo);
    }

    /**
     * 更新状态栏文本和图标
     */
    private updateStatusBarText(status: SyncStatus): void {
        const icon = StatusBarManager.STATUS_ICONS[status];
        this.statusBarItem.text = `同步问题 ${icon}`;
    }

    /**
     * 更新状态栏工具提示
     */
    private updateStatusBarTooltip(statusInfo: SyncStatusInfo): void {
        const tooltipParts = [statusInfo.message];
        
        if (statusInfo.lastSync) {
            const timeAgo = this.getTimeAgo(statusInfo.lastSync);
            tooltipParts.push(`上次同步: ${timeAgo}`);
        }
        
        if (isAutoSyncEnabled()) {
            tooltipParts.push('点击立即同步');
        }
        
        this.statusBarItem.tooltip = tooltipParts.join('\n');
    }

    /**
     * 获取状态栏项目（测试用）
     * @internal 仅用于测试
     */
    public getStatusBarItem(): vscode.StatusBarItem {
        return this.statusBarItem;
    }

    /**
     * 计算时间间隔显示文本
     * 
     * 将时间差转换为用户友好的显示格式：
     * - 少于1分钟: "刚刚"
     * - 1-59分钟: "X分钟前"
     * - 1-23小时: "X小时前"
     * - 24小时及以上: "X天前"
     * 
     * @param date 要计算间隔的日期
     * @returns 格式化的时间间隔字符串
     */
    private getTimeAgo(date: Date): string {
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / (1000 * 60));
        
        if (diffMins < 1) {
            return '刚刚';
        }
        
        if (diffMins < 60) {
            return `${diffMins}分钟前`;
        }
        
        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) {
            return `${diffHours}小时前`;
        }
        
        const diffDays = Math.floor(diffHours / 24);
        return `${diffDays}天前`;
    }

    /**
     * 释放状态栏资源
     * 
     * 在服务停止时调用，确保状态栏项目被正确释放。
     */
    public dispose(): void {
        this.statusBarItem.dispose();
    }
}
