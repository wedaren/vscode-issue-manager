import * as vscode from 'vscode';
import { LLMService } from '../llm/LLMService';
import { createIssueFile } from './issueFileUtils';

/**
 * 判断文本中是否存在 Markdown 一级标题（第一行非空行以 `# ` 开头）
 */
export function hasH1(text: string): boolean {
    if (!text) { return false; }
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const firstLine = lines.find(l => l.trim().length > 0) || '';
    return /^#\s+/.test(firstLine);
}

/**
 * 从剪贴板创建问题：
 * - 读取剪贴板内容
 * - 如果已有 H1 标题则直接使用原始内容
 * - 否则调用 LLMService 生成一个 H1 标题并将其插入到内容前面
 * - 在任何失败场景下降级到占位标题
 */
export async function createIssueFromClipboard(): Promise<void> {
    try {
        const clipboard = await vscode.env.clipboard.readText();
        if (!clipboard || clipboard.trim().length === 0) {
            vscode.window.showInformationMessage('无法创建问题：剪贴板为空。');
            return;
        }
        let finalContent = clipboard;
        if (!hasH1(clipboard)) {
            // 需要生成标题，LLMService.generateTitle 在失败时会返回空字符串而不是抛出异常
            const suggestedTitle = await LLMService.generateTitle(clipboard);
            const title = (suggestedTitle && suggestedTitle.trim()) || 'Untitled Issue';
            finalContent = `# ${title}\n\n${clipboard}`;
        }

        const uri = await createIssueFile('', finalContent);
        if (!uri) {
            // createIssueFile 已经会弹错信息
            return;
        }
    } catch (error) {
        console.error('createIssueFromClipboard error:', error);
        vscode.window.showErrorMessage('从剪贴板创建问题失败。');
    }
}

