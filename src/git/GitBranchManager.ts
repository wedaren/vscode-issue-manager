import * as vscode from 'vscode';
import simpleGit, { SimpleGit, BranchSummary } from 'simple-git';

/**
 * Git 分支信息
 */
export interface GitBranchInfo {
    /** 分支名称 */
    name: string;
    /** 完整分支名称（包含 remote/） */
    fullName: string;
    /** 是否是当前分支 */
    isCurrent: boolean;
    /** 最后提交的 SHA */
    commit: string;
    /** 最后提交时间 */
    lastCommitDate: Date;
    /** 最后提交信息 */
    lastCommitMessage: string;
    /** 是否是远程分支 */
    isRemote: boolean;
    /** 父分支列表 */
    parents: string[];
    /** 关联的 Issue ID（可选） */
    associatedIssueId?: string;
}

/**
 * Git 分支管理器
 * 负责获取和管理 Git 分支信息
 */
export class GitBranchManager {
    private git: SimpleGit | null = null;
    private repoPath: string | null = null;
    private _onDidChangeData: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    readonly onDidChangeData: vscode.Event<void> = this._onDidChangeData.event;

    // 分支关联数据存储
    private branchAssociations: Map<string, string> = new Map();

    constructor(private context: vscode.ExtensionContext) {
        this.loadAssociations();
        this.initializeGit();
    }

    /**
     * 初始化 Git
     */
    private async initializeGit(): Promise<void> {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }

            // 使用第一个工作区文件夹作为仓库路径
            this.repoPath = workspaceFolders[0].uri.fsPath;
            this.git = simpleGit(this.repoPath);

