import * as vscode from "vscode";
import * as path from "path";
import { getIssueDir } from "../config";
import { createIssueMarkdown } from "../data/IssueMarkdowns";
import { createIssueNodes } from "../data/issueTreeManager";
import { backgroundFillIssue } from "../llm/backgroundFill";
import { Logger } from "../core/utils/Logger";
import { DecomposedQuestion, SubQuestion } from "../llm/LLMService";

/**
 * 🧩 问题分解专家 - 相关命令注册
 * 
 * 这个模块提供了将复杂问题分解结果转化为实际问题文件的能力
 */

/**
 * 注册问题分解相关的命令
 */
export function registerDecompositionCommands(context: vscode.ExtensionContext): void {
    // 从分解结果批量创建所有子问题
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "issueManager.batchCreateFromDecomposition",
            batchCreateFromDecomposition
        )
    );

    // 创建单个子问题
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "issueManager.createIssueFromSubQuestion",
            createIssueFromSubQuestion
        )
    );

    // 创建父问题文档（包含所有子问题的概览）
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "issueManager.createIssueFromDecompositionRoot",
            createIssueFromDecompositionRoot
        )
    );
}

/**
 * 从分解结果批量创建所有子问题
 * 会创建一个父问题和所有子问题，并自动建立树结构
 */
