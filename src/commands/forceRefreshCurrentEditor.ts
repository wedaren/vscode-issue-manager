import * as vscode from "vscode";

/**
 * 简要说明：通过关闭并重新打开文档强制刷新活动编辑器视图。
 * 适用于外部接口修改文件但编辑器未及时更新的场景。
 */
export async function forceRefreshCurrentEditor(): Promise<void> {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
        return;
    }

    const { document, viewColumn, selections } = activeEditor;
    if (document.isDirty) {
        await vscode.window.showWarningMessage("当前编辑器存在未保存修改，已取消强制刷新。请先保存后重试。");
        return;
    }

    const uri = document.uri;
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    const reopenedDocument = await vscode.workspace.openTextDocument(uri);
    const reopenedEditor = await vscode.window.showTextDocument(reopenedDocument, {
        viewColumn,
        preview: false,
        preserveFocus: false,
    });

    if (selections.length > 0) {
        reopenedEditor.selections = selections;
        reopenedEditor.revealRange(selections[0]);
    }
}

/**
 * 强制刷新指定文件对应的编辑器（如果已打开）。
 * - 在编辑器无未保存修改时，关闭并重新打开该编辑器以确保从磁盘读取最新内容。
 * - 若编辑器未打开，则会简单打开该文档。
 */
export async function forceRefreshEditor(uri: vscode.Uri): Promise<void> {
    if (!uri) return;

    // 尝试在已打开的可见编辑器中找到匹配的文档（比较 fsPath，忽略 query）
    const targetFsPath = uri.fsPath;
    const match = vscode.window.visibleTextEditors.find(e => e.document.uri.fsPath === targetFsPath);

    if (match) {
        const editor = match;
        if (editor.document.isDirty) {
            await vscode.window.showWarningMessage("目标文件在编辑器中存在未保存修改，跳过自动刷新。请先保存后重试。");
            return;
        }

        const { viewColumn, selections } = editor;
        try {
            // 聚焦目标编辑器并关闭它，然后重新打开以强制从磁盘加载
            await vscode.window.showTextDocument(editor.document, { viewColumn, preview: false, preserveFocus: false });
            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');

            const reopenedDocument = await vscode.workspace.openTextDocument(uri);
            const reopenedEditor = await vscode.window.showTextDocument(reopenedDocument, { viewColumn, preview: false, preserveFocus: false });
            if (selections && selections.length > 0) {
                reopenedEditor.selections = selections;
                reopenedEditor.revealRange(selections[0]);
            }
        } catch (e) {
            // 忽略错误
        }
    } else {
        // 未打开：直接打开文档（不打断当前活动编辑器）
        try {
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true });
        } catch (e) {}
    }
}
