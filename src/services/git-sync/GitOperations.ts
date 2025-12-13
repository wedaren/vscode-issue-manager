import * as fs from 'fs';
import * as path from 'path';
import { simpleGit, SimpleGit, SimpleGitOptions } from 'simple-git';
import { getAutoCommitMessage } from '../../config';

/**
 * Git操作封装类
 * 
 * 提供底层Git操作的封装，包括：
 * - 检查Git仓库状态
 * - 拉取远程更改
 * - 检查本地更改和冲突
 * - 提交并推送更改
 * - 测试Git连接性
 * 
 * 所有Git操作都通过simple-git库执行，统一错误处理。
 */
export class GitOperations {
    /**
     * 检查目录是否为Git仓库
     * 
     * @param dir 要检查的目录路径
     * @returns 如果目录包含.git文件夹则返回true
     */
    public static isGitRepository(dir: string): boolean {
        return fs.existsSync(path.join(dir, '.git'));
    }

    /**
     * 创建SimpleGit实例
     * 
     * @param cwd Git操作的工作目录
     * @returns 配置好的SimpleGit实例
     */
    private static getGit(cwd: string): SimpleGit {
        const options: Partial<SimpleGitOptions> = {
            baseDir: cwd,
            binary: 'git',
            maxConcurrentProcesses: 1,
        };
        return simpleGit(options);
    }

    /**
     * 从远程仓库拉取更改
     * 
     * 执行以下操作：
     * 1. 检查当前分支
     * 2. 获取远程分支状态
     * 3. 使用merge模式拉取当前分支的更新
     * 
     * @param cwd Git仓库目录
     * @returns 如果有更新被拉取则返回true，否则返回false
     * @throws 如果拉取失败则抛出错误
     */
    public static async pullChanges(cwd: string): Promise<boolean> {
        const git = this.getGit(cwd);
        try {
            // 先检查当前分支
            const branchSummary = await git.branch();
            const currentBranch = branchSummary.current;
            
            if (!currentBranch) {
                throw new Error('无法确定当前 Git 分支');
            }
            
            // 获取远程分支状态
            await git.fetch('origin');
            
            // 拉取当前分支的更新，使用merge而非rebase避免复杂情况
            const pullResult = await git.pull('origin', currentBranch, { '--no-rebase': null });

            // 判断是否有实际的更新：检查文件变更数量或摘要中的变更数
            // 对 pullResult 做防御性检查，避免某些 simple-git 版本下字段为 undefined
            const filesChanged = Array.isArray((pullResult as any).files) && (pullResult as any).files.length > 0;
            const summary = (pullResult as any).summary;
            const summaryChanges = summary && typeof summary.changes === 'number' ? summary.changes > 0 : false;
            return filesChanged || summaryChanges;
        } catch (error) {
            this.handleGitError(error, '拉取远程更改失败');
        }
    }

    /**
     * 检查是否有本地更改
     * 
     * @param cwd Git仓库目录
     * @returns 如果有未提交的本地更改则返回true
     */
    public static async hasLocalChanges(cwd: string): Promise<boolean> {
        const git = this.getGit(cwd);
        const status = await git.status();
        return !status.isClean();
    }

    /**
     * 检查是否有合并冲突
     * 
     * @param cwd Git仓库目录
     * @returns 如果存在合并冲突则返回true
     */
    public static async hasConflicts(cwd: string): Promise<boolean> {
        const git = this.getGit(cwd);
        const status = await git.status();
        return status.conflicted.length > 0;
    }

    /**
     * 提交并推送更改
     * 
     * 执行以下操作：
     * 1. 添加所有更改到暂存区
     * 2. 使用自动生成的提交消息提交
     * 3. 推送到远程仓库的当前分支
     * 
     * @param cwd Git仓库目录
     * @throws 如果提交或推送失败则抛出错误
     */
    public static async commitAndPushChanges(cwd: string): Promise<void> {
        const git = this.getGit(cwd);
        
        try {
            // 添加所有更改
            await git.add('.');
            
            // 生成提交消息
            const template = getAutoCommitMessage();
            const commitMessage = template.replace('{date}', new Date().toISOString());  
            
            // 提交
            await git.commit(commitMessage);
            
            // 获取当前分支并推送
            const branchSummary = await git.branch();
            const currentBranch = branchSummary.current;
            
            if (!currentBranch) {
                throw new Error('无法确定当前 Git 分支');
            }
            
            await git.push('origin', currentBranch);
        } catch (error) {
            this.handleGitError(error, '提交并推送更改失败');
        }
    }

    /**
     * 测试Git连接性
     * 
     * 通过尝试列出远程分支来测试与远程仓库的连接性。
     * 用于诊断网络连接问题。
     * 
     * @param cwd Git仓库目录
     * @returns 如果连接正常则返回true，否则返回false
     */
    public static async testGitConnectivity(cwd: string): Promise<boolean> {
        try {
            const git = this.getGit(cwd);
            // 尝试简单的远程操作来测试连接性
            await git.listRemote(['--heads', 'origin']);
            return true;
        } catch (error) {
            console.log('Git connectivity test failed:', error);
            return false;
        }
    }

    /**
     * 增强Git操作的错误信息并重新抛出
     * @param error 捕获到的原始错误
     * @param prefix 错误消息前缀
     */
    private static handleGitError(error: unknown, prefix: string): never {
        if (error instanceof Error) {
            const enhancedError = new Error(`${prefix}: ${error.message}`);
            enhancedError.stack = error.stack;
            throw enhancedError;
        }
        throw error;
    }
}
