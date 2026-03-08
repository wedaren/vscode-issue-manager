import * as fs from 'fs';
import * as path from 'path';
import { simpleGit, SimpleGit, SimpleGitOptions } from 'simple-git';
import { getAutoCommitMessage } from '../../config';
import { Logger } from '../../core/utils/Logger';

/**
 * Git操作封装类
 *
 * 同步策略: commit → pull → push（先保存本地变更，再合并远程，最后推送）
 *
 * 优化：
 * - 缓存 SimpleGit 实例，避免重复创建
 * - 缓存当前分支名，减少 git branch 查询
 * - push 被拒绝时自动 pull + retry
 * - 网络不可用时先做本地 commit 保障数据安全
 * - LLM 生成语义化提交消息（带超时）
 */
export class GitOperations {
    // 缓存 SimpleGit 实例（按工作目录）
    private static gitInstances = new Map<string, SimpleGit>();
    // 缓存当前分支名（按工作目录），减少 git branch 查询
    private static branchCache = new Map<string, { branch: string; timestamp: number }>();
    private static readonly BRANCH_CACHE_TTL = 60_000; // 1分钟缓存
    private static readonly LLM_TIMEOUT_MS = 5_000; // LLM 生成提交消息的超时时间
    private static readonly TRACKED_PATTERNS = ['*.md', '.issueManager'];

    // LLM 提交消息生成器（外部注入，避免直接依赖 LLMService 导致循环引用）
    private static commitMessageGenerator: ((changedFiles: string[]) => Promise<string>) | null = null;

    /**
     * 注册 LLM 提交消息生成器
     */
    public static setCommitMessageGenerator(
        generator: ((changedFiles: string[]) => Promise<string>) | null
    ): void {
        this.commitMessageGenerator = generator;
    }

    /**
     * 检查目录是否为Git仓库
     */
    public static isGitRepository(dir: string): boolean {
        return fs.existsSync(path.join(dir, '.git'));
    }

    /**
     * 获取或创建 SimpleGit 实例（缓存）
     */
    private static getGit(cwd: string): SimpleGit {
        const cached = this.gitInstances.get(cwd);
        if (cached) {
            return cached;
        }

        const options: Partial<SimpleGitOptions> = {
            baseDir: cwd,
            binary: 'git',
            maxConcurrentProcesses: 1,
        };
        const git = simpleGit(options);
        this.gitInstances.set(cwd, git);
        return git;
    }

    /**
     * 获取当前分支名（带缓存）
     */
    private static async getCurrentBranch(git: SimpleGit, cwd: string): Promise<string> {
        const cached = this.branchCache.get(cwd);
        if (cached && Date.now() - cached.timestamp < this.BRANCH_CACHE_TTL) {
            return cached.branch;
        }

        const branchSummary = await git.branch();
        const currentBranch = branchSummary.current;

        if (!currentBranch) {
            throw new Error('无法确定当前 Git 分支');
        }

        this.branchCache.set(cwd, { branch: currentBranch, timestamp: Date.now() });
        return currentBranch;
    }

    /**
     * 使分支缓存失效
     */
    public static invalidateBranchCache(cwd?: string): void {
        if (cwd) {
            this.branchCache.delete(cwd);
        } else {
            this.branchCache.clear();
        }
    }

    /**
     * 从远程仓库拉取更改
     *
     * @param cwd Git仓库目录
     * @returns 如果有更新被拉取则返回true，否则返回false
     * @throws 如果拉取失败则抛出错误
     */
    public static async pullChanges(cwd: string): Promise<boolean> {
        const git = this.getGit(cwd);
        try {
            const currentBranch = await this.getCurrentBranch(git, cwd);

            await git.fetch('origin');
            const pullResult = await git.pull('origin', currentBranch, { '--no-rebase': null });

            const filesChanged = (pullResult.files?.length ?? 0) > 0;
            const summaryChanges = (pullResult.summary?.changes ?? 0) > 0;
            return filesChanged || summaryChanges;
        } catch (error) {
            this.invalidateBranchCache(cwd);
            this.handleGitError(error, '拉取远程更改失败');
        }
    }

