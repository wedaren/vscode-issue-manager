import * as vscode from 'vscode';
import * as path from 'path';
import { getIssueDir } from '../config';
import { getTitle, getFrontmatter, FrontmatterData } from '../utils/markdown';

/**
 * 问题结构节点
 */
export interface IssueStructureNode {
    id: string;
    filePath: string;
    title: string;
    children: IssueStructureNode[];
    isCurrentFile: boolean;
    hasError: boolean;
    errorMessage?: string;
}

/**
 * 问题结构视图提供者
 * 基于 frontmatter 中的 root_file、parent_file、children_files 字段构建树状结构
 */
export class IssueStructureProvider implements vscode.TreeDataProvider<IssueStructureNode> {
    private _onDidChangeTreeData: vscode.EventEmitter<IssueStructureNode | undefined | null | void> = new vscode.EventEmitter<IssueStructureNode | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<IssueStructureNode | undefined | null | void> = this._onDidChangeTreeData.event;

    private currentActiveFile: string | null = null;
    private rootNodes: IssueStructureNode[] = [];
    private viewTitle: string = '问题结构';

    constructor(private context: vscode.ExtensionContext) {
        // 监听编辑器激活文件变化
        this.context.subscriptions.push(
            vscode.window.onDidChangeActiveTextEditor(editor => {
                this.onActiveEditorChanged(editor);
            })
        );

        // 初始化时检查当前激活的编辑器
        this.onActiveEditorChanged(vscode.window.activeTextEditor);
    }

    /**
     * 当激活编辑器改变时调用
     */
    private async onActiveEditorChanged(editor: vscode.TextEditor | undefined): Promise<void> {
        if (!editor || editor.document.languageId !== 'markdown') {
            this.clearView();
            return;
        }

        const issueDir = getIssueDir();
        if (!issueDir || !editor.document.uri.fsPath.startsWith(issueDir)) {
            this.clearView();
            return;
        }

        // 检查文件是否有有效的 frontmatter
        const frontmatter = await getFrontmatter(editor.document.uri);
        if (!frontmatter || !frontmatter.root_file) {
            this.showGuidanceMessage();
            return;
        }

        this.currentActiveFile = path.basename(editor.document.uri.fsPath);
        await this.buildStructureFromActiveFile(frontmatter);
    }

    /**
     * 清空视图
     */
    private clearView(): void {
        this.currentActiveFile = null;
        this.rootNodes = [];
        this.viewTitle = '问题结构';
        this.updateViewTitle();
        this._onDidChangeTreeData.fire();
    }

    /**
     * 显示引导信息
     */
    private showGuidanceMessage(): void {
        this.currentActiveFile = null;
        this.rootNodes = [{
            id: 'guidance',
            filePath: '',
            title: '请打开一篇已结构化的文档以查看其问题结构',
            children: [],
            isCurrentFile: false,
            hasError: false
        }];
        this.viewTitle = '问题结构';
        this.updateViewTitle();
        this._onDidChangeTreeData.fire();
    }

    /**
     * 从当前激活文件构建结构
     */
    private async buildStructureFromActiveFile(frontmatter: FrontmatterData): Promise<void> {
        const issueDir = getIssueDir();
        if (!issueDir || !frontmatter.root_file) {
            return;
        }

        const rootFilePath = path.join(issueDir, frontmatter.root_file);
        const rootUri = vscode.Uri.file(rootFilePath);

        try {
            // 检查根文件是否存在
            await vscode.workspace.fs.stat(rootUri);
            
            // 获取根文件标题并更新视图标题
            const rootTitle = await getTitle(rootUri);
            this.viewTitle = `问题结构: ${rootTitle}`;
            this.updateViewTitle();

            // 构建树结构
            const visited = new Set<string>();
            const rootNode = await this.buildNodeRecursively(frontmatter.root_file, visited);
            this.rootNodes = rootNode ? [rootNode] : [];
            
            this._onDidChangeTreeData.fire();
        } catch (error) {
            console.error(`根文件不存在: ${rootFilePath}`, error);
            this.rootNodes = [{
                id: 'error',
                filePath: '',
                title: `根文件不存在: ${frontmatter.root_file}`,
                children: [],
                isCurrentFile: false,
                hasError: true,
                errorMessage: `根文件不存在: ${frontmatter.root_file}`
            }];
            this.viewTitle = '问题结构: 错误';
            this.updateViewTitle();
            this._onDidChangeTreeData.fire();
        }
    }

