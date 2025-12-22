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

type MarkdownIssue = {
    title: string;
    uri: vscode.Uri;
};

export async function getMarkdownIssues(): Promise<MarkdownIssue[]> {
    const files = await getAllMarkdownFiles();
    const issues: MarkdownIssue[] = [];

    for (const file of files) {
        const title = await getTitle(file);
        issues.push({ title, uri: file });
    }

    return issues;
}
