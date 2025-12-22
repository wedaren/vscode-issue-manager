import * as vscode from 'vscode';
import { getTitle } from '../utils/markdown';
import { getIssueDir } from '../config';

/**
 * 获取问题目录中所有 Markdown 文件;
 * @returns 问题目录中所有 Markdown 文件
 */
export async function getAllMarkdownFiles(): Promise<vscode.Uri[]> {
    const issueDir = getIssueDir();
    if (!issueDir) {
        return [];
    }

    const files = await vscode.workspace.findFiles(new vscode.RelativePattern(issueDir, '**/*.md'), '**/.issueManager/**');
    return files;
}

export async function getMarkdownIssues(): Promise<{ title: string, filePath: string }[]> {
    const files = await getAllMarkdownFiles();
    const issues: { title: string, filePath: string, uri: vscode.Uri }[] = [];

    for (const file of files) {
        const title = await getTitle(file);
        issues.push({ title, filePath: file.fsPath, uri: file });
    }

    return issues;
}
