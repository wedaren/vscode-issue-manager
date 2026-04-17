/**
 * Web Research Agent 服务
 *
 * 在 VSCode 端运行的研究型 Agent，接受 Chrome Side Panel 下发的研究任务后，
 * 利用 LLM + 工具（web_search / fetch_url / create_issue / create_issue_tree …）
 * 自主完成：搜索 → 获取数据 → 整理 → 记录到笔记 → 生成报告。
 *
 * 进度事件通过回调推送，由 ChromeIntegrationServer 转发给 Chrome Side Panel。
 */

import * as vscode from 'vscode';
import { LLMService } from '../llm/LLMService';
import { CHAT_TOOLS, executeChatTool } from '../llmChat/chatTools';
import { Logger } from '../core/utils/Logger';

const logger = Logger.getInstance();

// ─── 类型 ─────────────────────────────────────────────────────

export interface AgentProgressEvent {
    /** 事件类型 */
    phase: 'planning' | 'tool_call' | 'tool_result' | 'thinking' | 'report' | 'complete' | 'error';
    /** 简短描述（给 UI 显示） */
    message: string;
    /** 额外数据（如搜索关键词、创建的笔记路径等） */
    detail?: string;
}

export interface AgentTask {
    /** 唯一 ID */
    id: string;
    /** 用户提交的研究需求 */
    task: string;
    /** 创建时间 */
    createdAt: number;
}

export interface AgentResult {
    success: boolean;
    /** LLM 最终输出的文本（报告摘要） */
    report: string;
    /** 研究过程中创建的笔记文件列表 */
    createdNotes: string[];
}

// ─── 系统提示词 ────────────────────────────────────────────────

const AGENT_SYSTEM_PROMPT = `你是一个专业的网络研究助手（Web Research Agent）。用户会给你一个研究任务，你需要自主完成以下工作流程：

## 工作流程
1. **理解需求**：分析用户的研究任务，制定搜索策略
2. **搜索信息**：使用 web_search 工具搜索相关信息（可以多次搜索不同关键词）
3. **深入阅读**：使用 fetch_url 工具访问搜索结果中最相关的链接，获取详细内容
4. **检索现有笔记**：使用 search_issues 搜索已有相关笔记，避免重复
5. **整理记录**：将研究发现整理成结构化笔记，使用 create_issue_tree 创建层级结构的研究报告
6. **生成报告**：最终输出研究报告摘要

## 工具使用策略
- 先用 web_search 搜索 2-3 个不同角度的关键词
- 对每个搜索结果中最有价值的 1-2 个链接使用 fetch_url 获取详细内容
- 使用 search_issues 检查是否已有相关笔记
- **重要：创建笔记时必须使用 create_issue_tree**，不要用 create_issue。create_issue_tree 可以一次性创建多个有层级关系的笔记节点（父子树结构），这是本系统的核心特性。

## create_issue_tree 使用说明
调用 create_issue_tree 时，传入 nodes 数组，每个节点通过 children 字段（子节点在数组中的索引）建立层级关系。示例：
\`\`\`json
{
  "nodes": [
    {
      "title": "AI Agent 框架调研报告",
      "body": "## 概述\\n本报告对比了主流 AI Agent 框架...",
      "children": [1, 2, 3]
    },
    {
      "title": "LangChain 分析",
      "body": "## LangChain\\n### 优势\\n- ...\\n### 劣势\\n- ...\\n### 来源\\n- https://..."
    },
    {
      "title": "AutoGPT 分析",
      "body": "## AutoGPT\\n..."
    },
    {
      "title": "CrewAI 分析",
      "body": "## CrewAI\\n...",
      "children": [4]
    },
    {
      "title": "CrewAI 实际案例",
      "body": "## 案例研究\\n..."
    }
  ],
  "rootIndex": 0
}
\`\`\`
- 索引 0 是根节点（研究主题），它的 children: [1,2,3] 表示 LangChain、AutoGPT、CrewAI 三个子主题
- 索引 3 (CrewAI) 还有自己的子节点 [4]，形成更深的层级
- 每个节点都会生成独立的 Markdown 笔记文件，并自动建立树形结构

## 输出要求
- 搜索时使用准确、具体的关键词
- 整理时保留关键数据、引用来源 URL
- 笔记使用 Markdown 格式，内容充实
- **所有研究发现必须通过 create_issue_tree 记录为层级笔记**
- 最后回复一段简洁的研究报告摘要

## 可用工具
- web_search: 通过 Chrome 浏览器进行网络搜索
- fetch_url: 通过 Chrome 浏览器访问指定 URL 获取内容
- search_issues: 搜索已有笔记
- read_issue: 读取已有笔记内容
- create_issue: 创建单个独立笔记（不推荐，无层级关系）
- **create_issue_tree**: 创建层级结构的笔记树（**强烈推荐**，自动建立父子关系）
- list_issue_tree: 查看笔记树结构
- update_issue: 更新已有笔记`;

// ─── 服务 ─────────────────────────────────────────────────────

export class WebAgentService {
    private static instance: WebAgentService;
    private runningTasks = new Map<string, AbortController>();

