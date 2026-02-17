import * as vscode from 'vscode';
import * as path from 'path';
import * as jsYaml from 'js-yaml';
import { getIssueMarkdown, getIssueMarkdownContent, createIssueMarkdown } from '../data/IssueMarkdowns';
import { createIssueNodes } from '../data/issueTreeManager';
import { GitSyncService } from '../services/git-sync';
import { LLMService } from '../llm/LLMService';
import { translateWithAgent } from '../llm/translationAgent';
import { getRelativeToNoteRoot } from '../utils/pathUtils';
import { Logger } from '../core/utils/Logger';

export function registerCreateTranslationFromEditorCommand(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('issueManager.createTranslationFromEditor', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('没有激活的编辑器可创建译文。');
                return;
            }

            const md = await getIssueMarkdown(editor.document.uri);
            if (!md) {
                vscode.window.showWarningMessage('当前文档不是有效的 IssueMarkdown，无法创建译文。');
                return;
            }

            try {
                const lang = (await vscode.window.showInputBox({
                    prompt: '请输入目标语言代码（例如 zh / en），回车确认',
                    placeHolder: 'zh',
                    value: 'zh'
                }))?.trim() || 'zh';

                const origFs = md.uri.fsPath;
                const dir = path.dirname(origFs);
                const base = path.basename(origFs, '.md');
                const newFileName = `${base}.${lang}.md`;
                const newFsPath = path.join(dir, newFileName);
                const newUri = vscode.Uri.file(newFsPath);

                // 如果文件已存在，提示打开
                try {
                    await vscode.workspace.fs.stat(newUri);
                    const open = await vscode.window.showInformationMessage('译文文件已存在，是否打开？', '打开', '取消');
                    if (open === '打开') {
                        const doc = await vscode.workspace.openTextDocument(newUri);
                        await vscode.window.showTextDocument(doc, { preview: false });
                    }
                    return;
                } catch {
                    // 文件不存在，继续创建
                }

                // 检查原始文件大小，超大文件需要用户确认是否写入全部内容
                const stat = await vscode.workspace.fs.stat(md.uri);
                const LARGE_FILE_THRESHOLD = 200 * 1024; // 200KB
                let includeBody = false;
                if (stat && typeof (stat as any).size === 'number' && (stat as any).size > LARGE_FILE_THRESHOLD) {
                    const choice = await vscode.window.showWarningMessage(
                        '检测到当前文档较大，直接复制全文可能非常耗时或导致卡顿。请选择操作：',
                        { modal: true },
                        '创建空译文（仅 frontmatter）',
                        '创建完整译文（可能耗时）',
                        '取消'
                    );
                    if (choice === '创建完整译文（可能耗时）') {
                        includeBody = true;
                    } else if (choice === '创建空译文（仅 frontmatter）') {
                        includeBody = false;
                    } else {
                        return; // 取消
                    }
                } else {
                    // 小文件默认包含正文
                    includeBody = true;
                }

                const rel = getRelativeToNoteRoot(origFs) ?? origFs;
                const newFrontmatter = Object.assign({}, md.frontmatter ?? {});
                // 设置或覆盖部分字段，保持类型兼容
                newFrontmatter.issue_title = newFrontmatter.issue_title ?? md.title;
                (newFrontmatter as any).translation_of = `IssueDir/${rel}`;
                (newFrontmatter as any).translation_language = lang;


                const bodyTitle = md.title ? `# ${md.title}（译文 - ${lang}）\n\n` : '';

                // 构建最终的正文（不包含 frontmatter），稍后一次性通过 createIssueMarkdown 写入文件
                let bodyContent = bodyTitle;

                if (includeBody) {
                    // 读取正文（不包含原 frontmatter）并询问是否使用 LLM 翻译
                    try {
                        const body = await getIssueMarkdownContent(md.uri);

                        const choice = await vscode.window.showQuickPick([
                            '翻译正文（使用 LLM）',
                            '复制原文（不翻译）',
                            '取消'
                        ], { placeHolder: '选择如何处理正文' });

                        if (!choice || choice === '取消') {
                            return; // 取消整个操作
                        }

                        if (choice === '复制原文（不翻译）') {
                            bodyContent += body;
                        } else if (choice === '翻译正文（使用 LLM）') {
                            // 使用 LLM 翻译正文，支持取消
                            function toAbortSignal(token: vscode.CancellationToken): AbortSignal {
                                const controller = new AbortController();
                                token.onCancellationRequested(() => controller.abort());
                                if (token.isCancellationRequested) controller.abort();
                                return controller.signal;
                            }

                            const translated = await vscode.window.withProgress(
                                {
                                    location: vscode.ProgressLocation.Notification,
                                    title: '正在调用 LLM 翻译正文（可取消）...',
                                    cancellable: true
                                },
                                async (progress, token) => {
                                    try {
                                            // 提供 Agent 模式选项：若文件较大，优先建议使用 Agent 分段翻译
                                            const useAgent = await vscode.window.showQuickPick([
                                                'Agent 模式（分段翻译，推荐大文件）',
                                                '普通模式（一次性翻译全文）',
                                                '取消'
                                            ], { placeHolder: '选择翻译模式（Agent 或 普通）' });

                                            if (!useAgent || useAgent === '取消') return '';

                                            if (useAgent.startsWith('Agent')) {
                                                const agentResult = await translateWithAgent(body, lang, { signal: toAbortSignal(token) });
                                                return agentResult;
                                            } else {
                                                const result = await LLMService.translate(body, lang, { signal: toAbortSignal(token) });
                                                return result;
                                            }
                                    } catch (err) {
                                        if (token.isCancellationRequested) {
                                            return '';
                                        }
                                        Logger.getInstance().error('LLM 翻译出错:', err);
                                        return '';
                                    }
                                }
                            );

                            if (!translated || translated.trim().length === 0) {
                                vscode.window.showWarningMessage('LLM 未返回有效翻译，已创建空译文。');
                            } else {
                                bodyContent += translated;
                            }
                        }
                    } catch (err) {
                        // 读取失败则继续以空译文为主
                        Logger.getInstance().warn('读取原文正文失败，已创建空译文', err);
                    }
                }
                // 通过一次调用创建完整的文件（frontmatter + markdownBody），避免重复写盘与 frontmatter 重复
                const initialUri = await createIssueMarkdown({ frontmatter: newFrontmatter, markdownBody: bodyContent || undefined });
                if (!initialUri) {
                    vscode.window.showErrorMessage('创建译文文件失败。');
                    return;
                }

                try {
                    await createIssueNodes([initialUri]);
                    vscode.commands.executeCommand('issueManager.refreshAllViews');
                } catch (e) {
                    Logger.getInstance().warn('将译文添加到问题树失败', e);
                }

                // 打开编辑器并触发同步
                const doc = await vscode.workspace.openTextDocument(initialUri);
                await vscode.window.showTextDocument(doc, { preview: false });
                try {
                    GitSyncService.getInstance().triggerSync();
                } catch {}
            } catch (error) {
                Logger.getInstance().error('创建译文失败:', error);
                vscode.window.showErrorMessage('创建译文失败');
            }
        })
    );
}
