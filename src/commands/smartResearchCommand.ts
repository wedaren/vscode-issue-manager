import * as vscode from "vscode";
import { AgentService, AgentStep } from "../services/agent/AgentService";
import { Logger } from "../core/utils/Logger";
import { createIssueMarkdown } from "../data/IssueMarkdowns";

/**
 * 注册智能研究命令
 */
export function registerSmartResearchCommand(context: vscode.ExtensionContext): void {
    const logger = Logger.getInstance();

    const disposable = vscode.commands.registerCommand(
        "issueManager.smartResearch",
        async () => {
            try {
                // 获取研究主题
                const topic = await vscode.window.showInputBox({
                    prompt: "请输入要研究的主题",
                    placeHolder: "例如：TypeScript 装饰器的最佳实践",
                    ignoreFocusOut: true,
                });

                if (!topic || topic.trim() === "") {
                    return;
                }

                // 创建进度提示
                await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: "智能研究中",
                        cancellable: true,
                    },
                    async (progress, token) => {
                        progress.report({ message: "正在规划研究步骤..." });

                        const agentService = new AgentService();
                        const steps: AgentStep[] = [];

                        // 执行研究任务
                        const result = await agentService.executeResearchTask(
                            topic.trim(),
                            10,
                            step => {
                                steps.push(step);
                                progress.report({
                                    message: `步骤 ${step.stepNumber}: ${step.reasoning}`,
                                    increment: 10,
                                });
                            },
                            token
                        );

                        if (!result.success) {
                            throw new Error(result.error || "研究任务失败");
                        }

                        progress.report({ message: "正在生成研究报告..." });

                        // 创建研究报告文档
                        const reportContent =
                            result.finalResult && typeof result.finalResult === "object"
                                ? (result.finalResult as { report: string }).report
                                : "无法生成报告";

                        const markdown = `# ${topic}\n\n> 🤖 此报告由智能 Agent 自动生成\n\n${reportContent}\n\n---\n\n## 研究过程\n\n${steps
                            .map(
                                s =>
                                    `### 步骤 ${s.stepNumber}: ${s.reasoning}\n\n**工具**: ${s.tool}\n\n**结果**:\n\`\`\`json\n${JSON.stringify(s.result, null, 2)}\n\`\`\`\n`
                            )
                            .join("\n")}`;

                        // 保存为新问题
                        const fileUri = await createIssueMarkdown({
                            markdownBody: markdown,
                        });

                        if (!fileUri) {
                            throw new Error("无法创建问题文件");
                        }

                        // 打开文档
                        const doc = await vscode.workspace.openTextDocument(fileUri);
                        await vscode.window.showTextDocument(doc);

                        vscode.window.showInformationMessage(
                            `✅ 智能研究完成！共执行 ${steps.length} 个步骤`
                        );
                    }
                );
            } catch (error) {
                logger.error("智能研究命令失败", error);
                vscode.window.showErrorMessage(
                    `智能研究失败: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }
    );

    context.subscriptions.push(disposable);
    logger.info("智能研究命令已注册");
}
