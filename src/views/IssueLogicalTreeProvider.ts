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
    resourceUri?: vscode.Uri;
}

/**
 * Issue 逻辑树视图提供者
 * 基于 issue_root、issue_parent、issue_children 字段构建逻辑树
 */
export class IssueLogicalTreeProvider implements vscode.TreeDataProvider<IssueLogicalTreeNode>, vscode.Disposable {
    private _onDidChangeTreeData: vscode.EventEmitter<IssueLogicalTreeNode | undefined | null | void> = 
        new vscode.EventEmitter<IssueLogicalTreeNode | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<IssueLogicalTreeNode | undefined | null | void> = 
        this._onDidChangeTreeData.event;

    private rootNodes: IssueLogicalTreeNode[] = [];
    private disposables: vscode.Disposable[] = [];

    constructor(private context: vscode.ExtensionContext) {
        // 初始化时构建树
        this.refresh();
    }

    /**
     * 刷新树视图
     */
    public refresh(): void {
        this.buildTree().then(() => {
            this._onDidChangeTreeData.fire();
        });
    }

    /**
     * 获取树节点
     */
    getTreeItem(element: IssueLogicalTreeNode): vscode.TreeItem {
        const treeItem = new vscode.TreeItem(
            element.title,
            element.children.length > 0 
                ? vscode.TreeItemCollapsibleState.Collapsed 
                : vscode.TreeItemCollapsibleState.None
        );

        treeItem.resourceUri = element.resourceUri;
        treeItem.command = {
            command: 'vscode.open',
            title: '打开文件',
            arguments: [element.resourceUri]
        };

        // 设置图标
        if (element.isRoot) {
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
     * 构建逻辑树
     */
    private async buildTree(): Promise<void> {
        const issueDir = getIssueDir();
        if (!issueDir) {
            this.rootNodes = [];
            return;
        }

        try {
            const service = IssueFrontmatterService.getInstance();
            
            // 获取所有 Markdown 文件
            const allFiles = await vscode.workspace.findFiles(
                new vscode.RelativePattern(issueDir, '**/*.md'),
                '**/.issueManager/**'
            );

            // 构建文件名到 frontmatter 的映射
            const fileMap = new Map<string, IssueFrontmatterData>();
            const relativeFiles: string[] = [];

            for (const fileUri of allFiles) {
                const fileName = path.relative(issueDir, fileUri.fsPath).replace(/\\/g, '/');
                relativeFiles.push(fileName);
            }

            // 批量读取 frontmatter
            const frontmatterMap = await service.getIssueFrontmatterBatch(relativeFiles);
            for (const [fileName, frontmatter] of frontmatterMap.entries()) {
                if (frontmatter) {
                    fileMap.set(fileName, frontmatter);
                }
            }

            // 查找所有根节点（issue_root 指向自己或没有 issue_root 字段但有 issue_children 的文件）
            const rootFileNames = new Set<string>();
            for (const [fileName, frontmatter] of fileMap.entries()) {
                if (frontmatter.issue_root === fileName || 
                    (!frontmatter.issue_root && frontmatter.issue_children && frontmatter.issue_children.length > 0)) {
                    rootFileNames.add(fileName);
                }
            }

            // 构建根节点
            this.rootNodes = [];
            for (const rootFileName of rootFileNames) {
                const rootNode = await this.buildNodeTree(rootFileName, fileMap, issueDir, true);
                if (rootNode) {
                    this.rootNodes.push(rootNode);
                }
            }

            // 按标题排序根节点
            this.rootNodes.sort((a, b) => a.title.localeCompare(b.title));

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
            // 生成文件名
            const { generateFileName } = await import('../utils/fileUtils');
            const fileName = generateFileName();
            const filePath = path.join(issueDir, fileName);
            const fileUri = vscode.Uri.file(filePath);

            // 确定父节点路径
            const parentFileName = parentNode ? parentNode.fileName : null;

            // 创建 frontmatter 内容
            const service = IssueFrontmatterService.getInstance();
            let frontmatterData: IssueFrontmatterData = {
                issue_root: parentFileName || fileName
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
