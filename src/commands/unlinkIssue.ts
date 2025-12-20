import * as vscode from 'vscode';
import * as path from 'path';
import { IssueFrontmatterService, IssueFrontmatterData } from '../services/IssueFrontmatterService';

/**
 * 解除关联选项
 */
enum UnlinkOption {
    /**
     * 仅解除当前节点（保留子节点）
     */
    KEEP_CHILDREN = 'keepChildren',
    /**
     * 解除当前节点及其所有子节点（递归清理）
     */
    CASCADE = 'cascade'
}

/**
 * 注册解除 issue 层级关联命令
 * @param context 扩展上下文
 */
export function registerUnlinkIssueCommand(context: vscode.ExtensionContext) {
    const command = vscode.commands.registerCommand(
        'issueManager.unlinkIssue',
        async (filePath?: string) => {
            try {
                // 获取要解除关联的文件路径
                let targetFile: string | undefined = filePath;

                if (!targetFile) {
                    // 如果没有传入文件路径，尝试从当前编辑器获取
                    const activeEditor = vscode.window.activeTextEditor;
                    if (activeEditor && activeEditor.document.languageId === 'markdown') {
                        targetFile = activeEditor.document.uri.fsPath;
                    }
                }

                if (!targetFile) {
                    vscode.window.showErrorMessage('请先打开一个 Markdown 文件或在树视图中选择一个节点。');
                    return;
                }

                // 执行解除关联操作
                await unlinkIssueNode(targetFile);
            } catch (error) {
                console.error('解除关联失败:', error);
                vscode.window.showErrorMessage(`解除关联失败: ${error}`);
            }
        }
    );

    context.subscriptions.push(command);
}

/**
 * 解除 issue 节点的层级关联
 */
async function unlinkIssueNode(filePath: string): Promise<void> {
    const service = IssueFrontmatterService.getInstance();
    
    // 从文件路径提取相对路径（相对于 issueDir）
    const fileName = await getRelativeFileName(filePath);
    if (!fileName) {
        vscode.window.showErrorMessage('无法确定文件的相对路径。');
        return;
    }

    // 读取当前节点的 frontmatter
    const frontmatter = await service.getIssueFrontmatter(fileName);
    if (!frontmatter) {
        vscode.window.showWarningMessage('该文件没有有效的 frontmatter，无需解除关联。');
        return;
    }

    // 检查是否有 issue_ 字段
    const hasIssueFields = frontmatter.issue_root || frontmatter.issue_parent || frontmatter.issue_children;
    if (!hasIssueFields) {
        vscode.window.showWarningMessage('该文件没有层级关联信息。');
        return;
    }

    // 收集子节点信息
    const children = frontmatter.issue_children || [];
    const hasChildren = children.length > 0;

    // 显示选项对话框
    const option = await showUnlinkOptionsDialog(fileName, hasChildren);
    if (!option) {
        return; // 用户取消操作
    }

    // 根据选项执行相应的解除操作
    if (option === UnlinkOption.KEEP_CHILDREN) {
        await unlinkKeepChildren(fileName, frontmatter);
    } else if (option === UnlinkOption.CASCADE) {
        await unlinkCascade(fileName, frontmatter);
    }

    // 刷新视图
    vscode.commands.executeCommand('issueManager.refreshAllViews');
}

/**
 * 显示解除关联选项对话框
 */
async function showUnlinkOptionsDialog(fileName: string, hasChildren: boolean): Promise<UnlinkOption | null> {
    interface QuickPickItemWithOption extends vscode.QuickPickItem {
        option: UnlinkOption;
    }

    const items: QuickPickItemWithOption[] = [
        {
            label: '$(file) 仅解除当前节点',
            description: hasChildren ? '子节点将变为新的根节点' : '推荐选项',
            detail: '从父文件的 issue_children 中移除当前文件，子文件将独立',
            option: UnlinkOption.KEEP_CHILDREN
        },
        {
            label: '$(flame) 解除当前节点及其所有子节点',
            description: hasChildren ? '递归清理整个分支' : '清理所有层级信息',
            detail: '彻底删除当前文件及所有后代文件的 issue_ 字段',
            option: UnlinkOption.CASCADE
        }
    ];

    const selected = await vscode.window.showQuickPick(items, {
        placeHolder: `选择解除关联方式：${fileName}`,
        title: '解除层级关联'
    });

    return selected ? selected.option : null;
}