    /**
     * 检查是否有本地更改
     */
    public static async hasLocalChanges(cwd: string): Promise<boolean> {
        const git = this.getGit(cwd);
        const status = await git.status();
        return !status.isClean();
    }

    /**
     * 检查是否有合并冲突
     */
    public static async hasConflicts(cwd: string): Promise<boolean> {
        const git = this.getGit(cwd);
        const status = await git.status();
        return status.conflicted.length > 0;
    }

    /**
     * 仅执行本地提交（不推送）
     *
     * 当网络不可用时调用，确保本地变更至少被 commit 保存。
     * 推送会在下次网络恢复时由 performAutoCommitAndPush 或周期性拉取补做。
     *
     * @returns 如果有变更被提交则返回true
     */
    public static async commitLocalChanges(cwd: string): Promise<boolean> {
        const git = this.getGit(cwd);

        try {
            if (!(await this.hasLocalChanges(cwd))) {
                return false;
            }

            const changedFiles = await this.getChangedFilesSummary(git);
            await git.add(this.TRACKED_PATTERNS);
            const commitMessage = await this.generateCommitMessage(changedFiles);
            await git.commit(commitMessage);
            Logger.getInstance().info('[GitOperations] 本地提交完成（网络不可用，推送将延迟）');
            return true;
        } catch (error) {
            Logger.getInstance().warn('[GitOperations] 本地提交失败', error);
            return false;
        }
    }

    /**
     * 判断文件路径是否匹配 TRACKED_PATTERNS（*.md 或 .issueManager/**）
     */
    private static isTrackedFile(filePath: string): boolean {
        return filePath.endsWith('.md') || filePath.startsWith('.issueManager');
    }

    /**
     * 获取变更文件的详细信息（用于 LLM 生成提交消息）
     *
     * 仅包含匹配 TRACKED_PATTERNS 的文件，确保与 git add 范围一致。
     */
    private static async getChangedFilesSummary(git: SimpleGit): Promise<string[]> {
        const status = await git.status();
        const files: string[] = [];

        for (const f of status.created) {
            if (this.isTrackedFile(f)) { files.push(`新增: ${f}`); }
        }
        for (const f of status.modified) {
            if (this.isTrackedFile(f)) { files.push(`修改: ${f}`); }
        }
        for (const f of status.deleted) {
            if (this.isTrackedFile(f)) { files.push(`删除: ${f}`); }
        }
        for (const f of status.renamed) {
            if (this.isTrackedFile(f.to)) { files.push(`重命名: ${f.from} -> ${f.to}`); }
        }
        for (const f of status.not_added) {
            if (this.isTrackedFile(f)) { files.push(`新增: ${f}`); }
        }

        return files;
    }

    /**
     * 生成提交消息
     *
     * 优先使用 LLM 生成语义化消息（5秒超时），失败时回退到模板消息。
     */
    private static async generateCommitMessage(changedFiles: string[]): Promise<string> {
        if (this.commitMessageGenerator && changedFiles.length > 0) {
            try {
                const llmMessage = await Promise.race([
                    this.commitMessageGenerator(changedFiles),
                    new Promise<string>((_, reject) =>
                        setTimeout(() => reject(new Error('LLM 超时')), this.LLM_TIMEOUT_MS)
                    )
                ]);
                if (llmMessage && llmMessage.trim().length > 0) {
                    Logger.getInstance().info(`[GitOperations] LLM 生成提交消息: ${llmMessage.trim()}`);
                    return llmMessage.trim();
                }
            } catch (error) {
                Logger.getInstance().warn('[GitOperations] LLM 生成提交消息失败或超时，回退到模板', error);
            }
        }

        const template = getAutoCommitMessage();
        return template.replace('{date}', new Date().toISOString());
    }

    /**
     * 检测是否为 push 被远程拒绝的错误（远程有新 commit）
     */
    private static isPushRejectedError(error: unknown): boolean {
        if (!(error instanceof Error)) {
            return false;
        }
        const msg = error.message.toLowerCase();
        return msg.includes('rejected') ||
               msg.includes('failed to push') ||
               msg.includes('non-fast-forward') ||
               msg.includes('fetch first') ||
               msg.includes('stale info');
    }

