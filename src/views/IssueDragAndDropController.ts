import * as vscode from 'vscode';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { getIssueDir } from '../config';
import { TreeData, IssueTreeNode, readTree, stripFocusedId,isFocusedRootId, writeTree } from '../data/treeManager';
import { IssueItem, IsolatedIssuesProvider } from './IsolatedIssuesProvider';
import { IssueOverviewProvider } from './IssueOverviewProvider';
import { FocusedIssuesProvider } from './FocusedIssuesProvider';
import { RecentIssuesProvider } from './RecentIssuesProvider';


// 自定义拖拽数据类型
const ISSUE_MIME_TYPE = 'application/vnd.code.tree.issue-manager';

type DraggedItem = IssueTreeNode | IssueItem

export class IssueDragAndDropController implements vscode.TreeDragAndDropController<IssueTreeNode | IssueItem> {
    public dropMimeTypes: string[] = [];
    public dragMimeTypes: string[] = [];

    constructor(private viewProvider: IssueOverviewProvider | IsolatedIssuesProvider | FocusedIssuesProvider | RecentIssuesProvider, private viewMode: 'isolated' | 'overview' | 'focused' | 'recent') {
        if (viewMode === 'isolated') {
            this.dragMimeTypes = [ISSUE_MIME_TYPE];
            this.dropMimeTypes = []; // 孤立问题视图只出不进
        } else if (viewMode === 'overview') {
            this.dropMimeTypes = [ISSUE_MIME_TYPE, 'application/vnd.code.tree.issuemanager.views.isolated', 'text/uri-list'];
            this.dragMimeTypes = [ISSUE_MIME_TYPE];
        } else if (viewMode === 'focused') {
            this.dropMimeTypes = [ISSUE_MIME_TYPE, 'application/vnd.code.tree.issuemanager.views.isolated', 'text/uri-list'];
            this.dragMimeTypes = [ISSUE_MIME_TYPE];
        } else if (viewMode === 'recent') {
            this.dragMimeTypes = [ISSUE_MIME_TYPE];
            this.dropMimeTypes = []; // 最近问题视图只出不进
        }
    }

    public async handleDrag(
        source: readonly (IssueTreeNode | IssueItem)[],
        treeDataTransfer: vscode.DataTransfer,
        token: vscode.CancellationToken
    ): Promise<void> {
        const transferData = source.map(item => {  
            if (item instanceof IssueItem) {  
                // 显式转换 Uri 为字符串以保证序列化安全  
                return { ...item, resourceUri: item.resourceUri.toString() };  
            }  
            return item;  
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
        target: IssueTreeNode | undefined,
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

        const targetNodeInTree = target ? this.findNode(treeData.rootNodes, stripFocusedId(target.id)) : undefined;
        const [_, transferItem] = [...dataTransfer].filter(([mimeType, transferItem]) => mimeType === ISSUE_MIME_TYPE && transferItem.value).pop() || [];
        const fromOverview = dataTransfer.get('application/vnd.code.tree.issuemanager.views.overview');
        const fromIsolated = dataTransfer.get('application/vnd.code.tree.issuemanager.views.isolated');
        const fromFocused = dataTransfer.get('application/vnd.code.tree.issuemanager.views.focused');
        const fromRecent = dataTransfer.get('application/vnd.code.tree.issuemanager.views.recent');
        const fromEditor = dataTransfer.get('text/uri-list');

        if (fromOverview && transferItem) {
            const draggedItems = transferItem.value as IssueTreeNode[];

            for (const dragged of draggedItems) {
                let nodeToMove: IssueTreeNode | null = null;

                if (dragged.id) {
                    const sourceNode = this.findNode(treeData.rootNodes, dragged.id);
                    if (sourceNode && this.isAncestor(sourceNode, targetNodeInTree)) {
                        vscode.window.showWarningMessage('无法将一个节点移动到它自己的子节点下。');
                        continue; // 跳过无效操作
                    }
                    nodeToMove = this.findAndRemoveNode(treeData.rootNodes, dragged.id);
                    nodeToMove && this.addNodeToTree(treeData, nodeToMove, targetNodeInTree);

                }
            }
        } else if (fromFocused && transferItem) {
            const draggedItems = transferItem.value as IssueTreeNode[];

            for (const dragged of draggedItems) {
                let nodeToMove: IssueTreeNode | null = null;
                if (dragged.id) {
                    const sourceNode = this.findNode(treeData.rootNodes, stripFocusedId(dragged.id));
                    if (sourceNode && this.isAncestor(sourceNode, targetNodeInTree)) {
                        vscode.window.showWarningMessage('无法将一个节点移动到它自己的子节点下。');
                        continue; // 跳过无效操作
                    }
                    if (isFocusedRootId(dragged.id)) {
                        vscode.window.showWarningMessage('无法将焦点根节点移动到其他位置。');
                        continue; // 跳过无效操作

                    }
                    nodeToMove = this.findAndRemoveNode(treeData.rootNodes, stripFocusedId(dragged.id));
                    nodeToMove && this.addNodeToTree(treeData, nodeToMove, targetNodeInTree);

                }
            }


        } else if ((fromIsolated||fromRecent)  && transferItem) {
            const draggedItems = (JSON.parse(transferItem.value) as {resourceUri:string}[]).filter(i=>i.resourceUri).map(i=>({
                ...i,
                resourceUri: vscode.Uri.parse(i.resourceUri) // 确保 resourceUri 是 Uri 对象
            }));
            for (const dragged of draggedItems) {
                let nodeToMove: IssueTreeNode | null = null;
                const relativePath = path.relative(issueDir, dragged.resourceUri.fsPath);
                nodeToMove = {
                    id: uuidv4(),
                    filePath: relativePath,
                    children: [],
                };

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
                const nodeToAdd: IssueTreeNode = {
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

    private addNodeToTree(treeData: TreeData, nodeToAdd: IssueTreeNode, target: IssueTreeNode | null | undefined): void {
        if (target) {
            if (!target.children) {
                target.children = [];
            }
            target.expanded = true;
            // 优化：插入为第一个子节点
            target.children.unshift(nodeToAdd);
        } else {
            // 顶层节点也插入为第一个
            treeData.rootNodes.unshift(nodeToAdd);
        }
    }

    private findNode(nodes: IssueTreeNode[], id: string): IssueTreeNode | null {
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

    private findAndRemoveNode(nodes: IssueTreeNode[], id: string): IssueTreeNode | null {
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

    private isAncestor(potentialAncestor: IssueTreeNode, potentialDescendant: IssueTreeNode | null | undefined): boolean {
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
