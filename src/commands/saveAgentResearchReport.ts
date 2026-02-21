import * as vscode from "vscode";
import { Logger } from "../core/utils/Logger";
import { createIssueMarkdown } from "../data/IssueMarkdowns";

/**
 * 保存 Agent 研究报告的命令参数
 */
interface SaveAgentReportArgs {
    topic: string;
    report: string;
    steps: Array<{
        stepNumber: number;
        reasoning: string;
        tool?: string;
        result?: unknown;
    }>;
}

/**
 * 注册保存 Agent 研究报告的命令
 */
export function registerSaveAgentResearchReport(context: vscode.ExtensionContext): void {
    const logger = Logger.getInstance();

    const disposable = vscode.commands.registerCommand(
        "issueManager.saveAgentResearchReport",
        async (args: SaveAgentReportArgs) => {
            try {
                const { topic, report, steps } = args;

                // 生成完整的 Markdown 内容
                const markdown = `# ${topic}

> 🤖 此报告由智能 Agent 自动生成
> 
> **生成时间**: ${new Date().toLocaleString("zh-CN")}
> **执行步骤数**: ${steps.length}

---

${report}

---

## 🔬 研究过程详情

${steps
    .map(
        s => `### 步骤 ${s.stepNumber}: ${s.reasoning}

${s.tool ? `**使用工具**: \`${s.tool}\`\n` : ""}
${s.result ? `**执行结果**:\n\n\`\`\`json\n${JSON.stringify(s.result, null, 2)}\n\`\`\`\n` : ""}`
    )
    .join("\n")}

---

## 📝 元数据

- **研究主题**: ${topic}
- **总步骤数**: ${steps.length}
- **报告生成**: ${new Date().toISOString()}
`;

                // 保存为新问题
                const fileUri = await createIssueMarkdown({ markdownBody: markdown });

                if (!fileUri) {
                    throw new Error("创建问题文件失败");
                }

                // 打开文档
                const doc = await vscode.workspace.openTextDocument(fileUri);
                await vscode.window.showTextDocument(doc);

                vscode.window.showInformationMessage(
                    `✅ Agent 研究报告已保存！`
                );
            } catch (error) {
                logger.error("保存 Agent 研究报告失败", error);
                vscode.window.showErrorMessage(
                    `保存失败: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }
    );

    context.subscriptions.push(disposable);
    logger.info("保存 Agent 研究报告命令已注册");
}
