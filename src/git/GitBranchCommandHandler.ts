import * as vscode from 'vscode';
import { GitBranchManager, GitBranchInfo } from './GitBranchManager';
import { GitBranchTreeProvider } from './GitBranchTreeProvider';
import { quickCreateIssue } from '../commands/quickCreateIssue';
import * as path from 'path';
import { getIssueDir } from '../config';

/**
 * Git 分支命令处理器
 * 负责处理所有与 Git 分支相关的命令
 */
export class GitBranchCommandHandler {
    constructor(
        private context: vscode.ExtensionContext,
        private branchManager: GitBranchManager,
        private treeProvider: GitBranchTreeProvider
    ) {}

    /**
     * 注册所有命令
     */
    public registerCommands(): void {
        // 刷新命令
        this.context.subscriptions.push(
            vscode.commands.registerCommand('issueManager.gitBranch.refresh', async () => {
                await this.refresh();
            })
        );

        // 检出分支命令
        this.context.subscriptions.push(
            vscode.commands.registerCommand('issueManager.gitBranch.checkout', async (branchInfo: GitBranchInfo) => {
                await this.checkoutBranch(branchInfo);
            })
        );

        // 创建分支命令
        this.context.subscriptions.push(
            vscode.commands.registerCommand('issueManager.gitBranch.create', async (branchInfo?: GitBranchInfo) => {
                await this.createBranch(branchInfo);
            })
        );

        // 删除分支命令
        this.context.subscriptions.push(
            vscode.commands.registerCommand('issueManager.gitBranch.delete', async (branchInfo: GitBranchInfo) => {
                await this.deleteBranch(branchInfo);
            })
        );

        // 关联 Issue 命令
        this.context.subscriptions.push(
            vscode.commands.registerCommand('issueManager.gitBranch.associateIssue', async (branchInfo: GitBranchInfo) => {
                await this.associateIssue(branchInfo);
            })
        );

        // 取消关联命令
        this.context.subscriptions.push(
            vscode.commands.registerCommand('issueManager.gitBranch.disassociate', async (branchInfo: GitBranchInfo) => {
                await this.disassociateIssue(branchInfo);
            })
        );

        // 打开关联的 Issue 命令
        this.context.subscriptions.push(
            vscode.commands.registerCommand('issueManager.gitBranch.openAssociatedIssue', async (issueId: string) => {
                await this.openAssociatedIssue(issueId);
            })
        );
    }

    /**
     * 刷新视图
     */
    private async refresh(): Promise<void> {
        this.branchManager.refresh();
        this.treeProvider.refresh();
        vscode.window.showInformationMessage('Git 分支视图已刷新');
    }

    /**
     * 检出分支
     */
    private async checkoutBranch(branchInfo: GitBranchInfo): Promise<void> {
        if (!branchInfo) {
            return;
        }

        try {
            await this.branchManager.checkoutBranch(branchInfo.fullName);
        } catch (error) {
            // 错误已经在 manager 中处理
        }
    }

    /**
     * 创建分支
     */
    private async createBranch(baseBranchInfo?: GitBranchInfo): Promise<void> {
        // 询问分支名称
        const branchName = await vscode.window.showInputBox({
            prompt: '请输入新分支名称',
            validateInput: (value) => {
                if (!value || value.trim() === '') {
                    return '分支名称不能为空';
                }
                if (!/^[a-zA-Z0-9/_-]+$/.test(value)) {
                    return '分支名称只能包含字母、数字、下划线、斜杠和连字符';
                }
                return undefined;
            }
        });

        if (!branchName) {
            return;
        }

        try {
            const baseBranch = baseBranchInfo?.fullName;
            await this.branchManager.createBranch(branchName, baseBranch);
        } catch (error) {
            // 错误已经在 manager 中处理
        }
    }

    /**
     * 删除分支
     */
    private async deleteBranch(branchInfo: GitBranchInfo): Promise<void> {
        if (!branchInfo) {
            return;
        }

        if (branchInfo.isCurrent) {
            vscode.window.showErrorMessage('不能删除当前分支');
            return;
        }

        // 确认删除
        const result = await vscode.window.showWarningMessage(
            `确定要删除分支 "${branchInfo.name}" 吗？`,
            { modal: true },
            '删除',
            '强制删除'
        );

        if (!result) {
            return;
        }

        try {
            const force = result === '强制删除';
            await this.branchManager.deleteBranch(branchInfo.fullName, force);
        } catch (error) {
            // 错误已经在 manager 中处理
        }
    }

    /**
     * 关联 Issue
     */
    private async associateIssue(branchInfo: GitBranchInfo): Promise<void> {
        if (!branchInfo) {
            return;
        }

        // 使用快速创建 Issue 功能
        const issueId = await quickCreateIssue();
        if (!issueId) {
            return;
        }

        try {
            await this.branchManager.associateBranchToIssue(branchInfo.fullName, issueId);
            vscode.window.showInformationMessage(`分支 "${branchInfo.name}" 已关联到 Issue: ${issueId}`);
        } catch (error) {
            vscode.window.showErrorMessage(`关联 Issue 失败: ${error}`);
        }
    }

    /**
     * 取消关联 Issue
     */
    private async disassociateIssue(branchInfo: GitBranchInfo): Promise<void> {
        if (!branchInfo || !branchInfo.associatedIssueId) {
            return;
        }

        const result = await vscode.window.showWarningMessage(
            `确定要取消分支 "${branchInfo.name}" 与 Issue "${branchInfo.associatedIssueId}" 的关联吗？`,
            { modal: true },
            '确定'
        );

        if (result === '确定') {
            try {
                await this.branchManager.disassociateBranch(branchInfo.fullName);
                vscode.window.showInformationMessage(`已取消关联`);
            } catch (error) {
                vscode.window.showErrorMessage(`取消关联失败: ${error}`);
            }
        }
    }

    /**
     * 打开关联的 Issue
     */
    private async openAssociatedIssue(issueId: string): Promise<void> {
        if (!issueId) {
            return;
        }

        try {
            const issueDir = getIssueDir();
            if (!issueDir) {
                vscode.window.showErrorMessage('未配置 Issue 目录');
                return;
            }

            // 构建 Issue 文件路径
            const issuePath = path.join(issueDir, `${issueId}.md`);
            const uri = vscode.Uri.file(issuePath);

            // 打开文件
            await vscode.window.showTextDocument(uri, { preview: false });
        } catch (error) {
            vscode.window.showErrorMessage(`打开 Issue 失败: ${error}`);
        }
    }
}
