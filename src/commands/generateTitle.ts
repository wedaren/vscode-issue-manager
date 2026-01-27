import * as vscode from 'vscode';
import { LLMService } from '../llm/LLMService';
import { updateIssueMarkdownFrontmatter, onTitleUpdate, isIssueMarkdown, getIssueMarkdown, getIssueMarkdownContent, IssueMarkdown } from '../data/IssueMarkdowns';
import { getIssueDir } from '../config';
import { Logger } from '../core/utils/Logger';
import { getIssueNodeById, getIssueNodesBy, isIssueNode } from '../data/issueTreeManager';

/**
 * 将 VS Code CancellationToken 转换为 AbortSignal
 */
function toAbortSignal(token: vscode.CancellationToken): AbortSignal {
    const controller = new AbortController();
    token.onCancellationRequested(() => {
        controller.abort();
    });
    if (token.isCancellationRequested) {
        controller.abort();
    }
    return controller.signal;
}

function normalizeTitle(t: string) {
    return t.trim().replace(/\s+/g, ' ').normalize();
}

function containsTitle(arr: string[], title: string) {
    const n = normalizeTitle(title).toLowerCase();
    return arr.some(a => normalizeTitle(a).toLowerCase() === n);
}

function mergeTitle(
    existing: { issue_title?: string | string[] | null } | null | undefined,
    title: string
): string | string[] | undefined {
    const t = normalizeTitle(title);
    if (!existing || existing.issue_title === undefined || existing.issue_title === null) {
        return t;
    } else if (typeof existing.issue_title === 'string') {
        const existingNorm = normalizeTitle(existing.issue_title);
        if (existingNorm.toLowerCase() === t.toLowerCase()) {
            return undefined; // 表示无需修改
        }
        return [existing.issue_title, t];
    } else if (Array.isArray(existing.issue_title)) {
        if (containsTitle(existing.issue_title, t)) {
            return undefined; // 表示无需修改
        }
        return [...existing.issue_title, t];
    } else {
        return t;
    }
}

export function registerGenerateTitleCommand(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('issueManager.generateTitleCommand', async (...args: unknown[]) => {
            let issueMarkdown: IssueMarkdown | null = null;
            try {
                // 支持来源：
                // 1. 传入 IssueNode（含 resourceUri），(viewItem =~ /issueNode/)
                // 2. 当前编辑器，且为 IssueMarkdown 文件


                if (args && args.length > 0) {
                    const firstArg = args[0];
                    if(isIssueNode(firstArg)){
                        const issueNode = await getIssueNodeById(firstArg.id);
                        if(issueNode){
                            issueMarkdown = await getIssueMarkdown(issueNode.filePath);
                        }
                    }
                }

                // 2. 使用当前激活的编辑器
                if (!issueMarkdown && vscode.window.activeTextEditor) {
                    issueMarkdown = await getIssueMarkdown(vscode.window.activeTextEditor.document.uri);
                }

                if (!issueMarkdown) {
                    vscode.window.showWarningMessage('未找到有效的 IssueMarkdown 文件。');
                    return;
                }

                const targetUri = issueMarkdown.uri;

                // 请求 LLM 生成标题，支持取消
                const title = await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: '正在生成标题...',
                        cancellable: true
                    },
                    async (progress, token) => {
                        try {
                            const content = await getIssueMarkdownContent(targetUri);
                            const generated = await LLMService.generateTitleOptimized(content, { signal: toAbortSignal(token) });
                            return generated;
                        } catch (err) {
                            // 如果是用户取消操作，则静默处理
                            if (token.isCancellationRequested) {
                                return;
                            }
                            // 非取消错误：记录日志以便调试，但对用户仍表现为“未生成有效标题”
                            Logger.getInstance().error('generateTitleFromEditor error:', err);
                            return;
                        }
                    }
                );

                if (!title || title.trim().length === 0) {
                    vscode.window.showInformationMessage('未生成有效标题。');
                    return;
                }

                const existing = (await getIssueMarkdown(targetUri))?.frontmatter ?? null;

                const newTitle = normalizeTitle(title);
                const merged = mergeTitle(existing, newTitle);
                if (merged === undefined) {
                    if (existing) {
                        if (typeof existing.issue_title === 'string' && normalizeTitle(existing.issue_title).toLowerCase() === newTitle.toLowerCase()) {
                            vscode.window.showInformationMessage('生成标题与现有 title 相同，未做修改。');
                            return;
                        }
                        if (Array.isArray(existing.issue_title) && containsTitle(existing.issue_title, newTitle)) {
                            vscode.window.showInformationMessage('生成标题已存在于 issue_title 中，未做修改。');
                            return;
                        }
                    }
                    return;
                }

                const ok = await updateIssueMarkdownFrontmatter(targetUri, { issue_title: merged });
                if (ok) {
                    vscode.window.showInformationMessage('已将生成标题写入 frontmatter.issue_title');
                } else {
                    vscode.window.showErrorMessage('写入 issue_title 失败，请查看日志。');
                }
            } catch (err: any) {
                if (err && err.message === 'cancelled') {
                    return;
                }
                Logger.getInstance().error('generateTitleFromEditor error:', err);
            }
        }),
        onTitleUpdate(() => {
            vscode.commands.executeCommand('issueManager.refreshAllViews');
        })
    );
}
