import * as vscode from 'vscode';
import * as path from 'path';

/**
 * 从 Markdown 文件内容中提取第一个一级标题。
 * @param content 文件内容。
 * @returns 第一个一级标题的文本，如果找不到则返回 undefined。
 */
function extractTitleFromContent(content: string): string | undefined {
    // 使用正则表达式以更稳健地匹配，并处理可能的行尾字符
    const match = content.match(/^#\s+(.*)/m);
    return match ? match[1].trim() : undefined;
}

/**
 * 获取给定 Markdown 文件的标题。
 * 优先读取文件中的第一个一级标题 (`# `)。如果找不到，则使用文件名（不含扩展名）作为后备。
 * @param fileUri 文件的 URI。
 * @returns 解析出的标题。
 */
export async function getIssueTitle(fileUri: vscode.Uri): Promise<string> {
    try {
        const contentBytes = await vscode.workspace.fs.readFile(fileUri);
        const content = Buffer.from(contentBytes).toString('utf-8');
        const titleFromContent = extractTitleFromContent(content);
        if (titleFromContent) {
            return titleFromContent;
        }
    } catch (error) {
        console.error(`读取文件时出错 ${fileUri.fsPath}:`, error);
        // 如果读取失败，则回退到使用文件名
    }

    // 后备方案：使用文件名（不含扩展名）
    const filename = path.basename(fileUri.fsPath, '.md');
    return filename;
}
