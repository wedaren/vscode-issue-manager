import * as vscode from 'vscode';
import { getFlatTree, FlatTreeNode, getIssueNodeById } from '../data/issueTreeManager';

type QuickPickItemWithId = vscode.QuickPickItem & { id?: string; commandId?: string;};

export function registerUnifiedQuickOpenCommand(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('issueManager.unifiedQuickOpen', async () => {
            const quickPick = vscode.window.createQuickPick<QuickPickItemWithId>();
            quickPick.placeholder = "输入问题关键词搜索，或以 '>' 开头切换到命令模式";
            quickPick.matchOnDescription = true;
            quickPick.matchOnDetail = false;
            quickPick.busy = true;
            quickPick.show();

            // 加载扁平化树并展示为默认项（与 searchIssues 行为一致）
            try {
                const flatNodes = await getFlatTree();

                const issueItems: QuickPickItemWithId[] = flatNodes.map(node => {
                    let description = '';
                    if (node.parentPath && node.parentPath.length > 0) {
                        const parentTitles = node.parentPath.map(n => n.title);
                        description = ['', ...parentTitles].join(' / ');
                    }
                    return { label: node.title, description, id: node.id } as QuickPickItemWithId;
                });

                // 命令模式项
                const commandItems: QuickPickItemWithId[] = [
                    { label: '生成项目名', description: '基于活动编辑器内容生成项目名并复制', commandId: 'issueManager.generateProjectName' },
                    { label: '生成 Git 分支名', description: '基于活动编辑器内容生成 git 分支名并复制', commandId: 'issueManager.generateGitBranchName' }
                ];

                let inCommandMode = false;
                let suppressChange = false; // 忽略程序性 value 变更
                quickPick.items = issueItems;
                quickPick.busy = false;

                quickPick.onDidChangeValue(value => {
                    if (suppressChange) { suppressChange = false; return; }
                    const v = value || '';
                    if (v.startsWith('>')) {
                        if (!inCommandMode) {
                            inCommandMode = true;
                            quickPick.items = commandItems;
                            // 将输入去掉前缀以便搜索命令描述
                            suppressChange = true;
                            quickPick.value = v.slice(1);
                            // 激活第一个命令以便用户可以直接回车
                            quickPick.activeItems = [quickPick.items[0]];
                        }
                    } else {
                        if (inCommandMode) {
                            inCommandMode = false;
                            quickPick.items = issueItems;
                            suppressChange = true;
                            quickPick.value = v;
                            quickPick.activeItems = [];
                        }
                        // 否则保持 issueItems，VS Code 会本地过滤
                    }
                });

                quickPick.onDidAccept(async () => {
                    const selected = quickPick.selectedItems[0];
                    if (!selected) { quickPick.hide(); return; }

                    if (inCommandMode) {
                        const cmd = selected.commandId;
                        if (cmd) {
                            await vscode.commands.executeCommand(cmd);
                        }
                    } else if (selected.id) {
                        // 定位并打开 issue
                        try {
                            const node = await getIssueNodeById(selected.id);
                            // 尝试使用已有命令定位
                            await vscode.commands.executeCommand('issueManager.openAndRevealIssue', node, 'overview');
                        } catch (e) {
                            // fallback: 呼叫 searchIssues to handle
                            await vscode.commands.executeCommand('issueManager.searchIssues', 'overview');
                        }
                    } else {
                        // 如果没有 id，退回到 searchIssues
                        await vscode.commands.executeCommand('issueManager.searchIssues', 'overview');
                    }
                    quickPick.hide();
                });

                quickPick.onDidHide(() => quickPick.dispose());

            } catch (err) {
                quickPick.busy = false;
                quickPick.hide();
                vscode.window.showErrorMessage('加载问题列表失败。');
            }
        })
    );
}
