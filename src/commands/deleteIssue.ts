import * as vscode from 'vscode';
import * as path from 'path';
import { IssueNode, getIssueNodesByUri, readTree, removeNode, writeTree } from '../data/issueTreeManager';
import { getIssueMarkdown, getIssueMarkdownTitleFromCache, isIssueMarkdown } from '../data/IssueMarkdowns';
import { EditorContextService } from '../services/EditorContextService';

/**
 * 递归检查节点及其所有子孙节点是否都只有单一关联引用。
 * 同时收集整棵子树中所有唯一的 filePath（用于后续批量删除文件）。
 */
async function isSubtreeSingleAssociation(
    node: IssueNode,
    filePaths: Set<string>
): Promise<boolean> {
    // 当前节点的文件在树中是否只有 1 处引用
    const nodes = await getIssueNodesByUri(node.resourceUri);
    if (nodes.length > 1) {
        return false;
    }
    filePaths.add(node.resourceUri.fsPath);

    // 递归检查所有 children
    for (const child of node.children ?? []) {
        if (!(await isSubtreeSingleAssociation(child, filePaths))) {
            return false;
        }
    }
    return true;
}

/**
 * 从编辑器安全删除的上下文信息。
 */
export interface DeleteFromEditorContext {
    /** 待删除的所有文件绝对路径（当前文件 + 子问题文件） */
    filePaths: Set<string>;
    /** 问题树中的根节点（若存在），用于解除关联 */
    rootNode?: IssueNode;
}

/**
 * 检查当前编辑器对应的 IssueMarkdown/IssueNode 是否可从编辑器安全删除。
 * 若可以，返回删除上下文（包含待删除文件路径和树节点）；否则返回 null。
 *
 * 允许删除的情况：
 * - 纯 IssueMarkdown（不在问题树中，即无关联的 IssueNode）
 * - IssueNode 仅 1 处关联，且其整棵子树中每个节点都只有单一关联
 *
 * 任何节点有多处关联的情况应在问题总览右键菜单中处理。
 */
export async function canDeleteFromEditor(uri: vscode.Uri): Promise<DeleteFromEditorContext | null> {
    const issueMarkdown = await getIssueMarkdown(uri);
    if (!isIssueMarkdown(issueMarkdown)) {
        return null;
    }

    const filePaths = new Set<string>();
    filePaths.add(uri.fsPath);

    const associatedNodes = await getIssueNodesByUri(uri);

    // 纯 IssueMarkdown，不在树中
    if (associatedNodes.length === 0) {
        return { filePaths };
    }

    // 仅 1 处关联，递归检查子树
    if (associatedNodes.length === 1) {
        const rootNode = associatedNodes[0];
        if (await isSubtreeSingleAssociation(rootNode, filePaths)) {
            return { filePaths, rootNode };
        }
    }

    return null;
}

/**
 * 注册”删除问题”命令，支持单个或批量删除问题文件。
 * @param context 扩展上下文
 */
export function registerDeleteIssueCommand(context: vscode.ExtensionContext) {
    const command = vscode.commands.registerCommand('issueManager.deleteIssue', async (item: vscode.TreeItem, selectedItems?: vscode.TreeItem[]) => {
        const itemsToDelete = selectedItems?.length ? selectedItems : (item ? [item] : []);
        if (itemsToDelete.length === 0) {
            vscode.window.showErrorMessage('没有选中要删除的文件。');
            return;
        }

    const fileNames = itemsToDelete.map(i => i.resourceUri ? path.basename(i.resourceUri.fsPath) : '未知文件').join('\n');
        const confirm = await vscode.window.showWarningMessage(
            `您确定要永久删除 ${itemsToDelete.length} 个文件吗？\n${fileNames}\n此操作无法撤销。`,
            { modal: true },
            '确认删除'
        );

        if (confirm === '确认删除') {
            let failedFiles: string[] = [];
            for (const i of itemsToDelete) {
                if (i.resourceUri) {
                    try {
                        await vscode.workspace.fs.delete(i.resourceUri);
                    } catch (error) {
                        const failedFile = path.basename(i.resourceUri.fsPath);
                        failedFiles.push(failedFile);
                        console.error(`删除文件 ${failedFile} 时出错:`, error);
                    }
                }
            }

            const successCount = itemsToDelete.length - failedFiles.length;
            if (failedFiles.length > 0) {
                vscode.window.showWarningMessage(`成功删除 ${successCount} 个文件，${failedFiles.length} 个文件删除失败: ${failedFiles.join(', ')}`);
            } else {
                vscode.window.showInformationMessage(`成功删除 ${successCount} 个文件。`);
            }
            // The view will refresh automatically via the FileSystemWatcher.
        }
    });

    context.subscriptions.push(command);
}

