import * as vscode from 'vscode';
import GitBranchManager from './GitBranchManager';
import { GitBranchTreeProvider } from './GitBranchTreeProvider';
import { selectOrCreateIssue } from '../commands/selectOrCreateIssue';

export class GitBranchCommandHandler {
    constructor(private manager: GitBranchManager, private treeProvider: GitBranchTreeProvider) {}

    registerCommands(context: vscode.ExtensionContext) {
        // 刷新
        context.subscriptions.push(
            vscode.commands.registerCommand('issueManager.gitBranch.refresh', async () => {
                await this.manager.refresh();
                this.treeProvider.refresh();
            })
        );

        // checkout
        context.subscriptions.push(
            vscode.commands.registerCommand('issueManager.gitBranch.checkout', async (item) => {
                if (!item || !item.entry) return;
                try {
                    await this.manager.checkout(item.entry.name);
                    vscode.window.showInformationMessage(`已检出分支 ${item.entry.name}`);
                } catch (e) {
                    vscode.window.showErrorMessage(`检出失败: ${e}`);
                }
            })
        );

        // create new branch from
        context.subscriptions.push(
            vscode.commands.registerCommand('issueManager.gitBranch.createBranchFrom', async (item) => {
                if (!item || !item.entry) return;
                const base = item.entry.name;
                const newName = await vscode.window.showInputBox({ prompt: `基于 ${base} 创建新分支，输入分支名` });
                if (!newName) return;
                try {
                    await this.manager.createBranchFrom(base, newName);
                    vscode.window.showInformationMessage(`已创建分支 ${newName} -> 基于 ${base}`);
                } catch (e) {
                    vscode.window.showErrorMessage(`创建分支失败: ${e}`);
                }
            })
        );

        // delete branch
        context.subscriptions.push(
            vscode.commands.registerCommand('issueManager.gitBranch.delete', async (item) => {
                if (!item || !item.entry) return;
                const name = item.entry.name;
                const isRemote = item.entry.isRemote;
                const confirm = await vscode.window.showWarningMessage(
                    `确定要删除分支 ${name} ?`, { modal: true }, '删除'
                );
                if (confirm !== '删除') return;

                try {
                    if (isRemote) {
                        // remote name may be like origin/branch, extract branch
                        const parts = name.split('/');
                        const branchOnly = parts.slice(1).join('/');
                        await this.manager.deleteRemoteBranch(branchOnly, parts[0] || 'origin');
                        vscode.window.showInformationMessage(`已删除远程分支 ${name}`);
                    } else {
                        await this.manager.deleteLocalBranch(name, true);
                        vscode.window.showInformationMessage(`已删除本地分支 ${name}`);
                    }
                } catch (e) {
                    vscode.window.showErrorMessage(`删除分支失败: ${e}`);
                }
            })
        );

        // 关联 Issue（参考 MarkerCommandHandler 的实现）
        context.subscriptions.push(
            vscode.commands.registerCommand('issueManager.gitBranch.associateIssue', async (item) => {
                if (!item || !item.entry) return;
                // 通过已注册的命令创建/选择 Issue（可能返回 issueId）
                try {
                    const issueId = await selectOrCreateIssue();
                    if (issueId) {
                        // 持久化关联到 manager
                        try {
                            await this.manager.setAssociation(item.entry.name, issueId);
                        } catch (e) {
                        }
                        this.treeProvider.refresh();
                        vscode.window.showInformationMessage(`已将分支 ${item.entry.name} 关联到问题 ${issueId}`);
                    }
                } catch (e) {
                    // 忽略或提示错误
                    vscode.window.showErrorMessage(`关联问题失败: ${e}`);
                }
            })
        );

        // 打开 Issue（参考 MarkerCommandHandler 的实现）
        context.subscriptions.push(
            vscode.commands.registerCommand('issueManager.gitBranch.openIssue', async (item) => {
                if (!item || !item.entry) return;
                const issueId = (item.entry as any).associatedIssueId;
                if (issueId) {
                    await vscode.commands.executeCommand('issueManager.openIssueBesideEditor', issueId);
                } else {
                    vscode.window.showWarningMessage('该分支尚未关联问题');
                }
            })
        );

        // 解除关联
        context.subscriptions.push(
            vscode.commands.registerCommand('issueManager.gitBranch.disassociate', async (item) => {
                if (!item || !item.entry) return;
                try {
                    await this.manager.setAssociation(item.entry.name, undefined);
                    this.treeProvider.refresh();
                    vscode.window.showInformationMessage(`已解除分支 ${item.entry.name} 的关联`);
                } catch (e) {
                    vscode.window.showErrorMessage(`解除关联失败: ${e}`);
                }
            })
        );
    }
}

export default GitBranchCommandHandler;
