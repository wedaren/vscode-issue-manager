// 调查板列表视图：在独立 ActivityBar 容器中以 TreeView 展示所有调查板。
// 支持新建、重命名、删除、从 Issue 右键菜单创建等操作。
// 数据来源：MarkdownBoardService.listBoardMarkdowns()（扫描 board_type: survey 的 markdown 文件）。

import * as vscode from 'vscode';
import { listBoardMarkdowns } from '../services/storage/MarkdownBoardService';

// ── TreeItem ──────────────────────────────────────────────────────────────────

/**
 * 调查板列表中的单个条目 TreeItem。
 */
export class BoardTreeItem extends vscode.TreeItem {
    constructor(
        public readonly meta: { id: string; name: string; createdAt: number; updatedAt: number; filePath: string },
    ) {
        super(meta.name, vscode.TreeItemCollapsibleState.None);
        this.id = meta.id;
        this.contextValue = 'boardItem';
        this.iconPath = new vscode.ThemeIcon('layout');
        this.tooltip = new vscode.MarkdownString(
            `**${meta.name}**\n\n` +
            `创建：${new Date(meta.createdAt).toLocaleString('zh-CN')}\n\n` +
            `更新：${new Date(meta.updatedAt).toLocaleString('zh-CN')}`,
        );
        this.command = {
            command: 'issueManager.board.open',
            title: '打开调查板',
            arguments: [meta.filePath],
        };
    }
}

// ── Provider ──────────────────────────────────────────────────────────────────

/**
 * 调查板管理侧边栏：列出所有调查板，支持新建、重命名、删除操作。
 */
export class BoardListProvider implements vscode.TreeDataProvider<BoardTreeItem> {
    public static readonly viewId = 'issueManager.views.boardList';

    private readonly _onDidChangeTreeData = new vscode.EventEmitter<BoardTreeItem | undefined | void>();
    public readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    /** 刷新调查板列表 */
    public refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: BoardTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(): Promise<BoardTreeItem[]> {
        const metas = await listBoardMarkdowns();
        return metas.map(meta => new BoardTreeItem(meta));
    }
}
