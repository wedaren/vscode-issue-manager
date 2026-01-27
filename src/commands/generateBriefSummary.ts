import * as vscode from 'vscode';
import { LLMService } from '../llm/LLMService';
import { updateIssueMarkdownFrontmatter, isIssueMarkdown, getIssueMarkdown, getIssueMarkdownContent, IssueMarkdown } from '../data/IssueMarkdowns';
import { Logger } from '../core/utils/Logger';
import { getIssueNodeById, isIssueNode } from '../data/issueTreeManager';

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

function normalizeSummary(s: string) {
    return s.trim().replace(/\s+/g, ' ').normalize();
}

function containsSummary(arr: string[], summary: string) {
    const n = normalizeSummary(summary).toLowerCase();
    return arr.some(a => normalizeSummary(a).toLowerCase() === n);
}

function mergeSummary(
    existing: { [key: string]: unknown } | null | undefined,
    summary: string
): string | string[] | undefined {
    const s = normalizeSummary(summary);
    const briefSummary = existing?.issue_brief_summary;
    
    if (!existing || briefSummary === undefined || briefSummary === null) {
        return s;
    } else if (typeof briefSummary === 'string') {
        const existingNorm = normalizeSummary(briefSummary);
        if (existingNorm.toLowerCase() === s.toLowerCase()) {
            return undefined; // 表示无需修改
        }
        return [briefSummary, s];
    } else if (Array.isArray(briefSummary)) {
        if (containsSummary(briefSummary as string[], s)) {
            return undefined; // 表示无需修改
        }
        return [...(briefSummary as string[]), s];
    } else {
        return s;
    }
}

export function registerGenerateBriefSummaryCommand(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('issueManager.generateBriefSummaryCommand', async (...args: unknown[]) => {
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

                // 请求 LLM 生成摘要，支持取消
                const summary = await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: '正在生成简明摘要...',
                        cancellable: true
                    },
                    async (progress, token) => {
                        try {
                            const content = await getIssueMarkdownContent(targetUri);
                            const generated = await LLMService.generateBriefSummary(content, { signal: toAbortSignal(token) });
                            return generated;
                        } catch (err) {
                            // 如果是用户取消操作，则静默处理
                            if (token.isCancellationRequested) {
                                return;
                            }
                            // 非取消错误：记录日志以便调试，但对用户仍表现为"未生成有效摘要"
                            Logger.getInstance().error('generateBriefSummary error:', err);
                            return;
                        }
                    }
                );

                if (!summary || summary.trim().length === 0) {
                    vscode.window.showInformationMessage('未生成有效摘要。');
                    return;
                }

                const existing = (await getIssueMarkdown(targetUri))?.frontmatter ?? null;

                const newSummary = normalizeSummary(summary);
                const merged = mergeSummary(existing, newSummary);
                if (merged === undefined) {  
                    vscode.window.showInformationMessage('生成摘要与现有 issue_brief_summary 相同或已存在，未做修改。');  
                    return;  
                }  
                const ok = await updateIssueMarkdownFrontmatter(targetUri, { issue_brief_summary: merged });
                if (ok) {
                    vscode.window.showInformationMessage('已将生成摘要写入 frontmatter.issue_brief_summary');
                } else {
                    vscode.window.showErrorMessage('写入 issue_brief_summary 失败，请查看日志。');
                }
            } catch (err: any) {
                if (err && err.message === 'cancelled') {
                    return;
                }
                Logger.getInstance().error('generateBriefSummary error:', err);
            }
        })
    );
}
