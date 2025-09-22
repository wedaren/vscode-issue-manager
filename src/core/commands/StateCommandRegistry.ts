import * as vscode from 'vscode';
import * as path from 'path';
import { BaseCommandRegistry } from './BaseCommandRegistry';
import { IssueTreeNode, readTree, writeTree, updateNodeExpanded, stripFocusedId } from '../../data/treeManager';
import { debounce, DebouncedFunction } from '../../utils/debounce';
import { Logger } from '../utils/Logger';

/**
 * 状态管理命令注册器
 * 
 * 负责注册与应用状态管理相关的命令，包括展开/折叠状态持久化、
 * 主题切换、设置管理等系统级操作。
 */
export class StateCommandRegistry extends BaseCommandRegistry {
    private expandCollapseHandler?: ExpandCollapseHandler;

    /**
     * 注册所有状态管理命令
     */
    public registerCommands(): void {
        this.logger.info('  🌳 注册状态管理命令...');
        
        this.registerUtilityCommands();
        this.initializeExpandCollapseHandler();
    }

    /**
     * 注册展开/折叠状态同步
     * 
     * @param overviewView 总览树视图
     * @param focusedView 关注问题树视图
     */
    public registerExpandCollapseSync(
        overviewView: vscode.TreeView<IssueTreeNode>,
        focusedView: vscode.TreeView<IssueTreeNode>
    ): void {
        if (!this.expandCollapseHandler) {
            this.expandCollapseHandler = new ExpandCollapseHandler();
        }

        try {
            this.expandCollapseHandler.registerTreeView(overviewView, 'overview');
            this.expandCollapseHandler.registerTreeView(focusedView, 'focused');
            this.logger.info('    ✓ 展开/折叠状态同步已注册');
        } catch (error) {
            this.logger.error('    ✗ 展开/折叠状态同步注册失败:', error);
        }
    }

    /**
     * 初始化展开/折叠处理器
     */
    private initializeExpandCollapseHandler(): void {
        this.expandCollapseHandler = new ExpandCollapseHandler();
    }

    /**
     * 注册工具类命令
     */
    private registerUtilityCommands(): void {
        // 复制文件名命令
        this.registerCommand(
            'issueManager.copyFilename',
            async (...args: unknown[]) => {
                const item = args[0] as vscode.TreeItem;
                let resourceUri: vscode.Uri | undefined;

                if (item?.resourceUri) {
                    resourceUri = item.resourceUri;
                } else {
                    const activeEditor = vscode.window.activeTextEditor;
                    resourceUri = activeEditor?.document.uri;
                }

                if (resourceUri) {
                    const fileName = path.basename(resourceUri.fsPath);
                    await vscode.env.clipboard.writeText(fileName);
                    vscode.window.showInformationMessage(`已复制文件名: ${fileName}`);
                } else {
                    vscode.window.showWarningMessage('未找到有效的文件路径，无法复制文件名。');
                }
            },
            '复制文件名'
        );

        // 重置扩展状态命令
        this.registerCommand(
            'issueManager.resetState',
            async () => {
                const confirm = await vscode.window.showWarningMessage(
                    '确定要重置所有扩展状态吗？这将清除所有本地配置和缓存。',
                    { modal: true },
                    '确认重置'
                );

                if (confirm === '确认重置') {
                    // 清除工作区状态 - 使用keys()方法获取所有键并逐一删除
                    const workspaceState = this.context.workspaceState;
                    const workspaceKeys = workspaceState.keys();
                    for (const key of workspaceKeys) {
                        await workspaceState.update(key, undefined);
                    }
                    
                    // 清除全局状态 - 使用keys()方法获取所有键并逐一删除  
                    const globalState = this.context.globalState;
                    const globalKeys = globalState.keys();
                    for (const key of globalKeys) {
                        await globalState.update(key, undefined);
                    }
                    
                    vscode.window.showInformationMessage('扩展状态已重置，请重新加载窗口。');
                    
                    // 建议重新加载窗口
                    const reload = await vscode.window.showInformationMessage(
                        '建议重新加载窗口以完全应用重置。',
                        '重新加载'
                    );
                    
                    if (reload === '重新加载') {
                        await vscode.commands.executeCommand('workbench.action.reloadWindow');
                    }
                }
            },
            '重置扩展状态'
        );

        // 导出配置命令
        this.registerCommand(
            'issueManager.exportConfig',
            async () => {
                const config = vscode.workspace.getConfiguration('issueManager');
                const configJson = JSON.stringify(config, null, 2);
                
                const document = await vscode.workspace.openTextDocument({
                    content: configJson,
                    language: 'json'
                });
                
                await vscode.window.showTextDocument(document);
                vscode.window.showInformationMessage('配置已导出到新文档');
            },
            '导出配置'
        );
    }
}

