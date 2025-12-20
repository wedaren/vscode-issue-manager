import * as vscode from 'vscode';
import * as path from 'path';
import { getIssueDir } from '../config';
import { IssueFrontmatterService, IssueFrontmatterData } from '../services/IssueFrontmatterService';
import { TitleCacheService } from '../services/TitleCacheService';

/**
 * Issue 逻辑树节点
 */
export interface IssueLogicalTreeNode {
    fileName: string; // 相对路径
    title: string;
    children: IssueLogicalTreeNode[];
    isRoot: boolean;
    isCurrentFile: boolean; // 是否是当前活动文件
    resourceUri?: vscode.Uri;
}

/**
 * Issue 逻辑树视图提供者
 * 基于当前活动文件的 issue_root、issue_parent、issue_children 字段构建逻辑树
 */
export class IssueLogicalTreeProvider implements vscode.TreeDataProvider<IssueLogicalTreeNode>, vscode.Disposable {
    private _onDidChangeTreeData: vscode.EventEmitter<IssueLogicalTreeNode | undefined | null | void> = 
        new vscode.EventEmitter<IssueLogicalTreeNode | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<IssueLogicalTreeNode | undefined | null | void> = 
        this._onDidChangeTreeData.event;

    private rootNodes: IssueLogicalTreeNode[] = [];
    private disposables: vscode.Disposable[] = [];
    private currentActiveFile: string | null = null;
    private currentRootFile: string | null = null; // 跟踪当前的根文件

    constructor(private context: vscode.ExtensionContext) {
        // 监听编辑器切换
        this.disposables.push(
            vscode.window.onDidChangeActiveTextEditor((editor) => {
                editor && this.onActiveEditorChanged(editor);
            })
        );

        // 初始化时检查当前编辑器
        if (vscode.window.activeTextEditor) {
            this.onActiveEditorChanged(vscode.window.activeTextEditor);
        }
    }

    /**
     * 处理编辑器切换
     */
    private async onActiveEditorChanged(editor: vscode.TextEditor | undefined): Promise<void> {

        const issueDir = getIssueDir();
        if (!issueDir) {
            this.currentActiveFile = null;
            this.currentRootFile = null;
            this.rootNodes = [];
            this._onDidChangeTreeData.fire();
            return;
        }

        const filePath = editor.document.uri.fsPath;
        if (!filePath.startsWith(issueDir)) {
            this.currentActiveFile = null;
            this.currentRootFile = null;
            this.rootNodes = [];
            this._onDidChangeTreeData.fire();
            return;
        }

        const fileName = path.relative(issueDir, filePath).replace(/\\/g, '/');
        
        // 获取新文件的 root
        const service = IssueFrontmatterService.getInstance();
        const frontmatter = await service.getIssueFrontmatter(fileName);
        const newRootFile = frontmatter?.issue_root || null;

        // 如果切换到同一个 root 下的不同文件，只更新 isCurrentFile 属性
        if (newRootFile && newRootFile === this.currentRootFile) {
            // 更新旧节点和新节点的 isCurrentFile 标志
            this.updateCurrentFileInTree(this.rootNodes, this.currentActiveFile, fileName);
            this.currentActiveFile = fileName;
            // 触发刷新以更新图标
            this._onDidChangeTreeData.fire();
            return;
        }

        // 切换到不同的 root 或没有 root，需要重建树
        this.currentActiveFile = fileName;
        this.currentRootFile = newRootFile;
        await this.refresh();
    }

    /**
     * 在树中更新当前文件标志
     */
    private updateCurrentFileInTree(nodes: IssueLogicalTreeNode[], oldFile: string | null, newFile: string): void {
        for (const node of nodes) {
            if (oldFile && node.fileName === oldFile) {
                node.isCurrentFile = false;
            }
            if (node.fileName === newFile) {
                node.isCurrentFile = true;
            }
            if (node.children.length > 0) {
                this.updateCurrentFileInTree(node.children, oldFile, newFile);
            }
        }
    }

    /**
     * 刷新树视图
     */
    public async refresh(): Promise<void> {
        await this.buildTree();
        this._onDidChangeTreeData.fire();
    }