/**
 * 注册"从编辑器删除当前问题"命令。
 * 删除当前活动编辑器对应的 IssueMarkdown 文件或 IssueNode 文件。
 */
export function registerDeleteIssueFromEditorCommand(context: vscode.ExtensionContext) {
    const command = vscode.commands.registerCommand('issueManager.deleteIssueFromEditor', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('未找到活动的编辑器。');
            return;
        }

        const uri = editor.document.uri;

        // 校验是否允许从编辑器删除，同时获取删除上下文（避免重复计算）
        const deleteCtx = await canDeleteFromEditor(uri);
        if (!deleteCtx) {
            vscode.window.showWarningMessage('当前问题有多处关联引用或子树中存在多处关联，请在问题总览中操作。');
            return;
        }

        const { filePaths, rootNode } = deleteCtx;
        const issueMarkdown = await getIssueMarkdown(uri);
        const fileName = path.basename(uri.fsPath);
        const displayName = issueMarkdown?.title ?? fileName;

        // 构建确认信息
        const childCount = filePaths.size - 1; // 排除当前文件本身
        let warningMsg = `您确定要永久删除「${displayName}」吗？`;
        if (childCount > 0) {
            // 收集子问题标题列表
            const childTitles = [...filePaths]
                .filter(p => p !== uri.fsPath)
                .map(p => getIssueMarkdownTitleFromCache(p) ?? path.basename(p));
            warningMsg += `\n\n该节点下包含 ${childCount} 个子问题，将一并删除：\n${childTitles.map(t => `  · ${t}`).join('\n')}`;
        }
        warningMsg += `\n\n此操作无法撤销。`;

        const confirm = await vscode.window.showWarningMessage(
            warningMsg,
            { modal: true },
            '确认删除'
        );

        if (confirm !== '确认删除') {
            return;
        }

        try {
            // 先从问题树中解除关联
            if (rootNode) {
                const treeData = await readTree();
                if (treeData) {
                    removeNode(treeData, rootNode.id);
                    await writeTree(treeData);
                    await EditorContextService.getInstance()?.recheckCurrentEditor();
                }
            }

            // 关闭当前编辑器标签页
            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');

            // 并行删除所有文件（当前文件 + 子问题文件）
            const results = await Promise.allSettled(
                [...filePaths].map(fp => vscode.workspace.fs.delete(vscode.Uri.file(fp)))
            );
            const failedFiles = [...filePaths].filter((_, i) => results[i].status === 'rejected').map(fp => path.basename(fp));
            for (const [i, r] of results.entries()) {
                if (r.status === 'rejected') {
                    console.error(`删除文件 ${[...filePaths][i]} 时出错:`, r.reason);
                }
            }

            if (failedFiles.length > 0) {
                vscode.window.showWarningMessage(`已删除 ${filePaths.size - failedFiles.length} 个文件，${failedFiles.length} 个失败: ${failedFiles.join(', ')}`);
            } else if (childCount > 0) {
                vscode.window.showInformationMessage(`已删除「${displayName}」及其 ${childCount} 个子问题。`);
            } else {
                vscode.window.showInformationMessage(`已删除「${displayName}」。`);
            }
            // 视图刷新由 FileSystemWatcher → onTitleUpdate debounce 链路自动触发，无需显式调用
        } catch (error) {
            console.error(`删除文件 ${fileName} 时出错:`, error);
            vscode.window.showErrorMessage(`删除「${displayName}」失败: ${error instanceof Error ? error.message : '未知错误'}`);
        }
    });

    context.subscriptions.push(command);
}
