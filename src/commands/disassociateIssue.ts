import * as vscode from 'vscode';
import * as path from 'path';
import { IssueNode, isIssueNode, readTree, removeNode, stripFocusedId, writeTree, getAssociatedFiles } from '../data/issueTreeManager';
import { EditorContextService } from '../services/EditorContextService';
import { getIssueDir } from '../config';



/**
 * ### 场景 1：解除唯一引用

1. 问题 A 只在树中有一个引用位置
2. 用户右键点击问题 A，选择"解除关联"
3. 系统解除关联后，检测到问题 A 没有其他引用
4. 弹出提示："问题 'A.md' 已没有任何关联引用，是否删除该问题文件？"
5. 用户可以选择"删除文件"或"保留文件"

### 场景 2：解除多个引用之一

1. 问题 B 在树中有多个引用位置（例如同时在项目 X 和项目 Y 下）
2. 用户右键点击项目 X 下的问题 B，选择"解除关联"
3. 系统解除关联后，检测到问题 B 在项目 Y 下还有引用
4. **不提示删除**，因为问题仍在使用中

### 场景 3：解除带子节点的节点

1. 问题 C 有子问题 C1 和 C2
2. 用户解除问题 C 的关联
3. 系统先提示："该节点下包含子问题，解除关联将一并移除其所有子节点。是否继续？"
4. 用户确认后，系统检查 C、C1、C2 是否还有其他引用
5. 对每个没有其他引用的问题，依次提示是否删除
 */

/**
 * 注册解除问题关联命令
 */
export function registerDisassociateIssueCommand(context: vscode.ExtensionContext) {
    const command = vscode.commands.registerCommand('issueManager.disassociateIssue', async (...args: unknown[]) => {
        const node = (Array.isArray(args) && args.length > 0) ? args[0] : null;

        if (!node || !isIssueNode(node) || node.id === 'placeholder-no-issues') {
            return;
        }

        // 如果有子节点，需要二次确认
        if (node.children && node.children.length > 0) {
            const confirm = await vscode.window.showWarningMessage(
                '该节点下包含子问题，解除关联将一并移除其所有子节点。是否继续？',
                { modal: true },
                '确定'
            );
            if (confirm !== '确定') {
                return;
            }
        }

        const treeData = await readTree();
        if (!treeData) {
            vscode.window.showErrorMessage('无法读取问题树数据。');
            return;
        }

        const issueId = stripFocusedId(node.id);
        const { removedNode, success } = removeNode(treeData, issueId);

        if (success) {
            await writeTree(treeData);
            await EditorContextService.getInstance()?.recheckCurrentEditor();

            // 检查是否还有其他引用 — 收集所有被移除的节点（包括子节点），按唯一文件路径去重后再提示删除
            try {
                const nodesToCheck: IssueNode[] = [];
                const collect = (n?: IssueNode | null) => {
                    if (!n) return;
                    nodesToCheck.push(n);
                    if (n.children && n.children.length > 0) {
                        n.children.forEach(child => collect(child));
                    }
                };

                collect(removedNode ?? (isIssueNode(node) ? node : undefined));

                const filePathSet = new Set<string>();
                nodesToCheck.forEach(n => {
                    if (n.filePath) filePathSet.add(n.filePath);
                });

                if (filePathSet.size > 0) {
                    const associated = await getAssociatedFiles();
                    const orphanPaths: string[] = [];
                    for (const p of filePathSet) {
                        if (!associated.has(p)) orphanPaths.push(p);
                    }

                    // 检查是否启用了自动删除设置；若启用则不询问直接删除孤立文件
                    const autoDelete = context.globalState.get<boolean>('issueManager.autoDeleteOnDisassociate', false);
                    for (const p of orphanPaths) {
                        const fileName = path.basename(p);
                        if (autoDelete) {
                            const issueDir = getIssueDir();
                            if (!issueDir) {
                                vscode.window.showErrorMessage('无法获取问题目录配置。');
                                return;
                            }
                            const fullPath = path.join(issueDir, p);
                            const fileUri = vscode.Uri.file(fullPath);
                            try {
                                await vscode.workspace.fs.delete(fileUri);
                            } catch (error) {
                                vscode.window.showErrorMessage(`删除文件失败: ${error instanceof Error ? error.message : '未知错误'}`);
                            }
                        } else {
                            const confirm = await vscode.window.showWarningMessage(
                                `问题 "${fileName}" 已没有任何关联引用，是否删除该问题文件？`,
                                { modal: false },
                                '删除文件',
                                '保留文件'
                            );

                            if (confirm === '删除文件') {
                                const issueDir = getIssueDir();
                                if (!issueDir) {
                                    vscode.window.showErrorMessage('无法获取问题目录配置。');
                                    return;
                                }

                                const fullPath = path.join(issueDir, p);
                                const fileUri = vscode.Uri.file(fullPath);
                                try {
                                    await vscode.workspace.fs.delete(fileUri);
                                } catch (error) {
                                    vscode.window.showErrorMessage(`删除文件失败: ${error instanceof Error ? error.message : '未知错误'}`);
                                }
                            }
                        }
                    }
                }

                // 无论是否有孤立文件被删除或被询问，均刷新视图以反映树的最新状态
                void vscode.commands.executeCommand('issueManager.refreshAllViews');
            } catch (error) {
                console.error('检查孤立问题或删除时出错:', error);
            }
        } else {
            vscode.window.showWarningMessage('无法在树中找到该节点以解除关联。');
        }
    });

    context.subscriptions.push(command);
}
