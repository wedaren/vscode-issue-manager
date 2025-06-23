import * as vscode from 'vscode';
import * as path from 'path';
import { getIssueDir } from '../config';
import { getIssueTitle } from '../utils/markdown';

// 定义一个更具体的 TreeItem 类型，确保 resourceUri 总是存在
export class IssueTreeItem extends vscode.TreeItem {
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

export class IsolatedIssuesProvider implements vscode.TreeDataProvider<IssueTreeItem> {

    private _onDidChangeTreeData: vscode.EventEmitter<IssueTreeItem | undefined | null | void> = new vscode.EventEmitter<IssueTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<IssueTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;
    private watcher: vscode.FileSystemWatcher | undefined;

    constructor(private context: vscode.ExtensionContext) {
        this.setupWatcher();

        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('issueManager.issueDir')) {
                this.setupWatcher();
                this.refresh();
            }
        });
    }

    private setupWatcher(): void {
        // 清理旧的监视器
        if (this.watcher) {
            this.watcher.dispose();
        }

        const issueDir = getIssueDir();
        if (issueDir) {
            const pattern = new vscode.RelativePattern(vscode.Uri.file(issueDir), '**/*.md');
            this.watcher = vscode.workspace.createFileSystemWatcher(pattern);

            // 当文件被创建、更改或删除时，刷新视图
            this.watcher.onDidCreate(() => this.refresh());
            this.watcher.onDidChange(() => this.refresh());
            this.watcher.onDidDelete(() => this.refresh());

            this.context.subscriptions.push(this.watcher);
        }
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: IssueTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: IssueTreeItem): Promise<IssueTreeItem[]> {
        const issueDir = getIssueDir();
        if (!issueDir) {
            // 当目录未配置时，返回空数组，VS Code 将自动显示在 package.json 中定义的 welcome content。
            return [];
        }

        if (element) {
            // 在孤立问题视图中，我们是一个扁平列表，所以只有根节点有子节点
            return Promise.resolve([]);
        }

        try {
            const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(issueDir));
            const mdFiles = entries.filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.md'));

            // 获取每个文件的统计信息（包含创建时间）
            const filesWithStats = await Promise.all(mdFiles.map(async ([name, type]) => {
                const fileUri = vscode.Uri.file(path.join(issueDir, name));
                const stat = await vscode.workspace.fs.stat(fileUri);
                return { name, uri: fileUri, ctime: stat.ctime };
            }));

            // 按创建时间倒序排序
            filesWithStats.sort((a, b) => b.ctime - a.ctime);

            const treeItems = await Promise.all(filesWithStats.map(async (file) => {
                const title = await getIssueTitle(file.uri);
                const item = new IssueTreeItem(title, file.uri);
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
                vscode.window.showErrorMessage(`读取问题目录时出错: ${error}`);
            }
            return [];
        }
    }
}
