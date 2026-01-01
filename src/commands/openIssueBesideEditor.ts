import * as vscode from "vscode";
import { isIssueTreeNode } from "../utils/treeUtils";
import { readTree, findNodeById, stripFocusedId, getIssueNodeById } from "../data/issueTreeManager";
import { getIssueIdFromUri } from "../utils/uriUtils";

export async function registerOpenIssueBesideEditorHandler(...args: unknown[]) {
    try {
        let sourceUri: vscode.Uri | undefined;
        let issueId: string | undefined;
        const first = args && args.length > 0 ? args[0] : undefined;

        if (first) {
            if (isIssueTreeNode(first)) {
                const node = first as any;
                issueId = stripFocusedId(node.id);
                sourceUri = node.resourceUri;
            } else if (typeof first === "string") {
                const node = await getIssueNodeById(first);
                if (node) {
                    issueId = stripFocusedId(node.id);
                    sourceUri = node.resourceUri;
                }
            } else if (typeof first === "object" && first !== null) {
                // 可能是 vscode.Uri-like 或者包含 issueId/filePath 的对象
                if ("fsPath" in first || "scheme" in first) {
                    sourceUri = first as vscode.Uri;
                    issueId = getIssueIdFromUri(sourceUri) || undefined;
                } else if ("issueId" in first) {
                    const node = await getIssueNodeById(first.issueId as string);
                    if (node) {
                        issueId = stripFocusedId(node.id);
                        sourceUri = node.resourceUri;
                    }
                }
            }
        }
        const editorUri = vscode.window.activeTextEditor?.document.uri;


        if (!sourceUri || !issueId) {
            vscode.window.showInformationMessage(
                "请提供问题的 URL 或从视图中选择问题，或激活包含 issueId 的编辑器。"
            );
            return;
        }

        if (editorUri?.fsPath !== sourceUri.fsPath) {
            const viewColumn = vscode.ViewColumn.Beside;
            const finalUri = issueId
                ? sourceUri.with({ query: `issueId=${encodeURIComponent(issueId)}` })
                : sourceUri;
            await vscode.window.showTextDocument(finalUri, { preview: false, viewColumn });
        }
    } catch (error) {
        vscode.window.showErrorMessage("在编辑器旁边打开问题失败");
    }
}
