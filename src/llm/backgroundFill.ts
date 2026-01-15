import * as vscode from 'vscode';
import * as path from 'path';
import { LLMService } from './LLMService';

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
    const controller = new AbortController();
    const timeout = options?.timeoutMs || 60000;
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    // 用于在 progress 结束后弹出的提示（避免在 loading 中弹出 action）
    let pendingNotification: { message: string; action?: string; uriToOpen?: vscode.Uri } | undefined;

    try {
        const result = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: '后台填充中…', cancellable: true },
            async (progress, token) : Promise<{ success: boolean; message?: string }> => {
                token.onCancellationRequested(() => controller.abort());

                // 读取当前文件 mtime
                let statBefore: vscode.FileStat | undefined;
                try {
                    statBefore = await vscode.workspace.fs.stat(uri);
                } catch (e) {
                    statBefore = undefined;
                }

                // 调用 LLM 生成文档（标题+内容）
                const doc = await LLMService.generateDocument(prompt, { signal: controller.signal });
                if (!doc || (!doc.content && !doc.title)) {
                    return { success: false, message: 'LLM 未生成有效内容' };
                }

                const finalContent = doc.content && doc.content.length > 0 ? doc.content : `# ${doc.title || prompt}\n\n`;

                // 在写回前检查 mtime 是否有变化
                try {
                    const statAfterCheck = await vscode.workspace.fs.stat(uri);
                    if (statBefore && statAfterCheck.mtime !== statBefore.mtime) {
                        const pendingPath = uri.fsPath + '.pending.md';
                        const pendingUri = vscode.Uri.file(pendingPath);
                        await vscode.workspace.fs.writeFile(pendingUri, Buffer.from(finalContent, 'utf8'));
                        pendingNotification = { message: '后台填充已完成，但目标文件已被修改。已将生成结果保存为临时文件。', action: '打开临时文件', uriToOpen: pendingUri };
                        return { success: true, message: '目标文件已变更，内容保存为临时文件' };
                    }
                } catch (e) {
                    // stat 失败则继续写入（可能文件不存在）
                }

                // 原子写回目标文件
                await vscode.workspace.fs.writeFile(uri, Buffer.from(finalContent, 'utf8'));

                // 如果该文件在某个编辑器中已打开，尝试用最新内容替换显示（仅在编辑器无未保存更改时）
                try {
                    const openEditors = vscode.window.visibleTextEditors.filter(e => e.document.uri.fsPath === uri.fsPath);
                    if (openEditors.length > 0) {
                        const editor = openEditors[0];
                        if (!editor.document.isDirty) {
                            const newDoc = await vscode.workspace.openTextDocument(uri);
                            await vscode.window.showTextDocument(newDoc, { viewColumn: editor.viewColumn, preview: false, preserveFocus: true });
                        } else {
                            const pendingPath = uri.fsPath + '.pending.md';
                            const pendingUri = vscode.Uri.file(pendingPath);
                            await vscode.workspace.fs.writeFile(pendingUri, Buffer.from(finalContent, 'utf8'));
                            pendingNotification = { message: '后台填充已完成，但当前编辑器有未保存更改。已将生成结果保存为临时文件。', action: '打开临时文件', uriToOpen: pendingUri };
                            try { await vscode.commands.executeCommand('issueManager.refreshAllViews'); } catch(e){}
                            return { success: true, message: '目标文件有未保存更改，内容保存为临时文件' };
                        }
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
        if (pendingNotification) {
            const choice = await vscode.window.showInformationMessage(pendingNotification.message, pendingNotification.action || '');
            if (choice && pendingNotification.uriToOpen) {
                try { await vscode.window.showTextDocument(pendingNotification.uriToOpen, { preview: false }); } catch(e){}
            }
        }

        return result;
    } catch (error:any) {
        if (error?.message === '请求已取消' || error?.name === 'AbortError') {
            return { success: false, message: '请求已取消或超时' };
        }
        console.error('backgroundFillIssue error:', error);
        return { success: false, message: String(error) };
    } finally {
        clearTimeout(timeoutId);
    }
}
