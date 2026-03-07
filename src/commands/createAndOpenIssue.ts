import * as vscode from "vscode";
import { createIssueMarkdown } from "../data/IssueMarkdowns";
import { createIssueNodes } from "../data/issueTreeManager";
import { openIssueNode } from "./openIssueNode";

/**
 * 创建一个新问题并在编辑器中打开，光标定位到正文区域（第三行）。
 * @param title 问题标题（可选，为空则创建无标题问题）
 * @param parentId 父节点 ID（可选，用于创建子问题）
 */
export async function createAndOpenIssue(title?: string, parentId?: string): Promise<void> {
    const uri = await createIssueMarkdown({ markdownBody: `# ${title || ""}\n\n` });
    if (!uri) {
        return;
    }
    const nodes = await createIssueNodes([uri], parentId);
    vscode.commands.executeCommand("issueManager.refreshAllViews");
    if (nodes && nodes[0] && nodes[0].id) {
        const col = `# ${title || ""}`.length;
        openIssueNode(nodes[0].id, {
            viewColumn: vscode.ViewColumn.Beside,
            preview: true,
            preserveFocus: false,
            selection: new vscode.Range(0, col, 0, col),
        }).catch(() => {});
    }
}