            // 检查是否是 Git 仓库
            const isRepo = await this.git.checkIsRepo();
            if (!isRepo) {
                this.git = null;
                this.repoPath = null;
            }
        } catch (error) {
            console.error('初始化 Git 失败:', error);
            this.git = null;
            this.repoPath = null;
        }
    }

    /**
     * 检查是否在 Git 仓库中
     */
    public isGitRepository(): boolean {
        return this.git !== null && this.repoPath !== null;
    }

    /**
     * 获取所有分支信息
     */
    public async getAllBranches(): Promise<GitBranchInfo[]> {
        if (!this.git) {
            return [];
        }

        try {
            // 获取所有分支
            const branchSummary: BranchSummary = await this.git.branch(['-a', '-v']);
            const branches: GitBranchInfo[] = [];

            // 处理每个分支
            for (const [name, branch] of Object.entries(branchSummary.branches)) {
                // 获取分支的最后提交信息
                const log = await this.git.log([name, '-1']);
                const lastCommit = log.latest;

                if (!lastCommit) {
                    continue;
                }

                // 获取父分支
                const parents = await this.getParentBranches(name);

                const branchInfo: GitBranchInfo = {
                    name: this.getBranchDisplayName(name),
                    fullName: name,
                    isCurrent: branch.current,
                    commit: branch.commit,
                    lastCommitDate: new Date(lastCommit.date),
                    lastCommitMessage: lastCommit.message,
                    isRemote: name.startsWith('remotes/'),
                    parents: parents,
                    associatedIssueId: this.branchAssociations.get(name)
                };

                branches.push(branchInfo);
            }

            // 按最后提交时间降序排列
            branches.sort((a, b) => b.lastCommitDate.getTime() - a.lastCommitDate.getTime());

            return branches;
        } catch (error) {
            console.error('获取分支信息失败:', error);
            return [];
        }
    }

    /**
     * 获取分支的显示名称
     */
    private getBranchDisplayName(fullName: string): string {
        if (fullName.startsWith('remotes/')) {
            return fullName.replace('remotes/', '');
        }
        return fullName;
    }

    /**
     * 获取父分支列表
     * 简化实现：通过分支创建时的基础分支判断
     */
    private async getParentBranches(branchName: string): Promise<string[]> {
        if (!this.git) {
            return [];
        }

        try {
            const parents: string[] = [];
            
            // 尝试从 Git 配置中获取分支的上游信息
            try {
                const upstream = await this.git.raw(['config', '--get', `branch.${branchName}.merge`]);
                if (upstream && upstream.trim()) {
                    const upstreamBranch = upstream.trim().replace('refs/heads/', '');
                    if (upstreamBranch !== branchName) {
                        parents.push(this.getBranchDisplayName(upstreamBranch));
                    }
                }
            } catch (error) {
                // 没有配置上游分支，继续尝试其他方法
            }

            // 如果没有找到父分支，尝试使用 merge-base 查找最近的共同祖先
            if (parents.length === 0) {
                const allBranches = await this.git.branch(['-a']);
                const candidates: Array<{ name: string; distance: number }> = [];

                for (const [name] of Object.entries(allBranches.branches)) {
                    if (name === branchName) {
                        continue;
                    }

                    try {
                        // 获取共同祖先
                        const mergeBase = await this.git.raw(['merge-base', branchName, name]);
                        const branchCommit = await this.git.revparse([name]);
                        
                        // 如果 merge-base 等于 name 的 commit，说明 name 可能是父分支
                        if (mergeBase.trim() === branchCommit.trim()) {
                            // 计算距离（当前分支比该分支多多少提交）
                            const distance = await this.getCommitDistance(mergeBase.trim(), branchName);
                            candidates.push({ 
                                name: this.getBranchDisplayName(name), 
                                distance 
                            });
                        }
                    } catch (error) {
                        // 忽略错误，继续检查下一个分支
                    }
                }

                // 排序并只保留距离最近的几个分支
                candidates.sort((a, b) => a.distance - b.distance);
                parents.push(...candidates.slice(0, 3).map(c => c.name));
            }

            return parents;
        } catch (error) {
            console.error(`获取分支 ${branchName} 的父分支失败:`, error);
            return [];
        }
    }

    /**
     * 获取两个提交之间的距离
     */
    private async getCommitDistance(fromCommit: string, toBranch: string): Promise<number> {
        if (!this.git) {
            return 0;
        }

        try {
            const result = await this.git.raw(['rev-list', '--count', `${fromCommit}..${toBranch}`]);
            return parseInt(result.trim()) || 0;
        } catch (error) {
            return 0;
        }
    }

    /**
     * 检出分支
     */
    public async checkoutBranch(branchName: string): Promise<void> {
        if (!this.git) {
            throw new Error('未在 Git 仓库中');
        }

        try {
            await this.git.checkout(branchName);
            this._onDidChangeData.fire();
            vscode.window.showInformationMessage(`已切换到分支: ${branchName}`);
        } catch (error) {
            vscode.window.showErrorMessage(`切换分支失败: ${error}`);
            throw error;
        }
    }

    /**
     * 创建新分支
     */
    public async createBranch(branchName: string, baseBranch?: string): Promise<void> {
        if (!this.git) {
            throw new Error('未在 Git 仓库中');
        }

        try {
            if (baseBranch) {
                await this.git.checkoutBranch(branchName, baseBranch);
            } else {
                await this.git.checkoutLocalBranch(branchName);
            }
            this._onDidChangeData.fire();
            vscode.window.showInformationMessage(`已创建并切换到新分支: ${branchName}`);
        } catch (error) {
            vscode.window.showErrorMessage(`创建分支失败: ${error}`);
            throw error;
        }
    }

    /**
     * 删除分支
     */
    public async deleteBranch(branchName: string, force: boolean = false): Promise<void> {
        if (!this.git) {
            throw new Error('未在 Git 仓库中');
        }

        try {
            const deleteFlag = force ? '-D' : '-d';
            await this.git.branch([deleteFlag, branchName]);
            this._onDidChangeData.fire();
            vscode.window.showInformationMessage(`已删除分支: ${branchName}`);
        } catch (error) {
            vscode.window.showErrorMessage(`删除分支失败: ${error}`);
            throw error;
        }
    }

    /**
     * 关联分支到 Issue
     */
    public async associateBranchToIssue(branchName: string, issueId: string): Promise<void> {
        this.branchAssociations.set(branchName, issueId);
        await this.saveAssociations();
        this._onDidChangeData.fire();
    }

    /**
     * 取消分支与 Issue 的关联
     */
    public async disassociateBranch(branchName: string): Promise<void> {
        this.branchAssociations.delete(branchName);
        await this.saveAssociations();
        this._onDidChangeData.fire();
    }

    /**
     * 获取分支关联的 Issue ID
     */
    public getAssociatedIssueId(branchName: string): string | undefined {
        return this.branchAssociations.get(branchName);
    }

    /**
     * 加载分支关联数据
     */
    private loadAssociations(): void {
        const data = this.context.globalState.get<Record<string, string>>('gitBranchAssociations', {});
        this.branchAssociations = new Map(Object.entries(data));
    }

    /**
     * 保存分支关联数据
     */
    private async saveAssociations(): Promise<void> {
        const data = Object.fromEntries(this.branchAssociations);
        await this.context.globalState.update('gitBranchAssociations', data);
    }

    /**
     * 刷新数据
     */
    public refresh(): void {
        this._onDidChangeData.fire();
    }

    /**
     * 获取按提交分组的分支
     * 用于处理多个分支指向同一个 commit 的情况
     */
    public async getBranchesByCommit(): Promise<Map<string, GitBranchInfo[]>> {
        const branches = await this.getAllBranches();
        const commitMap = new Map<string, GitBranchInfo[]>();

        for (const branch of branches) {
            const existing = commitMap.get(branch.commit) || [];
            existing.push(branch);
            commitMap.set(branch.commit, existing);
        }

        return commitMap;
    }
}
