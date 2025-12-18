import * as vscode from 'vscode';
import * as path from 'path';
import { NoteMappingService } from '../services/noteMapping/NoteMappingService';
import { getIssueDir } from '../config';
import { EditorEventManager } from '../services/EditorEventManager';
import { getWorkspaceRoot } from '../utils/pathUtils';
import { readTree, findNodeById } from '../data/treeManager';

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
    private lastWorkspaceFilePath: string | null = null; // 记住最后一个工作区内的文件
    private lastWorkspaceFileTitle: string | null = null; // 记住最后一个工作区内文件的标题
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
        
        // 如果文件在工作区内，记住它
        const workspaceRoot = getWorkspaceRoot();
        if (workspaceRoot && this.currentFilePath.startsWith(workspaceRoot)) {
            this.lastWorkspaceFilePath = this.currentFilePath;
            const editor = vscode.window.activeTextEditor;
            this.lastWorkspaceFileTitle = editor ? path.basename(editor.document.fileName) : path.basename(this.currentFilePath);
        }
        
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
                // 检查文件是否在工作区内，如果不在则不支持添加
                const workspaceRoot = getWorkspaceRoot();
                const isInWorkspace = this.currentFilePath && workspaceRoot && this.currentFilePath.startsWith(workspaceRoot);
                item.contextValue = isInWorkspace ? 'fileMapping' : 'fileMappingReadOnly';
                break;
                
            case 'issue':
                item.collapsibleState = vscode.TreeItemCollapsibleState.None;
                item.iconPath = new vscode.ThemeIcon('note');
                item.description = element.description;
                
                // 设置 resourceUri 以支持移动命令
                if (element.filePath) {
                    const issueDir = getIssueDir();
                    if (issueDir) {
                        const fullPath = path.join(issueDir, element.filePath);
                        item.resourceUri = vscode.Uri.file(fullPath);
                    }
                }
                
                // Set contextValue based on the element ID to distinguish workspace vs file issues
                if (element.id.startsWith('workspace-issue-')) {
                    item.contextValue = 'workspaceIssue';
                } else if (element.id.startsWith('file-issue-')) {
                    item.contextValue = 'fileIssue';
                } else {
                    item.contextValue = 'mappedIssue';
                }
                
                // 设置点击命令打开 issue，使用 node.id
                if (element.issueId) {
                    item.command = {
                        command: 'issueManager.openNoteByNodeId',
                        title: '打开笔记',
                        arguments: [element.issueId]
                    };
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
            // 检查文件是否在工作区内
            const workspaceRoot = getWorkspaceRoot();
            if (workspaceRoot && this.currentFilePath.startsWith(workspaceRoot)) {
                // 文件在工作区内：显示编辑器标题，描述显示"当前文件映射"
                const editor = vscode.window.activeTextEditor;
                const editorTitle = editor ? path.basename(editor.document.fileName) : path.basename(this.currentFilePath);
                nodes.push({
                    id: 'file-mappings',
                    type: 'file',
                    label: editorTitle,
                    description: '当前文件映射',
                    filePath: this.currentFilePath
                });
            } else if (this.lastWorkspaceFilePath) {
                // 文件不在工作区内：显示之前工作区内文件的标题，展示其关联，不显示描述，不支持添加
                nodes.push({
                    id: 'file-mappings',
                    type: 'file',
                    label: this.lastWorkspaceFileTitle || '当前文件映射',
                    description: undefined,
                    filePath: this.lastWorkspaceFilePath // 使用之前的文件路径来显示映射
                });
            }
        } else if (this.lastWorkspaceFilePath) {
            // 没有当前文件，但有之前的工作区文件，显示其信息
            nodes.push({
                id: 'file-mappings',
                type: 'file',
                label: this.lastWorkspaceFileTitle || '当前文件映射',
                description: undefined,
                filePath: this.lastWorkspaceFilePath
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
                }
            ];
        }
        
        // 读取树结构以获取文件路径
        const tree = await readTree();
        
        // 获取所有 issue（按优先级排序，已由 service 处理）
        const issueNodes: NoteMappingNode[] = [];
        for (const mapping of workspaceMappings) {
            for (const issueId of mapping.targets) {
                const title = await this.mappingService.getIssueTitle(issueId);
                
                // 通过 node.id 查找节点以获取文件路径
                const result = findNodeById(tree.rootNodes, issueId);
                const filePath = result ? result.node.filePath : undefined;
                
                issueNodes.push({
                    id: `workspace-issue-${issueId}`,
                    type: 'issue',
                    label: title,
                    description: issueId,
                    issueId: issueId,
                    filePath: filePath
                });
            }
        }
        
        return issueNodes;
    }

    /**
     * 获取当前文件映射的 issue 列表
     */
    private async getFileMappings(): Promise<NoteMappingNode[]> {
        // 确定要查询映射的文件路径
        let targetFilePath: string | null = null;
        const workspaceRoot = getWorkspaceRoot();
        
        if (this.currentFilePath && workspaceRoot && this.currentFilePath.startsWith(workspaceRoot)) {
            // 当前文件在工作区内，使用当前文件
            targetFilePath = this.currentFilePath;
        } else if (this.lastWorkspaceFilePath) {
            // 当前文件不在工作区内，使用之前记住的工作区文件
            targetFilePath = this.lastWorkspaceFilePath;
        }
        
        if (!targetFilePath) {
            return [];
        }
        
        const issueIds = await this.mappingService.resolveForFile(targetFilePath);
        
        if (issueIds.length === 0) {
            return [
                {
                    id: 'no-file-mapping',
                    type: 'message',
                    label: '当前文件暂无映射'
                }
            ];
        }
        
        // 读取树结构以获取文件路径
        const tree = await readTree();
        
        // 显示映射的 issue
        const issueNodes: NoteMappingNode[] = [];
        for (const issueId of issueIds) {
            const title = await this.mappingService.getIssueTitle(issueId);
            
            // 通过 node.id 查找节点以获取文件路径
            const result = findNodeById(tree.rootNodes, issueId);
            const filePath = result ? result.node.filePath : undefined;
            
            issueNodes.push({
                id: `file-issue-${issueId}`,
                type: 'issue',
                label: title,
                description: issueId,
                issueId: issueId,
                filePath: filePath
            });
        }
        
        return issueNodes;
    }

    /**
     * 释放资源
     */
    dispose(): void {
        this._onDidChangeTreeData.dispose();
        this.disposables.forEach(d => d.dispose());
    }
}
