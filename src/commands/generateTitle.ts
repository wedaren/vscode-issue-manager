import * as vscode from 'vscode';
import { LLMService } from '../llm/LLMService';
import { updateIssueMarkdownFrontmatter, getIssueMarkdownFrontmatter } from '../data/IssueMarkdowns';
import { getIssueDir } from '../config';
import { getIssueMarkdownTitle } from '../data/IssueMarkdowns';
import { Logger } from '../core/utils/Logger';

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
            let targetUri: vscode.Uri | undefined;
            try {
                // 支持三种来源：
                // 1. 传入 TreeItem / IssueTreeNode（含 resourceUri）
                // 2. 传入 vscode.Uri
                // 3. 无参数时使用活动编辑器
                let doc: vscode.TextDocument | undefined;

                if (args && args.length > 0) {
                    const first = args[0] as any;
                    if (first && typeof first === 'object' && 'resourceUri' in first && first.resourceUri) {
                        targetUri = first.resourceUri as vscode.Uri;
                        doc = await vscode.workspace.openTextDocument(targetUri);
                    } else if (first && (first.scheme || first.fsPath || first.path)) {
                        // 可能是 Uri
                        try {
                            targetUri = first as vscode.Uri;
                            doc = await vscode.workspace.openTextDocument(targetUri);
                        } catch (e) {
                            // ignore
                        }
                    }
                }

                if (!doc) {
                    const editor = vscode.window.activeTextEditor;
                    if (!editor) {
                        vscode.window.showWarningMessage('请在 Markdown 编辑器中运行此命令或从问题总览右键触发。');
                        return;
                    }
                    doc = editor.document;
                    targetUri = doc.uri;
                }

                if (!doc) {
                    vscode.window.showWarningMessage('找不到目标文档。');
                    return;
                }

                if (doc.languageId !== 'markdown') {
                    vscode.window.showWarningMessage('此命令仅适用于 Markdown 文件。');
                    return;
                }

                const issueDir = getIssueDir();
                if (!issueDir) {
                    vscode.window.showWarningMessage('请先在设置中配置问题目录。');
                    return;
                }

                const filePath = doc.uri.fsPath;
                if (!filePath.startsWith(issueDir)) {
                    vscode.window.showWarningMessage('当前文件不在配置的 issueDir 内，无法写入 issue frontmatter。');
                    return;
                }

                // 请求 LLM 生成标题，支持取消
                const title = await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: '正在生成标题...',
                        cancellable: true
                    },
                    async (progress, token) => {
                        try {
                            const generated = await LLMService.generateTitleOptimized(doc!.getText(), { signal: token as unknown as AbortSignal });
                            return generated;
                        } catch (err) {
                            if (token.isCancellationRequested) {
                                throw new Error('cancelled');
                            }
                            throw err;
                        }
                    }
                );

                if (!title || title.trim().length === 0) {
                    vscode.window.showInformationMessage('未生成有效标题。');
                    return;
                }

                const existing = await getIssueMarkdownFrontmatter(doc.uri);

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

                const ok = await updateIssueMarkdownFrontmatter(doc.uri, { issue_title: merged });
                if (ok) {
                    // 触发缓存刷新/标题更新
                    try {
                        await getIssueMarkdownTitle(doc.uri);
                    } catch (e) {
                        Logger.getInstance().warn('刷新标题缓存失败', e);
                    }
                    vscode.window.showInformationMessage('已将生成标题写入 frontmatter.issue_title');
                } else {
                    vscode.window.showErrorMessage('写入 issue_title 失败，请查看日志。');
                }
            } catch (err: any) {
                if (err && err.message === 'cancelled') {
                    vscode.window.showInformationMessage('生成标题已取消');
                    return;
                }
                Logger.getInstance().error('generateTitleFromEditor error:', err);
                // 降级：允许手动输入
                const manual = await vscode.window.showInputBox({ prompt: '自动生成失败，请手动输入标题（留空取消）' });
                if (!manual || manual.trim().length === 0) {
                    return;
                }

                try {
                    if (!targetUri) {
                        vscode.window.showErrorMessage('目标文档已丢失，无法写入标题。');
                        return;
                    }
                    const existing = await getIssueMarkdownFrontmatter(targetUri);
                    const t = normalizeTitle(manual);
                    const merged = mergeTitle(existing, t);
                    if (merged === undefined) {
                        if (existing) {
                            if (typeof existing.issue_title === 'string' && normalizeTitle(existing.issue_title).toLowerCase() === t.toLowerCase()) {
                                return;
                            }
                            if (Array.isArray(existing.issue_title) && containsTitle(existing.issue_title, t)) {
                                return;
                            }
                        }
                        return;
                    }
                    const ok = await updateIssueMarkdownFrontmatter(targetUri, { issue_title: merged });
                    if (ok) {
                        try { await getIssueMarkdownTitle(targetUri); } catch {}
                        vscode.window.showInformationMessage('已将手动输入标题写入 frontmatter.issue_title');
                    }
                } catch (e) {
                    Logger.getInstance().error('手动写入标题失败', e);
                    vscode.window.showErrorMessage('写入标题失败，请查看日志。');
                }
            }
        })
    );
}
