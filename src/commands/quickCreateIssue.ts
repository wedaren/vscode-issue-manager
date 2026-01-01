import * as vscode from 'vscode';
import { getIssueDir } from '../config';
import { createIssueFile, createIssueFileSilent, addIssueToTree } from './issueFileUtils';
import { getFlatTree, FlatTreeNode } from '../data/issueTreeManager';
import { backgroundFillIssue } from '../llm/backgroundFill';

export async function quickCreateIssue(parentId: string | null = null): Promise<void> {
    const issueDir = getIssueDir();
    if (!issueDir) {
        vscode.window.showErrorMessage('请先配置 issue 目录 (issueManager.issueDir)。');
        vscode.commands.executeCommand('workbench.action.openSettings', 'issueManager.issueDir');
        return;
    }

    const quickPick = vscode.window.createQuickPick<vscode.QuickPickItem>();
    quickPick.placeholder = '输入要创建的问题标题，或选择已有节点...';
    quickPick.canSelectMany = false;
    quickPick.matchOnDescription = true;

    let latestFlat: FlatTreeNode[] = [];

    interface ActionQuickPickItem extends vscode.QuickPickItem {
        action: 'create' | 'create-background' | 'open-existing';
        payload?: any;
    }

    async function refreshFlatTree() {
        try {
            latestFlat = await getFlatTree();
        } catch (e) {
            latestFlat = [];
        }
    }

    await refreshFlatTree();

    quickPick.onDidChangeValue(async (value) => {
        const v = value || '';
        const direct: ActionQuickPickItem = { label: v || '新问题标题', description: '直接创建并打开', alwaysShow: true, action: 'create', payload: v || '新问题标题' };
        const background: ActionQuickPickItem = { label: v || '新问题标题（后台）', description: '后台创建并由 AI 填充（不打开）', alwaysShow: true, action: 'create-background', payload: v || '新问题标题' };

        // 交由 VS Code QuickPick 自身做过滤：不在这里按输入过滤扁平节点
        const flatItems: ActionQuickPickItem[] = latestFlat
            .map(n => {
                const desc = n.parentPath && n.parentPath.length > 0
                    ? '/' + n.parentPath.map(p => p.title).join(' / ')
                    : undefined;
                const words = value.split(' ')
                    .map(k => (k || '').trim())
                    .filter(k => k.length > 0);
                // 要求 label 或 description 都包含 value 的所有词组
                const shouldShow = words.length > 1 && words.every(k => n.title.includes(k) || (desc && desc.includes(k)));

                const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                let highlightedLabel = n.title;
                let highlightedDesc = desc;
                if (words.length > 0) {
                    for (const k of words) {
                        const re = new RegExp(escapeRegExp(k), 'g');
                        highlightedLabel = highlightedLabel.replace(re, `【${k}】`);
                        if (highlightedDesc) {
                            highlightedDesc = highlightedDesc.replace(re, `【${k}】`);
                        }
                    }
                }

                return {
                    label: shouldShow ? highlightedLabel : n.title,
                    description: shouldShow ? highlightedDesc : desc,
                    // 使用 action/payload 传递节点 id 以便后续能直接定位到 tree 节点
                    action: 'open-existing',
                    payload: n.id,
                    alwaysShow: shouldShow
                } as ActionQuickPickItem;
            });

        quickPick.items = [direct, background, ...flatItems];
    });

    quickPick.onDidAccept(async () => {
        const sel = quickPick.selectedItems[0] as ActionQuickPickItem | undefined;
        const input = quickPick.value || (sel && sel.label) || '';
        if (!sel) {
            // 直接按 Enter，执行直接创建并打开
            if (input) {
                const uri = await createIssueFile(input);
                if (uri) {
                    await addIssueToTree([uri], parentId, true);
                }
            }
            quickPick.dispose();
            return;
        }
        // 使用 action 字段区分操作
        switch (sel.action) {
            case 'create': {
                const title = sel.payload || input || sel.label;
                const uri = await createIssueFile(title);
                if (uri) {
                    await addIssueToTree([uri], parentId);
                }
                break;
            }
            case 'create-background': {
                const title = sel.payload || input || sel.label.replace('（后台）','');
                const uri = await createIssueFileSilent(title);
                if (uri) {
                    await addIssueToTree([uri], parentId, true);
                    // 启动后台填充（不阻塞 UI）
                    backgroundFillIssue(uri, title, { timeoutMs: 60000 }).then(() => {}).catch(()=>{});
                }
                break;
            }
            case 'open-existing': {
                const nodeId = sel.payload as string | undefined;
                if (nodeId) {
                    const node = latestFlat.find(n => n.id === nodeId);
                    if (node) {
                        try {
                            await vscode.commands.executeCommand('issueManager.openAndRevealIssue', node, 'overview');
                        } catch (e) {
                            vscode.window.showErrorMessage('定位并打开问题失败。');
                        }
                    } else {
                        vscode.window.showWarningMessage('未找到对应问题节点，无法定位。');
                    }
                } else {
                    // 兜底：按标题查找第一个匹配项并打开
                    const matched = latestFlat.find(n => n.title === sel.label);
                    if (matched && matched.resourceUri) {
                        try {
                            await vscode.window.showTextDocument(matched.resourceUri, { preview: false });
                        } catch (e) {
                            vscode.window.showErrorMessage(`无法打开文件: ${sel.label}`);
                        }
                    }
                }
                break;
            }
        }

        quickPick.dispose();
    });

    quickPick.onDidHide(() => quickPick.dispose());
    // 初始化显示
    quickPick.items = [
        { label: '新问题标题', description: '直接创建并打开', alwaysShow: true },
        { label: '新问题标题（后台）', description: '后台创建并由 AI 填充（不打开）', alwaysShow: true }
    ];
    quickPick.show();
}
