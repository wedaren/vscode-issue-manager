import * as vscode from 'vscode';
import * as path from 'path';
import { backgroundFillIssue } from '../llm/backgroundFill';
import { createIssueMarkdown } from '../data/IssueMarkdowns';
import { createIssueNodes } from '../data/issueTreeManager';

export async function executeCreateIssueFromCompletion(...args: unknown[]): Promise<void> {
    try {
        const { parentId, titleArg, background, insertMode, hasTrigger } = parseCreateIssueArgs(args);
        const editor = vscode.window.activeTextEditor;

        let title = titleArg && titleArg.trim().length > 0 ? titleArg.trim() : undefined;
        if (!title) {
            title = await vscode.window.showInputBox({ prompt: '输入要创建的问题标题（取消将中止）' });
            if (!title) { return; }
        }

        const uri = await createIssueMarkdown({ markdownBody: `# ${title}\n\n` });
        if (!uri) { return; }

        const added = await createIssueNodes([uri], parentId);
        
        const newNodeId = added && added.length > 0 ? added[0].id : undefined;

        if (background) {
            backgroundFillIssue(uri, title, { timeoutMs: 60000 });
        }

        if (editor) {
            await insertLinkIntoEditor(editor, uri, title, newNodeId, insertMode, hasTrigger, background);
        }
    } catch (error) {
        console.error('createIssueFromCompletion 执行失败:', error);
        throw error;
    }
}

export function parseCreateIssueArgs(args: unknown[]): { parentId?: string | undefined; titleArg?: string; background: boolean; insertMode: string; hasTrigger: boolean } {
    const parentId = typeof args?.[0] === 'string' ? args[0] : undefined;
    const titleArg = typeof args?.[1] === 'string' ? args[1] : undefined;
    const background = typeof args?.[2] === 'boolean' ? args[2] : false;
    const insertMode = typeof args?.[3] === 'string' ? args[3] : 'relativePath';
    const hasTrigger = typeof args?.[4] === 'boolean' ? args[4] : false;
    return { parentId, titleArg, background, insertMode, hasTrigger };
}


async function insertLinkIntoEditor(editor: vscode.TextEditor, uri: vscode.Uri, title: string, newNodeId: string | undefined, insertMode = 'relativePath', hasTrigger = false, background = false): Promise<void> {
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
    // - 使用保存下来的选区信息可以保证在插入后把光标/选区恢复到原先位置，而不是停留在插入位置。
    // - 通过在行尾插入一个换行再跟上 `insertText`，可以在原行下方新增内容，保持原有文本不被删除。
    const previousSelection = editor.selection;
    const doc = editor.document;
    const targetLine = previousSelection.active.line;
    const line = doc.lineAt(targetLine);

    // 统一判断：当需要保留选区时（background 或 光标不在行尾），在当前行下新增；否则替换整行并移到下一行首
    const cursorIsAtLineEnd = previousSelection.isEmpty && previousSelection.active.isEqual(line.range.end);
    const preserveSelection = background || !cursorIsAtLineEnd;

    if (preserveSelection) {
        await editor.edit(editBuilder => {
            const currentLineEnd = line.range.end;
            editBuilder.insert(currentLineEnd, '\n' + insertText + '\n');
        });

        try {
            editor.selection = previousSelection;
            editor.revealRange(previousSelection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        } catch (e) {
            // 忽略恢复错误
        }

        return;
    }

    // 否则：替换整行并把光标移动到下一行首
    await editor.edit(editBuilder => {
        editBuilder.replace(line.range, insertText + '\n');
    });

    try {
        const updatedDoc = editor.document;
        const newLine = Math.min(updatedDoc.lineCount - 1, targetLine + 1);
        const pos = new vscode.Position(newLine, 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    } catch (e) {
        // 忽略恢复失败
    }
}
