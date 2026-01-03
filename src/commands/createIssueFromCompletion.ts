import * as vscode from 'vscode';
import * as path from 'path';
import { createIssueFileSilent, addIssueToTree } from './issueFileUtils';
import { backgroundFillIssue } from '../llm/backgroundFill';

export async function executeCreateIssueFromCompletion(...args: unknown[]): Promise<void> {
    try {
        const { parentId, titleArg, background, insertMode, hasTrigger } = parseCreateIssueArgs(args);
        const editor = vscode.window.activeTextEditor;

        let title = titleArg && titleArg.trim().length > 0 ? titleArg.trim() : undefined;
        if (!title) {
            title = await vscode.window.showInputBox({ prompt: '输入要创建的问题标题（取消将中止）' });
            if (!title) { return; }
        }

        const { uri, newNodeId } = await createAndOpenIssue(title, parentId);
        if (!uri) { return; }

        if (background) {
            backgroundFillIssue(uri, title, { timeoutMs: 60000 }).then(()=>{}).catch(()=>{});
        }

        if (editor) {
            await insertLinkIntoEditor(editor, uri, title, newNodeId, insertMode, hasTrigger);
        }
    } catch (error) {
        console.error('createIssueFromCompletion 执行失败:', error);
        throw error;
    }
}

export function parseCreateIssueArgs(args: unknown[]): { parentId: string | null; titleArg?: string; background: boolean; insertMode: string; hasTrigger: boolean } {
    const parentId = args && args.length > 0 && (typeof args[0] === 'string' ? args[0] as string : null) || null;
    const titleArg = args && args.length > 1 && typeof args[1] === 'string' ? args[1] as string : undefined;
    const background = args && args.length > 2 && typeof args[2] === 'boolean' ? args[2] as boolean : false;
    const insertMode = args && args.length > 3 && typeof args[3] === 'string' ? args[3] as string : 'relativePath';
    const hasTrigger = args && args.length > 4 && typeof args[4] === 'boolean' ? args[4] as boolean : false;
    return { parentId, titleArg, background, insertMode, hasTrigger };
}

export async function createAndOpenIssue(title: string, parentId: string | null): Promise<{ uri?: vscode.Uri; newNodeId?: string | undefined }> {
    const uri = await createIssueFileSilent(title);
    if (!uri) { return { }; }

    const added = await addIssueToTree([uri], parentId);
    const newNodeId = added && added.length > 0 ? added[0].id : undefined;

    try {
        const openUri = newNodeId ? uri.with({ query: `issueId=${encodeURIComponent(newNodeId)}` }) : uri;
        await vscode.window.showTextDocument(openUri, { preview: false, viewColumn: vscode.ViewColumn.Beside });
    } catch (e) {
        try { await vscode.window.showTextDocument(uri, { preview: false }); } catch {}
    }

    return { uri, newNodeId };
}

async function insertLinkIntoEditor(editor: vscode.TextEditor, uri: vscode.Uri, title: string, newNodeId: string | undefined, insertMode = 'relativePath', hasTrigger = false): Promise<void> {
    const currentDir = path.dirname(editor.document.uri.fsPath);
    const relativePath = path.relative(currentDir, uri.fsPath);
    let insertText: string;

    switch (insertMode) {
        case 'markdownLink':
            if (hasTrigger) {
                insertText = `${title}]]`;
            } else {
                insertText = `[${title}](${relativePath}${newNodeId ? '?issueId=' + encodeURIComponent(newNodeId) : ''})`;
            }
            break;
        case 'filename':
            insertText = path.basename(uri.fsPath);
            break;
        case 'relativePath':
        default:
            insertText = relativePath;
            break;
    }

    // 插入行为说明：
    // - 不替换选中文本或触发词，而是把要插入的内容放到选区所在行的下一行。
    // - 使用 `editor.selection.end.line` 可以保证当用户选中某段文本时，插入位置在选区末尾所在的行，而不是替换选中文本。
    // - 通过在行尾插入一个换行再跟上 `insertText`，可以在原行下方新增内容，保持原有文本不被删除。
    await editor.edit(editBuilder => {
        const endLine = editor.selection.end.line;
        const currentLineEnd = editor.document.lineAt(endLine).range.end;
        editBuilder.insert(currentLineEnd, '\n' + insertText);
    });
}
