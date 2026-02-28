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
