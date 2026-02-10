import * as vscode from 'vscode';
import {
    createAbortControllerWithTimeout,
    readFileStatSafe,
    savePendingFile,
} from './backgroundFill.utils';
import { updateIssueMarkdownBody } from '../data/IssueMarkdowns';
import { openIssueNode } from '../commands/openIssueNode';
import { LLMService } from './LLMService';

/**
 * 在后台为指定 issue 文件使用 LLM 生成并填充完整内容。
 * - 先获取文件 mtime 以便在写回前检测冲突。
 * - 生成内容后再次检查 mtime，若文件被修改则写入备用文件并提示用户。
 */
export async function backgroundFillIssue(
    uri: vscode.Uri,
    prompt: string,
    issueId?: string,
    options?: { timeoutMs?: number }
): Promise<{ success: boolean; message?: string }> {
    const timeoutMs = options?.timeoutMs ?? 60000;
    const { controller, clear } = createAbortControllerWithTimeout(timeoutMs);

    // 用于在 progress 结束后弹出的提示（避免在 loading 中弹出 action）
    let pendingNotification: { message: string; action?: string; uriToOpen?: vscode.Uri } | undefined;

    try {
        const result = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: '后台填充中…', cancellable: true },
            async (progress, token): Promise<{ success: boolean; message?: string }> => {
                token.onCancellationRequested(() => controller.abort());

                // 读取当前文件 mtime
                const statBefore = await readFileStatSafe(uri);

                // 调用 LLM 生成文档（标题+内容）
                const doc = await LLMService.generateDocument(prompt, { signal: controller.signal });

                if (!doc || (!doc.content && !doc.title)) {
                    return { success: false, message: 'LLM 未生成有效内容' };
                }

                const finalContent = doc.content && doc.content.length > 0 ? doc.content : `# ${doc.title || prompt}\n\n`;

                // 使用复用的写回逻辑完成写入与交互
                const applyResult = await applyGeneratedIssueContent(uri, finalContent, issueId);
                return applyResult;
            }
        );

        return result;
    } catch (error: any) {
        if (error?.message === '请求已取消' || error?.name === 'AbortError') {
            return { success: false, message: '请求已取消或超时' };
        }
        console.error('backgroundFillIssue error:', error);
        return { success: false, message: String(error) };
    } finally {
        clear();
    }
}

/**
 * 将生成的 Markdown 内容写回目标 issue 文件，包含 mtime 冲突检测、临时文件保存与用户交互。
 */
export async function applyGeneratedIssueContent(
    uri: vscode.Uri,
    finalContent: string,
    issueId?: string
): Promise<{ success: boolean; message?: string }> {
    try {
        // 在写回前检查 mtime 是否有变化
        const statBefore = await readFileStatSafe(uri);
        try {
            const statAfterCheck = await readFileStatSafe(uri);
            if (statBefore && statAfterCheck && statAfterCheck.mtime !== statBefore.mtime) {
                const pendingUri = await savePendingFile(uri, finalContent);
                // 提示用户并提供打开临时文件操作
                vscode.window
                    .showInformationMessage(
                        '后台填充已完成，但目标文件已被修改。已将生成结果保存为临时文件。',
                        '打开临时文件'
                    )
                    .then((choice) => {
                            if (choice === '打开临时文件' && pendingUri) {
                            // Thenable does not have .catch in typings; use then(onFulfilled, onRejected)
                            vscode.window.showTextDocument(pendingUri).then(
                                () => {},
                                () => {}
                            );
                        }
                    });
                return { success: true, message: '目标文件已变更，内容保存为临时文件' };
            }
        } catch (e) {
            // stat 失败则继续写入（可能文件不存在）
        }

        // 原子写回目标文件
        await updateIssueMarkdownBody(uri, finalContent);

        vscode.window.showInformationMessage('已完成。', '打开文件', '对半打开').then((choice) => {
            if (!choice) return;
            if (choice === '打开文件') {
                issueId ? openIssueNode(issueId) : vscode.window.showTextDocument(uri).then(() => {}, () => {});
            } else if (choice === '对半打开') {
                issueId
                    ? openIssueNode(issueId, { viewColumn: vscode.ViewColumn.Beside })
                    : vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.Beside }).then(() => {}, () => {});
            }
        });

        return { success: true };
    } catch (error: any) {
        console.error('applyGeneratedIssueContent error:', error);
        return { success: false, message: String(error) };
    }
}
