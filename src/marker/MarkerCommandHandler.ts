import * as vscode from 'vscode';
import { MarkerManager, MarkerItem, MarkerTask } from './MarkerManager';
import { MarkerTreeProvider } from './MarkerTreeProvider';
import { getIssueNodeById } from '../data/issueTreeManager';
import { selectOrCreateIssue } from '../commands/selectOrCreateIssue';

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

        // 快速新建任务：使用 selectOrCreateIssue 创建新问题并执行新建任务流程
        context.subscriptions.push(
            vscode.commands.registerCommand('issueManager.quickCreateTask', async (...args: unknown[]) => {
                const parentId = args && args.length > 0 && typeof args[0] === 'string' ? (args[0] as string) : undefined;
                const createdId = await selectOrCreateIssue(parentId);
                if (createdId) {
                    await this.executeTaskWorkflow(createdId);
                }
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

        // 从归档任务恢复：复用新建任务逻辑
        context.subscriptions.push(
            vscode.commands.registerCommand('issueManager.marker.fillFromArchived', async (item) => {
                if (item && 'task' in item) {
                    const task = item.task as MarkerTask;
                    const issueId = task.associatedIssueId;
                    if (issueId) {
                        await this.executeTaskWorkflow(issueId, task);
                    } else {
                        vscode.window.showWarningMessage('归档任务没有关联的问题 ID，无法开启标准工作流。');
                    }
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

        // 打开关联
        context.subscriptions.push(
            vscode.commands.registerCommand('issueManager.marker.openAssociated', async (item) => {
                if (item) {
                    if ('marker' in item) {
                        vscode.commands.executeCommand('issueManager.openIssueNode',item.marker.associatedIssueId);
                    } else if ('task' in item) {
                        vscode.commands.executeCommand('issueManager.openIssueNode',item.task.associatedIssueId);
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

        // 将所有打开的编辑器导入为标记并关闭
        context.subscriptions.push(
            vscode.commands.registerCommand('issueManager.marker.importAllEditors', async () => {
                await this.markerManager.importAllOpenEditors();
            })
        );

        // 刷新视图
        context.subscriptions.push(
            vscode.commands.registerCommand('issueManager.marker.refresh', () => {
                this.treeProvider.refresh();
            })
        );
    }

    /**
     * 执行统一的新建/切换任务工作流
     * @param issueId 关联的问题ID
     * @param taskToLoad 可选：要从归档加载的任务
     */
    private async executeTaskWorkflow(issueId: string, taskToLoad?: MarkerTask): Promise<void> {
        try {
            // 1. 检查是否有未保存的编辑器
            const hasDirty = vscode.workspace.textDocuments.some(d => d.isDirty);
            if (hasDirty) {
                vscode.window.showWarningMessage('存在未保存的编辑器，请保存后重试');
                return;
            }

            // 2. 计算是否有可导入的打开编辑器（忽略空的 untitled 和特殊 scheme 编辑器）
            const importableEditors = vscode.window.visibleTextEditors.filter(ed => {
                const doc = ed.document;
                // 只考虑文件或未命名文件（untitled），忽略输出/特殊 scheme
                if (!['file', 'untitled'].includes(doc.uri.scheme)) { return false; }
                // 忽略空的 untitled 编辑器（VS Code 在无文件时可能保留一个空编辑器）
                if (doc.isUntitled && doc.getText().trim().length === 0) { return false; }
                return true;
            });

            const hasOpenEditors = importableEditors.length > 0;
            let doImport = false;
            if (hasOpenEditors) {
                // 提供三项：'导入并关闭'、'仅关闭'、'取消'（用户可按 Esc 取消）
                const IMPORT_AND_CLOSE = '导入并关闭';
                const CLOSE_ONLY = '仅关闭';
                const CANCEL = '取消';
                const choice = await vscode.window.showInformationMessage(
                    '将所有打开的编辑器加入当前任务并关闭？',
                    { modal: true },
                    CLOSE_ONLY,
                    IMPORT_AND_CLOSE,
                    CANCEL
                );
                if (!choice || choice === CANCEL) {
                    return; // 用户按 Esc 或选择取消
                }
                doImport = choice === IMPORT_AND_CLOSE;
            } else {
                // 无可导入的编辑器，直接跳过导入步骤
                doImport = false;
            }

            if (doImport) {
                await this.markerManager.importAllOpenEditorsSilent();
            }

            // 在开启新任务前，关闭所有当前的编辑器以清理工作区
            // （无论是刚刚导入的还是用户选择仅关闭，都在此处统一关闭）
            await vscode.commands.executeCommand('workbench.action.closeAllEditors');

            // 3. 归档当前任务并设置新任务
            await this.markerManager.archiveCurrentTask();
            
            if (taskToLoad) {
                // 从归档加载
                await this.markerManager.fillFromArchivedTask(taskToLoad);
            } else {
                // 仅关联新问题
                await this.markerManager.associateIssueToCurrentTask(issueId);
            }

            
            try {
                const node = await getIssueNodeById(issueId);
                if (node && node.resourceUri) {
                    const issueUri = node.resourceUri.with({ query: `issueId=${encodeURIComponent(issueId)}` });
                    await vscode.window.showTextDocument(issueUri, { preview: false });
                }
            } catch {}

            // 交互体验测试，避免打开太多内容干扰工作，暂时注释掉以下代码
            
            // // 4. 打开左右编辑器视图并设置分栏
            // try {
            //     const node = await getIssueNodeById(issueId);
            //     if (node && node.resourceUri) {
            //         const issueUri = node.resourceUri.with({ query: `issueId=${encodeURIComponent(issueId)}` });

            //         // 左侧：打开 Issue 文档
            //         await vscode.window.showTextDocument(issueUri, { preview: false, viewColumn: vscode.ViewColumn.One });

            //         // 右侧：打开关联的文件
            //         const markers = this.markerManager.getCurrentTask().markers;

            //         if (markers.length > 0 && markers[0].filePath) {
            //             const uri = vscode.Uri.file(markers[0].filePath);
            //             await vscode.window.showTextDocument(uri, { preview: false, viewColumn: vscode.ViewColumn.Two });
            //         } else {
            //             // 默认：如果在右侧没有关联文件，则在右侧打开 Issue 文档
            //             await vscode.window.showTextDocument(issueUri, { preview: false, viewColumn: vscode.ViewColumn.Two });
            //         }

            //         // 设置编辑器布局为左右两列
            //         try {
            //             await vscode.commands.executeCommand('vscode.setEditorLayout', {
            //                 orientation: 0,
            //                 groups: [
            //                     { size: 0.9 },
            //                     { size: 0.1 }
            //                 ]
            //             });
            //         } catch {}

            //         // 确保焦点在左侧编辑器
            //         try {
            //             await vscode.window.showTextDocument(issueUri, { preview: false, viewColumn: vscode.ViewColumn.One });
            //         } catch {}
            //     }
            // } catch (e) {
            //     console.error('打开左右编辑器失败', e);
            // }

        } catch (error) {
            console.error('任务工作流执行失败', error);
            vscode.window.showErrorMessage('执行任务流程失败');
        }
    }
}
