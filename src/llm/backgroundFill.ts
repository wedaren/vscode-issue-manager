import * as vscode from 'vscode';
import {
    createAbortControllerWithTimeout,
    readFileStatSafe,
    callLLMGenerateDocument,
    savePendingFile,
    atomicWriteFile,
    updateOpenEditorIfCleanOrSavePending,
    notifyPendingResult,
} from './backgroundFill.utils';

/**
 * 在后台为指定 issue 文件使用 LLM 生成并填充完整内容。
 * - 先获取文件 mtime 以便在写回前检测冲突。
 * - 生成内容后再次检查 mtime，若文件被修改则写入备用文件并提示用户。
 */
export async function backgroundFillIssue(
    uri: vscode.Uri,
    prompt: string,
    options?: { timeoutMs?: number }
): Promise<{ success: boolean; message?: string }>{
    const timeoutMs = options?.timeoutMs ?? 60000;
    const { controller, clear } = createAbortControllerWithTimeout(timeoutMs);

    // 用于在 progress 结束后弹出的提示（避免在 loading 中弹出 action）
    let pendingNotification: { message: string; action?: string; uriToOpen?: vscode.Uri } | undefined;

    try {
        const result = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: '后台填充中…', cancellable: true },
            async (progress, token) : Promise<{ success: boolean; message?: string }> => {
                token.onCancellationRequested(() => controller.abort());

                // 读取当前文件 mtime
                const statBefore = await readFileStatSafe(uri);

                // 调用 LLM 生成文档（标题+内容）
                const doc = await callLLMGenerateDocument(prompt, controller.signal);
                if (!doc || (!doc.content && !doc.title)) {
                    return { success: false, message: 'LLM 未生成有效内容' };
                }

                const finalContent = doc.content && doc.content.length > 0 ? doc.content : `# ${doc.title || prompt}\n\n`;

                // 在写回前检查 mtime 是否有变化
                try {
                    const statAfterCheck = await readFileStatSafe(uri);
                    if (statBefore && statAfterCheck && statAfterCheck.mtime !== statBefore.mtime) {
                        const pendingUri = await savePendingFile(uri, finalContent);
                        pendingNotification = { message: '后台填充已完成，但目标文件已被修改。已将生成结果保存为临时文件。', action: '打开临时文件', uriToOpen: pendingUri };
                        return { success: true, message: '目标文件已变更，内容保存为临时文件' };
                    }
                } catch (e) {
                    // stat 失败则继续写入（可能文件不存在）
                }

                // 原子写回目标文件
                await atomicWriteFile(uri, finalContent);

                // 如果该文件在某个编辑器中已打开，尝试用最新内容替换显示（仅在编辑器无未保存更改时）
                try {
                    const updateResult = await updateOpenEditorIfCleanOrSavePending(uri, finalContent);
                    if (updateResult.pendingUri) {
                        pendingNotification = { message: '后台填充已完成，但当前编辑器有未保存更改。已将生成结果保存为临时文件。', action: '打开临时文件', uriToOpen: updateResult.pendingUri };
                        return { success: true, message: '目标文件有未保存更改，内容保存为临时文件' };
                    }
                } catch (e) {
                    console.error('尝试更新打开的编辑器时出错:', e);
                }

                try { await vscode.commands.executeCommand('issueManager.refreshAllViews'); } catch(e){}
                pendingNotification = { message: '后台填充已完成。', action: '打开文件', uriToOpen: uri };
                return { success: true };
            }
        );

        // 在 progress 结束后再弹出提示，避免 loading 中出现交互按钮
        await notifyPendingResult(pendingNotification);

        return result;
    } catch (error:any) {
        if (error?.message === '请求已取消' || error?.name === 'AbortError') {
            return { success: false, message: '请求已取消或超时' };
        }
        console.error('backgroundFillIssue error:', error);
        return { success: false, message: String(error) };
    } finally {
        clear();
    }
}
