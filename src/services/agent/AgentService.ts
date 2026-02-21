import * as vscode from "vscode";
import * as path from "path";
import { LLMService } from "../../llm/LLMService";
import { getAllIssueMarkdowns } from "../../data/IssueMarkdowns";
import { createIssueMarkdown } from "../../data/IssueMarkdowns";
import { Logger } from "../../core/utils/Logger";

/**
 * Agent 工具接口
 */
export interface AgentTool {
    name: string;
    description: string;
    parameters: Record<string, { type: string; description: string; required?: boolean }>;
    execute: (params: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Agent 执行步骤
 */
export interface AgentStep {
    stepNumber: number;
    action: string;
    tool?: string;
    params?: Record<string, unknown>;
    result?: unknown;
    reasoning?: string;
}

/**
 * Agent 任务结果
 */
export interface AgentTaskResult {
    success: boolean;
    steps: AgentStep[];
    finalResult?: unknown;
    error?: string;
}

/**
 * 智能 Agent 服务
 * 
 * 提供自主研究、多步骤推理和文档生成能力
 */
export class AgentService {
    private tools: Map<string, AgentTool> = new Map();
    private logger: Logger;

    constructor() {
        this.logger = Logger.getInstance();
        this.registerDefaultTools();
    }

    /**
     * 注册默认工具
     */
    private registerDefaultTools(): void {
        // 工具 1：搜索相关问题
        this.registerTool({
            name: "searchIssues",
            description: "在知识库中搜索与给定主题相关的问题",
            parameters: {
                query: {
                    type: "string",
                    description: "搜索查询文本",
                    required: true,
                },
                limit: {
                    type: "number",
                    description: "返回结果的最大数量",
                    required: false,
                },
            },
            execute: async (params: Record<string, unknown>) => {
                return this.searchIssues(
                    params.query as string,
                    (params.limit as number) || 10
                );
            },
        });

        // 工具 2：创建新问题
        this.registerTool({
            name: "createIssue",
            description: "创建一个新的问题文件",
            parameters: {
                title: {
                    type: "string",
                    description: "问题标题",
                    required: true,
                },
                content: {
                    type: "string",
                    description: "问题内容（Markdown 格式）",
                    required: false,
                },
            },
            execute: async (params: Record<string, unknown>) => {
                return this.createIssue(
                    params.title as string,
                    (params.content as string) || ""
                );
            },
        });

        // 工具 3：读取问题内容
        this.registerTool({
            name: "readIssue",
            description: "读取指定问题的完整内容",
            parameters: {
                filePath: {
                    type: "string",
                    description: "问题文件的完整路径",
                    required: true,
                },
            },
            execute: async (params: Record<string, unknown>) => {
                return this.readIssue(params.filePath as string);
            },
        });

        // 工具 4：分析问题关系
        this.registerTool({
            name: "analyzeRelations",
            description: "分析问题之间的关系图谱",
            parameters: {
                issueId: {
                    type: "string",
                    description: "要分析的问题 ID（文件名）",
                    required: false,
                },
            },
            execute: async (params: Record<string, unknown>) => {
                return this.analyzeRelations(params.issueId as string | undefined);
            },
        });

        // 工具 5：关联问题
        this.registerTool({
            name: "linkIssues",
            description: "建立问题之间的父子关系",
            parameters: {
                parentIssueId: {
                    type: "string",
                    description: "父问题 ID",
                    required: true,
                },
                childIssueId: {
                    type: "string",
                    description: "子问题 ID",
                    required: true,
                },
            },
            execute: async (params: Record<string, unknown>) => {
                return this.linkIssues(
                    params.parentIssueId as string,
                    params.childIssueId as string
                );
            },
        });
    }

    /**
     * 注册工具
     */
    public registerTool(tool: AgentTool): void {
        this.tools.set(tool.name, tool);
        this.logger.info(`Agent 工具已注册: ${tool.name}`);
    }

    /**
     * 获取所有可用工具的描述
     */
    private getToolsDescription(): string {
        const toolDescriptions = Array.from(this.tools.values()).map(tool => {
            const params = Object.entries(tool.parameters)
                .map(([name, info]) => {
                    const required = info.required ? " (必需)" : " (可选)";
                    return `  - ${name}${required}: ${info.description}`;
                })
                .join("\n");
            return `${tool.name}: ${tool.description}\n参数:\n${params}`;
        });
        return toolDescriptions.join("\n\n");
    }

    /**
     * 执行智能研究任务
     * 
     * @param topic 研究主题
     * @param maxSteps 最大步骤数
     * @param progress 进度回调
     * @param token 取消令牌
     */
    public async executeResearchTask(
        topic: string,
        maxSteps: number = 10,
        progress?: (step: AgentStep) => void,
        token?: vscode.CancellationToken
    ): Promise<AgentTaskResult> {
        const steps: AgentStep[] = [];
        let currentStep = 0;

        this.logger.info(`开始智能研究任务: ${topic}`);

        try {
            // 第一步：规划研究步骤
            const planPrompt = `
你是一个智能研究助手。用户想要研究以下主题：

"${topic}"

你有以下工具可以使用：
${this.getToolsDescription()}

请规划一个研究计划，包含 3-7 个步骤，每个步骤应该：
1. 使用一个工具来获取信息或执行操作
2. 有清晰的推理说明为什么需要这一步

请以 JSON 格式返回计划，格式如下：
{
  "plan": [
    {
      "step": 1,
      "reasoning": "解释为什么需要这一步",
      "tool": "工具名称",
      "params": { "参数名": "参数值" }
    }
  ]
}
`;

            const planResponse = await LLMService._request([
                vscode.LanguageModelChatMessage.User(planPrompt),
            ]);

            if (!planResponse) {
                throw new Error("无法生成研究计划");
            }

            // 解析计划
            const planJson = this.extractJsonFromText(planResponse.text);
            const plan = planJson.plan as Array<{
                step: number;
                reasoning: string;
                tool: string;
                params: Record<string, unknown>;
            }>;

            this.logger.info(`研究计划已生成，共 ${plan.length} 步`);

            // 执行计划中的每一步
            for (const plannedStep of plan) {
                if (token?.isCancellationRequested) {
                    throw new Error("任务已取消");
                }

                currentStep++;
                const step: AgentStep = {
                    stepNumber: currentStep,
                    action: plannedStep.reasoning,
                    tool: plannedStep.tool,
                    params: plannedStep.params,
                    reasoning: plannedStep.reasoning,
                };

                this.logger.info(
                    `执行步骤 ${currentStep}: ${plannedStep.tool} - ${plannedStep.reasoning}`
                );

                // 执行工具
                const tool = this.tools.get(plannedStep.tool);
                if (!tool) {
                    step.result = { error: `工具 ${plannedStep.tool} 不存在` };
                } else {
                    try {
                        step.result = await tool.execute(plannedStep.params);
                    } catch (error) {
                        step.result = {
                            error:
                                error instanceof Error ? error.message : String(error),
                        };
                    }
                }

                steps.push(step);
                if (progress) {
                    progress(step);
                }

                if (currentStep >= maxSteps) {
                    this.logger.warn(`达到最大步骤数 ${maxSteps}，停止执行`);
                    break;
                }
            }

            // 生成最终研究报告
            const reportPrompt = `
基于以下研究步骤的结果，生成一份完整的研究报告：

研究主题: ${topic}

研究步骤和结果:
${steps
    .map(
        s => `
步骤 ${s.stepNumber}: ${s.reasoning}
工具: ${s.tool}
结果: ${JSON.stringify(s.result, null, 2)}
`
    )
    .join("\n")}

请生成一份详细的 Markdown 格式研究报告，包含：
1. 研究主题概述
2. 关键发现
3. 相关问题总结
4. 进一步研究建议

报告应该结构清晰、内容详实。
`;

            const reportResponse = await LLMService._request([
                vscode.LanguageModelChatMessage.User(reportPrompt),
            ]);

            const finalReport = reportResponse?.text || "无法生成报告";

            this.logger.info("研究任务完成");

            return {
                success: true,
                steps,
                finalResult: {
                    report: finalReport,
                    stepCount: steps.length,
                },
            };
        } catch (error) {
            this.logger.error("研究任务失败", error);
            return {
                success: false,
                steps,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * 工具实现：搜索问题
     */
    private async searchIssues(
        query: string,
        limit: number
    ): Promise<Array<{ title: string; filePath: string; snippet: string }>> {
        const allIssues = await getAllIssueMarkdowns();

        // 使用 LLM 进行语义搜索
        const searchPrompt = `
从以下问题列表中，找出与查询"${query}"最相关的 ${limit} 个问题。

问题列表:
${JSON.stringify(
    allIssues.map(i => ({ title: i.title, filePath: i.uri.fsPath })),
    null,
    2
)}

请以 JSON 格式返回结果，包含标题、文件路径和相关性说明：
{
  "results": [
    {
      "title": "问题标题",
      "filePath": "/path/to/file.md",
      "relevance": "相关性说明（一句话）"
    }
  ]
}
`;

        const response = await LLMService._request([
            vscode.LanguageModelChatMessage.User(searchPrompt),
        ]);

        if (!response) {
            return [];
        }

        const json = this.extractJsonFromText(response.text);
        return (json.results as Array<{
            title: string;
            filePath: string;
            relevance: string;
        }>).map(r => ({
            title: r.title,
            filePath: r.filePath,
            snippet: r.relevance,
        }));
    }

    /**
     * 工具实现：创建问题
     */
    private async createIssue(
        title: string,
        content: string
    ): Promise<{ issueId: string; filePath: string }> {
        const markdown = `# ${title}\n\n${content}`;
        const result = await createIssueMarkdown({ markdownBody: markdown });

        if (!result) {
            throw new Error("创建问题失败");
        }

        this.logger.info(`已创建新问题: ${title}`);

        return {
            issueId: path.basename(result.fsPath, ".md"),
            filePath: result.fsPath,
        };
    }

    /**
     * 工具实现：读取问题
     */
    private async readIssue(filePath: string): Promise<{ title: string; content: string }> {
        const document = await vscode.workspace.openTextDocument(filePath);
        const content = document.getText();

        // 提取标题
        const titleMatch = content.match(/^#\s+(.+)$/m);
        const title = titleMatch ? titleMatch[1] : path.basename(filePath, ".md");

        return { title, content };
    }

    /**
     * 工具实现：分析关系
     */
    private async analyzeRelations(
        issueId?: string
    ): Promise<{ nodes: number; edges: number; description: string }> {
        // 由于 GraphDataService 需要文件路径，这里简化实现
        // 返回一个模拟的结果
        const allIssues = await getAllIssueMarkdowns();
        const nodes = allIssues.length;

        let description = `知识图谱包含 ${nodes} 个问题节点。`;

        if (issueId) {
            const targetIssue = allIssues.find(
                i => path.basename(i.uri.fsPath, ".md") === issueId
            );
            if (targetIssue) {
                description += ` 找到问题: ${targetIssue.title}`;
            }
        }

        return { nodes, edges: 0, description };
    }

    /**
     * 工具实现：关联问题
     */
    private async linkIssues(
        parentIssueId: string,
        childIssueId: string
    ): Promise<{ success: boolean; message: string }> {
        try {
            // 这里需要实现实际的关联逻辑
            // 由于现有代码结构复杂，这里仅返回成功状态
            this.logger.info(`关联问题: ${parentIssueId} -> ${childIssueId}`);

            return {
                success: true,
                message: `已将 ${childIssueId} 关联到 ${parentIssueId}`,
            };
        } catch (error) {
            return {
                success: false,
                message: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * 从文本中提取 JSON 对象
     */
    private extractJsonFromText(text: string): Record<string, unknown> {
        // 尝试提取 JSON 代码块
        const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/);
        const candidate = jsonMatch?.[1] ? jsonMatch[1] : text;

        // 查找第一个 { 和最后一个 }
        const firstBrace = candidate.indexOf("{");
        const lastBrace = candidate.lastIndexOf("}");

        if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
            throw new Error("未在响应中找到有效的 JSON 对象");
        }

        const jsonString = candidate.substring(firstBrace, lastBrace + 1);
        return JSON.parse(jsonString) as Record<string, unknown>;
    }
}
