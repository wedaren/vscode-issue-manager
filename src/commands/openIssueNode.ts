import * as vscode from "vscode";
import * as path from "path";
import { IssueNode, getIssueNodeById } from "../data/issueTreeManager";
import { getIssueDir } from "../config";

/**
 * 打开 IssueNode 对应的文件，支持传入 `IssueNode` 或 `issueId` 字符串。
 * 在打开的 URI 上附加 `issueId` 查询参数，保证同一路径可作为不同上下文打开。
 * @param issueOrNode `IssueNode` 对象或 `issueId` 字符串
 */
export async function openIssueNode(
    issueOrNode: string | IssueNode,
    viewOpton?: vscode.TextDocumentShowOptions
): Promise<void> {
    const issueDir = getIssueDir();
    if (!issueDir) {
        vscode.window.showWarningMessage("请先配置问题目录。");
        return;
    }

    let node: IssueNode | undefined;

    if (typeof issueOrNode === "string") {
        const issueId = issueOrNode;
        const found = await getIssueNodeById(issueId).catch(() => undefined);
        if (!found) {
            vscode.window.showErrorMessage(`找不到对应的笔记节点：${issueId}`);
            return;
        }
        node = found;
    } else {
        node = issueOrNode;
    }

    const filePath = path.join(issueDir, node.filePath);
    const uri = vscode.Uri.file(filePath).with({ query: `issueId=${encodeURIComponent(node.id)}` });

    try {
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, viewOpton);
    } catch (error) {
        vscode.window.showErrorMessage(`无法打开笔记文件：${node.filePath}`);
        console.error("打开笔记失败:", error);
    }
}

export function openIssueNodeBeside(issueOrNode: string | IssueNode): Promise<void> {
    const isCurrentEditor = vscode.window.activeTextEditor;
    if (isCurrentEditor) {
        return openIssueNode(issueOrNode, {
            viewColumn: vscode.ViewColumn.Beside,
            preview: true,
            preserveFocus: true,
        });
    } else {
        return openIssueNode(issueOrNode, {
            preview: false,
        });
    }
}
