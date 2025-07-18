import * as vscode from 'vscode';
import * as path from 'path';
import { getIssueDir } from '../config';
import { getTitle } from '../utils/markdown';
import { readTree } from '../data/treeManager';

/**
 * 定义 IssueItem 类型，确保每个节点都绑定一个 markdown 文件的 resourceUri。
 * 该类型专用于视图中的每个 .md 文件项。
 */
export class IssueItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly resourceUri: vscode.Uri,
    ) {
        super(label, vscode.TreeItemCollapsibleState.None);
        // 当鼠标悬停时显示完整路径
        this.tooltip = `${this.label}`;
        // 将 contextValue 设置为 'isolatedIssue'，以便在 package.json 中针对性地显示命令
        this.contextValue = 'isolatedIssue';
    }
}

export class IsolatedIssuesProvider implements vscode.TreeDataProvider<IssueItem> {

    private _onDidChangeTreeData: vscode.EventEmitter<IssueItem | undefined | null | void> = new vscode.EventEmitter<IssueItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<IssueItem | undefined | null | void> = this._onDidChangeTreeData.event;
    constructor(private context: vscode.ExtensionContext) {
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('issueManager.issueDir')) {
                this.refresh();
            }
        });
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: IssueItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: IssueItem): Promise<IssueItem[]> {
        const issueDir = getIssueDir();
        if (!issueDir) {
            // 当目录未配置时，返回空数组，VS Code 将自动显示在 package.json 中定义的 welcome content。
            return [];
        }

        if (element) {
            // 在孤立问题视图中，我们是一个扁平列表，所以只有根节点有子节点
            return [];
        }

        try {
            // 1. 读取当前的树状结构，获取所有已关联的文件路径
            const treeData = await readTree();
            const associatedFiles = new Set<string>();
            function collectPaths(nodes: any[]) {
                for (const node of nodes) {
                    associatedFiles.add(path.normalize(node.filePath));
                    if (node.children) {
                        collectPaths(node.children);
                    }
                }
            }
            collectPaths(treeData.rootNodes);

            // 2. 读取问题目录下的所有 .md 文件
            const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(issueDir));
            const allMdFiles = entries.filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.md'));

            // 3. 过滤出未被关联的文件
            const isolatedMdFiles = allMdFiles.filter(([name, type]) => {
                const relativePath = path.normalize(name);
                return !associatedFiles.has(relativePath);
            });

            // 4. 为孤立文件创建 TreeItem
            const filesWithStats = await Promise.all(isolatedMdFiles.map(async ([name, type]) => {
                const fileUri = vscode.Uri.file(path.join(issueDir, name));
                const stat = await vscode.workspace.fs.stat(fileUri);
                return { name, uri: fileUri, ctime: stat.ctime };
            }));

            // 按创建时间倒序排序
            filesWithStats.sort((a, b) => b.ctime - a.ctime);

            const treeItems = await Promise.all(filesWithStats.map(async (file) => {
                const title = await getTitle(file.uri);
                const item = new IssueItem(title, file.uri);
                item.command = {
                    command: 'vscode.open',
                    title: '打开文件',
                    arguments: [file.uri]
                };
                return item;
            }));

            return treeItems;
        } catch (error) {
            // 如果目录不存在或无法读取，显示错误信息
            if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
                vscode.window.showErrorMessage(`配置的问题目录不存在: ${issueDir}`);
            } else {
                vscode.window.showErrorMessage(`加载孤立问题时出错: ${error}`);
            }
            return [];
        }
    }
}
