import * as vscode from 'vscode';
import * as path from 'path';
import { generateFileName } from '../utils/fileUtils';
import { getIssueDir } from '../config';
import { IssueFrontmatterService, IssueFrontmatterData } from '../services/IssueFrontmatterService';
import { IssueLogicalTreeModel, IssueLogicalTreeNode } from '../models/IssueLogicalTreeModel';

/**
 * Issue 逻辑树视图提供者
 * 基于当前活动文件的 issue_root、issue_parent、issue_children 字段构建逻辑树
 */
export class IssueLogicalTreeProvider implements vscode.TreeDataProvider<IssueLogicalTreeNode>, vscode.Disposable {
    private _onDidChangeTreeData: vscode.EventEmitter<IssueLogicalTreeNode | undefined | null | void> = 
        new vscode.EventEmitter<IssueLogicalTreeNode | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<IssueLogicalTreeNode | undefined | null | void> = 
        this._onDidChangeTreeData.event;

    private model: IssueLogicalTreeModel;
    private disposables: vscode.Disposable[] = [];

    constructor(private context: vscode.ExtensionContext) {
        this.model = new IssueLogicalTreeModel();

        // 监听编辑器切换
        this.disposables.push(
            vscode.window.onDidChangeActiveTextEditor((editor) => {
                this.onActiveEditorChanged(editor);
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

        if (!editor || editor.document.languageId !== 'markdown') {
            // this.model.clear();
            // this._onDidChangeTreeData.fire();
            return;
        }

        const issueDir = getIssueDir();
        if (!issueDir) {
            this.model.clear();
            this._onDidChangeTreeData.fire();
            return;
        }

        const filePath = editor.document.uri.fsPath;
        if (!filePath.startsWith(issueDir)) {
            this.model.clear();
            this._onDidChangeTreeData.fire();
            return;
        }

        const fileName = path.relative(issueDir, filePath).replace(/\\/g, '/');
        
        // 获取新文件的 root
        const service = IssueFrontmatterService.getInstance();
        const frontmatter = await service.getIssueFrontmatter(fileName);
        const newRootFile = frontmatter?.issue_root || null;

        // 如果切换到同一个 root 下的不同文件，只更新 isCurrentFile 属性
        if (newRootFile && newRootFile === this.model.rootFile) {
            // 更新旧节点和新节点的 isCurrentFile 标志
            this.model.updateCurrentFileInTree(this.model.activeFile, fileName);
            // 触发刷新以更新图标
            this._onDidChangeTreeData.fire();
            return;
        }

        // 切换到不同的 root 或没有 root，需要重建树
        this.model.activeFile = fileName;
        this.model.rootFile = newRootFile;
        await this.refresh();
    }

    /**
     * 刷新树视图
     */
    public async refresh(): Promise<void> {
        if (this.model.activeFile) {
            await this.model.buildTree(this.model.activeFile);
        } else {
            this.model.clear();
        }
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
            return this.model.nodes;
        }

        // 返回子节点
        return element.children;
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
        return this.model.findNode(frontmatter.issue_parent);
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
            this.model.activeFile = fileName;
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
                rootFileName = this.model.rootFile || fileName;
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
        this.model.clear();
    }
}
