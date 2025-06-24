import * as vscode from 'vscode';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { getIssueDir } from '../config';
import { TreeData, TreeNode, readTree, writeTree } from '../data/treeManager';
import { IssueTreeItem } from './IsolatedIssuesProvider';
import { IssueOverviewProvider } from './IssueOverviewProvider';

// 自定义拖拽数据类型
const ISSUE_MIME_TYPE = 'application/vnd.code.tree.issue-manager';

interface DraggedItem {
    type: 'isolated' | 'overview';
    filePath: string;
    id?: string;
}

export class IssueDragAndDropController implements vscode.TreeDragAndDropController<TreeNode | IssueTreeItem> {
    dropMimeTypes: readonly string[] = [ISSUE_MIME_TYPE];
    dragMimeTypes: readonly string[] = [ISSUE_MIME_TYPE];

    constructor(private overviewProvider: IssueOverviewProvider) {}

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
        const targetNodeInTree = target ? this.findNode(treeData.rootNodes, target.id) : undefined;

        for (const [mimeType, transferItem] of dataTransfer) {
            if (token.isCancellationRequested) {
                return;
            }

            if (mimeType === ISSUE_MIME_TYPE) {
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
                    } else if (dragged.type === 'isolated') {
                        const relativePath = path.relative(issueDir, dragged.filePath);
                        nodeToMove = {
                            id: uuidv4(),
                            filePath: relativePath,
                            children: [],
                        };
                    }

                    if (nodeToMove) {
                        this.addNodeToTree(treeData, nodeToMove, targetNodeInTree);
                    }
                }
            }
        }

        await writeTree(treeData);
        this.overviewProvider.refresh();
        vscode.commands.executeCommand('issueManager.isolatedIssues.refresh');
    }

    private addNodeToTree(treeData: TreeData, nodeToAdd: TreeNode, target: TreeNode | null | undefined): void {
        if (target) {
            if (!target.children) {
                target.children = [];
            }
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
