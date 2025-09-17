import * as vscode from 'vscode';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { getIssueDir } from '../config';
import { TreeData, IssueTreeNode, readTree, stripFocusedId, isFocusedRootId, writeTree } from '../data/treeManager';
import { IssueOverviewProvider } from './IssueOverviewProvider';
import { FocusedIssuesProvider } from './FocusedIssuesProvider';
import { RecentIssuesProvider } from './RecentIssuesProvider';
import { RSSItem, RSSService } from '../services/RSSService';


// 自定义拖拽数据类型
const ISSUE_MIME_TYPE = 'application/vnd.code.tree.issue-manager';
const RSS_MIME_TYPE = 'application/vnd.code.tree.rss-issue-manager';

type DraggedItem = IssueTreeNode | vscode.TreeItem;

export class IssueDragAndDropController implements vscode.TreeDragAndDropController<IssueTreeNode | vscode.TreeItem> {
    public dropMimeTypes: string[] = [];
    public dragMimeTypes: string[] = [];

    constructor(private viewProvider: IssueOverviewProvider | FocusedIssuesProvider | RecentIssuesProvider, private viewMode: 'overview' | 'focused' | 'recent') {
        if (viewMode === 'overview' || viewMode === 'focused') {
            this.dropMimeTypes = [ISSUE_MIME_TYPE, 'text/uri-list', RSS_MIME_TYPE];
            this.dragMimeTypes = [ISSUE_MIME_TYPE];
        } else if (viewMode === 'recent') {
            this.dragMimeTypes = [ISSUE_MIME_TYPE];
            this.dropMimeTypes = []; // 最近问题视图只出不进
        }
    }

    public async handleDrag(
        source: readonly (IssueTreeNode | vscode.TreeItem)[],
        treeDataTransfer: vscode.DataTransfer,
        token: vscode.CancellationToken
    ): Promise<void> {
        const transferData = source.map(item => {
            if (item instanceof vscode.TreeItem) {
                // 显式转换 Uri 为字符串以保证序列化安全  
                return { ...item, resourceUri: item.resourceUri!.toString() };
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
        if (!target && this.viewMode === 'focused') {
            vscode.window.showErrorMessage('请先选择一个节点作为目标。');
            return;
        }

        const targetNodeInTree = target ? this.findNode(treeData.rootNodes, stripFocusedId(target.id)) : undefined;
        const [_, transferItem] = [...dataTransfer].filter(([mimeType, transferItem]) => mimeType === ISSUE_MIME_TYPE && transferItem.value).pop() || [];
        const fromEditor = dataTransfer.get('text/uri-list');
        const fromRSS = dataTransfer.get(RSS_MIME_TYPE);

        if (transferItem) {
            const draggedItemsRaw = transferItem.value;
            const draggedItems = (typeof draggedItemsRaw === 'string' ? JSON.parse(draggedItemsRaw) : draggedItemsRaw) as DraggedItem[];

            for (const dragged of draggedItems) {
                // Case 1: Dragged from a tree view (overview, focused, recent)
                if (dragged.id) { // It's an IssueTreeNode
                    const sourceNode = this.findNode(treeData.rootNodes, stripFocusedId(dragged.id));
                    if (sourceNode && this.isAncestor(sourceNode, targetNodeInTree)) {
                        vscode.window.showWarningMessage('无法将一个节点移动到它自己的子节点下。');
                        continue;
                    }
                    if (isFocusedRootId(dragged.id)) {
                        vscode.window.showWarningMessage('无法将焦点根节点移动到其他位置。');
                        continue;
                    }
                    const nodeToMove = this.findAndRemoveNode(treeData.rootNodes, stripFocusedId(dragged.id));
                    if (nodeToMove) {
                        this.addNodeToTree(treeData, nodeToMove, targetNodeInTree);
                    }
                }
                // Case 2: Dragged from recent (isolated item) or another source
                else if (dragged.resourceUri) { // It's a TreeItem (like an isolated issue)
                    const resourceUri = vscode.Uri.parse(dragged.resourceUri as unknown as string);
                    const relativePath = path.relative(issueDir, resourceUri.fsPath);
                    const nodeToMove: IssueTreeNode = {
                        id: uuidv4(),
                        filePath: relativePath,
                        children: [],
                    };
                    this.addNodeToTree(treeData, nodeToMove, targetNodeInTree);
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

        } else if (fromRSS) {
            // 处理从RSS视图拖拽过来的文章
            await this.handleRSSDropItems(fromRSS, targetNodeInTree || undefined, treeData);
        }

        await writeTree(treeData);
        // this.viewProvider.refresh();
        vscode.commands.executeCommand('issueManager.refreshAllViews');
    }

    /**
     * 处理RSS拖拽项目
     */
    private async handleRSSDropItems(rssItems: vscode.DataTransferItem, targetNodeInTree: IssueTreeNode | undefined, treeData: TreeData): Promise<void> {
        try {
            const rssService = RSSService.getInstance();
            const rssItemsString = await rssItems.asString();
            // 定义一个临时的DTO类型来处理反序列化
            type RSSItemDTO = Omit<RSSItem, 'pubDate'> & { pubDate: string };
            const rssItemsValue = JSON.parse(rssItemsString) as RSSItemDTO[];

            for (const rssData of rssItemsValue) {
                // 重构RSS数据为RSSItem
                const rssItem: RSSItem = {
                    ...rssData,  
                    pubDate: new Date(rssData.pubDate),  
                };

                // 转换RSS文章为Markdown文件
                const markdownUri = await rssService.convertToMarkdownUri(rssItem);

                if (markdownUri) {
                    const issueDir = getIssueDir();
                    if (issueDir) {
                        const relativePath = path.relative(issueDir, markdownUri.fsPath);
                        const nodeToAdd: IssueTreeNode = {
                            id: uuidv4(),
                            filePath: relativePath,
                            children: [],
                        };

                        this.addNodeToTree(treeData, nodeToAdd, targetNodeInTree);
                    }
                }
            }

            vscode.window.showInformationMessage(`已成功添加 ${rssItemsValue.length} 篇RSS文章到问题管理`);
        } catch (error) {
            console.error('处理RSS拖拽失败:', error);
            vscode.window.showErrorMessage('添加RSS文章失败，请重试');
        }
    }

    private addNodeToTree(treeData: TreeData, nodeToAdd: IssueTreeNode, target: IssueTreeNode | null | undefined): void {
        if (target) {
            if (!target.children) {
                target.children = [];
            }
            target.expanded = true;
            // 优化：插入为第一个子节点
            // 收集所有待插入节点，保持原始顺序
            if (Array.isArray(nodeToAdd)) {
                target.children.unshift(...nodeToAdd);
            } else {
                target.children.unshift(nodeToAdd);
            }
        } else {
            // 顶层节点也插入为第一个
            // 收集所有待插入节点，保持原始顺序
            if (Array.isArray(nodeToAdd)) {
                treeData.rootNodes.unshift(...nodeToAdd);
            } else {
                treeData.rootNodes.unshift(nodeToAdd);
            }

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
