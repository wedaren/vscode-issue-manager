import * as vscode from 'vscode';
import { titleCache } from './titleCache';
import { getIssueDir } from '../config';

/**
 * 获取问题目录中所有 Markdown 文件;
 * @returns 问题目录中所有 Markdown 文件
 */
async function getAllIssueMarkdownFiles(): Promise<vscode.Uri[]> {
    const issueDir = getIssueDir();
    if (!issueDir) {
        return [];
    }

    const files = await vscode.workspace.findFiles(new vscode.RelativePattern(issueDir, '**/*.md'), '**/.issueManager/**');
    return files;
}

export type IssueMarkdown = {  
    title: string;  
    uri: vscode.Uri;  
};

/**  
 * 获取问题目录中所有 Markdown 文件的标题和 URI。  
 * @returns 包含标题和 URI 的对象数组。  
 */  
export async function getAllIssueMarkdowns(): Promise<IssueMarkdown[]> {
    const files = await getAllIssueMarkdownFiles();
    const issues: IssueMarkdown[] = [];

    for (const file of files) {
        const title = await titleCache.get(file);
        issues.push({ title, uri: file });
    }

    return issues;
}
