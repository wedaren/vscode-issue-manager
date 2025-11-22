import * as vscode from 'vscode';
import { createIssueFile } from './issueFileUtils';

/**
 * 从文本创建问题的参数接口
 */
export interface CreateIssueFromTextParams {
    title: string;
    content?: string;
}

/**
 * 从文本创建问题
 * 
 * 这个命令专门用于从 Chat Participant 或其他来源将文本内容保存为问题文件。
 * 
 * @param params - 包含标题和可选内容的参数对象
 * @returns 创建的文件 URI,失败时返回 null
 */
export async function createIssueFromText(params?: CreateIssueFromTextParams): Promise<vscode.Uri | null> {
    try {
        if (!params) {
            vscode.window.showErrorMessage('缺少必需的参数');
            return null;
        }

        const { title, content } = params;

        if (!title || title.trim().length === 0) {
            vscode.window.showErrorMessage('标题不能为空');
            return null;
        }

        // 如果提供了内容,确保内容包含 H1 标题
        let finalContent = content;
        if (content && content.trim().length > 0) {
            // 检查内容是否已经包含 H1 标题
            const lines = content.replace(/\r\n/g, '\n').split('\n');
            const firstNonEmptyLine = lines.find(l => l.trim().length > 0) || '';
            const hasH1 = /^#\s+/.test(firstNonEmptyLine);
            
            if (!hasH1) {
                // 如果没有 H1 标题,添加一个
                finalContent = `# ${title}\n\n${content}`;
            }
        }

        const uri = await createIssueFile(title, finalContent);
        
        if (uri) {
            vscode.window.showInformationMessage(`✅ 已创建问题: ${title}`);
        }
        
        return uri;
    } catch (error) {
        console.error('createIssueFromText error:', error);
        vscode.window.showErrorMessage('创建问题失败');
        return null;
    }
}
