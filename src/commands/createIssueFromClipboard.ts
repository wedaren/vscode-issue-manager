import * as vscode from 'vscode';
import { LLMService } from '../llm/LLMService';
import { createIssueMarkdown } from '../data/IssueMarkdowns';
import { GitSyncService } from '../services/git-sync';

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
        let filenameTitle = '';

        if (hasH1(clipboard)) {
            // 如果剪贴板已有 H1，则提取第一行作为标题建议
            const lines = clipboard.replace(/\r\n/g, '\n').split('\n');
            const firstLine = lines.find(l => l.trim().length > 0) || '';
            filenameTitle = firstLine.replace(/^#+\s*/, '').trim();
        } else {
            // 使用带进度并可取消的调用来生成标题
            const controller = new AbortController();
            const suggestedTitle = await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: '生成标题…',
                    cancellable: true
                },
                async (progress, token) => {
                    token.onCancellationRequested(() => controller.abort());
                    progress.report({ message: finalContent.slice(0, 30) + (finalContent.length > 30 ? '...' : '') });
                    try {
                        const t = await LLMService.generateTitle(clipboard, { signal: controller.signal });
                        return t || '';
                    } catch (err) {
                        return '';
                    }
                }
            );

            if (controller.signal.aborted) {
                vscode.window.showInformationMessage('已取消自动标题生成。');
                return;
            }

            if (suggestedTitle && suggestedTitle.trim().length > 0) {
                // 让用户确认或编辑生成的标题
                const USE_SUGGESTED_TITLE = '使用该标题';
                const EDIT_SUGGESTED_TITLE = '编辑标题';
                const CANCEL_CREATION = '取消';
                const choice = await vscode.window.showInformationMessage(`建议标题：${suggestedTitle}`, USE_SUGGESTED_TITLE, EDIT_SUGGESTED_TITLE, CANCEL_CREATION);
                if (choice === USE_SUGGESTED_TITLE) {
                    filenameTitle = suggestedTitle.trim();
                } else if (choice === EDIT_SUGGESTED_TITLE) {
                    const edited = await vscode.window.showInputBox({ value: suggestedTitle.trim(), prompt: '编辑自动生成的标题' });
                    if (edited === undefined) {
                        vscode.window.showInformationMessage('已取消创建问题。');
                        return;
                    }
                    filenameTitle = (edited && edited.trim()) || 'Untitled Issue';
                } else {
                    vscode.window.showInformationMessage('已取消创建问题。');
                    return;
                }
            } else {
                filenameTitle = 'Untitled Issue';
                vscode.window.showInformationMessage('未能自动生成标题，已使用占位标题。');
            }

            finalContent = `# ${filenameTitle}\n\n${clipboard}`;
        }

        const uri = await createIssueMarkdown(filenameTitle || '', finalContent);
        if (!uri) {
            // createIssueFile 已经会弹错信息
            return;
        }

        // 触发同步
        GitSyncService.getInstance().triggerSync();

    } catch (error) {
        console.error('createIssueFromClipboard error:', error);
        vscode.window.showErrorMessage('从剪贴板创建问题失败。');
    }
}

