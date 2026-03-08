import * as vscode from 'vscode';
import {
    GROUP_NAMES_KEY, getTabUri, formatRelativeTime, getFileMtimes,
} from '../commands/editorGroupUtils';

// ─── TreeItem 类型 ──────────────────────────────────────────

/** 编辑器组节点 */
export class EditorGroupItem extends vscode.TreeItem {
    constructor(
        public readonly tabGroup: vscode.TabGroup,
        public readonly groupIndex: number,
        customName: string | undefined,
    ) {
        // 有自定义名时：名称为主标签，组号为描述；否则组号为主标签
        const label = customName
            ? customName
            : `编辑器组 ${groupIndex + 1}`;
        super(label, vscode.TreeItemCollapsibleState.Expanded);
        const activeLabel = tabGroup.isActive ? '活动 · ' : '';
        this.description = customName
            ? `组 ${groupIndex + 1} · ${activeLabel}${tabGroup.tabs.length} 个标签页`
            : `${activeLabel}${tabGroup.tabs.length} 个标签页`;
        this.contextValue = tabGroup.isActive ? 'editorGroup.active' : 'editorGroup';
        this.iconPath = new vscode.ThemeIcon(tabGroup.isActive ? 'window' : 'split-horizontal');
    }
}

/** 标签页节点 */
export class EditorTabItem extends vscode.TreeItem {
    constructor(
        public readonly tab: vscode.Tab,
        public readonly parentGroup: vscode.TabGroup,
        mtime?: number,
    ) {
        super(tab.label, vscode.TreeItemCollapsibleState.None);

        // 图标：当前活动组的活动标签用蓝色 eye，其他组的活动标签用灰色 eye
        if (tab.isActive && parentGroup.isActive) {
            this.iconPath = new vscode.ThemeIcon('eye', new vscode.ThemeColor('charts.blue'));
        } else if (tab.isActive) {
            this.iconPath = new vscode.ThemeIcon('eye', new vscode.ThemeColor('disabledForeground'));
        } else if (tab.isDirty) {
            this.iconPath = new vscode.ThemeIcon('circle-filled');
        } else if (tab.isPinned) {
            this.iconPath = new vscode.ThemeIcon('pinned');
        } else {
            this.iconPath = new vscode.ThemeIcon('file');
        }

        // 描述
        const tags: string[] = [];
        if (tab.isActive) { tags.push('活动'); }
        if (tab.isDirty) { tags.push('未保存'); }
        if (tab.isPinned) { tags.push('已固定'); }
        if (tab.isPreview) { tags.push('预览'); }
        if (mtime) { tags.push(formatRelativeTime(mtime)); }
        this.description = tags.join(' · ') || undefined;

        // resourceUri 用于文件装饰
        this.resourceUri = getTabUri(tab);

        // 点击后聚焦该标签页
        if (this.resourceUri) {
            this.command = {
                command: 'vscode.open',
                title: '打开文件',
                arguments: [this.resourceUri, { viewColumn: parentGroup.viewColumn, preserveFocus: false }],
            };
        }

        this.contextValue = 'editorTab';
    }
}

export type EditorGroupViewNode = EditorGroupItem | EditorTabItem;

// ─── Provider ───────────────────────────────────────────────

export class EditorGroupTreeProvider implements vscode.TreeDataProvider<EditorGroupViewNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<EditorGroupViewNode | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private disposables: vscode.Disposable[] = [];

    constructor(private readonly context: vscode.ExtensionContext) {
        // 监听标签页/组变化自动刷新
        this.disposables.push(
            vscode.window.tabGroups.onDidChangeTabGroups(() => this.refresh()),
            vscode.window.tabGroups.onDidChangeTabs(() => this.refresh()),
        );
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    dispose(): void {
        for (const d of this.disposables) d.dispose();
        this._onDidChangeTreeData.dispose();
    }

    private getGroupNames(): Record<number, string> {
        return this.context.workspaceState.get<Record<number, string>>(GROUP_NAMES_KEY) ?? {};
    }

    getTreeItem(element: EditorGroupViewNode): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: EditorGroupViewNode): Promise<EditorGroupViewNode[]> {
        if (!element) {
            // 根节点：所有编辑器组
            const names = this.getGroupNames();
            return vscode.window.tabGroups.all.map(
                (group, index) => new EditorGroupItem(group, index, names[group.viewColumn ?? (index + 1)]),
            );
        }

        if (element instanceof EditorGroupItem) {
            // 批量获取标签页文件的 mtime
            const tabs = element.tabGroup.tabs;
            const uris = tabs.map(getTabUri);
            const mtimeMap = await getFileMtimes(uris);

            return tabs.map((tab, i) => {
                const mtime = uris[i] ? mtimeMap.get(uris[i]!.toString()) : undefined;
                return new EditorTabItem(tab, element.tabGroup, mtime);
            });
        }

        return [];
    }

    getParent(element: EditorGroupViewNode): EditorGroupViewNode | undefined {
        if (element instanceof EditorTabItem) {
            const names = this.getGroupNames();
            const groups = vscode.window.tabGroups.all;
            const idx = groups.indexOf(element.parentGroup);
            if (idx >= 0) {
                return new EditorGroupItem(
                    element.parentGroup,
                    idx,
                    names[element.parentGroup.viewColumn ?? (idx + 1)],
                );
            }
        }
        return undefined;
    }
}
