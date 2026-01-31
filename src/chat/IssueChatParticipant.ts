import * as vscode from "vscode";
import { getIssueDir } from "../config";
import { LLMService } from "../llm/LLMService";
import { getFlatTree } from "../data/issueTreeManager";
import * as path from "path";
import { Logger } from "../core/utils/Logger";
import { createIssueMarkdown } from "../data/IssueMarkdowns";
import { AgentService } from "../services/agent/AgentService";

/**
 * 命令别名常量定义
 */
const CREATE_COMMANDS = ["新建", "new", "create"] as const;
const SEARCH_COMMANDS = ["搜索", "search", "find"] as const;
const REVIEW_COMMANDS = ["审阅", "review"] as const;
const RESEARCH_COMMANDS = ["研究", "research", "deep", "doc", "文档"] as const;
const AGENT_COMMANDS = ["agent", "智能研究", "自主研究"] as const;
const HELP_COMMANDS = ["帮助", "help"] as const;

/**
 * 意图配置 - 定义每种意图的检测关键词和噪音词
 * 按从长到短排序，确保优先匹配较长的短语
 */
const INTENT_CONFIG = {
    create: {
        keywords: ["创建", "新建", "create", "new"],
        noiseWords: [
            "look for",
            "document",
            "create",
            "issue",
            "note",
            "new",
            "帮我创建",
            "帮我新建",
            "一个关于",
            "关于",
            "问题",
            "笔记",
            "文档",
            "创建",
            "新建",
        ],
    },
    search: {
        keywords: ["搜索", "查找", "找", "search", "find"],
        noiseWords: [
            "look for",
            "search",
            "find",
            "帮我找找",
            "帮我找",
            "帮我搜索",
            "帮我查找",
            "相关的问题",
            "相关问题",
            "相关的",
            "相关",
            "找找",
            "搜索",
            "查找",
            "找",
        ],
    },
    research: {
        keywords: ["研究", "research", "deep", "撰写", "生成文档"],
        noiseWords: ["帮我研究", "帮我撰写", "帮我生成", "关于", "文档", "研究", "撰写"],
    },
} as const;

/**
 * 从文本中移除噪音词，提取核心内容
 * @param text 原始文本
 * @param noiseWords 要移除的噪音词数组（应按从长到短排序）
 * @returns 清理后的文本
 */
function cleanText(text: string, noiseWords: string[]): string {
    let result = text;

    // 按从长到短的顺序替换，避免部分匹配问题
    for (const noise of noiseWords) {
        // 转义正则特殊字符，避免注入问题
        const escaped = noise.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const pattern = new RegExp(escaped, "gi");
        result = result.replace(pattern, " ");
    }

    // 清理多余空格
    return result.replace(/\s+/g, " ").trim();
}

/**
 * 检测用户意图并提取核心内容
 * @param prompt 用户输入的原始文本
 * @param intentKeywords 意图检测关键词数组
 * @param noiseWords 要移除的噪音词数组
 * @returns 如果检测到意图，返回清理后的文本；否则返回 null
 */
function detectIntent(
    prompt: string,
    intentKeywords: readonly string[],
    noiseWords: readonly string[]
): string | null {
    const lowerPrompt = prompt.toLowerCase();

    // 检查是否包含任何意图关键词
    if (!intentKeywords.some(keyword => lowerPrompt.includes(keyword))) {
        return null;
    }

    // 提取并清理文本
    const cleaned = cleanText(prompt, noiseWords as string[]);
    return cleaned || null;
}

/**
 * Issue Manager Chat Participant
 *
 * 在 Copilot Chat 中提供问题管理功能
 * 使用 @issueManager 触发
 */
export class IssueChatParticipant {
    private participant: vscode.ChatParticipant | undefined;

    private static isRecord(value: unknown): value is Record<string, unknown> {
        return value !== null && typeof value === "object" && !Array.isArray(value);
    }

    private static extractJsonObject(text: string): unknown {
        const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/);
        const candidate = jsonMatch?.[1] ? jsonMatch[1] : text;

