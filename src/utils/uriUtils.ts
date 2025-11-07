import * as vscode from 'vscode';
import { Logger } from '../core/utils/Logger';  

/**
 * 从给定的 URI 查询字符串中解析 issueId。
 * @param uri The vscode.Uri 对象。
 * @returns 如果找到，则返回 issueId 字符串；否则返回 undefined。
 */
export function getIssueIdFromUri(uri: vscode.Uri | undefined): string | undefined {
    if (!uri) {
        return undefined;
    }
    try {
        const query = uri.query || '';
        const match = query.match(/(?:^|&)issueId=([^&]+)/);
        if (match) {
            return decodeURIComponent(match[1]);
        }
    } catch (error) {
        // 在解析过程中可能出现错误，例如 URI 格式不正确
        Logger.getInstance().error('从 URI 解析 issueId 失败', error);  
    }
    return undefined;
}

/**
 * 从给定的 URI 查询字符串中解析 viewSource。
 * @param uri The vscode.Uri 对象。
 * @returns 如果找到，则返回 viewSource 字符串；否则返回 undefined。
 */
export function getViewSourceFromUri(uri: vscode.Uri | undefined): string | undefined {
    if (!uri) {
        return undefined;
    }
    try {
        const query = uri.query || '';
        const match = query.match(/(?:^|&)viewSource=([^&]+)/);
        if (match) {
            return decodeURIComponent(match[1]);
        }
    } catch (error) {
        // 在解析过程中可能出现错误，例如 URI 格式不正确
        Logger.getInstance().error('从 URI 解析 viewSource 失败', error);  
    }
    return undefined;
}