    /**
     * 获取树节点
     */
    getTreeItem(element: IssueLogicalTreeNode): vscode.TreeItem {
        const treeItem = new vscode.TreeItem(
            element.title,
            element.children.length > 0 
                ? vscode.TreeItemCollapsibleState.Expanded  // 默认展开
                : vscode.TreeItemCollapsibleState.None
        );

        treeItem.resourceUri = element.resourceUri;
        treeItem.command = {
            command: 'vscode.open',
            title: '打开文件',
            arguments: [element.resourceUri]
        };

        // 设置图标 - 当前活动文件使用眼睛图标
        if (element.isCurrentFile) {
            treeItem.iconPath = new vscode.ThemeIcon('eye');
        } else if (element.isRoot) {
            treeItem.iconPath = new vscode.ThemeIcon('root-folder');
        } else {
            treeItem.iconPath = new vscode.ThemeIcon('file');
        }

        // 设置上下文值，用于控制菜单显示
        treeItem.contextValue = element.isRoot ? 'issueLogicalRoot' : 'issueLogicalNode';

        return treeItem;
    }

    /**
     * 获取子节点
     */
    async getChildren(element?: IssueLogicalTreeNode): Promise<IssueLogicalTreeNode[]> {
        if (!element) {
            // 返回根节点
            return this.rootNodes;
        }

        // 返回子节点
        return element.children;
    }

    /**
     * 构建逻辑树 - 显示当前活动文件所属的完整层级结构
     */
    private async buildTree(): Promise<void> {
        const issueDir = getIssueDir();
        if (!issueDir || !this.currentActiveFile) {
            this.rootNodes = [];
            return;
        }

        try {
            const service = IssueFrontmatterService.getInstance();
            
            // 读取当前文件的 frontmatter
            const currentFrontmatter = await service.getIssueFrontmatter(this.currentActiveFile);
            
            if (!currentFrontmatter || !currentFrontmatter.issue_root) {
                // 如果没有 issue_root，显示空树
                this.rootNodes = [];
                return;
            }

            // 获取根文件名
            const rootFileName = currentFrontmatter.issue_root;
            
            // 更新当前根文件
            this.currentRootFile = rootFileName;

            // 收集需要读取的所有文件
            const filesToLoad = new Set<string>();
            filesToLoad.add(rootFileName);

            // 递归收集所有相关文件
            const collectFiles = async (fileName: string) => {
                // if (filesToLoad.has(fileName)) {
                //     return;
                // }
                filesToLoad.add(fileName);

                const fm = await service.getIssueFrontmatter(fileName);
                if (fm && fm.issue_children) {
                    for (const child of fm.issue_children) {
                        await collectFiles(child);
                    }
                }
            };

            await collectFiles(rootFileName);

            // 批量读取所有相关文件的 frontmatter
            const frontmatterMap = await service.getIssueFrontmatterBatch(Array.from(filesToLoad));
            const fileMap = new Map<string, IssueFrontmatterData>();
            for (const [fileName, frontmatter] of frontmatterMap.entries()) {
                if (frontmatter) {
                    fileMap.set(fileName, frontmatter);
                }
            }

            // 构建根节点
            const rootNode = await this.buildNodeTree(rootFileName, fileMap, issueDir, true);
            this.rootNodes = rootNode ? [rootNode] : [];

        } catch (error) {
            console.error('构建逻辑树失败:', error);
            this.rootNodes = [];
        }
    }

    /**
     * 递归构建节点树
     */
    private async buildNodeTree(
        fileName: string,
        fileMap: Map<string, IssueFrontmatterData>,
        issueDir: string,
        isRoot: boolean
    ): Promise<IssueLogicalTreeNode | null> {
        const frontmatter = fileMap.get(fileName);
        if (!frontmatter) {
            return null;
        }

        // 获取标题
        const title = await this.getTitle(fileName);

        // 构建子节点
        const children: IssueLogicalTreeNode[] = [];
        const childrenFiles = frontmatter.issue_children || [];
        
        for (const childFileName of childrenFiles) {
            const childNode = await this.buildNodeTree(childFileName, fileMap, issueDir, false);
            if (childNode) {
                children.push(childNode);
            }
        }

        return {
            fileName,
            title,
            children,
            isRoot,
            isCurrentFile: fileName === this.currentActiveFile, // 标记是否是当前活动文件
            resourceUri: vscode.Uri.file(path.join(issueDir, fileName))
        };
    }