/**
 * 选项 A：仅解除当前节点（保留子节点）
 */
async function unlinkKeepChildren(fileName: string, frontmatter: IssueFrontmatterData): Promise<void> {
    const service = IssueFrontmatterService.getInstance();
    const updates = new Map<string, Partial<IssueFrontmatterData>>();

    try {
        // 1. 如果有父节点，从父文件的 issue_children 中删除当前路径
        if (frontmatter.issue_parent) {
            const parentFrontmatter = await service.getIssueFrontmatter(frontmatter.issue_parent);
            if (parentFrontmatter && parentFrontmatter.issue_children) {
                const updatedChildren = parentFrontmatter.issue_children.filter(child => child !== fileName);
                updates.set(frontmatter.issue_parent, {
                    issue_children: updatedChildren
                });
            }
        }

        // 2. 将当前节点的所有子文件独立化
        const children = frontmatter.issue_children || [];
        for (const child of children) {
            updates.set(child, {
                issue_parent: null,
                issue_root: child // 子文件自己成为新的根节点
            });
        }

        // 3. 清除当前节点的所有 issue_ 字段
        await service.removeAllIssueFields(fileName);

        // 4. 批量应用更新
        if (updates.size > 0) {
            const success = await service.updateIssueFieldsBatch(updates);
            if (success) {
                const affectedCount = updates.size + 1; // 包括当前节点
                vscode.window.showInformationMessage(
                    `成功解除关联，共修改了 ${affectedCount} 个文件的元数据。`
                );
            } else {
                vscode.window.showErrorMessage('部分文件更新失败，请检查日志。');
            }
        } else {
            vscode.window.showInformationMessage('解除关联完成。');
        }
    } catch (error) {
        console.error('解除关联（保留子节点）失败:', error);
        vscode.window.showErrorMessage(`解除关联失败: ${error}`);
    }
}

/**
 * 选项 B：解除当前节点及其所有子节点（递归清理）
 */
async function unlinkCascade(fileName: string, frontmatter: IssueFrontmatterData): Promise<void> {
    const service = IssueFrontmatterService.getInstance();
    const updates = new Map<string, Partial<IssueFrontmatterData>>();

    try {
        // 1. 如果有父节点，从父文件的 issue_children 中删除当前路径
        if (frontmatter.issue_parent) {
            const parentFrontmatter = await service.getIssueFrontmatter(frontmatter.issue_parent);
            if (parentFrontmatter && parentFrontmatter.issue_children) {
                const updatedChildren = parentFrontmatter.issue_children.filter(child => child !== fileName);
                updates.set(frontmatter.issue_parent, {
                    issue_children: updatedChildren
                });
            }
        }

        // 2. 递归收集当前节点的所有后代
        const descendants = await service.collectDescendants(fileName);
        const allNodesToClean = [fileName, ...descendants];

        // 显示预览
        const confirm = await vscode.window.showWarningMessage(
            `将修改 ${allNodesToClean.length} 个文件的元数据，彻底清除层级关系。是否继续？`,
            { modal: true },
            '确认',
            '取消'
        );

        if (confirm !== '确认') {
            return;
        }

        // 3. 批量应用父节点更新
        if (updates.size > 0) {
            await service.updateIssueFieldsBatch(updates);
        }

        // 4. 批量删除所有节点的 issue_ 字段
        const success = await service.removeAllIssueFieldsBatch(allNodesToClean);
        
        if (success) {
            const totalAffected = allNodesToClean.length + updates.size;
            vscode.window.showInformationMessage(
                `成功解除关联，共修改了 ${totalAffected} 个文件的元数据。`
            );
        } else {
            vscode.window.showErrorMessage('部分文件更新失败，请检查日志。');
        }
    } catch (error) {
        console.error('解除关联（递归清理）失败:', error);
        vscode.window.showErrorMessage(`解除关联失败: ${error}`);
    }
}

/**
 * 获取文件相对于 issueDir 的路径
 */
async function getRelativeFileName(absolutePath: string): Promise<string | null> {
    try {
        const config = vscode.workspace.getConfiguration('issueManager');
        const issueDir = config.get<string>('issueDir');
        
        if (!issueDir) {
            return null;
        }

        return path.relative(issueDir, absolutePath).replace(/\\/g, '/');
    } catch (error) {
        console.error('获取相对路径失败:', error);
        return null;
    }
}
