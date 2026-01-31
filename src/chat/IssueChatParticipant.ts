import * as vscode from "vscode";
import { getIssueDir } from "../config";
import { LLMService, DecomposedQuestion, SubQuestion, OrganizeSuggestion } from "../llm/LLMService";
import { getFlatTree, getAssociatedFiles } from "../data/issueTreeManager";
import { getAllIssueMarkdowns } from "../data/IssueMarkdowns";
import * as path from "path";
import { Logger } from "../core/utils/Logger";
import { createIssueMarkdown } from "../data/IssueMarkdowns";

/**
 * 命令别名常量定义
 */
const CREATE_COMMANDS = ["新建", "new", "create"] as const;
const SEARCH_COMMANDS = ["搜索", "search", "find"] as const;
const REVIEW_COMMANDS = ["审阅", "review"] as const;
const RESEARCH_COMMANDS = ["研究", "research", "deep", "doc", "文档"] as const;
const HELP_COMMANDS = ["帮助", "help"] as const;
const DECOMPOSE_COMMANDS = ["分解", "decompose", "break", "拆解"] as const;
const ORGANIZE_COMMANDS = ["整理", "organize", "archive", "归档"] as const;
const INSIGHTS_COMMANDS = ["洞察", "insights", "health", "健康"] as const;

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
    decompose: {
        keywords: ["分解", "拆解", "拆分", "decompose", "break down"],
        noiseWords: ["帮我分解", "帮我拆解", "帮我拆分", "这个问题", "问题", "分解", "拆解", "拆分"],
    },
    organize: {
        keywords: ["整理", "归档", "organize", "archive"],
        noiseWords: ["帮我整理", "帮我归档", "孤立问题", "问题", "整理", "归档"],
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
            } else if ((DECOMPOSE_COMMANDS as readonly string[]).includes(command)) {
                await this.handleDecomposeCommand(prompt, stream, token);
            } else if ((ORGANIZE_COMMANDS as readonly string[]).includes(command)) {
                await this.handleOrganizeCommand(stream, token);
            } else if ((INSIGHTS_COMMANDS as readonly string[]).includes(command)) {
                await this.handleInsightsCommand(stream, token);
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
     * 🧩 处理问题分解命令 - 将复杂问题智能分解为可执行的子问题树
     */
    private async handleDecomposeCommand(
        prompt: string,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<void> {
        if (!prompt) {
            stream.markdown("❓ 请提供一个需要分解的复杂问题。例如:\n");
            stream.markdown("- `/分解 如何构建一个高可用的微服务架构`\n");
            stream.markdown("- `/分解 学习机器学习需要掌握哪些知识`\n");
            stream.markdown("- `/分解 如何从零开始创业`\n");
            return;
        }

        stream.progress("🧩 正在分析问题结构...");

        const controller = new AbortController();
        const cancellationListener = token.onCancellationRequested(() => {
            controller.abort();
        });

        try {
            const result = await LLMService.decomposeQuestion(prompt, {
                signal: controller.signal,
            });

            if (!result) {
                stream.markdown("❌ 问题分解失败，请稍后重试。\n");
                return;
            }

            // 显示分解结果
            stream.markdown(`# 🧩 问题分解结果\n\n`);
            stream.markdown(`## 📋 核心问题\n\n**${result.rootQuestion}**\n\n`);
            stream.markdown(`${result.overview}\n\n`);

            stream.markdown(`## 🌳 子问题树 (${result.subQuestions.length} 个子问题)\n\n`);

            // 按优先级分组显示
            const p0Questions = result.subQuestions.filter(q => q.priority === "P0");
            const p1Questions = result.subQuestions.filter(q => q.priority === "P1");
            const p2Questions = result.subQuestions.filter(q => q.priority === "P2");

            if (p0Questions.length > 0) {
                stream.markdown(`### 🔴 P0 - 核心基础\n\n`);
                for (const q of p0Questions) {
                    this.renderSubQuestion(stream, q, result.subQuestions);
                }
            }

            if (p1Questions.length > 0) {
                stream.markdown(`### 🟡 P1 - 重要扩展\n\n`);
                for (const q of p1Questions) {
                    this.renderSubQuestion(stream, q, result.subQuestions);
                }
            }

            if (p2Questions.length > 0) {
                stream.markdown(`### 🟢 P2 - 可选深入\n\n`);
                for (const q of p2Questions) {
                    this.renderSubQuestion(stream, q, result.subQuestions);
                }
            }

            stream.markdown(`## 📍 建议学习路径\n\n${result.suggestedPath}\n\n`);
            stream.markdown(`**预估总时间**: ${result.estimatedTotalTime}\n\n`);

            // 添加批量创建按钮
            stream.markdown(`---\n\n`);
            stream.button({
                command: "issueManager.batchCreateFromDecomposition",
                arguments: [result],
                title: "🚀 一键创建所有子问题",
            });

            stream.button({
                command: "issueManager.createIssueFromDecompositionRoot",
                arguments: [result],
                title: "📝 创建父问题文档",
            });

            stream.button({
                command: "issueManager.decomposition.openViewWithResult",
                arguments: [result],
                title: "📋 在分解视图中管理",
            });

        } catch (error) {
            if (
                token.isCancellationRequested ||
                (error instanceof Error && error.message === "请求已取消")
            ) {
                stream.markdown("❌ 操作已取消\n");
                return;
            }
            Logger.getInstance().error("[IssueChatParticipant] Decompose failed", error);
            stream.markdown("❌ 问题分解过程中发生错误\n");
        } finally {
            cancellationListener.dispose();
        }
    }

    /**
     * 渲染单个子问题
     */
    private renderSubQuestion(
        stream: vscode.ChatResponseStream,
        question: SubQuestion,
        allQuestions: SubQuestion[]
    ): void {
        const depNames = question.dependencies
            .map(depId => {
                const dep = allQuestions.find(q => q.id === depId);
                return dep ? `#${dep.id}` : `#${depId}`;
            })
            .join(", ");

        stream.markdown(`**${question.id}. ${question.title}**\n`);
        stream.markdown(`> ${question.description}\n\n`);
        
        if (question.dependencies.length > 0) {
            stream.markdown(`- 📎 前置依赖: ${depNames}\n`);
        }
        if (question.keywords.length > 0) {
            stream.markdown(`- 🏷️ 关键词: ${question.keywords.join(", ")}\n`);
        }
        stream.markdown(`\n`);

        // 为每个子问题添加单独创建按钮
        stream.button({
            command: "issueManager.createIssueFromSubQuestion",
            arguments: [question],
            title: `➕ 创建: ${question.title.substring(0, 20)}...`,
        });
        stream.markdown(`\n`);
    }

    /**
     * 🔗 处理智能整理命令 - 分析孤立问题并推荐归档位置
     */
    private async handleOrganizeCommand(
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<void> {
        stream.progress("🔗 正在分析孤立问题...");

        const controller = new AbortController();
        const cancellationListener = token.onCancellationRequested(() => {
            controller.abort();
        });

        try {
            // 获取所有问题和已关联的问题
            const allIssues = await getAllIssueMarkdowns();
            const associatedFiles = await getAssociatedFiles();
            const flatTree = await getFlatTree();

            // 找出孤立问题（未在树中关联的问题）
            const isolatedIssues = allIssues.filter(
                issue => !associatedFiles.has(path.basename(issue.uri.fsPath))
            );

            if (isolatedIssues.length === 0) {
                stream.markdown("✅ **太棒了！** 你的知识库没有孤立问题。\n\n");
                stream.markdown("所有问题都已妥善归档。继续保持！ 💪\n");
                return;
            }

            stream.markdown(`# 🔗 智能整理建议\n\n`);
            stream.markdown(`发现 **${isolatedIssues.length}** 个孤立问题等待归档。\n\n`);

            // 构建现有树结构供 LLM 分析
            const existingTree = flatTree.map(node => ({
                title: node.title,
                filePath: node.filePath,
                level: node.parentPath.length,
                children: [], // 简化结构
            }));

            // 准备孤立问题数据（包含内容预览）
            const isolatedData = await Promise.all(
                isolatedIssues.slice(0, 20).map(async issue => {
                    // 读取部分内容作为上下文
                    let content = "";
                    try {
                        const doc = await vscode.workspace.openTextDocument(issue.uri);
                        content = doc.getText().substring(0, 500);
                    } catch {
                        // 忽略读取失败
                    }
                    return {
                        title: issue.title,
                        filePath: path.basename(issue.uri.fsPath),
                        content,
                    };
                })
            );

            // 调用 LLM 分析
            const suggestions = await LLMService.organizeIsolatedIssues(
                isolatedData,
                existingTree,
                { signal: controller.signal }
            );

            if (!suggestions || suggestions.length === 0) {
                stream.markdown("❌ 无法生成归档建议，请稍后重试。\n");
                return;
            }

            // 按置信度排序
            const sortedSuggestions = suggestions.sort((a, b) => b.confidence - a.confidence);

            // 显示建议
            stream.markdown(`## 📊 归档建议\n\n`);

            for (const suggestion of sortedSuggestions) {
                const confidenceEmoji = suggestion.confidence >= 80 ? "🟢" : suggestion.confidence >= 60 ? "🟡" : "🔴";
                
                stream.markdown(`### ${confidenceEmoji} ${suggestion.isolatedIssue.title}\n\n`);
                
                if (suggestion.recommendedParent.isNew) {
                    stream.markdown(`**建议**: 创建新分类「${suggestion.recommendedParent.title}」并归入\n`);
                } else {
                    stream.markdown(`**建议归入**: 「${suggestion.recommendedParent.title}」\n`);
                }
                
                stream.markdown(`- 置信度: ${suggestion.confidence}%\n`);
                stream.markdown(`- 理由: ${suggestion.reason}\n`);

                if (suggestion.relatedIssues.length > 0) {
                    stream.markdown(`- 相关问题: ${suggestion.relatedIssues.join(", ")}\n`);
                }

                stream.markdown(`\n`);

                // 添加操作按钮
                stream.button({
                    command: "issueManager.acceptOrganizeSuggestion",
                    arguments: [suggestion],
                    title: `✅ 接受归档建议`,
                });
                stream.markdown(`\n`);
            }

            if (isolatedIssues.length > 20) {
                stream.markdown(`\n_注: 仅分析了前 20 个孤立问题，还有 ${isolatedIssues.length - 20} 个待整理_\n\n`);
            }

            // 批量操作按钮
            stream.markdown(`---\n\n`);
            stream.button({
                command: "issueManager.acceptAllOrganizeSuggestions",
                arguments: [sortedSuggestions.filter(s => s.confidence >= 70)],
                title: "🚀 一键接受高置信度建议 (≥70%)",
            });

        } catch (error) {
            if (
                token.isCancellationRequested ||
                (error instanceof Error && error.message === "请求已取消")
            ) {
                stream.markdown("❌ 操作已取消\n");
                return;
            }
            Logger.getInstance().error("[IssueChatParticipant] Organize failed", error);
            stream.markdown("❌ 整理分析过程中发生错误\n");
        } finally {
            cancellationListener.dispose();
        }
    }

    /**
     * 🔬 处理知识洞察命令 - 分析知识库健康状况
     */
    private async handleInsightsCommand(
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<void> {
        stream.progress("🔬 正在分析知识库健康状况...");

        const controller = new AbortController();
        const cancellationListener = token.onCancellationRequested(() => {
            controller.abort();
        });

        try {
            // 获取所有问题
            const allIssues = await getAllIssueMarkdowns();
            const associatedFiles = await getAssociatedFiles();

            // 计算统计数据
            const now = Date.now();
            const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;
            
            const recentCreated = allIssues.filter(i => i.ctime > oneWeekAgo).length;
            const recentModified = allIssues.filter(i => i.mtime > oneWeekAgo).length;

            // 准备数据
            const issueData = allIssues.map(issue => ({
                title: issue.title,
                filePath: path.basename(issue.uri.fsPath),
                mtime: issue.mtime,
                isOrphan: !associatedFiles.has(path.basename(issue.uri.fsPath)),
            }));

            // 调用 LLM 生成洞察
            const insights = await LLMService.generateKnowledgeInsights(
                issueData,
                { created: recentCreated, modified: recentModified, period: "7天" },
                { signal: controller.signal }
            );

            if (!insights) {
                stream.markdown("❌ 无法生成知识洞察，请稍后重试。\n");
                return;
            }

            // 显示洞察报告
            stream.markdown(`# 🔬 知识库健康报告\n\n`);

            // 健康度评分
            const healthEmoji = insights.healthScore >= 80 ? "🟢" : insights.healthScore >= 60 ? "🟡" : "🔴";
            stream.markdown(`## ${healthEmoji} 健康度评分: ${insights.healthScore}/100\n\n`);
            stream.markdown(`${insights.healthAnalysis}\n\n`);

            // 统计概览
            stream.markdown(`## 📊 统计概览\n\n`);
            stream.markdown(`- **总问题数**: ${allIssues.length}\n`);
            stream.markdown(`- **孤立问题**: ${issueData.filter(i => i.isOrphan).length}\n`);
            stream.markdown(`- **近 7 天新建**: ${recentCreated}\n`);
            stream.markdown(`- **近 7 天修改**: ${recentModified}\n\n`);

            // 主题分布
            if (insights.topicDistribution.length > 0) {
                stream.markdown(`## 🏷️ 主题分布\n\n`);
                for (const topic of insights.topicDistribution.slice(0, 5)) {
                    const bar = "█".repeat(Math.ceil(topic.percentage / 10));
                    stream.markdown(`- **${topic.topic}**: ${topic.count} (${topic.percentage}%) ${bar}\n`);
                }
                stream.markdown(`\n`);
            }

            // 被遗忘的问题
            if (insights.forgottenIssues.length > 0) {
                stream.markdown(`## 💤 可能被遗忘的问题\n\n`);
                for (const issue of insights.forgottenIssues.slice(0, 5)) {
                    stream.markdown(`- **${issue.title}**: ${issue.reason}\n`);
                }
                stream.markdown(`\n`);
            }

            // 孤立问题分析
            stream.markdown(`## 🏝️ 孤立问题分析\n\n`);
            const severityEmoji = insights.orphanAnalysis.severity === "high" ? "🔴" : 
                                  insights.orphanAnalysis.severity === "medium" ? "🟡" : "🟢";
            stream.markdown(`**严重程度**: ${severityEmoji} ${insights.orphanAnalysis.severity}\n\n`);
            stream.markdown(`${insights.orphanAnalysis.analysis}\n\n`);

            // 行动建议
            if (insights.actionItems.length > 0) {
                stream.markdown(`## 🎯 行动建议\n\n`);
                for (const action of insights.actionItems) {
                    const priorityEmoji = action.priority === "high" ? "🔴" : 
                                          action.priority === "medium" ? "🟡" : "🟢";
                    stream.markdown(`- ${priorityEmoji} **${action.action}** (预估: ${action.estimatedTime})\n`);
                }
                stream.markdown(`\n`);
            }

            // 鼓励语
            stream.markdown(`---\n\n`);
            stream.markdown(`💬 ${insights.encouragement}\n\n`);

            // 快捷操作
            stream.button({
                command: "issueManager.chat",
                arguments: ["/整理"],
                title: "🔗 开始整理孤立问题",
            });

        } catch (error) {
            if (
                token.isCancellationRequested ||
                (error instanceof Error && error.message === "请求已取消")
            ) {
                stream.markdown("❌ 操作已取消\n");
                return;
            }
            Logger.getInstance().error("[IssueChatParticipant] Insights failed", error);
            stream.markdown("❌ 生成知识洞察过程中发生错误\n");
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

        stream.markdown("### `/审阅` - 生成可执行计划\n");
        stream.markdown("审阅当前打开的文档/笔记，并生成可执行任务清单（带优先级与下一步动作）。\n\n");
        stream.markdown("**示例:**\n");
        stream.markdown("- `@issueManager /审阅`\n");
        stream.markdown("- `@issueManager /审阅 优化本周工作计划可执行性`\n\n");

        stream.markdown("### 🧩 `/分解` - 问题分解专家 (新!)\n");
        stream.markdown("将复杂问题智能分解为可执行的子问题树，支持一键批量创建。\n\n");
        stream.markdown("**示例:**\n");
        stream.markdown("- `@issueManager /分解 如何构建一个高可用的微服务架构`\n");
        stream.markdown("- `@issueManager /分解 学习机器学习需要掌握哪些知识`\n");
        stream.markdown("- `@issueManager /分解 如何从零开始创业`\n\n");

        stream.markdown("### 🔗 `/整理` - 知识织网者 (新!)\n");
        stream.markdown("智能分析孤立问题，为每个问题推荐最佳归档位置，支持批量归档。\n\n");
        stream.markdown("**示例:**\n");
        stream.markdown("- `@issueManager /整理`\n\n");

        stream.markdown("### 🔬 `/洞察` - 知识库健康报告 (新!)\n");
        stream.markdown("分析知识库健康状况，发现被遗忘的问题，提供改进建议。\n\n");
        stream.markdown("**示例:**\n");
        stream.markdown("- `@issueManager /洞察`\n\n");

        stream.markdown("### `/帮助` - 显示此帮助\n\n");

        stream.markdown("## 💡 智能模式\n\n");
        stream.markdown("不使用命令时,AI 会理解您的意图:\n");
        stream.markdown("- `@issueManager 创建一个关于性能优化的问题`\n");
        stream.markdown("- `@issueManager 帮我找找登录相关的问题`\n");
        stream.markdown("- `@issueManager 帮我研究一下分布式事务`\n");
        stream.markdown("- `@issueManager 帮我分解一下这个复杂问题`\n");
        stream.markdown("- `@issueManager 整理一下我的孤立问题`\n\n");

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

        // 检测分解意图
        const decomposeTopic = detectIntent(
            prompt,
            INTENT_CONFIG.decompose.keywords,
            INTENT_CONFIG.decompose.noiseWords
        );
        if (decomposeTopic) {
            stream.markdown(`💡 检测到问题分解意图...\n\n`);
            await this.handleDecomposeCommand(decomposeTopic, stream, token);
            return;
        }

        // 检测整理意图
        const organizeTopic = detectIntent(
            prompt,
            INTENT_CONFIG.organize.keywords,
            INTENT_CONFIG.organize.noiseWords
        );
        if (organizeTopic !== null) {
            stream.markdown(`💡 检测到整理归档意图...\n\n`);
            await this.handleOrganizeCommand(stream, token);
            return;
        }

        // 默认显示帮助
        stream.markdown("💡 我可以帮您管理问题。\n\n");
        stream.markdown("试试:\n");
        stream.markdown("- `/新建 [标题]` - 创建新问题\n");
        stream.markdown("- `/搜索 [关键词]` - 搜索问题\n");
        stream.markdown("- `/研究 [主题]` - 深度研究并生成文档\n");
        stream.markdown("- `/分解 [复杂问题]` - 🧩 智能分解问题\n");
        stream.markdown("- `/整理` - 🔗 智能归档孤立问题\n");
        stream.markdown("- `/洞察` - 🔬 知识库健康报告\n");
        stream.markdown("- `/帮助` - 查看所有命令\n\n");
    }
}