    /**
     * 获取文件标题
     */
    private async getTitle(fileName: string): Promise<string> {
        try {
            const titleCache = TitleCacheService.getInstance();
            const title = await titleCache.get(fileName);
            return title || path.basename(fileName, '.md');
        } catch (error) {
            console.error(`获取标题失败 (${fileName}):`, error);
            return path.basename(fileName, '.md');
        }
    }

    /**
     * 批量获取标题映射
     */
    private async getTitleMap(fileNames: string[]): Promise<Map<string, string>> {
        const titleCache = TitleCacheService.getInstance();
        const titles = await titleCache.getMany(fileNames);
        
        const titleMap = new Map<string, string>();
        for (let i = 0; i < fileNames.length; i++) {
            titleMap.set(fileNames[i], titles[i] || path.basename(fileNames[i], '.md'));
        }
        
        return titleMap;
    }

    /**
     * 获取节点的父节点
     */
    public async getParent(element: IssueLogicalTreeNode): Promise<IssueLogicalTreeNode | null> {
        const service = IssueFrontmatterService.getInstance();
        const frontmatter = await service.getIssueFrontmatter(element.fileName);
        
        if (!frontmatter || !frontmatter.issue_parent) {
            return null;
        }

        // 在树中查找父节点
        return this.findNodeInTree(frontmatter.issue_parent, this.rootNodes);
    }

    /**
     * 在树中查找节点
     */
    private findNodeInTree(
        fileName: string, 
        nodes: IssueLogicalTreeNode[]
    ): IssueLogicalTreeNode | null {
        for (const node of nodes) {
            if (node.fileName === fileName) {
                return node;
            }
            const found = this.findNodeInTree(fileName, node.children);
            if (found) {
                return found;
            }
        }
        return null;
    }

    /**
     * 为当前文件创建根 frontmatter
     */
    public async createRootForCurrentFile(): Promise<void> {
        const issueDir = getIssueDir();
        if (!issueDir) {
            vscode.window.showErrorMessage('问题目录未配置。');
            return;
        }

        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor || activeEditor.document.languageId !== 'markdown') {
            vscode.window.showErrorMessage('请先打开一个 Markdown 文件。');
            return;
        }

        const filePath = activeEditor.document.uri.fsPath;
        if (!filePath.startsWith(issueDir)) {
            vscode.window.showErrorMessage('当前文件不在问题目录内。');
            return;
        }

        const fileName = path.relative(issueDir, filePath).replace(/\\/g, '/');

