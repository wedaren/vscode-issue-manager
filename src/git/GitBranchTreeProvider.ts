import * as vscode from 'vscode';
import { GitBranchManager, GitBranchInfo } from './GitBranchManager';
import * as path from 'path';

/**
 * TreeView 节点类型
 */
type GitBranchTreeItem = BranchNodeItem | ParentBranchItem;

/**
 * 分支节点
 */
class BranchNodeItem extends vscode.TreeItem {
    constructor(
        public readonly branchInfo: GitBranchInfo,
        public readonly displayLabel: string,
        public readonly hasParents: boolean
    ) {
        super(
            displayLabel,
            hasParents 
                ? vscode.TreeItemCollapsibleState.Collapsed 
                : vscode.TreeItemCollapsibleState.None
        );
        
        this.contextValue = branchInfo.isRemote ? 'remoteBranch' : 'localBranch';
        
        // 设置描述（显示最后提交时间）
        const date = branchInfo.lastCommitDate;
        this.description = `(last commit: ${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')})`;
        
        // 设置工具提示
        this.tooltip = `分支: ${branchInfo.fullName}\n` +
                       `提交: ${branchInfo.commit.substring(0, 7)}\n` +
                       `时间: ${date.toLocaleString()}\n` +
                       `消息: ${branchInfo.lastCommitMessage}`;
        
        // 设置图标
        if (branchInfo.isCurrent) {
            this.iconPath = new vscode.ThemeIcon('git-branch', new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'));
        } else if (branchInfo.associatedIssueId) {
            this.iconPath = new vscode.ThemeIcon('link');
        } else {
            this.iconPath = new vscode.ThemeIcon('git-branch');
        }
        
        // 如果关联了 Issue，添加命令
        if (branchInfo.associatedIssueId) {
            this.command = {
                command: 'issueManager.gitBranch.openAssociatedIssue',
                title: '打开关联的 Issue',
                arguments: [branchInfo.associatedIssueId]
            };
        }
    }
}

/**
 * 父分支节点
 */
class ParentBranchItem extends vscode.TreeItem {
    constructor(public readonly parentBranchName: string) {
        super(parentBranchName, vscode.TreeItemCollapsibleState.None);
        this.contextValue = 'parentBranch';
        this.iconPath = new vscode.ThemeIcon('arrow-up');
    }
}

/**
 * Git 分支 TreeView Provider
 */
export class GitBranchTreeProvider implements vscode.TreeDataProvider<GitBranchTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<GitBranchTreeItem | undefined | null | void> = 
        new vscode.EventEmitter<GitBranchTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<GitBranchTreeItem | undefined | null | void> = 
        this._onDidChangeTreeData.event;

    constructor(private branchManager: GitBranchManager) {
        // 监听分支管理器的数据变化
        branchManager.onDidChangeData(() => {
            this._onDidChangeTreeData.fire();
        });
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: GitBranchTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: GitBranchTreeItem): Promise<GitBranchTreeItem[]> {
        if (!this.branchManager.isGitRepository()) {
            return [];
        }

        if (!element) {
            // 根节点：显示所有分支，按提交分组
            return await this.getRootNodes();
        }

        // 显示分支的父分支
        if (element instanceof BranchNodeItem) {
            return element.branchInfo.parents.map(
                parentName => new ParentBranchItem(parentName)
            );
        }

        return [];
    }

    /**
     * 获取根节点（按 commit 分组的分支）
     */
    private async getRootNodes(): Promise<BranchNodeItem[]> {
        const commitMap = await this.branchManager.getBranchesByCommit();
        const nodes: BranchNodeItem[] = [];

        // 将 commitMap 转换为数组并按时间排序
        const sortedCommits = Array.from(commitMap.entries())
            .sort((a, b) => {
                const dateA = a[1][0].lastCommitDate.getTime();
                const dateB = b[1][0].lastCommitDate.getTime();
                return dateB - dateA;
            });

        for (const [commit, branches] of sortedCommits) {
            if (branches.length === 1) {
                // 只有一个分支指向此 commit
                const branch = branches[0];
                const label = this.formatBranchLabel(branch);
                nodes.push(new BranchNodeItem(branch, label, branch.parents.length > 0));
            } else {
                // 多个分支指向同一个 commit，需要为每个分支创建节点
                // 按分支名排序
                const sortedBranches = branches.sort((a, b) => a.name.localeCompare(b.name));
                
                for (const branch of sortedBranches) {
                    const label = this.formatMergedBranchLabel(branch, sortedBranches);
                    nodes.push(new BranchNodeItem(branch, label, branch.parents.length > 0));
                }
            }
        }

        return nodes;
    }

    /**
     * 格式化单个分支的标签
     */
    private formatBranchLabel(branch: GitBranchInfo): string {
        let label = '';
        
        if (branch.isCurrent) {
            label = `HEAD → ${branch.name}`;
        } else {
            label = branch.name;
        }
        
        return label;
    }

    /**
     * 格式化合并分支的标签（多个分支指向同一 commit）
     */
    private formatMergedBranchLabel(currentBranch: GitBranchInfo, allBranches: GitBranchInfo[]): string {
        // 获取其他分支的名称
        const otherBranches = allBranches
            .filter(b => b.fullName !== currentBranch.fullName)
            .map(b => {
                if (b.isCurrent) {
                    return `HEAD → ${b.name}`;
                }
                return b.name;
            });
        
        // 构建标签
        if (currentBranch.isCurrent) {
            if (otherBranches.length > 0) {
                return `HEAD → ${currentBranch.name}, ${otherBranches.join(', ')}`;
            }
            return `HEAD → ${currentBranch.name}`;
        } else {
            if (otherBranches.length > 0) {
                return `${currentBranch.name}, ${otherBranches.join(', ')}`;
            }
            return currentBranch.name;
        }
    }

    getParent(element: GitBranchTreeItem): GitBranchTreeItem | undefined {
        if (element instanceof ParentBranchItem) {
            // 父分支节点的父节点是分支节点
            // 这里需要遍历找到对应的分支节点
            // 由于 VS Code 的限制，这里返回 undefined
            return undefined;
        }
        return undefined;
    }
}