    /**
     * 检测是否为网络相关错误
     */
    private static isNetworkError(error: unknown): boolean {
        if (!(error instanceof Error)) {
            return false;
        }
        const msg = error.message.toLowerCase();
        return msg.includes('network') ||
               msg.includes('connection') ||
               msg.includes('econnreset') ||
               msg.includes('econnrefused') ||
               msg.includes('timeout') ||
               msg.includes('ssh: connect') ||
               msg.includes('could not read from remote') ||
               msg.includes('unable to access');
    }

    /**
     * 提交并推送更改（安全策略: commit → pull → push）
     *
     * 执行流程：
     * 1. 收集变更文件信息并生成提交消息
     * 2. git add + commit（先保存本地变更）
     * 3. git pull --no-rebase（合并远程更新）
     * 4. git push（推送到远程）
     * 5. 如果 push 被拒绝（远程有新 commit），自动 pull + push 重试一次
     * 6. 如果网络不可用，本地 commit 已完成，不会丢数据
     *
     * @param cwd Git仓库目录
     * @throws 如果提交或推送失败则抛出错误
     */
    public static async commitAndPushChanges(cwd: string): Promise<void> {
        const git = this.getGit(cwd);

        try {
            // 1. 收集变更信息（add 之前，以便区分 not_added 等状态）
            const changedFiles = await this.getChangedFilesSummary(git);

            // 2. 先 commit 本地变更（确保数据安全）
            await git.add(this.TRACKED_PATTERNS);
            const commitMessage = await this.generateCommitMessage(changedFiles);
            await git.commit(commitMessage);

            // 3. pull 合并远程更新
            const currentBranch = await this.getCurrentBranch(git, cwd);
            try {
                await git.pull('origin', currentBranch, { '--no-rebase': null });
            } catch (pullError) {
                // 网络错误: 本地 commit 已完成，push 延迟到下次
                if (this.isNetworkError(pullError)) {
                    Logger.getInstance().warn('[GitOperations] pull 网络错误，本地已提交，推送延迟');
                    throw pullError;
                }
                // 其他 pull 错误（如冲突）直接抛出
                throw pullError;
            }

            // 4. push 到远程
            try {
                await git.push('origin', currentBranch);
            } catch (pushError) {
                // push 被拒绝（远程又有新 commit）：pull + push 重试一次
                if (this.isPushRejectedError(pushError)) {
                    Logger.getInstance().info('[GitOperations] push 被拒绝，执行 pull + push 重试');
                    this.invalidateBranchCache(cwd);
                    const retryBranch = await this.getCurrentBranch(git, cwd);
                    await git.pull('origin', retryBranch, { '--no-rebase': null });
                    await git.push('origin', retryBranch);
                    return;
                }
                // 网络错误: 本地 commit 已完成
                if (this.isNetworkError(pushError)) {
                    Logger.getInstance().warn('[GitOperations] push 网络错误，本地已提交，推送延迟');
                }
                this.invalidateBranchCache(cwd);
                throw pushError;
            }
        } catch (error) {
            this.handleGitError(error, '提交并推送更改失败');
        }
    }

    /**
     * 测试Git连接性
     */
    public static async testGitConnectivity(cwd: string): Promise<boolean> {
        try {
            const git = this.getGit(cwd);
            await git.listRemote(['--heads', 'origin']);
            return true;
        } catch (error) {
            Logger.getInstance().warn('Git connectivity test failed:', error);
            return false;
        }
    }

    /**
     * 清理缓存（在服务停止时调用）
     */
    public static cleanup(): void {
        this.gitInstances.clear();
        this.branchCache.clear();
        this.commitMessageGenerator = null;
    }

    /**
     * 增强Git操作的错误信息并重新抛出
     */
    private static handleGitError(error: unknown, prefix: string): never {
        if (error instanceof Error) {
            // 如果已经有前缀，不重复添加
            if (error.message.startsWith(prefix)) {
                throw error;
            }
            const enhancedError = new Error(`${prefix}: ${error.message}`);
            enhancedError.stack = error.stack;
            throw enhancedError;
        }
        throw error;
    }
}
