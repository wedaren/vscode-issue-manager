import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 获取用户配置的 issue 目录的绝对路径。
 * @returns 如果配置了有效的、真实存在的目录路径，则返回该路径，否则返回 undefined。
 */
export function getIssueDir(): string | undefined {
    const config = vscode.workspace.getConfiguration('issueManager');
    const issueDir = config.get<string>('issueDir');

    if (!issueDir) {
        // 如果未配置，则不提示，调用方可以根据返回值决定是否引导用户配置
        return undefined;
    }

    // 1. 校验是否为绝对路径
    if (!path.isAbsolute(issueDir)) {
        vscode.window.showWarningMessage('问题目录必须是一个绝对路径。请检查您的设置。');
        return undefined;
    }

    // 2. 校验路径是否存在且为目录
    try {
        const stats = fs.statSync(issueDir);
        if (!stats.isDirectory()) {
            vscode.window.showWarningMessage(`配置的路径不是一个目录: ${issueDir}`);
            return undefined;
        }
    } catch (error: any) {
        // fs.statSync 在路径不存在时会抛出异常
        if (error.code === 'ENOENT') {
            vscode.window.showWarningMessage(`配置的目录不存在: ${issueDir}`);
        } else {
            // 其他未知错误
            vscode.window.showErrorMessage(`检查目录时发生错误: ${error.message}`);
        }
        return undefined;
    }


    return issueDir;
}
export type ViewMode = 'list' | 'grouped';

/**
 * 获取最近问题视图的默认显示模式
 * @returns 'grouped' | 'list'
 */
export function getRecentIssuesDefaultMode(): ViewMode {
    const config = vscode.workspace.getConfiguration('issueManager');
    const mode = config.get<string>('recentIssues.defaultMode');
    return mode === 'list' ? 'list' : 'grouped'; // 默认值为 grouped
}

/**
 * 获取自动同步是否启用
 */
export function isAutoSyncEnabled(): boolean {
    const config = vscode.workspace.getConfiguration('issueManager');
    return config.get<boolean>('sync.enableAutosync', false);
}

/**
 * 获取自动提交消息模板
 */
export function getAutoCommitMessage(): string {
    const config = vscode.workspace.getConfiguration('issueManager');
    return config.get<string>('sync.autoCommitMessage', '[Auto-Sync] Changes at {date}');
}

/**
 * 获取文件变更防抖间隔（秒）
 */
export function getChangeDebounceInterval(): number {
    const config = vscode.workspace.getConfiguration('issueManager');
    return config.get<number>('sync.changeDebounceInterval', 300);
}

/**
 * 获取周期性拉取间隔（分钟）
 */
export function getPeriodicPullInterval(): number {
    const config = vscode.workspace.getConfiguration('issueManager');
    return config.get<number>('sync.periodicPullInterval', 15);
}

/**
 * 获取RSS默认更新间隔（分钟）
 */
export function getRSSDefaultUpdateInterval(): number {
    const config = vscode.workspace.getConfiguration('issueManager');
    return config.get<number>('rss.defaultUpdateInterval', 60);
}

/**
 * 获取RSS是否启用自动更新
 */
export function isRSSAutoUpdateEnabled(): boolean {
    const config = vscode.workspace.getConfiguration('issueManager');
    return config.get<boolean>('rss.enableAutoUpdate', true);
}

/**
 * 获取标题缓存重建的过期时长（小时）。
 * 返回 0 表示禁用基于过期时间的自动重建（文件缺失仍会触发重建）。
 */
export function getTitleCacheRebuildIntervalHours(): number {
    const config = vscode.workspace.getConfiguration('issueManager');
    const val = config.get<number>('titleCache.rebuildIntervalHours', 24);
    // 防御性：避免负数或 NaN
    if (typeof val !== 'number' || !isFinite(val) || val < 0) {
        return 24;
    }
    return val;
}
