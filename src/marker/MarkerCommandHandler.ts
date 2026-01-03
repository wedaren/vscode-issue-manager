import * as vscode from 'vscode';
import { MarkerManager, MarkerItem, MarkerTask } from './MarkerManager';
import { MarkerTreeProvider } from './MarkerTreeProvider';

/**
 * 标记命令处理器
 */
export class MarkerCommandHandler {
    constructor(
        private markerManager: MarkerManager,
        private treeProvider: MarkerTreeProvider
    ) {}

    /**
     * 注册所有标记相关命令
     */
    registerCommands(context: vscode.ExtensionContext): void {
        // 创建新标记
        context.subscriptions.push(
            vscode.commands.registerCommand('issueManager.marker.createMarker', async () => {
                const editor = vscode.window.activeTextEditor;
                await this.markerManager.createMarker(undefined, editor);
            })
        );

        // 归档当前任务
        context.subscriptions.push(
            vscode.commands.registerCommand('issueManager.marker.archiveCurrentTask', async () => {
                await this.markerManager.archiveCurrentTask();
            })
        );

        // 清空当前任务
        context.subscriptions.push(
            vscode.commands.registerCommand('issueManager.marker.clearCurrentTask', async () => {
                await this.markerManager.clearCurrentTask();
            })
        );

        // 删除归档任务
        context.subscriptions.push(
            vscode.commands.registerCommand('issueManager.marker.deleteArchived', async (item) => {
                if (item && 'task' in item) {
                    await this.markerManager.deleteArchivedTask(item.task);
                }
            })
        );

        // 从归档任务填充
        context.subscriptions.push(
            vscode.commands.registerCommand('issueManager.marker.fillFromArchived', async (item) => {
                if (item && 'task' in item) {
                    await this.markerManager.fillFromArchivedTask(item.task);
                }
            })
        );

        // 重命名标记
        context.subscriptions.push(
            vscode.commands.registerCommand('issueManager.marker.renameMarker', async (item) => {
                if (item && 'marker' in item) {
                    await this.markerManager.renameMarker(item.marker);
                }
            })
        );

        // 删除标记
        context.subscriptions.push(
            vscode.commands.registerCommand('issueManager.marker.deleteMarker', async (item) => {
                if (item && 'marker' in item) {
                    await this.markerManager.deleteMarker(item.marker);
                }
            })
        );

        // 批量删除标记
        context.subscriptions.push(
            vscode.commands.registerCommand('issueManager.marker.batchDeleteMarkers', async () => {
                await this.markerManager.batchDeleteMarkers();
            })
        );

        // 关联标记或任务
        context.subscriptions.push(
            vscode.commands.registerCommand('issueManager.marker.associateMarker', async (item) => {
                if (item) {
                    if ('marker' in item) {
                        await this.markerManager.associate(item.marker);
                    } else if ('task' in item) {
                        await this.markerManager.associate(item.task);
                    }
                }
            })
        );

        // 跳转到标记
        context.subscriptions.push(
            vscode.commands.registerCommand('issueManager.marker.jumpToMarker', async (marker: MarkerItem) => {
                await this.markerManager.jumpToMarker(marker);
            })
        );

        // 刷新视图
        context.subscriptions.push(
            vscode.commands.registerCommand('issueManager.marker.refresh', () => {
                this.treeProvider.refresh();
            })
        );
    }
}
