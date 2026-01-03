import * as vscode from 'vscode';
import { MarkerManager, MarkerItem, MarkerTask } from './MarkerManager';

/**
 * TreeView 节点类型
 */
type MarkerTreeItem = CurrentTaskItem | ArchivedTaskItem | MarkerItemTreeItem;

/**
 * 当前任务节点
 */
class CurrentTaskItem extends vscode.TreeItem {
    constructor(public readonly task: MarkerTask) {
        super('当前标记任务合集', vscode.TreeItemCollapsibleState.Expanded);
        this.contextValue = 'currentTask';
        this.description = `${task.markers.length} 个标记`;
        
        // 根据关联状态显示不同图标
        if (task.associatedIssueId) {
            this.iconPath = new vscode.ThemeIcon('go-to-file');
        } else {
            this.iconPath = new vscode.ThemeIcon('link');
        }
    }
}

/**
 * 归档任务节点
 */
class ArchivedTaskItem extends vscode.TreeItem {
    constructor(public readonly task: MarkerTask, public readonly index: number) {
        super(task.title, vscode.TreeItemCollapsibleState.Collapsed);
        this.contextValue = 'archivedTask';
        this.description = `${task.markers.length} 个标记`;
        this.tooltip = `创建时间: ${new Date(task.createdAt).toLocaleString()}`;
        
        // 根据关联状态显示不同图标
        if (task.associatedIssueId) {
            this.iconPath = new vscode.ThemeIcon('go-to-file');
        } else {
            this.iconPath = new vscode.ThemeIcon('link');
        }
    }
}

/**
 * 标记项节点
 */
class MarkerItemTreeItem extends vscode.TreeItem {
    constructor(
        public readonly marker: MarkerItem,
        public readonly isArchived: boolean
    ) {
        super(marker.message, vscode.TreeItemCollapsibleState.None);
        
        // 根据是否归档设置不同的 contextValue
        this.contextValue = isArchived ? 'archivedMarkerItem' : 'currentMarkerItem';
        
        // 设置描述（显示文件名和行号）
        if (marker.filePath && marker.line !== undefined) {
            const fileName = marker.filePath.split('/').pop() || '';
            this.description = `${fileName}:${marker.line + 1}`;
            this.tooltip = `${marker.filePath}:${marker.line + 1}:${marker.column || 0}`;
            
            // 如果有位置信息，点击可以跳转
            this.command = {
                command: 'issueManager.marker.jumpToMarker',
                title: '跳转到标记',
                arguments: [marker]
            };
        }
        
        // 根据关联状态显示不同图标
        if (marker.associatedIssueId) {
            this.iconPath = new vscode.ThemeIcon('go-to-file');
        } else {
            this.iconPath = new vscode.ThemeIcon('link');
        }
    }
}

/**
 * 标记 TreeView Provider
 */
export class MarkerTreeProvider implements vscode.TreeDataProvider<MarkerTreeItem>, vscode.TreeDragAndDropController<MarkerTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<MarkerTreeItem | undefined | null | void> = 
        new vscode.EventEmitter<MarkerTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<MarkerTreeItem | undefined | null | void> = 
        this._onDidChangeTreeData.event;

    // 拖放支持
    readonly dropMimeTypes = ['application/vnd.code.tree.markerView'];
    readonly dragMimeTypes = ['application/vnd.code.tree.markerView'];

    constructor(private markerManager: MarkerManager) {
        // 监听数据变化
        markerManager.onDidChangeData(() => {
            this._onDidChangeTreeData.fire();
        });
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: MarkerTreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: MarkerTreeItem): MarkerTreeItem[] {
        if (!element) {
            // 根节点：显示当前任务和所有归档任务
            const items: MarkerTreeItem[] = [];
            
            // 添加当前任务
            const currentTask = this.markerManager.getCurrentTask();
            items.push(new CurrentTaskItem(currentTask));
            
            // 添加归档任务
            const archivedTasks = this.markerManager.getArchivedTasks();
            archivedTasks.forEach((task, index) => {
                items.push(new ArchivedTaskItem(task, index));
            });
            
            return items;
        }

        // 显示任务下的标记
        if (element instanceof CurrentTaskItem) {
            return element.task.markers.map(m => new MarkerItemTreeItem(m, false));
        }

        if (element instanceof ArchivedTaskItem) {
            return element.task.markers.map(m => new MarkerItemTreeItem(m, true));
        }

        return [];
    }

    getParent(element: MarkerTreeItem): MarkerTreeItem | undefined {
        if (element instanceof MarkerItemTreeItem) {
            // 标记项的父节点是任务
            if (element.isArchived) {
                // 需要找到对应的归档任务
                const tasks = this.markerManager.getArchivedTasks();
                for (let i = 0; i < tasks.length; i++) {
                    if (tasks[i].markers.includes(element.marker)) {
                        return new ArchivedTaskItem(tasks[i], i);
                    }
                }
            } else {
                return new CurrentTaskItem(this.markerManager.getCurrentTask());
            }
        }
        return undefined;
    }

    // 拖放处理
    async handleDrag(source: readonly MarkerTreeItem[], dataTransfer: vscode.DataTransfer): Promise<void> {
        // 只允许拖动当前任务中的标记
        const currentMarkers = source.filter(item => 
            item instanceof MarkerItemTreeItem && !item.isArchived
        ) as MarkerItemTreeItem[];
        
        if (currentMarkers.length > 0) {
            dataTransfer.set(
                'application/vnd.code.tree.markerView',
                new vscode.DataTransferItem(currentMarkers)
            );
        }
    }

    async handleDrop(target: MarkerTreeItem | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
        const transferItem = dataTransfer.get('application/vnd.code.tree.markerView');
        if (!transferItem) {
            return;
        }

        const draggedItems = transferItem.value as MarkerItemTreeItem[];
        if (draggedItems.length === 0) {
            return;
        }

        // 只处理单个标记的拖动
        if (draggedItems.length > 1) {
            vscode.window.showWarningMessage('暂不支持批量拖动标记');
            return;
        }

        const draggedItem = draggedItems[0];
        
        // 确定目标位置
        let targetIndex: number;
        
        if (!target) {
            // 拖到根节点，移动到末尾
            targetIndex = this.markerManager.getCurrentTask().markers.length - 1;
        } else if (target instanceof CurrentTaskItem) {
            // 拖到当前任务节点，移动到开头
            targetIndex = 0;
        } else if (target instanceof MarkerItemTreeItem && !target.isArchived) {
            // 拖到另一个标记上，插入到该标记之前
            const markers = this.markerManager.getCurrentTask().markers;
            targetIndex = markers.indexOf(target.marker);
        } else {
            // 拖到归档任务或归档标记上，不允许
            vscode.window.showWarningMessage('不能将标记拖动到归档任务中');
            return;
        }

        // 执行移动
        await this.markerManager.moveMarker(draggedItem.marker, targetIndex);
    }
}
