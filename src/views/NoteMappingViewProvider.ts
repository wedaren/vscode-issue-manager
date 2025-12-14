import * as vscode from 'vscode';
import * as path from 'path';
import { NoteMappingService } from '../services/noteMapping/NoteMappingService';
import { getIssueDir } from '../config';
import { EditorEventManager } from '../services/EditorEventManager';

/**
 * 笔记映射节点类型
 */
export interface NoteMappingNode {
    id: string;
    type: 'workspace' | 'file' | 'issue' | 'button' | 'message';
    label: string;
    description?: string;
    issueId?: string;
    filePath?: string;
}

/**
 * 笔记映射视图提供者
 * 显示当前工作区和文件的笔记映射关系
 */
export class NoteMappingViewProvider implements vscode.TreeDataProvider<NoteMappingNode>, vscode.Disposable {
    private _onDidChangeTreeData: vscode.EventEmitter<NoteMappingNode | undefined | null | void> = 
        new vscode.EventEmitter<NoteMappingNode | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<NoteMappingNode | undefined | null | void> = 
        this._onDidChangeTreeData.event;

    private currentFilePath: string | null = null;
    private mappingService: NoteMappingService;
    private disposables: vscode.Disposable[] = [];

    constructor(private context: vscode.ExtensionContext) {
        this.mappingService = NoteMappingService.getInstance();

        // 监听编辑器切换
        const editorEventManager = EditorEventManager.getInstance();
        this.disposables.push(
            editorEventManager.onIssueFileActivated((uri) => {
                this.onEditorChanged(uri);
            })
        );

        // 监听活动编辑器变化
        this.disposables.push(
            vscode.window.onDidChangeActiveTextEditor(editor => {
                if (editor) {
                    this.onEditorChanged(editor.document.uri);
                } else {
                    this.currentFilePath = null;
                    this._onDidChangeTreeData.fire();
                }
            })
        );

        // 监听映射变化
        this.disposables.push(
            this.mappingService.watch(() => {
                this._onDidChangeTreeData.fire();
            })
        );

        // 初始化当前文件
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            this.onEditorChanged(activeEditor.document.uri);
        }
    }

    /**
     * 编辑器切换时的处理
     */
    private onEditorChanged(uri: vscode.Uri): void {
        this.currentFilePath = uri.fsPath;
        this._onDidChangeTreeData.fire();
    }

    /**
     * 刷新视图
     */
    public refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    /**
     * 获取树节点
     */
    getTreeItem(element: NoteMappingNode): vscode.TreeItem {
        const item = new vscode.TreeItem(element.label);
        
        switch (element.type) {
            case 'workspace':
                item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
                item.iconPath = new vscode.ThemeIcon('globe');
                item.contextValue = 'workspaceMapping';
                break;
                
            case 'file':
                item.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
                item.iconPath = new vscode.ThemeIcon('file');
                item.description = element.description;
                item.contextValue = 'fileMapping';
                break;
                
            case 'issue':
                item.collapsibleState = vscode.TreeItemCollapsibleState.None;
                item.iconPath = new vscode.ThemeIcon('note');
                item.description = element.description;
                item.contextValue = 'mappedIssue';
                
                // 设置点击命令打开 issue
                if (element.issueId) {
                    const issueDir = getIssueDir();
                    if (issueDir) {
                        const fileName = element.issueId.endsWith('.md') ? element.issueId : `${element.issueId}.md`;
                        const issueUri = vscode.Uri.file(path.join(issueDir, fileName));
                        item.command = {
                            command: 'vscode.open',
                            title: '打开笔记',
                            arguments: [issueUri]
                        };
                        item.resourceUri = issueUri;
                    }
                }
                break;
                
            case 'button':
                item.collapsibleState = vscode.TreeItemCollapsibleState.None;
                item.iconPath = new vscode.ThemeIcon('add');
                item.contextValue = 'createMappingButton';
                item.command = {
                    command: element.id,
                    title: element.label,
                    arguments: []
                };
                break;
                
            case 'message':
                item.collapsibleState = vscode.TreeItemCollapsibleState.None;
                item.iconPath = new vscode.ThemeIcon('info');
                item.contextValue = 'message';
                break;
        }
        
        return item;
    }

    /**
     * 获取子节点
     */
    async getChildren(element?: NoteMappingNode): Promise<NoteMappingNode[]> {
        if (!element) {
            // 根节点
            return this.getRootNodes();
        }
        
        // 获取子节点
        if (element.type === 'workspace') {
            return this.getWorkspaceMappings();
        } else if (element.type === 'file') {
            return this.getFileMappings();
        }
        
        return [];
    }

    /**
     * 获取根节点
     */
    private async getRootNodes(): Promise<NoteMappingNode[]> {
        const issueDir = getIssueDir();
        if (!issueDir) {
            return [{
                id: 'not-configured',
                type: 'message',
                label: '请先配置问题目录'
            }];
        }

        const nodes: NoteMappingNode[] = [];
        
        // 工作区映射节点
        nodes.push({
            id: 'workspace-mappings',
            type: 'workspace',
            label: '工作区映射'
        });
        
        // 当前文件映射节点
        if (this.currentFilePath) {
            const relativePath = this.getRelativePath(this.currentFilePath);
            nodes.push({
                id: 'file-mappings',
                type: 'file',
                label: '当前文件映射',
                description: relativePath || path.basename(this.currentFilePath),
                filePath: this.currentFilePath
            });
        }
        
        return nodes;
    }

    /**
     * 获取工作区映射的 issue 列表
     */
    private async getWorkspaceMappings(): Promise<NoteMappingNode[]> {
        const allMappings = await this.mappingService.getAll();
        const workspaceMappings = allMappings.filter(m => m.scope === 'workspace');
        
        if (workspaceMappings.length === 0) {
            return [
                {
                    id: 'no-workspace-mapping',
                    type: 'message',
                    label: '暂无工作区映射'
                },
                {
                    id: 'issueManager.bindWorkspaceNote',
                    type: 'button',
                    label: '点击创建工作区映射'
                }
            ];
        }
        
        // 获取所有 issue（按优先级排序，已由 service 处理）
        const issueNodes: NoteMappingNode[] = [];
        for (const mapping of workspaceMappings) {
            for (const issueId of mapping.targets) {
                const title = await this.mappingService.getIssueTitle(issueId);
                issueNodes.push({
                    id: `workspace-issue-${issueId}`,
                    type: 'issue',
                    label: title,
                    description: issueId,
                    issueId: issueId
                });
            }
        }
        
        return issueNodes;
    }

    /**
     * 获取当前文件映射的 issue 列表
     */
    private async getFileMappings(): Promise<NoteMappingNode[]> {
        if (!this.currentFilePath) {
            return [];
        }
        
        const issueIds = await this.mappingService.resolveForFile(this.currentFilePath);
        
        if (issueIds.length === 0) {
            // 检查当前文件是否在工作区内
            const issueDir = getIssueDir();
            const isInWorkspace = issueDir && this.currentFilePath.startsWith(issueDir);
            
            if (isInWorkspace) {
                return [
                    {
                        id: 'no-file-mapping',
                        type: 'message',
                        label: '当前文件暂无映射'
                    },
                    {
                        id: 'issueManager.mapNoteForFile',
                        type: 'button',
                        label: '点击创建文件映射'
                    }
                ];
            } else {
                return [
                    {
                        id: 'file-not-in-workspace',
                        type: 'message',
                        label: '当前文件不在工作区内'
                    },
                    {
                        id: 'issueManager.mapNoteForFile',
                        type: 'button',
                        label: '点击创建文件映射'
                    }
                ];
            }
        }
        
        // 显示映射的 issue
        const issueNodes: NoteMappingNode[] = [];
        for (const issueId of issueIds) {
            const title = await this.mappingService.getIssueTitle(issueId);
            issueNodes.push({
                id: `file-issue-${issueId}`,
                type: 'issue',
                label: title,
                description: issueId,
                issueId: issueId
            });
        }
        
        return issueNodes;
    }

    /**
     * 获取相对于工作区的路径
     */
    private getRelativePath(filePath: string): string | null {
        const issueDir = getIssueDir();
        if (!issueDir) {
            return null;
        }
        
        if (filePath.startsWith(issueDir)) {
            return path.relative(issueDir, filePath);
        }
        
        return null;
    }

    /**
     * 释放资源
     */
    dispose(): void {
        this._onDidChangeTreeData.dispose();
        this.disposables.forEach(d => d.dispose());
    }
}