    static getInstance(): WebAgentService {
        if (!WebAgentService.instance) {
            WebAgentService.instance = new WebAgentService();
        }
        return WebAgentService.instance;
    }

    /** 当前是否有任务在运行 */
    isRunning(taskId?: string): boolean {
        if (taskId) {
            return this.runningTasks.has(taskId);
        }
        return this.runningTasks.size > 0;
    }

    /** 取消任务 */
    cancelTask(taskId: string): void {
        const controller = this.runningTasks.get(taskId);
        if (controller) {
            controller.abort();
            this.runningTasks.delete(taskId);
            logger.info(`[WebAgent] 任务已取消: ${taskId}`);
        }
    }

    /**
     * 启动研究任务
     */
    async startResearch(
        task: AgentTask,
        onProgress: (event: AgentProgressEvent) => void,
    ): Promise<AgentResult> {
        const controller = new AbortController();
        this.runningTasks.set(task.id, controller);

        const createdNotes: string[] = [];

        logger.info(`[WebAgent] 开始研究任务: ${task.id} — ${task.task}`);
        onProgress({ phase: 'planning', message: '正在分析研究需求…' });

        try {
            // 构建消息
            const messages = [
                vscode.LanguageModelChatMessage.User(AGENT_SYSTEM_PROMPT),
                vscode.LanguageModelChatMessage.User(`请完成以下研究任务：\n\n${task.task}`),
            ];

            // 使用 streamWithTools 驱动 Agent
            const result = await LLMService.streamWithTools(
                messages,
                CHAT_TOOLS,
                // onChunk — 收集文本，同时推送 thinking 事件
                (chunk: string) => {
                    // 只在有实质内容时推送
                    if (chunk.trim()) {
                        onProgress({ phase: 'thinking', message: '正在思考…', detail: chunk });
                    }
                },
                // onToolCall — 执行工具
                async (toolName: string, input: Record<string, unknown>): Promise<string> => {
                    // 推送 tool_call 事件
                    const toolLabel = getToolLabel(toolName);
                    const summary = getToolCallSummary(toolName, input);
                    onProgress({ phase: 'tool_call', message: `调用工具: ${toolLabel}`, detail: summary });

                    // 执行工具
                    const toolResult = await executeChatTool(toolName, input, { autonomous: true });

                    // 追踪创建的笔记
                    if ((toolName === 'create_issue' || toolName === 'create_issue_tree') && toolResult.success) {
                        createdNotes.push(toolResult.content);
                    }

                    // 推送 tool_result 事件
                    const resultPreview = toolResult.content.slice(0, 200);
                    onProgress({
                        phase: 'tool_result',
                        message: `${toolLabel} 完成`,
                        detail: resultPreview,
                    });

                    return toolResult.content;
                },
                {
                    signal: controller.signal,
                    maxToolRounds: 15, // 研究型任务允许更多轮次
                    onToolStatus: (status) => {
                        if (status.phase === 'calling') {
                            onProgress({
                                phase: 'tool_call',
                                message: `正在执行: ${getToolLabel(status.toolName)}`,
                            });
                        }
                    },
                },
            );

            this.runningTasks.delete(task.id);

            const report = result?.text || '研究完成，但未生成摘要文本。';

            onProgress({ phase: 'report', message: '研究报告已生成', detail: report });
            onProgress({ phase: 'complete', message: '研究任务完成' });

            logger.info(`[WebAgent] 任务完成: ${task.id} | 创建笔记=${createdNotes.length}`);

            return { success: true, report, createdNotes };
        } catch (e) {
            this.runningTasks.delete(task.id);
            const msg = e instanceof Error ? e.message : String(e);
            logger.error(`[WebAgent] 任务失败: ${task.id}`, e);
            onProgress({ phase: 'error', message: `研究失败: ${msg}` });
            return { success: false, report: `研究任务失败: ${msg}`, createdNotes };
        }
    }
}

// ─── 辅助 ─────────────────────────────────────────────────────

function getToolLabel(name: string): string {
    const labels: Record<string, string> = {
        web_search: '网络搜索',
        fetch_url: '抓取网页',
        search_issues: '检索笔记',
        read_issue: '读取笔记',
        create_issue: '创建笔记',
        create_issue_tree: '创建笔记树',
        list_issue_tree: '笔记树结构',
        update_issue: '更新笔记',
    };
    return labels[name] || name;
}

function getToolCallSummary(name: string, input: Record<string, unknown>): string {
    switch (name) {
        case 'web_search':
            return `搜索: ${input.query || ''}`;
        case 'fetch_url':
            return `访问: ${input.url || ''}`;
        case 'search_issues':
            return `检索: ${input.query || ''}`;
        case 'read_issue':
            return `读取: ${input.filename || ''}`;
        case 'create_issue':
            return `创建: ${input.title || ''}`;
        case 'create_issue_tree':
            return `创建笔记树: ${(input.nodes as any[])?.length || 0} 个节点`;
        case 'update_issue':
            return `更新: ${input.filename || ''}`;
        default:
            return JSON.stringify(input).slice(0, 100);
    }
}