        const firstBrace = candidate.indexOf("{");
        const lastBrace = candidate.lastIndexOf("}");
        if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
            throw new Error("未在模型响应中找到 JSON 对象");
        }
        const jsonString = candidate.substring(firstBrace, lastBrace + 1);
        return JSON.parse(jsonString) as unknown;
    }

    private static async aggregateText(
        response: vscode.LanguageModelChatResponse,
        token: vscode.CancellationToken
    ): Promise<string> {
        let full = "";
        for await (const chunk of response.text) {
            if (token.isCancellationRequested) {
                throw new Error("请求已取消");
            }
            full += String(chunk);
        }
        return full;
    }

    /**
     * 注册 Chat Participant
     */
    public register(context: vscode.ExtensionContext): void {
        // 检查是否支持 Chat API
        if (!vscode.chat || !vscode.chat.createChatParticipant) {
            Logger.getInstance().warn("[IssueChatParticipant] Chat API 不可用");
            return;
        }

        // 创建 Chat Participant
        this.participant = vscode.chat.createChatParticipant(
            "issueManager.chat",
            this.handleChatRequest.bind(this)
        );

        // 配置参与者
        this.participant.iconPath = vscode.Uri.file(
            path.join(context.extensionPath, "resources", "icon.svg")
        );

        context.subscriptions.push(this.participant);
        Logger.getInstance().info("[IssueChatParticipant] Chat Participant 已注册");
    }

    /**
     * 处理聊天请求
     */
    private async handleChatRequest(
        request: vscode.ChatRequest,
        context: vscode.ChatContext,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<void> {
        // 检查问题目录是否配置
        const issueDir = getIssueDir();
        if (!issueDir) {
            stream.markdown("❌ 请先在设置中配置 `issueManager.issueDir`\n\n");
            stream.button({
                command: "workbench.action.openSettings",
                arguments: ["issueManager.issueDir"],
                title: "打开设置",
            });
            return;
        }

        // 解析命令
        const command = request.command?.toLowerCase() || "";
        const prompt = request.prompt.trim();

        try {
            // 根据命令路由到不同的处理器
            if ((CREATE_COMMANDS as readonly string[]).includes(command)) {
                await this.handleCreateCommand(prompt, stream, token);
            } else if ((SEARCH_COMMANDS as readonly string[]).includes(command)) {
                await this.handleSearchCommand(prompt, stream, token);
            } else if ((REVIEW_COMMANDS as readonly string[]).includes(command)) {
                await this.handleReviewCommand(prompt, request, stream, token);
            } else if ((RESEARCH_COMMANDS as readonly string[]).includes(command)) {
                await this.handleResearchCommand(prompt, stream, token);
            } else if ((AGENT_COMMANDS as readonly string[]).includes(command)) {
                await this.handleAgentResearchCommand(prompt, stream, token);
            } else if ((HELP_COMMANDS as readonly string[]).includes(command)) {
                this.handleHelpCommand(stream);
            } else {
                // 无命令时,尝试智能理解用户意图
                await this.handleDefaultCommand(prompt, stream, token);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            stream.markdown(`\n\n❌ 执行失败: ${errorMessage}\n`);
        }
    }

    /**
     * 处理审阅命令：生成可执行计划（任务清单），并提供一键创建问题按钮
     */
    private async handleReviewCommand(
        prompt: string,
        request: vscode.ChatRequest,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<void> {
        const activeEditor = vscode.window.activeTextEditor;
        const activeDoc = activeEditor?.document;

        const docText = activeDoc?.getText() ?? "";
        const hasDoc = docText.trim().length > 0;
        const focus = prompt.trim();

        if (!hasDoc && !focus) {
            stream.markdown("❓ 请打开一个要审阅的 Markdown 文档，或提供审阅目标。例如: `/审阅 优化本周计划可执行性`\n");
            return;
        }

        stream.progress("正在审阅并生成可执行计划...");

        type Priority = "P0" | "P1" | "P2";
        interface ReviewTask {
            title: string;
            priority: Priority;
            estimate: string;
            rationale: string;
            steps: string[];
            deliverable?: string;
        }
        interface ReviewPlan {
            goal: string;
            tasks: ReviewTask[];
            risks: string[];
            assumptions: string[];
            nextAction: string;
        }

        const isPriority = (v: unknown): v is Priority => v === "P0" || v === "P1" || v === "P2";
        const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === "string");
        const isReviewTask = (v: unknown): v is ReviewTask => {
            if (!IssueChatParticipant.isRecord(v)) {
                return false;
            }
            const titleVal = v.title;
            const priorityVal = v.priority;
            const estimateVal = v.estimate;
            const rationaleVal = v.rationale;
            const stepsVal = v.steps;

            if (typeof titleVal !== "string" || !titleVal.trim()) {
                return false;
            }
            if (!isPriority(priorityVal)) {
                return false;
            }
            if (typeof estimateVal !== "string" || !estimateVal.trim()) {
                return false;
            }
            if (typeof rationaleVal !== "string" || !rationaleVal.trim()) {
                return false;
            }
            if (!isStringArray(stepsVal) || stepsVal.length === 0) {
                return false;
            }
            const deliverableVal = v.deliverable;
            if (deliverableVal !== undefined && typeof deliverableVal !== "string") {
                return false;
            }
            return true;
        };
        const isReviewPlan = (v: unknown): v is ReviewPlan => {
            if (!IssueChatParticipant.isRecord(v)) {
                return false;
            }
            if (typeof v.goal !== "string" || !v.goal.trim()) {
                return false;
            }
            if (!Array.isArray(v.tasks) || !v.tasks.every(isReviewTask)) {
                return false;
            }
            if (!isStringArray(v.risks)) {
                return false;
            }
            if (!isStringArray(v.assumptions)) {
                return false;
            }
            if (typeof v.nextAction !== "string" || !v.nextAction.trim()) {
                return false;
            }
            return true;
        };

        const schemaHint = `\n\n请仅输出 JSON（不要输出解释文字），严格符合以下结构：\n{\n  "goal": "...",\n  "tasks": [\n    {\n      "title": "...",\n      "priority": "P0|P1|P2",\n      "estimate": "例如 30m/2h/1d",\n      "rationale": "为什么要做",\n      "steps": ["具体可执行步骤1", "步骤2"],\n      "deliverable": "可选：产出物"\n    }\n  ],\n  "risks": ["..."],\n  "assumptions": ["..."],\n  "nextAction": "用户下一步最小动作"\n}\n`;

        const contentForReview = hasDoc
            ? `以下是需要审阅的 Markdown 内容：\n\n---\n${docText}\n---\n`
            : "";

        const focusHint = focus
            ? `用户关注点/目标：${focus}\n`
            : "用户关注点/目标：生成更可执行、可落地的计划（拆成任务、优先级、下一步动作）。\n";

        const userPrompt =
            `你是一个严格、务实的执行教练。你的目标是把用户的内容审阅后转成“可执行计划”。\n` +
            `${focusHint}` +
            `要求：\n` +
            `- 任务必须是可执行动作，避免抽象词（如“优化”“提升”）不落地\n` +
            `- 每条任务给出最小步骤（steps），能直接照着做\n` +
            `- P0 代表必须先做的阻塞项\n` +
            `- 如果内容缺信息，用 assumptions 明确补齐，并把补齐动作列为任务\n` +
            `${contentForReview}` +
            `${schemaHint}`;

        const response = await request.model.sendRequest(
            [vscode.LanguageModelChatMessage.User(userPrompt)],
            { justification: "审阅并生成可执行计划" },
            token
        );

        const raw = await IssueChatParticipant.aggregateText(response, token);

        let planUnknown: unknown;
        try {
            planUnknown = IssueChatParticipant.extractJsonObject(raw);
        } catch (e) {
            Logger.getInstance().warn("[IssueChatParticipant] /审阅 JSON 解析失败", e);
            stream.markdown("❌ 生成计划失败：模型没有返回可解析的 JSON。请重试或缩短输入内容。\n");
            return;
        }

        if (!isReviewPlan(planUnknown)) {
            Logger.getInstance().warn("[IssueChatParticipant] /审阅 JSON 不符合 schema", planUnknown);
            stream.markdown("❌ 生成计划失败：模型返回的 JSON 结构不符合预期。请重试。\n");
            return;
        }

        const plan = planUnknown;

        stream.markdown(`# ✅ 可执行计划\n\n`);
        stream.markdown(`**目标**：${plan.goal}\n\n`);
        stream.markdown(`**下一步最小动作**：${plan.nextAction}\n\n`);

        stream.markdown("## 📋 任务清单\n\n");
        plan.tasks.slice(0, 12).forEach((task, index) => {
            stream.markdown(
                `${index + 1}. **${task.title}**（${task.priority} / ${task.estimate}）\n` +
                    `   - 理由：${task.rationale}\n` +
                    `   - 步骤：\n${task.steps.map(s => `     - ${s}`).join("\n")}\n` +
                    (task.deliverable ? `   - 产出物：${task.deliverable}\n` : "") +
                    "\n"
            );

            const body =
                `# ${task.title}\n\n` +
                `## Why\n${task.rationale}\n\n` +
                `## Steps\n${task.steps.map(s => `- ${s}`).join("\n")}\n\n` +
                (task.deliverable ? `## Deliverable\n${task.deliverable}\n\n` : "");

            stream.button({
                command: "issueManager.createIssueFromReviewTask",
                title: "➕ 创建为问题",
                arguments: [{ title: task.title, body }],
            });
        });

        if (plan.risks.length > 0) {
            stream.markdown("## ⚠️ 风险\n\n");
            stream.markdown(plan.risks.map(r => `- ${r}`).join("\n") + "\n\n");
        }

        if (plan.assumptions.length > 0) {
            stream.markdown("## 🧩 假设/缺口\n\n");
            stream.markdown(plan.assumptions.map(a => `- ${a}`).join("\n") + "\n\n");
        }

        const planMarkdown =
            `# ${plan.goal}\n\n` +
            `## Next Action\n${plan.nextAction}\n\n` +
            `## Tasks\n` +
            plan.tasks
                .map(t => {
                    const header = `- [ ] **${t.title}** (${t.priority}/${t.estimate})`;
                    const why = `  - Why: ${t.rationale}`;
                    const steps = t.steps.map(s => `  - Step: ${s}`).join("\n");
                    const deliverable = t.deliverable ? `\n  - Deliverable: ${t.deliverable}` : "";
                    return `${header}\n${why}\n${steps}${deliverable}`;
                })
                .join("\n") +
            `\n\n## Risks\n${plan.risks.map(r => `- ${r}`).join("\n")}\n\n` +
            `## Assumptions\n${plan.assumptions.map(a => `- ${a}`).join("\n")}\n`;

        stream.button({
            command: "issueManager.saveReviewPlanAsDoc",
            title: "📝 保存为文档",
            arguments: [{ title: `Review - ${plan.goal}`, markdown: planMarkdown }],
        });
    }

    /**
     * 处理创建问题命令
     */
    private async handleCreateCommand(
        prompt: string,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<void> {
        if (!prompt) {
            stream.markdown("❓ 请提供问题标题。例如: `/新建 修复登录bug`\n");
            return;
        }

        stream.progress("正在创建问题...");

        // 使用 LLM 优化标题
        let optimizedTitle = prompt;
        try {
            // 注意: VS Code 的 CancellationToken 与 AbortSignal 不完全兼容
            // 这里暂不传递 token,让 LLM 服务使用默认超时
            const generated = await LLMService.generateTitle(prompt);
            if (generated && !token.isCancellationRequested) {
                optimizedTitle = generated;
                stream.markdown(`💡 AI 优化标题: **${optimizedTitle}**\n\n`);
            }
        } catch (error) {
            // LLM 失败时使用原始输入
            Logger.getInstance().warn(
                "[IssueChatParticipant] LLM 生成标题失败,使用原始输入",
                error
            );
        }

        // 创建问题文件
        const uri = await createIssueMarkdown({ markdownBody: `# ${optimizedTitle}\n\n` })

        if (uri) {
            const filename = path.basename(uri.fsPath);
            stream.markdown(`✅ 已创建问题: \`${filename}\`\n\n`);

            // 创建一个包含 resourceUri 的对象,符合 focusIssueFromIssueFile 命令的要求
            stream.button({
                command: "issueManager.focusIssueFromIssueFile",
                arguments: [{ resourceUri: uri }],
                title: "⭐ 添加到关注",
            });
        } else {
            stream.markdown("❌ 创建问题失败\n");
        }
    }

    /**
     * 处理搜索问题命令
     */
    private async handleSearchCommand(
        prompt: string,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<void> {
        if (!prompt) {
            stream.markdown("❓ 请提供搜索关键词。例如: `/搜索 登录`\n");
            return;
        }

        stream.progress("正在搜索问题...");

        // 扁平化树节点（已包含标题）
        const flatNodes = await getFlatTree();

        // 关键词匹配搜索：标题、文件路径、父节点标题
        const keyword = prompt.toLowerCase();
        const matchedIssueNodes = flatNodes.filter(node => {
            // 匹配标题
            if (node.title.toLowerCase().includes(keyword)) {
                return true;
            }
            // 匹配文件路径
            if (node.filePath.toLowerCase().includes(keyword)) {
                return true;
            }
            // 匹配父节点标题（分组标题）
            if (node.parentPath.some(parent => parent.title.toLowerCase().includes(keyword))) {
                return true;
            }
            return false;
        });

        if (matchedIssueNodes.length === 0) {
            stream.markdown(`🔍 没有找到包含 "${prompt}" 的问题\n`);
            return;
        }

        stream.markdown(`🔍 找到 **${matchedIssueNodes.length}** 个相关问题:\n\n`);

        // 显示前10个结果
        const displayIssues = matchedIssueNodes.slice(0, 10);
        const issueDir = getIssueDir() || "";

        displayIssues.forEach((issue, index) => {
            // 构建完整路径并生成 URI，使标题可点击
            const fullPath = path.isAbsolute(issue.filePath)
                ? issue.filePath
                : path.join(issueDir, issue.filePath);
            const uri = vscode.Uri.file(fullPath);

            stream.markdown(`${index + 1}. [**${issue.title}**](${uri})\n`);

            // 显示父节点信息
            if (issue.parentPath.length > 0) {
                const parentLinks = issue.parentPath
                    .map(parent => {
                        const fullPath = path.isAbsolute(parent.filePath)
                            ? parent.filePath
                            : path.join(issueDir, parent.filePath);
                        const uri = vscode.Uri.file(fullPath);
                        // 使用代码样式 [`标题`](链接) 可以改变链接颜色（通常随主题变为非蓝色），同时保持可点击
                        return `[\`${parent.title}\`](${uri})`;
                    })
                    .join(" > ");
                stream.markdown(`   > ${parentLinks}\n`);
            }
        });

        if (matchedIssueNodes.length > 10) {
            stream.markdown(`\n_...还有 ${matchedIssueNodes.length - 10} 个结果_\n\n`);
        }

        // 添加搜索按钮
        stream.button({
            command: "issueManager.searchIssuesInFocused",
            title: "🔍 打开搜索面板",
        });
    }

    /**
     * 处理深度研究/文档生成命令
     */
    private async handleResearchCommand(
        prompt: string,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<void> {
        if (!prompt) {
            stream.markdown("❓ 请提供研究主题。例如: `/研究 如何优化 React 性能`\n");
            return;
        }

        stream.progress("正在进行深度研究并撰写文档...");

        // 创建 AbortController 以处理取消请求
        const controller = new AbortController();
        const cancellationListener = token.onCancellationRequested(() => {
            controller.abort();
        });

        try {
            // 调用 LLM 生成文档内容
            const { title, content, modelFamily } = await LLMService.generateDocument(prompt, {
                signal: controller.signal,
            });

            if (!title || !content) {
                stream.markdown("❌ 生成文档失败，请稍后重试。\n");
                return;
            }

            stream.markdown(`💡 已生成文档: **${title}** (使用模型: ${modelFamily || "未知"})\n\n`);

            // 创建问题文件
            const uri = await createIssueMarkdown({ markdownBody: content, frontmatter: { title: title } });

            if (uri) {
                const filename = path.basename(uri.fsPath);
                stream.markdown(`✅ 文档已保存: \`${filename}\`\n\n`);

                stream.button({
                    command: "issueManager.focusIssueFromIssueFile",
                    arguments: [{ resourceUri: uri }],
                    title: "⭐ 添加到关注",
                });

                stream.button({
                    command: "vscode.open",
                    arguments: [uri],
                    title: "📄 打开文档",
                });
            } else {
                stream.markdown("❌ 保存文件失败\n");
            }
        } catch (error) {
            // 检查是否是取消错误
            if (
                token.isCancellationRequested ||
                (error instanceof Error && error.message === "请求已取消")
            ) {
                stream.markdown("❌ 操作已取消\n");
                return;
            }
            Logger.getInstance().error("[IssueChatParticipant] Research failed", error);
            stream.markdown("❌ 研究过程中发生错误\n");
        } finally {
            cancellationListener.dispose();
        }
    }

    /**
     * 处理帮助命令
     */
    private handleHelpCommand(stream: vscode.ChatResponseStream): void {
        stream.markdown("# 问题管理器 - 帮助\n\n");
        stream.markdown("使用 `@issueManager` 在聊天中管理问题。\n\n");
        stream.markdown("## 📋 可用命令\n\n");

        stream.markdown("### `/新建` - 创建新问题\n");
        stream.markdown("创建一个新的问题文件,支持 AI 标题优化。\n\n");
        stream.markdown("**示例:**\n");
        stream.markdown("- `@issueManager /新建 修复登录bug`\n");
        stream.markdown("- `@issueManager /新建 优化首页加载速度`\n\n");

        stream.markdown("### `/搜索` - 搜索问题\n");
        stream.markdown("根据关键词搜索现有问题。\n\n");
        stream.markdown("**示例:**\n");
        stream.markdown("- `@issueManager /搜索 登录`\n");
        stream.markdown("- `@issueManager /搜索 性能`\n\n");

        stream.markdown("### `/研究` - 深度研究并生成文档\n");
        stream.markdown("利用 AI 进行深度分析并生成详细文档。\n\n");
        stream.markdown("**示例:**\n");
        stream.markdown("- `@issueManager /研究 如何优化 React 性能`\n");
        stream.markdown("- `@issueManager /研究 微服务架构设计模式`\n\n");

        stream.markdown("### `/agent` - 🤖 智能 Agent 自主研究 (NEW!)\n");
        stream.markdown("使用智能 Agent 进行多步骤自主研究。Agent 会自动规划研究步骤、搜索知识库、分析关系并生成深度报告。\n\n");
        stream.markdown("**特点:**\n");
        stream.markdown("- 🧠 自主规划研究步骤\n");
        stream.markdown("- 🔍 智能搜索相关问题\n");
        stream.markdown("- 🕸️ 分析知识图谱关系\n");
        stream.markdown("- 📊 生成详细研究报告\n");
        stream.markdown("- 💾 可保存完整研究过程\n\n");
        stream.markdown("**示例:**\n");
        stream.markdown("- `@issueManager /agent TypeScript 装饰器最佳实践`\n");
        stream.markdown("- `@issueManager /agent 分布式系统设计模式`\n");
        stream.markdown("- `@issueManager /agent 如何提升代码质量`\n\n");

        stream.markdown("### `/审阅` - 生成可执行计划\n");
        stream.markdown("审阅当前打开的文档/笔记，并生成可执行任务清单（带优先级与下一步动作）。\n\n");
        stream.markdown("**示例:**\n");
        stream.markdown("- `@issueManager /审阅`\n");
        stream.markdown("- `@issueManager /审阅 优化本周工作计划可执行性`\n\n");

        stream.markdown("### `/帮助` - 显示此帮助\n\n");

        stream.markdown("## 💡 智能模式\n\n");
        stream.markdown("不使用命令时,AI 会理解您的意图:\n");
        stream.markdown("- `@issueManager 创建一个关于性能优化的问题`\n");
        stream.markdown("- `@issueManager 帮我找找登录相关的问题`\n");
        stream.markdown("- `@issueManager 帮我研究一下分布式事务`\n\n");

        // 添加快捷按钮
        stream.button({
            command: "issueManager.openFocusedView",
            title: "👀 打开关注问题",
        });

        stream.button({
            command: "issueManager.openRecentView",
            title: "🕐 打开最近问题",
        });

        stream.button({
            command: "issueManager.smartResearch",
            title: "🤖 启动智能研究",
        });
    }

    /**
     * 处理默认命令(无斜杠命令)
     * 使用 AI 理解用户意图
     */
    private async handleDefaultCommand(
        prompt: string,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<void> {
        if (!prompt) {
            this.handleHelpCommand(stream);
            return;
        }

        // 检测创建意图
        const createTitle = detectIntent(
            prompt,
            INTENT_CONFIG.create.keywords,
            INTENT_CONFIG.create.noiseWords
        );
        if (createTitle) {
            stream.markdown(`💡 检测到创建意图...\n\n`);
            await this.handleCreateCommand(createTitle, stream, token);
            return;
        }

        // 检测搜索意图
        const searchKeyword = detectIntent(
            prompt,
            INTENT_CONFIG.search.keywords,
            INTENT_CONFIG.search.noiseWords
        );
        if (searchKeyword) {
            stream.markdown(`💡 检测到搜索意图...\n\n`);
            await this.handleSearchCommand(searchKeyword, stream, token);
            return;
        }

        // 检测研究意图
        const researchTopic = detectIntent(
            prompt,
            INTENT_CONFIG.research.keywords,
            INTENT_CONFIG.research.noiseWords
        );
        if (researchTopic) {
            stream.markdown(`💡 检测到研究意图...\n\n`);
            await this.handleResearchCommand(researchTopic, stream, token);
            return;
        }

        // 默认显示帮助
        stream.markdown("💡 我可以帮您管理问题。\n\n");
        stream.markdown("试试:\n");
        stream.markdown("- `/新建 [标题]` - 创建新问题\n");
        stream.markdown("- `/搜索 [关键词]` - 搜索问题\n");
        stream.markdown("- `/研究 [主题]` - 深度研究并生成文档\n");
        stream.markdown("- `/agent [主题]` - 🤖 智能 Agent 自主研究（多步骤推理）\n");
        stream.markdown("- `/帮助` - 查看所有命令\n\n");
    }

    /**
     * 处理智能 Agent 研究命令
     * 
     * 使用多步骤推理和工具调用进行深度研究
     */
    private async handleAgentResearchCommand(
        prompt: string,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<void> {
        if (!prompt) {
            stream.markdown("❓ 请提供研究主题。例如: `/agent TypeScript 装饰器最佳实践`\n");
            return;
        }

        stream.markdown("🤖 启动智能 Agent 进行自主研究...\n\n");
        stream.progress("Agent 正在规划研究步骤...");

        const agentService = new AgentService();
        const steps: Array<{ stepNumber: number; reasoning: string; tool?: string; result?: unknown }> = [];

        try {
            const result = await agentService.executeResearchTask(
                prompt,
                10,
                step => {
                    if (step.reasoning) {
                        steps.push({
                            stepNumber: step.stepNumber,
                            reasoning: step.reasoning,
                            tool: step.tool,
                            result: step.result,
                        });
                        stream.markdown(`\n### 步骤 ${step.stepNumber}: ${step.reasoning}\n`);
                        if (step.tool) {
                            stream.markdown(`**工具**: \`${step.tool}\`\n`);
                        }
                        stream.progress(`执行步骤 ${step.stepNumber}...`);
                    }
                },
                token
            );

            if (!result.success) {
                throw new Error(result.error || "Agent 研究任务失败");
            }

            stream.markdown("\n\n---\n\n## 📊 研究报告\n\n");

            const reportContent =
                result.finalResult && typeof result.finalResult === "object"
                    ? (result.finalResult as { report: string }).report
                    : "无法生成报告";

            stream.markdown(reportContent);

            stream.markdown("\n\n---\n\n");
            stream.markdown(`✅ **Agent 研究完成**，共执行 ${steps.length} 个步骤\n\n`);

            // 提供保存选项
            stream.button({
                command: "issueManager.saveAgentResearchReport",
                arguments: [{ topic: prompt, report: reportContent, steps }],
                title: "💾 保存研究报告",
            });
        } catch (error) {
            if (
                token.isCancellationRequested ||
                (error instanceof Error && error.message === "任务已取消")
            ) {
                stream.markdown("\n\n❌ Agent 任务已取消\n");
                return;
            }
            Logger.getInstance().error("[IssueChatParticipant] Agent research failed", error);
            stream.markdown(
                `\n\n❌ Agent 研究失败: ${error instanceof Error ? error.message : String(error)}\n`
            );
        }
    }
}
