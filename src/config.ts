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

/**
 * 获取最近问题视图的默认显示模式
 * @returns 'grouped' | 'list'
 */
export function getRecentIssuesDefaultMode(): 'grouped' | 'list' {
    const config = vscode.workspace.getConfiguration('issueManager');
    const mode = config.get<string>('recentIssues.defaultMode');
    return mode === 'list' ? 'list' : 'grouped'; // 默认值为 grouped
}
