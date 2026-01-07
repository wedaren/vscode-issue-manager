import * as vscode from 'vscode';
import * as path from 'path';
import { getIssueDir } from '../config';
import { createIssueFileSilent, addIssueToTree } from './issueFileUtils';
import { getFlatTree, FlatTreeNode, stripFocusedId } from '../data/issueTreeManager';
import { backgroundFillIssue } from '../llm/backgroundFill';
import { getIssueIdFromUri } from '../utils/uriUtils';
import { FileAccessTracker } from '../services/FileAccessTracker';

export async function quickCreateIssue(parentId: string | null = null): Promise<string | null> {
    const issueDir = getIssueDir();
    if (!issueDir) {
        vscode.window.showErrorMessage('请先配置 issue 目录 (issueManager.issueDir)。');
        vscode.commands.executeCommand('workbench.action.openSettings', 'issueManager.issueDir');
        return null;
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

    // 尝试获取当前编辑器对应的 issueId（如果有）
    const activeIssueId = getIssueIdFromUri(vscode.window.activeTextEditor?.document?.uri);
    let fileAccessTracker: FileAccessTracker | undefined;
    try {
        fileAccessTracker = FileAccessTracker.getInstance();
    } catch (e) {
        // 如果尚未初始化，则忽略追踪器（降级为文件修改时间）
        fileAccessTracker = undefined;
    }

    quickPick.onDidChangeValue(async (value) => {
        const v = value || '';
        const direct: ActionQuickPickItem = { label: v || '新问题标题', description: '直接创建并打开', alwaysShow: true, action: 'create', payload: v || '新问题标题' };
        const background: ActionQuickPickItem = { label: v || '新问题标题（后台）', description: '后台创建并由 AI 填充（不打开）', alwaysShow: true, action: 'create-background', payload: v || '新问题标题' };

        // 交由 VS Code QuickPick 自身做过滤：不在这里按输入过滤扁平节点
        // 按最近访问时间排序：优先使用 FileAccessTracker 的访问时间，其次回退到文件修改时间
        const fileTimes = await Promise.all(latestFlat.map(async n => {
            const absPath = n.resourceUri?.fsPath || (getIssueDir() ? path.join(getIssueDir()!, n.filePath) : n.filePath);
            let t = 0;
            try {
                if (fileAccessTracker) {
                    const s = fileAccessTracker.getFileAccessStats(absPath);
                    if (s && s.lastViewTime) {
                        t = s.lastViewTime;
                    }
                }
                if (!t && n.resourceUri) {
                    const stat = await vscode.workspace.fs.stat(n.resourceUri);
                    t = stat.mtime || 0;
                }
            } catch (e) {
                // 忽略任意错误，保留 t = 0
            }
            return { node: n, time: t };
        }));

        fileTimes.sort((a, b) => (b.time || 0) - (a.time || 0));

        const sortedFlat = fileTimes.map(ft => ft.node);

        const flatItems: ActionQuickPickItem[] = sortedFlat
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

                // 如果当前编辑器正打开该 issue，则在描述中标注，方便用户通过输入“当前”快速定位
                let finalDesc = shouldShow ? highlightedDesc : desc;
                if (activeIssueId && n.id === activeIssueId) {
                    finalDesc = finalDesc ? `${finalDesc} （当前编辑器）` : '当前编辑器';
                }

                return {
                    label: shouldShow ? highlightedLabel : n.title,
                    description: finalDesc,
                    action: 'open-existing',
                    payload: n.id,
                    alwaysShow: shouldShow || (activeIssueId && n.id === activeIssueId)
                } as ActionQuickPickItem;
            });

        // 当用户没有输入内容时，默认只显示按最近访问排序的已有项；当有输入时，将新问题项放到最前
        if (v.trim().length === 0) {
            quickPick.items = flatItems;
        } else {
            quickPick.items = [direct, background, ...flatItems];
        }
    });
    // quickPick.onDidHide 已在上面 Promise 中处理
    // 初始化显示：展示按最近访问排序的已有项（不包含新建项），避免用户打开时仍看到“新问题标题”在最前
    try {
        const initFileTimes = await Promise.all(latestFlat.map(async n => {
            const absPath = n.resourceUri?.fsPath || (getIssueDir() ? path.join(getIssueDir()!, n.filePath) : n.filePath);
            let t = 0;
            try {
                if (fileAccessTracker) {
                    const s = fileAccessTracker.getFileAccessStats(absPath);
                    if (s && s.lastViewTime) {
                        t = s.lastViewTime;
                    }
                }
                if (!t && n.resourceUri) {
                    const stat = await vscode.workspace.fs.stat(n.resourceUri);
                    t = stat.mtime || 0;
                }
            } catch (e) {
                // ignore
            }
            return { node: n, time: t };
        }));

        initFileTimes.sort((a, b) => (b.time || 0) - (a.time || 0));
        const initSorted = initFileTimes.map(ft => ft.node);
        const initialItems: ActionQuickPickItem[] = initSorted.map(n => {
            const desc = n.parentPath && n.parentPath.length > 0
                ? '/' + n.parentPath.map(p => p.title).join(' / ')
                : undefined;
            let finalDesc = desc;
            if (activeIssueId && n.id === activeIssueId) {
                finalDesc = finalDesc ? `${finalDesc} （当前编辑器）` : '当前编辑器';
            }
            return {
                label: n.title,
                description: finalDesc,
                action: 'open-existing',
                payload: n.id,
                alwaysShow: true
            } as ActionQuickPickItem;
        });
        quickPick.items = initialItems;
    } catch (e) {
        // 回退到显示新建选项（极端情况）
        quickPick.items = [
            { label: '新问题标题', description: '直接创建并打开', alwaysShow: true },
            { label: '新问题标题（后台）', description: '后台创建并由 AI 填充（不打开）', alwaysShow: true }
        ];
    }
    quickPick.show();

    // 包装为 Promise，以便在 QuickPick 操作完成后返回新建或选中问题的 id
    const result = await new Promise<string | null>(resolve => {
        quickPick.onDidAccept(async () => {
            const sel = quickPick.selectedItems[0] as ActionQuickPickItem | undefined;
            const input = quickPick.value || (sel && sel.label) || '';
            if (!sel) {
                // 直接按 Enter，静默创建并返回 id（不在此处打开）
                if (input) {
                    const uri = await createIssueFileSilent(input);
                    if (uri) {
                        const nodes = await addIssueToTree([uri], parentId, true);
                        if (nodes && nodes.length > 0) {
                            resolve(stripFocusedId(nodes[0].id));
                            quickPick.dispose();
                            return;
                        }
                    }
                }
                quickPick.dispose();
                resolve(null);
                return;
            }

            // 使用 action 字段区分操作
            switch (sel.action) {
                case 'create': {
                    const title = sel.payload || input || sel.label;
                    const uri = await createIssueFileSilent(title);
                    if (uri) {
                        const nodes = await addIssueToTree([uri], parentId);
                        if (nodes && nodes.length > 0) {
                            resolve(stripFocusedId(nodes[0].id));
                            break;
                        }
                    }
                    resolve(null);
                    break;
                }
                case 'create-background': {
                    const title = sel.payload || input || sel.label.replace('（后台）','');
                    const uri = await createIssueFileSilent(title);
                    if (uri) {
                        const nodes = await addIssueToTree([uri], parentId);
                        if (nodes && nodes.length > 0) {
                            // 启动后台填充（不阻塞 UI）
                            backgroundFillIssue(uri, title, { timeoutMs: 60000 }).then(() => {}).catch(()=>{});
                            resolve(stripFocusedId(nodes[0].id));
                            break;
                        }
                    }
                    resolve(null);
                    break;
                }
                case 'open-existing': {
                    resolve(sel.payload as string);
                    break;
                }
                default: {
                    resolve(null);
                }
            }

            quickPick.dispose();
        });

        quickPick.onDidHide(() => {
            quickPick.dispose();
            resolve(null);
        });
        console.log('quickPick show')
    });

    return result;
}