    /**
     * 递归构建节点
     */
    private async buildNodeRecursively(fileName: string, visited: Set<string>): Promise<IssueStructureNode | null> {
        const issueDir = getIssueDir();
        if (!issueDir) {
            return null;
        }

        // 检测循环引用
        if (visited.has(fileName)) {
            return {
                id: fileName,
                filePath: fileName,
                title: `循环引用: ${fileName}`,
                children: [],
                isCurrentFile: fileName === this.currentActiveFile,
                hasError: true,
                errorMessage: '检测到循环引用'
            };
        }

        visited.add(fileName);

        const filePath = path.join(issueDir, fileName);
        const fileUri = vscode.Uri.file(filePath);

        try {
            // 检查文件是否存在
            await vscode.workspace.fs.stat(fileUri);
            
            // 获取文件标题
            const title = await getTitle(fileUri);
            
            // 获取 frontmatter
            const frontmatter = await getFrontmatter(fileUri);
            const childrenFiles = frontmatter?.children_files || [];

            // 递归构建子节点
            const children: IssueStructureNode[] = [];
            for (const childFileName of childrenFiles) {
                const childNode = await this.buildNodeRecursively(childFileName, new Set(visited));
                if (childNode) {
                    children.push(childNode);
                }
            }

            visited.delete(fileName);

            return {
                id: fileName,
                filePath: fileName,
                title,
                children,
                isCurrentFile: fileName === this.currentActiveFile,
                hasError: false
            };

        } catch (error) {
            visited.delete(fileName);
            return {
                id: fileName,
                filePath: fileName,
                title: `文件未找到: ${fileName}`,
                children: [],
                isCurrentFile: fileName === this.currentActiveFile,
                hasError: true,
                errorMessage: '文件不存在'
            };
        }
    }

    /**
     * 更新视图标题
     */
    private updateViewTitle(): void {
        vscode.commands.executeCommand('setContext', 'issueManager.structureViewTitle', this.viewTitle);
    }

    /**
     * 手动刷新视图
     */
    public refresh(): void {
        this.onActiveEditorChanged(vscode.window.activeTextEditor);
    }

    getTreeItem(element: IssueStructureNode): vscode.TreeItem {
        // 处理引导信息节点
        if (element.id === 'guidance') {
            const item = new vscode.TreeItem(element.title, vscode.TreeItemCollapsibleState.None);
            item.id = element.id;
            item.contextValue = 'guidance';
            return item;
        }

        // 处理错误节点
        if (element.hasError) {
            const item = new vscode.TreeItem(element.title, vscode.TreeItemCollapsibleState.None);
            item.id = element.id;
            item.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'));
            item.tooltip = element.errorMessage;
            item.contextValue = 'errorNode';
            return item;
        }

        // 处理正常节点
        const collapsibleState = element.children.length > 0 
            ? vscode.TreeItemCollapsibleState.Expanded 
            : vscode.TreeItemCollapsibleState.None;

        const item = new vscode.TreeItem(element.title, collapsibleState);
        item.id = element.id;
        item.description = element.filePath;
        item.tooltip = new vscode.MarkdownString(`**${element.title}**\n\n文件名: \`${element.filePath}\``);
        
        // 设置资源URI以支持点击打开
        const issueDir = getIssueDir();
        if (issueDir) {
            item.resourceUri = vscode.Uri.file(path.join(issueDir, element.filePath));
        }

        // 高亮当前激活的文件
        if (element.isCurrentFile) {
            item.iconPath = new vscode.ThemeIcon('arrow-right', new vscode.ThemeColor('list.highlightForeground'));
        }

        // 设置点击命令
        item.command = {
            command: 'vscode.open',
            title: '打开文件',
            arguments: [item.resourceUri]
        };

        item.contextValue = 'structureNode';
        return item;
    }

    getChildren(element?: IssueStructureNode): vscode.ProviderResult<IssueStructureNode[]> {
        if (element) {
            return element.children;
        }
        return this.rootNodes;
    }

    /**
     * 获取父节点（支持 reveal 操作）
     */
    getParent(element: IssueStructureNode): IssueStructureNode | null {
        // 在树中查找父节点
        const findParent = (node: IssueStructureNode, target: IssueStructureNode): IssueStructureNode | null => {
            if (node.children.some(child => child.id === target.id)) {
                return node;
            }
            for (const child of node.children) {
                const parent = findParent(child, target);
                if (parent) {
                    return parent;
                }
            }
            return null;
        };

        for (const root of this.rootNodes) {
            const parent = findParent(root, element);
            if (parent) {
                return parent;
            }
        }
        return null;
    }

    /**
     * 清理资源
     */
    dispose(): void {
        // TreeDataProvider 接口实现通常不需要特殊清理
        // 但为了符合 VS Code 的 Disposable 接口要求，提供此方法
    }
}