async function batchCreateFromDecomposition(
    decomposition: DecomposedQuestion
): Promise<void> {
    const issueDir = getIssueDir();
    if (!issueDir) {
        vscode.window.showErrorMessage("请先配置问题目录 (issueManager.issueDir)");
        return;
    }

    try {
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "正在创建问题结构...",
                cancellable: false,
            },
            async (progress) => {
                // 1. 首先创建父问题
                progress.report({ message: "创建父问题..." });
                
                const parentContent = generateParentMarkdown(decomposition);
                const parentUri = await createIssueMarkdown({
                    markdownBody: parentContent,
                    frontmatter: { title: decomposition.rootQuestion },
                });

                if (!parentUri) {
                    throw new Error("创建父问题失败");
                }

                // 使用 createIssueNodes 添加父问题到树（作为根节点）
                const parentNodes = await createIssueNodes([parentUri]);
                const parentNodeId = parentNodes && parentNodes.length > 0 ? parentNodes[0].id : undefined;

                if (!parentNodeId) {
                    Logger.getInstance().warn("添加父问题到树失败，将作为孤立问题继续");
                }

                // 2. 按优先级顺序创建子问题
                const sortedQuestions = [...decomposition.subQuestions].sort((a, b) => {
                    const priorityOrder = { P0: 0, P1: 1, P2: 2 };
                    return priorityOrder[a.priority] - priorityOrder[b.priority];
                });

                const createdIssues: Array<{ question: SubQuestion; uri: vscode.Uri; nodeId?: string }> = [];

                for (let i = 0; i < sortedQuestions.length; i++) {
                    const question = sortedQuestions[i];
                    progress.report({
                        message: `创建子问题 ${i + 1}/${sortedQuestions.length}: ${question.title}`,
                        increment: (100 / sortedQuestions.length),
                    });

                    const childContent = generateSubQuestionMarkdown(question, decomposition);
                    const childUri = await createIssueMarkdown({
                        markdownBody: childContent,
                        frontmatter: { 
                            title: question.title,
                            priority: question.priority,
                            keywords: question.keywords,
                        },
                    });

                    if (childUri) {
                        // 使用 createIssueNodes 创建子节点，传入 parentNodeId 建立层级关系
                        const childNodes = await createIssueNodes([childUri], parentNodeId);
                        const childNodeId = childNodes && childNodes.length > 0 ? childNodes[0].id : undefined;
                        createdIssues.push({ question, uri: childUri, nodeId: childNodeId });

                        // 后台填充内容（异步，不阻塞）
                        backgroundFillIssue(
                            childUri,
                            `请详细研究并撰写关于"${question.title}"的内容。\n\n背景：${question.description}\n\n建议内容大纲：${question.suggestedContent}`,
                            childNodeId,
                            { timeoutMs: 60000 }
                        ).catch((err) => {
                            Logger.getInstance().warn(`后台填充子问题失败: ${question.title}`, err);
                        });
                    }
                }

                // 3. 显示完成通知
                const createdCount = createdIssues.length;
                const action = await vscode.window.showInformationMessage(
                    `✅ 已创建 ${createdCount + 1} 个问题（1 个父问题 + ${createdCount} 个子问题）`,
                    "打开父问题",
                    "在问题总览中查看"
                );

                if (action === "打开父问题") {
                    await vscode.window.showTextDocument(parentUri);
                } else if (action === "在问题总览中查看") {
                    vscode.commands.executeCommand("issueManager.openOverviewView");
                }
            }
        );
    } catch (error) {
        Logger.getInstance().error("批量创建问题失败", error);
        vscode.window.showErrorMessage(`批量创建问题失败: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * 创建单个子问题
 */
async function createIssueFromSubQuestion(question: SubQuestion): Promise<void> {
    const issueDir = getIssueDir();
    if (!issueDir) {
        vscode.window.showErrorMessage("请先配置问题目录 (issueManager.issueDir)");
        return;
    }

    try {
        const content = `# ${question.title}

## 概述

${question.description}

## 优先级

**${question.priority}** - ${getPriorityDescription(question.priority)}

## 关键词

${question.keywords.map(k => `- ${k}`).join("\n")}

## 内容大纲

${question.suggestedContent}

---

*此问题由「问题分解专家」生成*
`;

        const uri = await createIssueMarkdown({
            markdownBody: content,
            frontmatter: {
                title: question.title,
                priority: question.priority,
                keywords: question.keywords,
            },
        });

        if (uri) {
            const action = await vscode.window.showInformationMessage(
                `✅ 已创建问题: ${question.title}`,
                "打开",
                "后台填充内容"
            );

            if (action === "打开") {
                await vscode.window.showTextDocument(uri);
            } else if (action === "后台填充内容") {
                backgroundFillIssue(
                    uri,
                    `请详细研究并撰写关于"${question.title}"的内容。\n\n背景：${question.description}\n\n建议内容大纲：${question.suggestedContent}`,
                    undefined,
                    { timeoutMs: 60000 }
                ).catch((err) => {
                    Logger.getInstance().warn(`后台填充失败`, err);
                });
                vscode.window.showInformationMessage("已开始后台填充内容，完成后会通知您");
            }
        }
    } catch (error) {
        Logger.getInstance().error("创建子问题失败", error);
        vscode.window.showErrorMessage(`创建子问题失败: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * 创建父问题文档（仅包含概览，不创建子问题）
 */
async function createIssueFromDecompositionRoot(
    decomposition: DecomposedQuestion
): Promise<void> {
    const issueDir = getIssueDir();
    if (!issueDir) {
        vscode.window.showErrorMessage("请先配置问题目录 (issueManager.issueDir)");
        return;
    }

    try {
        const content = generateParentMarkdown(decomposition);
        const uri = await createIssueMarkdown({
            markdownBody: content,
            frontmatter: { title: decomposition.rootQuestion },
        });

        if (uri) {
            await vscode.window.showTextDocument(uri);
            vscode.window.showInformationMessage(`✅ 已创建父问题文档: ${decomposition.rootQuestion}`);
        }
    } catch (error) {
        Logger.getInstance().error("创建父问题文档失败", error);
        vscode.window.showErrorMessage(`创建父问题文档失败: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * 生成父问题的 Markdown 内容
 */
function generateParentMarkdown(decomposition: DecomposedQuestion): string {
    const subQuestionsSection = decomposition.subQuestions
        .map((q) => {
            const depStr = q.dependencies.length > 0 
                ? ` (依赖: ${q.dependencies.map(d => `#${d}`).join(", ")})`
                : "";
            return `- [ ] **[${q.priority}]** ${q.id}. ${q.title}${depStr}`;
        })
        .join("\n");

    return `# ${decomposition.rootQuestion}

## 概述

${decomposition.overview}

## 子问题清单

${subQuestionsSection}

## 建议学习路径

${decomposition.suggestedPath}

## 预估时间

**${decomposition.estimatedTotalTime}**

---

*此问题结构由「问题分解专家」生成*
*生成时间: ${new Date().toLocaleString("zh-CN")}*
`;
}

/**
 * 生成子问题的 Markdown 内容
 */
function generateSubQuestionMarkdown(
    question: SubQuestion,
    decomposition: DecomposedQuestion
): string {
    const dependenciesSection = question.dependencies.length > 0
        ? `## 前置依赖

${question.dependencies.map((depId) => {
    const dep = decomposition.subQuestions.find((q) => q.id === depId);
    return dep ? `- #${depId}: ${dep.title}` : `- #${depId}`;
}).join("\n")}

`
        : "";

    return `# ${question.title}

## 概述

${question.description}

## 优先级

**${question.priority}** - ${getPriorityDescription(question.priority)}

${dependenciesSection}## 关键词

${question.keywords.map(k => `- ${k}`).join("\n")}

## 内容大纲

${question.suggestedContent}

## 笔记

<!-- 在此添加您的研究笔记 -->



---

*此问题由「问题分解专家」生成*
*父问题: ${decomposition.rootQuestion}*
`;
}

/**
 * 获取优先级描述
 */
function getPriorityDescription(priority: "P0" | "P1" | "P2"): string {
    switch (priority) {
        case "P0":
            return "🔴 核心基础 - 必须优先完成";
        case "P1":
            return "🟡 重要扩展 - 建议完成";
        case "P2":
            return "🟢 可选深入 - 有时间再研究";
        default:
            return "";
    }
}
