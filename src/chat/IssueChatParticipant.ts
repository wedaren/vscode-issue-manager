import * as vscode from "vscode";
import { getIssueDir } from "../config";
import { LLMService } from "../llm/LLMService";
import { getFlatTree } from "../data/issueTreeManager";
import * as path from "path";
import { Logger } from "../core/utils/Logger";
import { createIssueMarkdown } from "../data/IssueMarkdowns";
import { KnowledgeGraphAgent, KnowledgeGraphReport, DiscoveredConnection } from "../llm/KnowledgeGraphAgent";
import { LearningPathAgent, LearningPath, LearningStage } from "../llm/LearningPathAgent";
import { IdeaSparkAgent, IdeaSession, IdeaSpark, saveSparkAsIssue } from "../llm/IdeaSparkAgent";

/**
 * 命令别名常量定义
 */
const CREATE_COMMANDS = ["新建", "new", "create"] as const;
const SEARCH_COMMANDS = ["搜索", "search", "find"] as const;
const REVIEW_COMMANDS = ["审阅", "review"] as const;
const RESEARCH_COMMANDS = ["研究", "research", "deep", "doc", "文档"] as const;
const HELP_COMMANDS = ["帮助", "help"] as const;
// 🆕 三个超能力 Agent 命令
const KNOWLEDGE_GRAPH_COMMANDS = ["知识图谱", "知识连接", "连接", "graph", "connect"] as const;
const LEARNING_PATH_COMMANDS = ["学习路径", "学习", "learn", "path"] as const;
const IDEA_SPARK_COMMANDS = ["创意", "灵感", "激发", "spark", "idea"] as const;

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
            // 🆕 三个超能力 Agent 命令
            } else if ((KNOWLEDGE_GRAPH_COMMANDS as readonly string[]).includes(command)) {
                await this.handleKnowledgeGraphCommand(prompt, stream, token);
            } else if ((LEARNING_PATH_COMMANDS as readonly string[]).includes(command)) {
                await this.handleLearningPathCommand(prompt, stream, token);
            } else if ((IDEA_SPARK_COMMANDS as readonly string[]).includes(command)) {
                await this.handleIdeaSparkCommand(prompt, stream, token);
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
        const uri = await createIssueMarkdown({ markdownBody: `# ${optimizedTitle}\n\n` });

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

    // ==================== 🆕 三个超能力 Agent ====================

    /**
     * 🧠 处理知识图谱命令：发现知识库中隐藏的关联
     * 
     * 这是一个令人惊叹的 LLM + Agent 组合功能！
     * Agent 会深度分析每个问题的内容，发现语义上的隐藏关联，
     * 并建议应该建立的知识连接。
     */
    private async handleKnowledgeGraphCommand(
        prompt: string,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<void> {
        stream.markdown("# 🧠 知识连接 Agent\n\n");
        stream.markdown("正在深度分析你的知识库，发现隐藏的关联...\n\n");

        const abortController = new AbortController();
        token.onCancellationRequested(() => abortController.abort());

        const agent = new KnowledgeGraphAgent({
            maxAnalysisRounds: 3,
            minConfidenceThreshold: 0.6,
        });

        // 监听进度
        agent.onProgress = (state, message) => {
            stream.progress(message);
        };

        agent.onThought = (thought) => {
            stream.markdown(`> 💭 **${thought.action}**: ${thought.reasoning.substring(0, 80)}${thought.reasoning.length > 80 ? "..." : ""}\n`);
        };

        agent.onConnection = (conn) => {
            const typeEmoji: Record<string, string> = {
                "semantic-similar": "🔗",
                "concept-overlap": "🎯",
                "causal-relation": "⚡",
                "prerequisite": "📚",
                "extension": "🌱",
                "contradiction": "⚔️",
                "example-of": "💡",
                "part-of": "🧩",
            };
            stream.markdown(`\n${typeEmoji[conn.relationshipType] || "🔗"} 发现连接: **${conn.sourceNode.title}** ↔ **${conn.targetNode.title}** (${Math.round(conn.confidence * 100)}%)\n`);
        };

        try {
            const report = await agent.analyze({ signal: abortController.signal });

            stream.markdown("\n---\n\n");
            stream.markdown("# 📊 知识图谱分析报告\n\n");

            // 概览
            stream.markdown(`## 📈 概览\n\n`);
            stream.markdown(`| 指标 | 数值 |\n|------|------|\n`);
            stream.markdown(`| 总知识节点 | ${report.summary.totalNodes} |\n`);
            stream.markdown(`| 现有连接 | ${report.summary.existingConnections} |\n`);
            stream.markdown(`| 发现新连接 | ${report.summary.discoveredConnections} |\n`);
            stream.markdown(`| 知识孤岛 | ${report.summary.knowledgeIslands} |\n`);
            stream.markdown(`| 覆盖度评分 | ${report.summary.coverageScore}/100 |\n`);
            stream.markdown(`| 内聚度评分 | ${report.summary.cohesionScore}/100 |\n\n`);

            // 发现的连接
            if (report.discoveredConnections.length > 0) {
                stream.markdown(`## 🔗 发现的隐藏关联 (${report.discoveredConnections.length})\n\n`);

                const topConnections = report.discoveredConnections
                    .sort((a, b) => b.confidence - a.confidence)
                    .slice(0, 10);

                for (const conn of topConnections) {
                    stream.markdown(`### ${conn.sourceNode.title} ↔ ${conn.targetNode.title}\n`);
                    stream.markdown(`- **关系类型**: ${conn.relationshipType}\n`);
                    stream.markdown(`- **置信度**: ${Math.round(conn.confidence * 100)}%\n`);
                    stream.markdown(`- **解释**: ${conn.explanation}\n`);
                    if (conn.sharedConcepts.length > 0) {
                        stream.markdown(`- **共享概念**: ${conn.sharedConcepts.join(", ")}\n`);
                    }
                    stream.markdown("\n");

                    // 添加创建连接按钮
                    stream.button({
                        command: "vscode.open",
                        arguments: [vscode.Uri.file(conn.sourceNode.filePath)],
                        title: `📄 打开 ${conn.sourceNode.title}`,
                    });
                }
            }

            // 知识孤岛
            if (report.knowledgeIslands.length > 0) {
                stream.markdown(`## 🏝️ 知识孤岛\n\n`);
                for (const island of report.knowledgeIslands) {
                    stream.markdown(`### ${island.theme}\n`);
                    stream.markdown(`- **孤立原因**: ${island.isolationReason}\n`);
                    stream.markdown(`- **整合建议**: ${island.integrationSuggestion}\n`);
                    stream.markdown(`- **包含节点**: ${island.nodes.map(n => n.title).join(", ")}\n\n`);
                }
            }

            // 建议
            if (report.recommendations.length > 0) {
                stream.markdown(`## 💡 改进建议\n\n`);
                for (const rec of report.recommendations) {
                    const priorityEmoji = { high: "🔴", medium: "🟡", low: "🟢" };
                    stream.markdown(`- ${priorityEmoji[rec.priority]} **${rec.type}**: ${rec.description}\n`);
                }
            }

            stream.markdown(`\n---\n_分析了 ${report.metrics.nodesAnalyzed} 个节点，耗时 ${Math.round(report.metrics.totalDuration / 1000)} 秒_\n`);

        } catch (error) {
            if (abortController.signal.aborted) {
                stream.markdown("\n\n⚠️ 分析已取消\n");
            } else {
                Logger.getInstance().error("[IssueChatParticipant] Knowledge graph failed:", error);
                stream.markdown(`\n\n❌ 分析失败: ${error instanceof Error ? error.message : String(error)}\n`);
            }
        }
    }

    /**
     * 🎯 处理学习路径命令：生成个性化学习路径
     * 
     * 这是一个令人惊叹的 LLM + Agent 组合功能！
     * Agent 会理解你的学习目标，分析知识库中的内容和依赖关系，
     * 为你生成最优的学习路径。
     */
    private async handleLearningPathCommand(
        prompt: string,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<void> {
        if (!prompt) {
            stream.markdown("❓ 请提供你的学习目标。例如: `/学习路径 掌握 TypeScript`\n");
            return;
        }

        stream.markdown("# 🎯 学习路径 Agent\n\n");
        stream.markdown(`正在为你的学习目标生成个性化路径: **${prompt}**\n\n`);

        const abortController = new AbortController();
        token.onCancellationRequested(() => abortController.abort());

        const agent = new LearningPathAgent({
            maxNodesPerPath: 15,
        });

        agent.onProgress = (state, message) => {
            stream.progress(message);
        };

        agent.onThought = (thought) => {
            stream.markdown(`> 💭 **${thought.action}**: ${thought.reasoning.substring(0, 100)}${thought.reasoning.length > 100 ? "..." : ""}\n`);
        };

        try {
            const learningPath = await agent.generatePath(prompt, { signal: abortController.signal });

            stream.markdown("\n---\n\n");
            stream.markdown(`# 📚 你的学习路径\n\n`);
            stream.markdown(`**学习目标**: ${learningPath.goal}\n`);
            stream.markdown(`**适合人群**: ${learningPath.targetAudience}\n\n`);

            // 概览
            stream.markdown(`## 📊 学习概览\n\n`);
            stream.markdown(`| 指标 | 数值 |\n|------|------|\n`);
            stream.markdown(`| 知识点数量 | ${learningPath.totalNodes} |\n`);
            stream.markdown(`| 学习阶段 | ${learningPath.stages.length} |\n`);
            stream.markdown(`| 预计总时长 | ${Math.round(learningPath.totalDuration / 60)} 小时 |\n`);
            stream.markdown(`| 建议周期 | ${learningPath.suggestedSchedule.totalWeeks} 周 |\n\n`);

            // 难度分布
            stream.markdown(`**难度分布**: 🟢 入门 ${learningPath.difficultyProgression.beginner} | 🟡 进阶 ${learningPath.difficultyProgression.intermediate} | 🔴 高级 ${learningPath.difficultyProgression.advanced}\n\n`);

            // 学习阶段
            stream.markdown(`## 🗺️ 学习阶段\n\n`);

            for (let i = 0; i < learningPath.stages.length; i++) {
                const stage = learningPath.stages[i];
                stream.markdown(`### 阶段 ${i + 1}: ${stage.name}\n`);
                stream.markdown(`📝 ${stage.description}\n\n`);
                stream.markdown(`⏱️ 预计时长: ${Math.round(stage.estimatedDuration / 60)} 小时\n`);
                stream.markdown(`🏆 里程碑: ${stage.milestone}\n\n`);

                stream.markdown(`**知识点:**\n`);
                for (const node of stage.nodes) {
                    const difficultyEmoji = { beginner: "🟢", intermediate: "🟡", advanced: "🔴" };
                    stream.markdown(`- ${difficultyEmoji[node.difficulty]} [${node.title}](${vscode.Uri.file(node.filePath)}) (${node.estimatedTime}分钟)\n`);
                    if (node.keyTakeaways.length > 0) {
                        stream.markdown(`  - 要点: ${node.keyTakeaways.slice(0, 2).join("; ")}\n`);
                    }
                }
                stream.markdown("\n");

                if (stage.checkQuestions.length > 0) {
                    stream.markdown(`**✅ 检验问题:**\n`);
                    stage.checkQuestions.forEach((q, j) => {
                        stream.markdown(`${j + 1}. ${q}\n`);
                    });
                    stream.markdown("\n");
                }
            }

            // 学习成果
            if (learningPath.learningOutcomes.length > 0) {
                stream.markdown(`## 🎓 学习成果\n\n`);
                stream.markdown(`完成这条学习路径后，你将掌握:\n`);
                learningPath.learningOutcomes.forEach(outcome => {
                    stream.markdown(`- ✅ ${outcome}\n`);
                });
            }

            stream.markdown(`\n---\n_基于你的知识库生成，共 ${learningPath.stages.length} 个阶段、${learningPath.totalNodes} 个知识点_\n`);

        } catch (error) {
            if (abortController.signal.aborted) {
                stream.markdown("\n\n⚠️ 生成已取消\n");
            } else {
                Logger.getInstance().error("[IssueChatParticipant] Learning path failed:", error);
                stream.markdown(`\n\n❌ 生成失败: ${error instanceof Error ? error.message : String(error)}\n`);
            }
        }
    }

    /**
     * 💡 处理创意激发命令：跨领域知识碰撞产生创新
     * 
     * 这是一个令人惊叹的 LLM + Agent 组合功能！
     * Agent 会从你的知识库中随机或智能选择不同领域的概念，
     * 让它们相互碰撞，产生意想不到的创新想法。
     */
    private async handleIdeaSparkCommand(
        prompt: string,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<void> {
        stream.markdown("# 💡 创意激发 Agent\n\n");
        stream.markdown("正在从你的知识库中提取概念，准备进行跨领域碰撞...\n\n");

        if (prompt) {
            stream.markdown(`🎯 聚焦主题: **${prompt}**\n\n`);
        }

        const abortController = new AbortController();
        token.onCancellationRequested(() => abortController.abort());

        const agent = new IdeaSparkAgent({
            sparksPerSession: 5,
            creativityLevel: "moderate",
        });

        agent.onProgress = (state, message) => {
            stream.progress(message);
        };

        agent.onThought = (thought) => {
            stream.markdown(`> 💭 **${thought.action}**: ${thought.reasoning.substring(0, 80)}${thought.reasoning.length > 80 ? "..." : ""}\n`);
        };

        agent.onSpark = (spark) => {
            stream.markdown(`\n✨ **新创意**: ${spark.idea.title}\n`);
        };

        try {
            const session = await agent.spark({
                signal: abortController.signal,
                theme: prompt || undefined,
            });

            stream.markdown("\n---\n\n");
            stream.markdown(`# 🌟 创意会话报告\n\n`);
            stream.markdown(`共探索 **${session.totalConceptsExplored}** 个概念，产生 **${session.sparks.length}** 个创意火花\n\n`);

            // 按综合评分排序展示
            const sortedSparks = session.sparks.sort((a, b) => {
                const scoreA = (a.idea.noveltyScore + a.idea.feasibilityScore + a.idea.impactScore) / 3;
                const scoreB = (b.idea.noveltyScore + b.idea.feasibilityScore + b.idea.impactScore) / 3;
                return scoreB - scoreA;
            });

            for (let i = 0; i < sortedSparks.length; i++) {
                const spark = sortedSparks[i];
                const avgScore = Math.round((spark.idea.noveltyScore + spark.idea.feasibilityScore + spark.idea.impactScore) / 3);

                stream.markdown(`## 💡 创意 ${i + 1}: ${spark.idea.title}\n\n`);
                stream.markdown(`${spark.idea.description}\n\n`);

                // 评分
                stream.markdown(`**评分**: 🆕 新颖度 ${spark.idea.noveltyScore} | ⚙️ 可行性 ${spark.idea.feasibilityScore} | 🎯 影响力 ${spark.idea.impactScore} | 📊 综合 **${avgScore}**\n\n`);

                // 碰撞来源
                const collisionTypeLabels: Record<string, string> = {
                    analogy: "类比迁移",
                    combination: "组合融合",
                    contrast: "对比启发",
                    abstraction: "抽象提升",
                    inversion: "逆向思考",
                };
                stream.markdown(`**碰撞方法**: ${collisionTypeLabels[spark.collisionType] || spark.collisionType}\n`);
                stream.markdown(`**概念碰撞**: ${spark.inputs.concept1.concept} (${spark.inputs.concept1.domain}) × ${spark.inputs.concept2.concept} (${spark.inputs.concept2.domain})${spark.inputs.concept3 ? ` × ${spark.inputs.concept3.concept}` : ""}\n\n`);

                // 核心洞见
                stream.markdown(`**🎯 核心洞见**: ${spark.elaboration.coreInsight}\n\n`);

                // 如何运作
                if (spark.elaboration.howItWorks) {
                    stream.markdown(`**⚙️ 如何运作**: ${spark.elaboration.howItWorks}\n\n`);
                }

                // 潜在应用
                if (spark.elaboration.potentialApplications.length > 0) {
                    stream.markdown(`**🌍 潜在应用**:\n`);
                    spark.elaboration.potentialApplications.forEach(app => {
                        stream.markdown(`- ${app}\n`);
                    });
                    stream.markdown("\n");
                }

                // 下一步
                if (spark.elaboration.nextSteps.length > 0) {
                    stream.markdown(`**📋 下一步**:\n`);
                    spark.elaboration.nextSteps.slice(0, 3).forEach((step, j) => {
                        stream.markdown(`${j + 1}. ${step}\n`);
                    });
                    stream.markdown("\n");
                }

                // 保存按钮
                stream.button({
                    command: "issueManager.createIssueFromReviewTask",
                    title: "💾 保存为问题",
                    arguments: [{
                        title: `💡 ${spark.idea.title}`,
                        body: `# 💡 ${spark.idea.title}\n\n${spark.idea.description}\n\n## 核心洞见\n${spark.elaboration.coreInsight}\n\n## 碰撞来源\n- ${spark.inputs.concept1.concept} × ${spark.inputs.concept2.concept}`,
                    }],
                });

                stream.markdown("\n---\n\n");
            }

            stream.markdown(`_创意会话完成，耗时 ${Math.round(session.duration / 1000)} 秒_\n`);

        } catch (error) {
            if (abortController.signal.aborted) {
                stream.markdown("\n\n⚠️ 创意会话已取消\n");
            } else {
                Logger.getInstance().error("[IssueChatParticipant] Idea spark failed:", error);
                stream.markdown(`\n\n❌ 创意激发失败: ${error instanceof Error ? error.message : String(error)}\n`);
            }
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

        stream.markdown("### `/审阅` - 生成可执行计划\n");
        stream.markdown("审阅当前打开的文档/笔记，并生成可执行任务清单（带优先级与下一步动作）。\n\n");
        stream.markdown("**示例:**\n");
        stream.markdown("- `@issueManager /审阅`\n");
        stream.markdown("- `@issueManager /审阅 优化本周工作计划可执行性`\n\n");

        stream.markdown("### 🔍 `/代码审阅` - 智能代码审阅 Agent\n");
        stream.markdown("使用 AI Agent 自主探索代码库，进行多轮迭代分析，发现潜在问题和改进机会。\n\n");
        stream.markdown("**示例:**\n");
        stream.markdown("- `@issueManager /代码审阅` - 审阅整个工作区\n");
        stream.markdown("- `@issueManager /cr 安全性` - 重点关注安全问题\n\n");

        stream.markdown("### 🧠 `/知识图谱` - 知识连接 Agent ⚡NEW\n");
        stream.markdown("深度分析知识库，发现问题之间隐藏的语义关联，自动建议应该建立的连接。\n\n");
        stream.markdown("**特色功能:**\n");
        stream.markdown("- 🌐 发现隐藏的知识关联\n");
        stream.markdown("- 🏝️ 识别知识孤岛\n");
        stream.markdown("- 📊 生成知识覆盖度报告\n\n");
        stream.markdown("**示例:**\n");
        stream.markdown("- `@issueManager /知识图谱`\n");
        stream.markdown("- `@issueManager /连接`\n\n");

        stream.markdown("### 🎯 `/学习路径` - 学习路径 Agent ⚡NEW\n");
        stream.markdown("基于知识库内容和你的学习目标，生成个性化的学习路径。\n\n");
        stream.markdown("**特色功能:**\n");
        stream.markdown("- 📚 智能分析知识依赖关系\n");
        stream.markdown("- 🗺️ 生成最优学习顺序\n");
        stream.markdown("- ⏱️ 估算学习时间\n");
        stream.markdown("- ✅ 提供阶段检验问题\n\n");
        stream.markdown("**示例:**\n");
        stream.markdown("- `@issueManager /学习路径 掌握 TypeScript`\n");
        stream.markdown("- `@issueManager /学习 系统设计`\n\n");

        stream.markdown("### 💡 `/创意` - 创意激发 Agent ⚡NEW\n");
        stream.markdown("随机碰撞不同领域的知识，激发创新灵感！\n\n");
        stream.markdown("**特色功能:**\n");
        stream.markdown("- 🎲 跨领域知识碰撞\n");
        stream.markdown("- 🔀 多种创意方法（类比/组合/逆向...）\n");
        stream.markdown("- 🌟 评估创意可行性\n");
        stream.markdown("- 📝 一键保存精彩创意\n\n");
        stream.markdown("**示例:**\n");
        stream.markdown("- `@issueManager /创意` - 随机激发\n");
        stream.markdown("- `@issueManager /灵感 AI产品` - 聚焦主题\n\n");

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
        stream.markdown("- `/帮助` - 查看所有命令\n\n");
    }
}