        try {
            const service = IssueFrontmatterService.getInstance();
            
            // 检查是否已经有 issue_root
            const existingFrontmatter = await service.getIssueFrontmatter(fileName);
            if (existingFrontmatter && existingFrontmatter.issue_root) {
                vscode.window.showInformationMessage('当前文件已经有 issue_root 字段。');
                return;
            }

            // 添加 issue_root 字段
            await service.updateIssueFields(fileName, {
                issue_root: fileName,
                issue_children: []
            });

            vscode.window.showInformationMessage('已为当前文件创建根节点 frontmatter。');
            
            // 刷新树视图
            this.currentActiveFile = fileName;
            await this.refresh();
        } catch (error) {
            console.error('创建根 frontmatter 失败:', error);
            vscode.window.showErrorMessage(`创建失败: ${error}`);
        }
    }

    /**
     * 添加子节点
     */
    public async addChild(parentNode?: IssueLogicalTreeNode): Promise<void> {
        const issueDir = getIssueDir();
        if (!issueDir) {
            vscode.window.showErrorMessage('问题目录未配置。');
            return;
        }

        // 提示用户输入标题
        const title = await vscode.window.showInputBox({
            prompt: '输入新文件标题',
            placeHolder: '例如：新任务'
        });

        if (!title) {
            return; // 用户取消
        }

        try {
            const service = IssueFrontmatterService.getInstance();
            
            // 生成文件名
            const { generateFileName } = await import('../utils/fileUtils');
            const fileName = generateFileName();
            const filePath = path.join(issueDir, fileName);
            const fileUri = vscode.Uri.file(filePath);

            // 确定父节点路径和根节点路径
            const parentFileName = parentNode ? parentNode.fileName : null;
            
            // 确定根节点：如果有父节点，使用父节点的root；否则使用当前的root
            let rootFileName: string;
            if (parentFileName) {
                // 如果有父节点，使用父节点的 root
                const parentFrontmatter = await service.getIssueFrontmatter(parentFileName);
                rootFileName = parentFrontmatter?.issue_root || parentFileName;
            } else {
                // 如果没有父节点，使用当前活动文件的 root，如果没有则使用新文件本身
                rootFileName = this.currentRootFile || fileName;
            }

            // 创建 frontmatter 内容
            let frontmatterData: IssueFrontmatterData = {
                issue_root: rootFileName
            };

            if (parentFileName) {
                frontmatterData.issue_parent = parentFileName;
            }

            const yaml = await import('js-yaml');
            const frontmatterContent = yaml.dump(frontmatterData, {
                flowLevel: -1,
                lineWidth: -1
            });

            const fileContent = `---\n${frontmatterContent.trim()}\n---\n\n# ${title}\n\n`;

            // 创建文件
            await vscode.workspace.fs.writeFile(fileUri, Buffer.from(fileContent, 'utf8'));

            // 如果有父节点，更新父节点的 issue_children
            if (parentFileName) {
                const parentFrontmatter = await service.getIssueFrontmatter(parentFileName);
                if (parentFrontmatter) {
                    const currentChildren = parentFrontmatter.issue_children || [];
                    await service.updateIssueFields(parentFileName, {
                        issue_children: [...currentChildren, fileName]
                    });
                }
            }

            // 打开文件
            await vscode.window.showTextDocument(fileUri);

            // 刷新视图
            this.refresh();

            vscode.window.showInformationMessage(`已创建文件: ${fileName}`);
        } catch (error) {
            console.error('创建子节点失败:', error);
            vscode.window.showErrorMessage(`创建文件失败: ${error}`);
        }
    }

    /**
     * 从逻辑树中移除节点
     */
    public async removeNode(node?: IssueLogicalTreeNode): Promise<void> {
        if (!node) {
            vscode.window.showErrorMessage('请选择要移除的节点。');
            return;
        }

        const issueDir = getIssueDir();
        if (!issueDir) {
            return;
        }

        try {
            const service = IssueFrontmatterService.getInstance();
            const frontmatter = await service.getIssueFrontmatter(node.fileName);

            if (!frontmatter) {
                vscode.window.showWarningMessage('该文件没有有效的 frontmatter。');
                return;
            }

            // 确认操作
            const hasChildren = node.children && node.children.length > 0;
            const message = hasChildren 
                ? `确定要从层级树移除"${node.title}"吗？其子节点将变为独立的根节点。`
                : `确定要从层级树移除"${node.title}"吗？`;

            const confirm = await vscode.window.showWarningMessage(
                message,
                { modal: true },
                '确认'
            );

            if (confirm !== '确认') {
                return;
            }

            // 如果有父节点，从父节点的 issue_children 中移除
            if (frontmatter.issue_parent) {
                const parentFrontmatter = await service.getIssueFrontmatter(frontmatter.issue_parent);
                if (parentFrontmatter && parentFrontmatter.issue_children) {
                    const updatedChildren = parentFrontmatter.issue_children.filter(
                        child => child !== node.fileName
                    );
                    await service.updateIssueFields(frontmatter.issue_parent, {
                        issue_children: updatedChildren
                    });
                }
            }

            // 将子节点独立化
            if (hasChildren) {
                const updates = new Map<string, Partial<IssueFrontmatterData>>();
                for (const child of node.children) {
                    updates.set(child.fileName, {
                        issue_parent: null,
                        issue_root: child.fileName
                    });
                }
                await service.updateIssueFieldsBatch(updates);
            }

            // 删除当前节点的 issue_ 字段
            await service.removeAllIssueFields(node.fileName);

            // 刷新视图
            this.refresh();

            vscode.window.showInformationMessage(`已从层级树移除: ${node.title}`);
        } catch (error) {
            console.error('移除节点失败:', error);
            vscode.window.showErrorMessage(`移除节点失败: ${error}`);
        }
    }

    /**
     * 清理资源
     */
    public dispose(): void {
        this._onDidChangeTreeData.dispose();
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables = [];
    }
}
