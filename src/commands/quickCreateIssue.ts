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
        const direct: vscode.QuickPickItem = { label: v || '新问题标题', description: '直接创建并打开', alwaysShow: true };
        const background: vscode.QuickPickItem = { label: v || '新问题标题（后台）', description: '后台创建并由 AI 填充（不打开）', alwaysShow: true };

        // 交由 VS Code QuickPick 自身做过滤：不在这里按输入过滤扁平节点
        const flatItems: vscode.QuickPickItem[] = latestFlat
            .map(n => ({
                label: n.title,
                description: n.parentPath && n.parentPath.length > 0 ? '/' + n.parentPath.map(p => p.title).join(' / ') : undefined,
                // 附带 id 以便后续能直接定位到 tree 节点
                id: n.id
            } as vscode.QuickPickItem & { id: string }));

        quickPick.items = [direct, background, ...flatItems];
    });

    quickPick.onDidAccept(async () => {
        const sel = quickPick.selectedItems[0];
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

        // 判断是两个固定选项还是已有项（通过 detail 判断）
        if (sel.description === '直接创建并打开') {
            const title = input || sel.label;
            const uri = await createIssueFile(title);
            if (uri) {
                await addIssueToTree([uri], parentId, true);
            }
            quickPick.dispose();
            return;
        }

        if (sel.description === '后台创建并由 AI 填充（不打开）' || sel.label.endsWith('（后台）')) {
            const title = input || sel.label.replace('（后台）','');
            const uri = await createIssueFileSilent(title);
            if (uri) {
                await addIssueToTree([uri], parentId, true);
                // 启动后台填充（不阻塞 UI）
                backgroundFillIssue(uri, title, { timeoutMs: 60000 }).then(() => {}).catch(()=>{});
            }
            quickPick.dispose();
            return;
        }

        // 否则视为打开已有：如果 QuickPickItem 带有 id，则直接按 id 查找扁平节点并定位
        const selWithId = sel as (vscode.QuickPickItem & { id?: string });
        if (selWithId.id) {
            const node = latestFlat.find(n => n.id === selWithId.id);
            if (node) {
                try {
                    // 使用已有的命令打开并定位（overview 视图）
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
