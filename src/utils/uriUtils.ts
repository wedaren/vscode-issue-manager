import * as vscode from 'vscode';

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
        console.error('从 URI 解析 issueId 失败', error);
    }
    return undefined;
}
