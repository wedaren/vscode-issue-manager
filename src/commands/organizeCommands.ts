import * as vscode from "vscode";
import * as path from "path";
import { getIssueDir } from "../config";
import { createIssueMarkdown, getIssueMarkdown } from "../data/IssueMarkdowns";
import { createIssueNodes, getFlatTree, getIssueNodeById } from "../data/issueTreeManager";
import { Logger } from "../core/utils/Logger";
import { OrganizeSuggestion } from "../llm/LLMService";

/**
 * 🔗 知识织网者 - 相关命令注册
 * 
 * 这个模块提供了智能归档孤立问题的能力
 */

/**
 * 注册归档相关的命令
 */
export function registerOrganizeCommands(context: vscode.ExtensionContext): void {
    // 接受单个归档建议
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "issueManager.acceptOrganizeSuggestion",
            acceptOrganizeSuggestion
        )
    );

    // 批量接受所有高置信度归档建议
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "issueManager.acceptAllOrganizeSuggestions",
            acceptAllOrganizeSuggestions
        )
    );
}

/**
 * 接受单个归档建议
 */
async function acceptOrganizeSuggestion(
    suggestion: OrganizeSuggestion
): Promise<void> {
    const issueDir = getIssueDir();
    if (!issueDir) {
        vscode.window.showErrorMessage("请先配置问题目录 (issueManager.issueDir)");
        return;
    }

    try {
        // 获取孤立问题的 URI
        const isolatedIssueUri = vscode.Uri.file(path.join(issueDir, suggestion.isolatedIssue.filePath));

        if (suggestion.recommendedParent.isNew) {
            // 需要先创建新的父节点
            const confirmed = await vscode.window.showInformationMessage(
                `将创建新分类「${suggestion.recommendedParent.title}」并将「${suggestion.isolatedIssue.title}」归入其中`,
                "确认",
                "取消"
            );

            if (confirmed !== "确认") {
                return;
            }

            // 创建新的父问题
            const parentContent = `# ${suggestion.recommendedParent.title}

${suggestion.recommendedParent.suggestedContent || "此分类由智能归档助手创建。"}

## 包含的问题

- ${suggestion.isolatedIssue.title}

---

*此分类由「知识织网者」自动创建*
`;

            const parentUri = await createIssueMarkdown({
                markdownBody: parentContent,
                frontmatter: { title: suggestion.recommendedParent.title },
            });

            if (!parentUri) {
                throw new Error("创建父节点失败");
            }

            // 使用 createIssueNodes 添加父节点到树
            const parentNodes = await createIssueNodes([parentUri]);
            const parentNodeId = parentNodes && parentNodes.length > 0 ? parentNodes[0].id : undefined;

            if (parentNodeId) {
                // 使用 createIssueNodes 将孤立问题添加为子节点
                await createIssueNodes([isolatedIssueUri], parentNodeId);
                vscode.window.showInformationMessage(
                    `✅ 已创建分类「${suggestion.recommendedParent.title}」并归档「${suggestion.isolatedIssue.title}」`
                );
            } else {
                vscode.window.showWarningMessage(
                    "创建了父节点，但无法建立关联。请手动在问题总览中组织。"
                );
            }
        } else {
            // 使用现有父节点
            const parentFilePath = suggestion.recommendedParent.filePath;
            if (!parentFilePath) {
                throw new Error("父节点路径不存在");
            }

            // 尝试找到父节点 ID
            let parentNodeId = await findNodeIdByFilePath(parentFilePath);

            if (!parentNodeId) {
                // 如果父节点不在树中，先用 createIssueNodes 添加它
                const parentUri = vscode.Uri.file(path.join(issueDir, parentFilePath));
                const addedParents = await createIssueNodes([parentUri]);
                parentNodeId = addedParents && addedParents.length > 0 ? addedParents[0].id : undefined;
            }

            if (parentNodeId) {
                // 使用 createIssueNodes 将孤立问题添加为子节点
                await createIssueNodes([isolatedIssueUri], parentNodeId);
                vscode.window.showInformationMessage(
                    `✅ 已将「${suggestion.isolatedIssue.title}」归档到「${suggestion.recommendedParent.title}」下`
                );
            } else {
                throw new Error("无法找到或创建父节点");
            }
        }

        // 刷新视图
        vscode.commands.executeCommand("issueManager.refreshViews");

    } catch (error) {
        Logger.getInstance().error("接受归档建议失败", error);
        vscode.window.showErrorMessage(
            `归档失败: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

/**
 * 批量接受所有高置信度归档建议
 */
async function acceptAllOrganizeSuggestions(
    suggestions: OrganizeSuggestion[]
): Promise<void> {
    const issueDir = getIssueDir();
    if (!issueDir) {
        vscode.window.showErrorMessage("请先配置问题目录 (issueManager.issueDir)");
        return;
    }

    if (!suggestions || suggestions.length === 0) {
        vscode.window.showInformationMessage("没有符合条件的归档建议");
        return;
    }

    const confirmed = await vscode.window.showInformationMessage(
        `将批量归档 ${suggestions.length} 个问题，确认继续？`,
        "确认",
        "取消"
    );

    if (confirmed !== "确认") {
        return;
    }

    let successCount = 0;
    let failCount = 0;

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "正在批量归档...",
            cancellable: false,
        },
        async (progress) => {
            for (let i = 0; i < suggestions.length; i++) {
                const suggestion = suggestions[i];
                progress.report({
                    message: `(${i + 1}/${suggestions.length}) ${suggestion.isolatedIssue.title}`,
                    increment: 100 / suggestions.length,
                });

                try {
                    await acceptOrganizeSuggestionSilent(suggestion);
                    successCount++;
                } catch (error) {
                    Logger.getInstance().warn(
                        `归档失败: ${suggestion.isolatedIssue.title}`,
                        error
                    );
                    failCount++;
                }
            }
        }
    );

    // 刷新视图
    vscode.commands.executeCommand("issueManager.refreshViews");

    if (failCount === 0) {
        vscode.window.showInformationMessage(`✅ 成功归档 ${successCount} 个问题`);
    } else {
        vscode.window.showWarningMessage(
            `归档完成: ${successCount} 成功, ${failCount} 失败`
        );
    }
}

/**
 * 静默接受归档建议（不显示通知）
 */
async function acceptOrganizeSuggestionSilent(
    suggestion: OrganizeSuggestion
): Promise<void> {
    const issueDir = getIssueDir();
    if (!issueDir) {
        throw new Error("问题目录未配置");
    }

    // 获取孤立问题的 URI
    const isolatedIssueUri = vscode.Uri.file(path.join(issueDir, suggestion.isolatedIssue.filePath));

    if (suggestion.recommendedParent.isNew) {
        // 创建新的父节点
        const parentContent = `# ${suggestion.recommendedParent.title}

${suggestion.recommendedParent.suggestedContent || "此分类由智能归档助手创建。"}

---

*此分类由「知识织网者」自动创建*
`;

        const parentUri = await createIssueMarkdown({
            markdownBody: parentContent,
            frontmatter: { title: suggestion.recommendedParent.title },
        });

        if (!parentUri) {
            throw new Error("创建父节点失败");
        }

        // 使用 createIssueNodes 添加父节点
        const parentNodes = await createIssueNodes([parentUri]);
        const parentNodeId = parentNodes && parentNodes.length > 0 ? parentNodes[0].id : undefined;

        if (parentNodeId) {
            // 使用 createIssueNodes 添加子节点
            await createIssueNodes([isolatedIssueUri], parentNodeId);
        } else {
            throw new Error("无法建立关联");
        }
    } else {
        const parentFilePath = suggestion.recommendedParent.filePath;
        if (!parentFilePath) {
            throw new Error("父节点路径不存在");
        }

        let parentNodeId = await findNodeIdByFilePath(parentFilePath);

        if (!parentNodeId) {
            // 使用 createIssueNodes 添加父节点
            const parentUri = vscode.Uri.file(path.join(issueDir, parentFilePath));
            const addedParents = await createIssueNodes([parentUri]);
            parentNodeId = addedParents && addedParents.length > 0 ? addedParents[0].id : undefined;
        }

        if (parentNodeId) {
            // 使用 createIssueNodes 添加子节点
            await createIssueNodes([isolatedIssueUri], parentNodeId);
        } else {
            throw new Error("无法找到或创建父节点");
        }
    }
}

/**
 * 通过文件路径查找节点 ID
 */
async function findNodeIdByFilePath(filePath: string): Promise<string | undefined> {
    const flatTree = await getFlatTree();
    
    // 标准化文件路径进行比较
    const normalizedPath = path.basename(filePath);
    
    const matchingNode = flatTree.find(
        (node) => path.basename(node.filePath) === normalizedPath
    );
    
    return matchingNode?.id;
}