/**
 * 展开/折叠状态处理器
 * 
 * 专门处理树视图的展开和折叠事件，实现状态持久化。
 * 使用防抖机制和错误恢复，确保性能和稳定性。
 */
class ExpandCollapseHandler {
    private readonly debouncedSaveState: DebouncedFunction<() => void>;
    private pendingUpdates = new Map<string, boolean>();
    private readonly logger: Logger;

    constructor() {
        this.logger = Logger.getInstance();
        // 使用防抖机制，避免频繁的I/O操作
        this.debouncedSaveState = debounce(() => {
            this.saveExpandedStates();
        }, 300);
    }

    /**
     * 为树视图注册展开/折叠事件监听器
     * 
     * @param treeView 要注册的树视图
     * @param viewName 视图名称，用于日志记录
     */
    public registerTreeView(treeView: vscode.TreeView<IssueTreeNode>, viewName: string): void {
        // 展开事件监听
        treeView.onDidExpandElement((e) => {
            this.handleExpandCollapse(e.element.id, true, viewName);
        });

        // 折叠事件监听
        treeView.onDidCollapseElement((e) => {
            this.handleExpandCollapse(e.element.id, false, viewName);
        });
    }

    /**
     * 处理展开/折叠事件
     * 
     * @param nodeId 节点ID
     * @param expanded 是否展开
     * @param viewName 视图名称
     */
    private handleExpandCollapse(nodeId: string, expanded: boolean, viewName: string): void {
        try {
            const cleanId = stripFocusedId(nodeId);
            this.pendingUpdates.set(cleanId, expanded);
            
            // 触发防抖保存
            this.debouncedSaveState();
            
        } catch (error) {
            this.logger.error(`展开/折叠处理失败 (${viewName}):`, error);
        }
    }

    /**
     * 保存展开状态到存储
     * 
     * 批量处理所有待保存的状态更新，减少I/O操作次数
     */
    private saveExpandedStates(): void {
        if (this.pendingUpdates.size === 0) {
            return;
        }

        // 异步处理保存操作，不阻塞用户界面
        this.performSave().catch(error => {
            this.logger.error('保存展开状态失败:', error);
            // 清空待处理的更新，避免重复尝试
            this.pendingUpdates.clear();
            
            // 显示用户友好的错误消息
            vscode.window.showWarningMessage('无法保存视图状态，下次启动时展开状态可能丢失。');
        });
    }

    /**
     * 执行实际的保存操作
     */
    private async performSave(): Promise<void> {
        try {
            const treeData = await readTree();
            let hasChanges = false;

            // 批量应用所有状态更新
            for (const [nodeId, expanded] of Array.from(this.pendingUpdates.entries())) {
                if (updateNodeExpanded(treeData.rootNodes, nodeId, expanded)) {
                    hasChanges = true;
                }
            }

            // 清空待处理的更新
            this.pendingUpdates.clear();

            // 只有在有实际变化时才保存和刷新
            if (hasChanges) {
                await writeTree(treeData);
                // 延迟刷新，避免阻塞用户操作
                setTimeout(() => {
                    vscode.commands.executeCommand('issueManager.refreshAllViews');
                }, 100);
            }

        } catch (error) {
            throw error; // 重新抛出错误，让上层处理
        }
    }
}