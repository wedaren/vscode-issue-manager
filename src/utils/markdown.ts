import * as vscode from 'vscode';
import * as path from 'path';
import { getIssueDir } from '../config';

/**
 * 从 Markdown 文件内容中提取第一个一级标题。
 * @param content 文件内容。
 * @returns 第一个一级标题的文本，如果找不到则返回 undefined。
 */
function extractTitleFromContent(content: string): string | undefined {
    const match = content.match(/^#\s+(.*)/m);
    return match ? match[1].trim() : undefined;
}

/**
 * 异步地获取给定 Markdown 文件的标题。
 * 优先读取文件中的第一个一级标题 (`# `)。如果找不到，则使用文件名（不含扩展名）作为后备。
 * @param fileUri 文件的 URI。
 * @returns 解析出的标题。
 */
export async function getTitle(fileUri: vscode.Uri): Promise<string> {
    try {
        const contentBytes = await vscode.workspace.fs.readFile(fileUri);
        const content = Buffer.from(contentBytes).toString('utf-8');
        const titleFromContent = extractTitleFromContent(content);
        if (titleFromContent) {
            return titleFromContent;
        }
    } catch (error) {
        console.error(`读取文件时出错 ${fileUri.fsPath}:`, error);
    }
    // 如果读取失败，则回退到使用文件名
    return path.basename(fileUri.fsPath, '.md');
}

/**
 * 获取问题目录中所有 Markdown 文件的标题和文件路径。
 * @returns 包含标题和文件路径的对象数组。
 */
export async function getAllMarkdownIssues(): Promise<{ title: string, filePath: string }[]> {
    const issueDir = getIssueDir();
    if (!issueDir) {
        return [];
    }

    const files = await vscode.workspace.findFiles(new vscode.RelativePattern(issueDir, '**/*.md'), '**/.issueManager/**');
    const issues: { title: string, filePath: string }[] = [];

    for (const file of files) {
        const title = await getTitle(file);
        issues.push({ title, filePath: file.fsPath });
    }

    return issues;
}
