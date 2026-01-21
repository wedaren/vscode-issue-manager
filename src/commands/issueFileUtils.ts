import * as vscode from "vscode";
import { createIssueMarkdown } from "../data/IssueMarkdowns";
import { IssueNode, createIssueNodes } from "../data/issueTreeManager";
import { addFocus } from "../data/focusedManager";

/**
 * 仅负责在磁盘上创建新的问题文件。
 * 文件名格式：YYYYMMDD-HHmmss-SSS.md，兼具可读性和唯一性。
 * @param title 问题标题
 * @returns 新建文件的 URI，如果失败则返回 null。
 * @deprecated 请使用 createIssueMarkdown 方法代替。
 */
export async function createIssueFile(title: string, content?: string): Promise<vscode.Uri | null> {
    const markdownBody = content && content.length > 0 ? content : `# ${title}\n\n`;
    const uri = await createIssueMarkdown({ markdownBody });
    if (!uri) return null;
    await vscode.window.showTextDocument(uri);
    return uri;
}

/**
 * 将指定文件路径的多个 issue 添加到 tree.json 数据中。
 * @param issueUris 要添加的问题文件的 URI 数组
 * @param parentId 父节点的 ID，如果为 null 则作为根节点
 * @param isAddToFocused 是否将新添加的节点添加到关注列表
 * @deprecated 请使用 createIssueNodes 方法代替。
 */
export async function addIssueToTree(
    issueUris: vscode.Uri[],
    parentId?: string,
    isAddToFocused: boolean = true
): Promise<IssueNode[] | null> {
    const res = await createIssueNodes(issueUris, parentId);
    if (!res) {
        return null;
    }

    const ids = res.map(node => node.id);
    if (isAddToFocused) {
        addFocus(ids);
    }

    vscode.commands.executeCommand("issueManager.refreshAllViews");
    return res;
}
