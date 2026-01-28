import * as vscode from 'vscode';
import { HtmlToMarkdownService } from '../services/converters/HtmlToMarkdownService';
import { LLMService } from '../llm/LLMService';
import { Logger } from '../core/utils/Logger';
import { GitSyncService } from '../services/git-sync';
import { createIssueNodes } from '../data/issueTreeManager';
import { createIssueMarkdown, updateIssueMarkdownBody } from '../data/IssueMarkdowns';
import { ImageProcessOptions, DEFAULT_IMAGE_PROCESS_OPTIONS } from '../utils/imageUtils';

/**
 * 从 HTML 内容创建问题的参数
 */
export interface CreateIssueFromHtmlParams {
    /**
     * HTML 内容
     */
    html: string;
    
    /**
     * 可选的标题
     */
    title?: string;
    
    /**
     * 可选的来源 URL
     */
    url?: string;
    
    /**
     * 是否保留图片（默认 true）
     */
    preserveImages?: boolean;
    
    /**
     * 是否保留链接（默认 true）
     */
    preserveLinks?: boolean;
    
    /**
     * 图片处理选项
     */
    imageProcessOptions?: ImageProcessOptions;
}

/**
 * 判断文本中是否存在 Markdown 一级标题（第一行非空行以 `# ` 开头）
 */
function hasH1(text: string): boolean {
    if (!text) { return false; }
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const firstLine = lines.find(l => l.trim().length > 0) || '';
    return /^#\s+/.test(firstLine);
}

/**
 * 从 HTML 内容创建问题
 * 
 * 此命令可以被 Chrome 扩展调用，用于将网页选取的内容转换为 Markdown 笔记
 * 
 * @param params 创建参数
 * @returns 创建的文件 URI 或 null
 */
