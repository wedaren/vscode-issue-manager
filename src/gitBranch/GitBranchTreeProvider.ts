import * as vscode from 'vscode';
import { GitBranchManager, BranchEntry } from './GitBranchManager';
import { getIssueTitleFromCache } from '../data/issueTreeManager';

class BranchTreeItem extends vscode.TreeItem {
    constructor(public readonly entry: BranchEntry) {
        const label = entry.name;
        super(label, vscode.TreeItemCollapsibleState.Collapsed);
        // 根据是否为 HEAD 与是否可删除设置 contextValue（便于在 package.json 中控制菜单显示）
        const kind = entry.isRemote ? 'gitRemoteBranch' : 'gitLocalBranch';
        const headOrDeletable = entry.isHead ? `${kind}Head` : `${kind}Deletable`;
        this.contextValue = entry.associatedIssueId ? `${headOrDeletable}Associated` : headOrDeletable;
        this.tooltip = `${entry.name} (${entry.commitHash})`;
        this.description = `last commit: ${new Date(entry.commitTime).toLocaleDateString()}`;

        // 根据 HEAD / 关联状态显示不同图标
        if (entry.isHead) {
            // 使用蓝色主题色的眼睛图标以突出 HEAD
            this.iconPath = new vscode.ThemeIcon('eye', new vscode.ThemeColor('terminal.ansiBlue'));
        } else if (entry.associatedIssueId) {
            this.iconPath = new vscode.ThemeIcon('go-to-file');
            this.description += ` • issue: ${getIssueTitleFromCache(entry.associatedIssueId)}`;
        } else {
            this.iconPath = new vscode.ThemeIcon('link');
        }
    }
}

export class GitBranchTreeProvider implements vscode.TreeDataProvider<BranchTreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<BranchTreeItem | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private manager: GitBranchManager) {
        this.manager.onDidChangeData(() => this.refresh());
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: BranchTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: BranchTreeItem): Promise<BranchTreeItem[]> {
        if (!element) {
            // 根节点：列出所有分支（本地优先），并按 commit 时间降序
            const all = this.manager.getBranches();
            // 本地优先
            const locals = all.filter(b => !b.isRemote).sort((a, b) => b.commitTime - a.commitTime);
            const remotes = all.filter(b => b.isRemote).sort((a, b) => b.commitTime - a.commitTime);

            const ordered = [...locals, ...remotes];

            // 构建每个 branch 的标题：自身名优先，随后列出指向相同 commit 的其它分支名
            const allBranches = this.manager.getBranches();
            const branchMap = new Map(allBranches.map(x => [x.name, x]));

            const items: BranchTreeItem[] = await Promise.all(ordered.map(async b => {
                const sameNames = this.manager.getBranchesByCommit(b.commitHash).filter(n => n !== b.name);
                // 格式化名称：自身分支名先，其他分支名随后；若某分支为 HEAD，则显示为 "HEAD → name"
                const allNames: string[] = [b.name].concat(sameNames);
                const formatted = allNames.map(n => {
                    // 查找对应 entry 是否为 HEAD (use prebuilt map for performance)
                    const ent = branchMap.get(n);
                    if (ent && ent.isHead) {
                        return `HEAD → ${n}`;
                    }
                    return n;
                });

                const label = formatted.join(', ');
                // 检查是否存在子节点（父分支）
                const parents = await this.manager.getParentBranches(b);
                const state = (parents && parents.length > 0) ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;

                const ti = new BranchTreeItem(b);
                ti.collapsibleState = state;
                ti.label = label;
                // description already set in constructor but override to ensure consistency
                ti.description = `last commit: ${new Date(b.commitTime).toLocaleDateString()}` + (b.associatedIssueId ? ` • issue: ${getIssueTitleFromCache(b.associatedIssueId)}` : '');
                return ti;
            }));

            return items;
        }

        // 子节点：查找父分支（使用 manager 提供的启发式方法）
        const parents = await this.manager.getParentBranches(element.entry);
        const allBranches = this.manager.getBranches();
        const branchMap = new Map(allBranches.map(x => [x.name, x]));

        return await Promise.all(parents.map(async p => {
            const sameNames = this.manager.getBranchesByCommit(p.commitHash).filter(n => n !== p.name);
            const allNames: string[] = [p.name].concat(sameNames);
            const formatted = allNames.map(n => {
                const ent = branchMap.get(n);
                if (ent && ent.isHead) {
                    return `HEAD → ${n}`;
                }
                return n;
            });
            const childParents = await this.manager.getParentBranches(p);
            const state = (childParents && childParents.length > 0) ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;
            const ti = new BranchTreeItem(p);
            ti.collapsibleState = state;
            ti.label = formatted.join(', ');
            ti.description = `last commit: ${new Date(p.commitTime).toLocaleDateString()}` + (p.associatedIssueId ? ` • issue: ${getIssueTitleFromCache(p.associatedIssueId)}` : '');
            return ti;
        }));
    }

    getParent(element: BranchTreeItem): BranchTreeItem | undefined {
        // 父节点逻辑不需要支持向上定位（视图以父分支为子节点展示），所以返回 undefined
        return undefined;
    }
}

export default GitBranchTreeProvider;
