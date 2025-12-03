import * as vscode from 'vscode';
import * as path from 'path';
import { createIssueFile, addIssueToTree } from './issueFileUtils';
import { getFlatTree } from '../data/treeManager';
import { getIssueDir } from '../config';
import { extractFilterKeyword } from '../utils/completionUtils';

/**
 * 从补全中创建问题并插入链接的命令参数
 */
export interface CreateIssueFromCompletionArgs {
    document: vscode.TextDocument;
    triggers: string[];
    insertMode: string;
    selectedText?: string;
}

/**
 * 从补全中创建问题并插入链接
 * 用于"新建笔记"补全项的后续处理
 */
export async function createIssueFromCompletionAndInsert(args: CreateIssueFromCompletionArgs): Promise<void> {
    try {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { return; }
        const { document, triggers, insertMode, selectedText } = args;
        const position = editor.selection.active;

        // 标题优先使用传入的选中文本，其次回退到提取的关键字
        let title = (selectedText ?? '').trim();
        if (!title) {
            const filterResult = extractFilterKeyword(document, position, triggers);
            title = filterResult.keyword?.trim() ?? '';
        }
        if (!title) {
            vscode.window.showInformationMessage('请输入标题后再创建笔记。');
            return;
        }

        // 创建笔记文件并加入树
        const uri = await createIssueFile(title);
        if (!uri) { return; }
        await addIssueToTree([uri], null, true);

        // 计算相对路径与（可选）节点 ID
        const issueDir = getIssueDir();
        let relativePath = '';
        if (issueDir) {
            relativePath = path.relative(path.dirname(document.uri.fsPath), uri.fsPath);
        }

        // 查找新节点 id（用于 markdownLink 普通模式插入）
        let issueId: string | undefined;
        try {
            if (issueDir) {
                const flat = await getFlatTree();
                const relFromIssueDir = path.relative(issueDir, uri.fsPath);
                const found = flat.find(n => n.filePath === relFromIssueDir);
                issueId = found?.id;
            }
        } catch { /* 忽略 */ }

        // 生成插入文本
        let insertText = '';
        switch (insertMode) {
            case 'markdownLink':
                // 有选区则直接插入标准 markdown 链接；无选区再判断是否存在触发符
                if (editor.selection && !editor.selection.isEmpty) {
                    if (issueId) {
                        insertText = `[${title}](${relativePath}?issueId=${encodeURIComponent(issueId)})`;
                    } else {
                        insertText = `[${title}](${relativePath})`;
                    }
                } else {
                    const fr = extractFilterKeyword(document, position, triggers);
                    if (fr.hasTrigger) {
                        insertText = `${title}]]`;
                    } else {
                        if (issueId) {
                            insertText = `[${title}](${relativePath}?issueId=${encodeURIComponent(issueId)})`;
                        } else {
                            insertText = `[${title}](${relativePath})`;
                        }
                    }
                }
                break;
            case 'filename':
                insertText = path.basename(uri.fsPath);
                break;
            case 'relativePath':
            default:
                insertText = relativePath || path.basename(uri.fsPath);
                break;
        }

        // 计算需要被替换的范围：有选区则直接替换选区；否则仅替换关键字本身（不包含触发符）
        let replaceRange: vscode.Range;
        if (editor.selection && !editor.selection.isEmpty) {
            replaceRange = new vscode.Range(editor.selection.start, editor.selection.end);
        } else {
            const lineText = document.lineAt(position.line).text;
            const prefix = lineText.slice(0, position.character);
            let startIndex = 0;
            let usedTrigger: string | undefined;
            for (const t of triggers) {
                const idx = prefix.lastIndexOf(t);
                if (idx !== -1) { usedTrigger = t; startIndex = idx + t.length; break; }
            }
            if (!usedTrigger) {
                const lastWhitespaceMatch = prefix.match(/\s(?=\S*$)/);
                startIndex = lastWhitespaceMatch ? (lastWhitespaceMatch.index! + 1) : 0;
            }

            replaceRange = new vscode.Range(
                new vscode.Position(position.line, startIndex),
                position
            );
        }

        await editor.edit(editBuilder => {
            editBuilder.replace(replaceRange, insertText);
        });

        vscode.window.setStatusBarMessage('已创建笔记并插入链接', 2000);
    } catch (err) {
        console.error('从补全创建并插入链接失败:', err);
    }
}
