import * as vscode from 'vscode';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { getIssueDir } from '../config';
import { TreeData, TreeNode, readTree, stripFocusedId, writeTree } from '../data/treeManager';
import { IssueTreeItem, IsolatedIssuesProvider } from './IsolatedIssuesProvider';
import { IssueOverviewProvider } from './IssueOverviewProvider';
import { FocusedIssuesProvider } from './FocusedIssuesProvider';


// 自定义拖拽数据类型
const ISSUE_MIME_TYPE = 'application/vnd.code.tree.issue-manager';

interface DraggedItem {
    type: 'isolated' | 'overview';
    filePath: string;
    id?: string;
}

export class IssueDragAndDropController implements vscode.TreeDragAndDropController<TreeNode | IssueTreeItem> {
    public dropMimeTypes: string[] = [];
    public dragMimeTypes: string[] = [];

    constructor(private viewProvider: IssueOverviewProvider | IsolatedIssuesProvider | FocusedIssuesProvider, private viewMode: 'isolated' | 'overview' | 'focused') {
        if (viewMode === 'isolated') {
            this.dragMimeTypes = [ISSUE_MIME_TYPE];
        } else if (viewMode === 'overview') {
            this.dropMimeTypes = [ISSUE_MIME_TYPE, 'application/vnd.code.tree.issuemanager.views.isolated', 'text/uri-list'];
            this.dragMimeTypes = [ISSUE_MIME_TYPE];
        } else if (viewMode === 'focused') {
            this.dropMimeTypes = [ISSUE_MIME_TYPE, 'application/vnd.code.tree.issuemanager.views.isolated', 'text/uri-list'];
            this.dragMimeTypes = [ISSUE_MIME_TYPE];
        }
    }

    public async handleDrag(
        source: readonly (TreeNode | IssueTreeItem)[],
        treeDataTransfer: vscode.DataTransfer,
        token: vscode.CancellationToken
    ): Promise<void> {

        const transferData: DraggedItem[] = source.map(item => {
            if (item instanceof IssueTreeItem) {
                return { type: 'isolated', filePath: item.resourceUri.fsPath };
            } else {
                const treeNode = item as TreeNode;
                return { type: 'overview', id: treeNode.id, filePath: treeNode.filePath };
            }
        });
        treeDataTransfer.set(ISSUE_MIME_TYPE, new vscode.DataTransferItem(transferData));
    }

