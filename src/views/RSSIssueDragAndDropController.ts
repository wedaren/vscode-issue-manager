import * as vscode from 'vscode';
import { RSSItem } from '../services/types/RSSTypes';
import { RSSItemTreeItem } from './rss/RSSTreeItems';

// RSS拖拽数据类型
const RSS_MIME_TYPE = 'application/vnd.code.tree.rss-issue-manager';

/**
 * RSS拖拽控制器
 * 支持将RSS文章拖拽到其他视图中
 */
export class RSSIssueDragAndDropController implements vscode.TreeDragAndDropController<vscode.TreeItem> {
    public dropMimeTypes: string[] = [];
    public dragMimeTypes: string[] = [RSS_MIME_TYPE];

    constructor() {
        // RSS视图只支持拖出，不支持拖入
        this.dropMimeTypes = [];
        this.dragMimeTypes = [RSS_MIME_TYPE];
    }

    /**
     * 处理拖拽操作
     */
    public async handleDrag(
        source: readonly vscode.TreeItem[],
        treeDataTransfer: vscode.DataTransfer,
        token: vscode.CancellationToken
    ): Promise<void> {
        // 只处理RSS文章项目的拖拽
        const rssItems = source.filter(item => item.contextValue === 'rssItem');
        
        if (rssItems.length === 0) {
            return;
        }

        // 准备拖拽数据
        const transferData = rssItems.map(treeItem => {
            const rssTreeItem = treeItem as RSSItemTreeItem;
            const item = rssTreeItem.item;
            return {
                id: item.id,
                feedId: item.feedId,
                title: item.title,
                link: item.link,
                description: item.description,
                pubDate: item.pubDate.toISOString(),
                author: item.author,
                categories: item.categories,
                // 标记为RSS来源
                source: 'rss'
            };
        });

        treeDataTransfer.set(RSS_MIME_TYPE, new vscode.DataTransferItem(transferData));
    }

    /**
     * 处理放置操作（RSS视图不接受拖入）
     */
    public async handleDrop(
        target: vscode.TreeItem | undefined,
        treeDataTransfer: vscode.DataTransfer,
        token: vscode.CancellationToken
    ): Promise<void> {
        // RSS视图不支持拖入，此方法不实现
        return;
    }
}
