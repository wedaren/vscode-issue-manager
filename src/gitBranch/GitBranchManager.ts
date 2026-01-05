import * as vscode from 'vscode';
import simpleGit, { SimpleGit } from 'simple-git';

export interface BranchEntry {
    name: string; // 完整 ref 名称，如 master 或 origin/main
    isRemote: boolean;
    commitHash: string;
    commitTime: number; // ms
    isHead?: boolean;
    /** 可选：关联的问题 ID */
    associatedIssueId?: string;
}

/**
 * Git 分支管理器：负责读取仓库分支、commit 信息并提供缓存与刷新通知
 */
export class GitBranchManager {
    private git: SimpleGit;
    private repoPath: string;
    private data: BranchEntry[] = [];
    private _onDidChangeData = new vscode.EventEmitter<void>();
    readonly onDidChangeData = this._onDidChangeData.event;
    private context: vscode.ExtensionContext;
    // branchName -> issueId
    private associations: Record<string, string> = {};

    constructor(context: vscode.ExtensionContext, repoPath?: string) {
        this.context = context;
        this.repoPath = repoPath || vscode.workspace.rootPath || '.';
        this.git = simpleGit(this.repoPath);
        this.loadAssociations();
    }

    async refresh(): Promise<void> {
        try {
            // 使用 for-each-ref 获取本地与远程 refs 的完整 refname、短名、commit 与日期
            // 这样我们可以精确判断某个 ref 是否属于 refs/remotes/*（远程），而不是仅凭短名中是否有 '/'。
            const fmt = '%(refname)%00%(refname:short)%00%(objectname)%00%(committerdate:unix)';
            const raw = await this.git.raw([
                'for-each-ref', `--format=${fmt}`, 'refs/heads', 'refs/remotes'
            ]);

            const lines = raw.split(/\r?\n/).filter(l => l.trim());
            const items: BranchEntry[] = [];

            for (const line of lines) {
                const parts = line.split('\0');
                if (parts.length < 4) { continue; }
                const fullRef = parts[0]; // e.g. refs/heads/feature/x or refs/remotes/origin/main
                const shortName = parts[1]; // e.g. feature/x or origin/main
                const hash = parts[2];
                const unix = parseInt(parts[3], 10) * 1000;
                const isRemote = fullRef.startsWith('refs/remotes/');

                items.push({ name: shortName, isRemote, commitHash: hash, commitTime: isNaN(unix) ? Date.now() : unix });
            }

            // 找到 HEAD 指向的分支名（如果存在）
            try {
                const head = await this.git.raw(['symbolic-ref', '-q', '--short', 'HEAD']);
                const headName = head.trim();
                if (headName) {
                    for (const it of items) {
                        if (it.name === headName) {
                            it.isHead = true;
                        }
                    }
                }
            } catch (e) {
                // detached HEAD 或无 HEAD，不处理
            }

            this.data = items;
            // 恢复之前保存的关联信息
            for (const it of this.data) {
                const assoc = this.associations[it.name];
                if (assoc) {
                    it.associatedIssueId = assoc;
                }
            }
            // 也为新读取的 items 恢复关联
            for (const it of this.data) {
                // noop (already applied)
            }
            // 如果 items 刚生成，确保也将 associations 应用
            for (const it of items) {
                const assoc = this.associations[it.name];
                if (assoc) {
                    it.associatedIssueId = assoc;
                }
            }
            this.data = items;
            this._onDidChangeData.fire();
        } catch (error) {
            console.error('GitBranchManager refresh error:', error);
        }
    }

    private makeAssociationsKey(): string {
        return `gitBranch.associations:${this.repoPath}`;
    }

    private loadAssociations(): void {
        try {
            const key = this.makeAssociationsKey();
            const raw = this.context.globalState.get<Record<string, string>>(key, {});
            this.associations = raw || {};
        } catch (e) {
            this.associations = {};
        }
    }

    private async saveAssociations(): Promise<void> {
        try {
            const key = this.makeAssociationsKey();
            await this.context.globalState.update(key, this.associations);
        } catch (e) {
            console.error('保存 Git 分支关联失败', e);
        }
    }

    getBranches(): BranchEntry[] {
        return this.data.slice();
    }

    /**
     * 根据 commit hash 返回指向相同 commit 的所有分支名
     */
    getBranchesByCommit(hash: string): string[] {
        return this.data.filter(b => b.commitHash === hash).map(b => b.name);
    }

    /**
     * 获取指定分支对应的父分支（简单启发式：查找 parent commit 与其它分支的 commit 相等的分支）
     */
    async getParentBranches(entry: BranchEntry): Promise<BranchEntry[]> {
        try {
            // 获取 parent commit hash
            const parent = await this.git.raw(['rev-parse', `${entry.commitHash}^`]);
            const parentHash = parent.trim();
            if (!parentHash) { return []; }

            const parents = this.data.filter(b => b.commitHash === parentHash);
            return parents;
        } catch (e) {
            return [];
        }
    }

    /** 删除本地分支 */
    async deleteLocalBranch(name: string, force = false): Promise<void> {
        try {
            await this.git.deleteLocalBranch(name, force);
            await this.refresh();
        } catch (e) {
            throw e;
        }
    }

    /** 删除远程分支（默认 origin） */
    async deleteRemoteBranch(name: string, remote = 'origin'): Promise<void> {
        try {
            // git push origin --delete <branch>
            await this.git.raw(['push', remote, '--delete', name]);
            await this.refresh();
        } catch (e) {
            throw e;
        }
    }

    /** 检出分支 */
    async checkout(name: string): Promise<void> {
        await this.git.checkout(name);
        await this.refresh();
    }

    /** 基于指定分支新建分支 */
    async createBranchFrom(base: string, newBranch: string): Promise<void> {
        await this.git.checkoutBranch(newBranch, base);
        await this.refresh();
    }

    /** 将分支与 issueId 关联并持久化 */
    async setAssociation(branchName: string, issueId: string | undefined): Promise<void> {
        if (!branchName) { return; }
        if (issueId) {
            this.associations[branchName] = issueId;
        } else {
            delete this.associations[branchName];
        }
        await this.saveAssociations();
        // 更新内存对象（如果已加载）
        for (const b of this.data) {
            if (b.name === branchName) {
                b.associatedIssueId = issueId;
            }
        }
        this._onDidChangeData.fire();
    }

    getAssociation(branchName: string): string | undefined {
        return this.associations[branchName];
    }
}

export default GitBranchManager;
