/**
 * 简要描述：提供一个命令 `issueManager.removeWikiLinksFromSelection`，在编辑器选区
 * 内或包裹选中文本的 [[...]] 中移除 wiki 方括号，保留内部文本。
 */
import * as vscode from 'vscode';

/**
 * 注册命令：`issueManager.removeWikiLinksFromSelection`
 */
export function registerRemoveWikiLinksFromSelection(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand('issueManager.removeWikiLinksFromSelection', async () => {
        const ed = vscode.window.activeTextEditor;
        if (!ed) return;
        const doc = ed.document;
        const sel = ed.selection;
        if (sel.isEmpty) return;

        const selText = doc.getText(sel);

        // 情形一：选区中包含至少一个完整的 [[...]]，执行批量替换
        if (/\[\[([\s\S]*?)\]\]/.test(selText)) {
            const replaced = selText.replace(/\[\[([\s\S]*?)\]\]/g, (_m, p1) => p1);
            if (replaced !== selText) {
                await ed.edit(builder => builder.replace(sel, replaced));
            }
            return;
        }

        // 情形二：选区本身为 [[...]] 的完整包裹，去除外层方括号
        if (selText.startsWith('[[') && selText.endsWith(']]')) {
            const inner = selText.substring(2, selText.length - 2);
            await ed.edit(builder => builder.replace(sel, inner));
            return;
        }

        // 情形三：基于全文尝试找到最近的左右中括号配对，优先使用靠近选区的配对
        try {
            const fullText = doc.getText();
            const selStart = doc.offsetAt(sel.start);
            const selEnd = doc.offsetAt(sel.end);
            const maxScan = 2000;

            // 在全文中查找靠近选区的左/右括号
            const leftBefore = fullText.lastIndexOf('[[', selEnd);
            const rightAfter = fullText.indexOf(']]', selStart);

            // 情况：选区被完整包裹在最近的左右括号中
            if (leftBefore !== -1 && rightAfter !== -1 && leftBefore < selStart && rightAfter > selEnd) {
                const absLeft = leftBefore;
                const absRight = rightAfter + 2;
                const range = new vscode.Range(doc.positionAt(absLeft), doc.positionAt(absRight));
                const innerText = fullText.substring(absLeft + 2, absRight - 2);
                await ed.edit(builder => builder.replace(range, innerText));
                return;
            }

            // 情况：只有左括号存在（或左在选区附近），尝试向后寻找右括号配对
            if (leftBefore !== -1) {
                const absLeft = leftBefore;
                const absRightSearch = fullText.indexOf(']]', absLeft + 2);
                if (absRightSearch !== -1 && absRightSearch - absLeft < maxScan * 2) {
                    const range = new vscode.Range(doc.positionAt(absLeft), doc.positionAt(absRightSearch + 2));
                    const innerText = fullText.substring(absLeft + 2, absRightSearch);
                    await ed.edit(builder => builder.replace(range, innerText));
                    return;
                }
                // 未找到配对，尝试删除该左括号
                const leftRange = new vscode.Range(doc.positionAt(absLeft), doc.positionAt(absLeft + 2));
                await ed.edit(builder => builder.delete(leftRange));
                return;
            }

            // 情况：只有右括号存在（或右在选区附近），尝试向前寻找左括号配对
            if (rightAfter !== -1) {
                const absRight = rightAfter + 2;
                const absLeftSearch = fullText.lastIndexOf('[[', absRight - 2);
                if (absLeftSearch !== -1 && absRight - absLeftSearch < maxScan * 2) {
                    const range = new vscode.Range(doc.positionAt(absLeftSearch), doc.positionAt(absRight));
                    const innerText = fullText.substring(absLeftSearch + 2, absRight - 2);
                    await ed.edit(builder => builder.replace(range, innerText));
                    return;
                }
                // 未找到配对，尝试删除该右括号
                const rightRange = new vscode.Range(doc.positionAt(absRight - 2), doc.positionAt(absRight));
                await ed.edit(builder => builder.delete(rightRange));
                return;
            }
        } catch {
            // ignore and fallback to adjacent-removal
        }

        // 情形四（回退）：仅删除选区左右紧邻的 [[ 或 ]]
        const fullText = doc.getText();
        const selStart = doc.offsetAt(sel.start);
        const selEnd = doc.offsetAt(sel.end);
        const beforeRange = new vscode.Range(doc.positionAt(Math.max(0, selStart - 2)), doc.positionAt(selStart));
        const afterRange = new vscode.Range(doc.positionAt(selEnd), doc.positionAt(Math.min(fullText.length, selEnd + 2)));
        const before = doc.getText(beforeRange);
        const after = doc.getText(afterRange);
        let editsMade = false;
        await ed.edit(builder => {
            if (before === '[[') {
                builder.delete(beforeRange);
                editsMade = true;
            }
            if (after === ']]') {
                builder.delete(afterRange);
                editsMade = true;
            }
        });
        if (!editsMade) return;
    });
    context.subscriptions.push(disposable);
}

export default registerRemoveWikiLinksFromSelection;
