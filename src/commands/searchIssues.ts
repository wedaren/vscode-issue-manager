import * as vscode from 'vscode';

import { readTree, IssueTreeNode } from '../data/treeManager';
import { getTitle } from '../utils/markdown';

/**
 * 问题总览视图搜索命令实现
 */
export function registerSearchIssuesCommand(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand('issueManager.searchIssues', async () => {
        // 展示 QuickPick
        const quickPick = vscode.window.createQuickPick();
        quickPick.busy = true;
        quickPick.placeholder = '请输入要搜索的问题标题或关键词...';
        quickPick.matchOnDescription = true;
        quickPick.matchOnDetail = false;
        quickPick.show();

        const treeData =  await readTree();

        // 递归扁平化 tree.json 节点
        interface FlatNode extends IssueTreeNode {
            parentPath: IssueTreeNode[];
        };
        function flatten(nodes: IssueTreeNode[], parentNodes: IssueTreeNode[] = []): FlatNode[] {
            let result: FlatNode[] = [];
            for (const node of nodes) {
                result.push({
                    ...node,
                    parentPath: [...parentNodes]
                });
                if (node.children && node.children.length > 0) {
                    result = result.concat(flatten(node.children, [...parentNodes, node]));
                }
            }
            return result;
        }
        const flatNodes = flatten(treeData.rootNodes || []);

        // 获取每个节点的 mtime
        async function getMtime(node: FlatNode): Promise<number> {
            try {
                const uri = node.resourceUri || vscode.Uri.file(node.filePath);
                const stat = await vscode.workspace.fs.stat(uri);
                return stat.mtime;
            } catch {
                return 0;
            }
        }

        // 并发获取所有 mtime
        const nodesWithMtime = await Promise.all(flatNodes.map(async node => {
            const mtime = await getMtime(node);
            return { ...node, mtime };
        }));

        // 按 mtime 降序排序
        nodesWithMtime.sort((a, b) => b.mtime - a.mtime);

        // 构建 QuickPickItem 列表
        type QuickPickItemWithId = vscode.QuickPickItem & { id: string };

        const items = await Promise.all(nodesWithMtime.map(async node => {
            const title = await getTitle(node.resourceUri || vscode.Uri.file(node.filePath));
            let description = '';
            // 层级路径展示优化：一级节点 description 留空，二级及以上显示父级路径
            if (node.parentPath.length > 0) {
                description = [ '', ...(await Promise.all(node.parentPath.map(async n => await getTitle(n.resourceUri || vscode.Uri.file(n.filePath)))))].join(' / ');
            }
            return {
                label: title,
                description,
                id: node.id,
                alwaysShow: false
            } as QuickPickItemWithId;
        }));

        quickPick.items = items;
        quickPick.busy = false;

        // 关闭时自动释放资源
        quickPick.onDidHide(() => quickPick.dispose());

        quickPick.onDidAccept(async () => {
            try {
                const selected = quickPick.selectedItems[0] as QuickPickItemWithId;
                if (selected) {
                    // 直接用扁平化节点查找，定位主树节点
                    const node = flatNodes.find(n => n.id === selected.id);
                    if (node) {
                        await vscode.commands.executeCommand('issueManager.views.overview.reveal', node, { select: true, focus: true, expand: true });
                    } else {
                        vscode.window.showWarningMessage('未找到对应问题节点，无法定位。');
                    }
                }
            } catch (error) {
                vscode.window.showWarningMessage('未找到对应问题节点，无法定位。');
            }
        });
    });
    context.subscriptions.push(disposable);
}