    /**
     * 兼容 VS Code TreeView 拖拽 transferItem.value 类型：
     * - 同一视图内拖拽时为原始对象
     * - 跨视图拖拽时为 JSON 字符串
     * 需统一判断类型，必要时 JSON.parse
     */
    public async handleDrop(
        target: TreeNode | undefined,
        dataTransfer: vscode.DataTransfer,
        token: vscode.CancellationToken
    ): Promise<void> {
        const issueDir = getIssueDir();
        if (!issueDir) {
            return;
        }

        const treeData = await readTree();
        if(!target && this.viewMode === 'focused') {
            vscode.window.showErrorMessage('请先选择一个节点作为目标。');
            return;
        }
        if(target && this.viewMode === 'focused') {
            target.id = stripFocusedId(target.id); // 确保 focused 模式下的目标节点 ID 是正确的
        }

        const targetNodeInTree = target ? this.findNode(treeData.rootNodes, target.id) : undefined;
        const [_, transferItem] = [...dataTransfer].filter(([mimeType, transferItem]) => mimeType === ISSUE_MIME_TYPE && transferItem.value).pop() || [];
        const fromOverview = dataTransfer.get('application/vnd.code.tree.issuemanager.views.overview');
        const fromIsolated = dataTransfer.get('application/vnd.code.tree.issuemanager.views.isolated');
        const fromEditor = dataTransfer.get('text/uri-list');

        if (fromOverview && transferItem) {
            const draggedItems: DraggedItem[] = transferItem.value;

            for (const dragged of draggedItems) {
                let nodeToMove: TreeNode | null = null;

                if (dragged.type === 'overview' && dragged.id) {
                    const sourceNode = this.findNode(treeData.rootNodes, dragged.id);
                    if (sourceNode && this.isAncestor(sourceNode, targetNodeInTree)) {
                        vscode.window.showWarningMessage('无法将一个节点移动到它自己的子节点下。');
                        continue; // 跳过无效操作
                    }
                    nodeToMove = this.findAndRemoveNode(treeData.rootNodes, dragged.id);
                    nodeToMove && this.addNodeToTree(treeData, nodeToMove, targetNodeInTree);

                }
            }


        } else if (fromIsolated && transferItem) {
            const draggedItems: DraggedItem[] = JSON.parse(transferItem.value);
            for (const dragged of draggedItems) {
                let nodeToMove: TreeNode | null = null;

                if (dragged.type === 'isolated') {
                    const relativePath = path.relative(issueDir, dragged.filePath);
                    nodeToMove = {
                        id: uuidv4(),
                        filePath: relativePath,
                        children: [],
                    };
                }

                if (nodeToMove) {
                    if (this.viewMode === 'focused') {
                        targetNodeInTree && this.addNodeToTree(treeData, nodeToMove, targetNodeInTree);
                    } else {
                        this.addNodeToTree(treeData, nodeToMove, targetNodeInTree);
                    }
                }
            }

        } else if (fromEditor) {
            const transferItemValue = fromEditor.value;
            const uriList = (typeof transferItemValue === 'string') ? transferItemValue.split(/\r?\n/) : [];
            for (const uriStr of uriList) {
                if (!uriStr.startsWith('file://')) { continue; }
                const fileUri = vscode.Uri.parse(uriStr);
                const absPath = fileUri.fsPath;
                if (!absPath.endsWith('.md')) {
                    vscode.window.showWarningMessage('只能拖拽 Markdown (.md) 文件到问题总览。');
                    continue;
                }
                if (!absPath.startsWith(issueDir)) {
                    vscode.window.showWarningMessage('只能拖拽“问题目录”内的 .md 文件。');
                    continue;
                }
                const relativePath = path.relative(issueDir, absPath);
                const nodeToAdd: TreeNode = {
                    id: uuidv4(),
                    filePath: relativePath,
                    children: [],
                };
                this.addNodeToTree(treeData, nodeToAdd, targetNodeInTree);
            }

        }

        await writeTree(treeData);
        // this.viewProvider.refresh();
        vscode.commands.executeCommand('issueManager.refreshAllViews');
    }

    private addNodeToTree(treeData: TreeData, nodeToAdd: TreeNode, target: TreeNode | null | undefined): void {
        if (target) {
            if (!target.children) {
                target.children = [];
            }
            target.expanded = true;
            target.children.push(nodeToAdd);
        } else {
            treeData.rootNodes.push(nodeToAdd);
        }
    }

    private findNode(nodes: TreeNode[], id: string): TreeNode | null {
        for (const node of nodes) {
            if (node.id === id) {
                return node;
            }
            const found = this.findNode(node.children || [], id);
            if (found) {
                return found;
            }
        }
        return null;
    }

    private findAndRemoveNode(nodes: TreeNode[], id: string): TreeNode | null {
        for (let i = 0; i < nodes.length; i++) {
            if (nodes[i].id === id) {
                const [removedNode] = nodes.splice(i, 1);
                return removedNode;
            }
            if (nodes[i].children) {
                const removedNode = this.findAndRemoveNode(nodes[i].children, id);
                if (removedNode) {
                    return removedNode;
                }
            }
        }
        return null;
    }

    private isAncestor(potentialAncestor: TreeNode, potentialDescendant: TreeNode | null | undefined): boolean {
        if (!potentialDescendant) {
            return false;
        }
        if (potentialAncestor.id === potentialDescendant.id) {
            return true;
        }
        if (!potentialAncestor.children) {
            return false;
        }
        return potentialAncestor.children.some(child => this.isAncestor(child, potentialDescendant));
    }
}