export async function createIssueFromHtml(params?: CreateIssueFromHtmlParams): Promise<vscode.Uri | null> {
    try {
        // 如果没有传入参数，提示用户输入 HTML
        if (!params || !params.html) {
            const html = await vscode.window.showInputBox({
                prompt: '请输入 HTML 内容',
                placeHolder: '<div>HTML 内容...</div>',
                ignoreFocusOut: true
            });
            
            if (!html) {
                vscode.window.showInformationMessage('已取消创建问题。');
                return null;
            }
            
            params = { html };
        }

        // 步骤 1: 先创建一个带标题的空文件以获取文件路径
        const initialTitle = params.title || 'Untitled Note';
        const uri = await createIssueMarkdown({ 
            markdownBody: `# ${initialTitle}\n\n` 
        });

        if (!uri) {
            vscode.window.showErrorMessage('创建问题文件失败。');
            return null;
        }

        try {
            // 步骤 2: 转换 HTML 为 Markdown，传入文件路径以便图片保存到文件同级目录
            const markdown = await HtmlToMarkdownService.convertToMarkdown(params.html, {
                preserveImages: params.preserveImages !== false,
                preserveLinks: params.preserveLinks !== false,
                contextFilePath: uri.fsPath,
                imageProcessOptions: params.imageProcessOptions || DEFAULT_IMAGE_PROCESS_OPTIONS
            });

            if (!markdown || markdown.trim().length === 0) {
                vscode.window.showWarningMessage('HTML 内容转换失败，已创建空问题文件。');
                return uri;
            }

            // 准备最终内容
            let finalContent = markdown;
            let filenameTitle = params.title || '';

            // 如果已经有标题参数，直接使用
            if (params.title && params.title.trim()) {
                // 检查转换后的 markdown 是否已经有 H1
                if (!hasH1(markdown)) {
                    finalContent = `# ${params.title}\n\n${markdown}`;
                }
                filenameTitle = params.title;
            } else {
                // 检查转换后的 markdown 是否已经有 H1
                if (hasH1(markdown)) {
                    // 提取第一行作为标题建议
                    const lines = markdown.replace(/\r\n/g, '\n').split('\n');
                    const firstLine = lines.find(l => l.trim().length > 0) || '';
                    filenameTitle = firstLine.replace(/^#+\s*/, '').trim();
                } else {
                    // 没有标题，尝试使用 LLM 生成
                    const suggestedTitle = await generateTitleWithProgress(markdown);
                    
                    if (suggestedTitle && suggestedTitle.trim().length > 0) {
                        filenameTitle = suggestedTitle.trim();
                        finalContent = `# ${filenameTitle}\n\n${markdown}`;
                    } else {
                        filenameTitle = 'Untitled Note';
                        finalContent = `# ${filenameTitle}\n\n${markdown}`;
                        vscode.window.showInformationMessage('未能自动生成标题，已使用占位标题。');
                    }
                }
            }

            // 添加元信息（如果提供了 URL）
            if (params.url) {
                const metadata = `\n\n---\n**来源**: [${params.url}](${params.url})  \n**创建时间**: ${new Date().toISOString().slice(0, 19).replace('T', ' ')}\n\n`;
                finalContent = finalContent + metadata;
            }

            // 步骤 3: 使用 updateIssueMarkdownBody 填充实际内容
            const updateSuccess = await updateIssueMarkdownBody(uri, finalContent);
            if (!updateSuccess) {
                vscode.window.showWarningMessage('更新问题内容失败，但文件已创建。');
            }

            // 将新创建的问题添加到树和关注列表
            try {
                await createIssueNodes([uri]);
                vscode.commands.executeCommand('issueManager.refreshAllViews');  
            } catch (e) {
                Logger.getInstance().error('添加问题到关注列表失败:', e);
            }
            
            vscode.window.showInformationMessage(`已从 HTML 创建问题: ${filenameTitle}`);
            
            // 触发同步
            GitSyncService.getInstance().triggerSync();
            
            return uri;
        } catch (conversionError) {
            Logger.getInstance().error('HTML 转换过程出错:', conversionError);
            vscode.window.showErrorMessage('处理 HTML 内容时出错。');
            return uri; // 返回已创建的空文件
        }

    } catch (error) {
        Logger.getInstance().error('createIssueFromHtml error:', error);
        vscode.window.showErrorMessage('从 HTML 创建问题失败。');
        return null;
    }
}

/**
 * 使用带进度的 LLM 生成标题
 */
async function generateTitleWithProgress(content: string): Promise<string> {
    const controller = new AbortController();
    
    const suggestedTitle = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: '生成标题…',
            cancellable: true
        },
        async (progress, token) => {
            token.onCancellationRequested(() => controller.abort());
            progress.report({ 
                message: content.slice(0, 50) + (content.length > 50 ? '...' : '') 
            });
            
            try {
                const title = await LLMService.generateTitle(content, { signal: controller.signal });
                return title || '';
            } catch (err) {
                console.error('生成标题失败:', err);
                return '';
            }
        }
    );

    if (controller.signal.aborted) {
        return '';
    }

    // 如果生成了标题，让用户确认或编辑
    if (suggestedTitle && suggestedTitle.trim().length > 0) {
        const USE_SUGGESTED_ACTION = '使用该标题';
        const EDIT_TITLE_ACTION = '编辑标题';
        const CANCEL_ACTION = '取消';

        
        const choice = await vscode.window.showInformationMessage(
            `建议标题：${suggestedTitle}`,
            USE_SUGGESTED_ACTION,
            EDIT_TITLE_ACTION,
            CANCEL_ACTION
        );
        
        if (choice === USE_SUGGESTED_ACTION) {
            return suggestedTitle.trim();
        } else if (choice === EDIT_TITLE_ACTION) {
            const edited = await vscode.window.showInputBox({
                value: suggestedTitle.trim(),
                prompt: '编辑自动生成的标题'
            });
            return edited?.trim() || '';
        }
    }
    
    return '';
}
