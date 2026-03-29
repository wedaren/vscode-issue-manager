/**
 * 统一对话执行引擎
 *
 * 所有 LLM 对话执行（UI 直接对话、askRole 命令、定时器 tick）的核心逻辑集中在此。
 * 调用方只负责"入队/启动"和"后处理"（状态标记、重试、hooks），不包含 LLM 调用细节。
 *
 * 职责：
 *   - 构建消息（复用 messageBuilder）
 *   - 工具调用循环（含超时、心跳、大结果外存、安全确认门）
 *   - 日志记录（logUri 条件性写入）
 *   - Token 统计
 *   - 工具调用摘要（toolPrologue）构建
 *
 * 不负责：
 *   - 状态标记（queued/executing/ready）
 *   - 重试/锁
 *   - 续写提升
 *   - Post-response hooks（由调用方触发）
 */
import * as vscode from 'vscode';
import { LLMService } from '../llm/LLMService';
import {
    getConversationConfig,
    updateConversationTokenUsed,
    estimateTokens,
    getOrCreateExecutionLog,
    startLogRun,
    appendLogLine,
    createToolCallNode,
} from './llmChatDataManager';
import { executeChatTool, getToolsForRole, type ToolExecContext } from './chatTools';
import { buildConversationMessages } from './messageBuilder';
import type { ChatRoleInfo } from './types';
import { Logger } from '../core/utils/Logger';

const logger = Logger.getInstance();

// ─── 公共接口 ─────────────────────────────────────────────────

export interface ExecutionOptions {
    /** 触发方式 */
    trigger: 'direct' | 'timer' | 'save';
    /** 流式 chunk 回调（UI 路径需要，定时器路径可传 noop） */
    onChunk?: (chunk: string) => void;
    /** 工具状态回调（UI 路径可选） */
    onToolStatus?: (status: { toolName: string; phase: 'calling' | 'done'; result?: string }) => void;
    /** 中止信号（由调用方控制超时/取消） */
    signal?: AbortSignal;
    /** 自主模式覆盖。不传则从对话/角色配置推断 */
    autonomous?: boolean;
    /** 日志生成开关覆盖。不传则从对话/角色配置推断 */
    logEnabled?: boolean;
    /** 单次工具调用超时（ms）。不传则用角色配置或默认 60s */
    toolTimeout?: number;
    /** 心跳回调：长时间运行的工具应定期调用，通知调用方仍在活跃 */
    onHeartbeat?: () => void;
    /** 工具调用活动回调：每次工具调用开始/完成时通知调用方（用于刷新 idle timer） */
    onToolActivity?: () => void;
}

export interface ExecutionResult {
    /** 助手回复文本（已 trim） */
    text: string;
    /** 工具调用前置摘要（> 💭 / > 📎 格式），无工具调用时为 undefined */
    toolPrologue?: string;
    /** 输入 token 数 */
    inputTokens: number;
    /** 输出 token 数 */
    outputTokens: number;
    /** 是否为该对话的首次 LLM 回复 */
    isFirstResponse: boolean;
    /** 首条用户消息文本 */
    firstUserText: string;
    /** 最后一条用户消息文本 */
    lastUserText: string;
}

// ─── 核心执行函数 ──────────────────────────────────────────────

/**
 * 执行一次 LLM 对话轮次。
 *
 * 构建消息 → 发起 LLM 请求（含工具循环）→ 返回结果。
 * 不写入对话文件、不管理状态标记、不触发 hooks — 这些由调用方负责。
 */
export async function executeConversation(
    uri: vscode.Uri,
    role: ChatRoleInfo,
    options: ExecutionOptions,
): Promise<ExecutionResult> {
    const {
        trigger,
        onChunk = () => {},
        onToolStatus,
        signal,
        onHeartbeat,
        onToolActivity,
    } = options;

    // ─── 配置解析 ────────────────────────────────────────────
    const convoConfig = await getConversationConfig(uri);
    const effectiveModelFamily = convoConfig?.modelFamily || role.modelFamily;
    const effectiveMaxTokens = convoConfig?.maxTokens ?? role.maxTokens;
    const effectiveLogEnabled = options.logEnabled ?? convoConfig?.logEnabled ?? role.logEnabled ?? false;
    const toolTimeout = options.toolTimeout ?? role.timerToolTimeout ?? 60_000;

    // 自主模式：显式传入 > 对话配置 > 角色配置 > 默认 false
    const isAutonomous = options.autonomous ?? convoConfig?.autonomous ?? role.autonomous ?? false;

    // ─── 日志初始化 ──────────────────────────────────────────
    let logUri: vscode.Uri | null = null;
    if (effectiveLogEnabled) {
        try { logUri = await getOrCreateExecutionLog(uri); } catch { /* 忽略 */ }
    }
    let runNumber = 0;
    if (logUri) {
        try {
            runNumber = await startLogRun(logUri, {
                trigger,
                roleName: role.name,
                modelFamily: effectiveModelFamily,
                timeout: toolTimeout,
                maxTokens: effectiveMaxTokens,
            });
        } catch { /* 日志写入失败不阻塞 */ }
    }

    // ─── 构建消息 ────────────────────────────────────────────
    const messages = await buildConversationMessages(uri, role);
    const isFirstResponse = messages.length === 2;
    const firstUserText = isFirstResponse ? extractMessageText(messages[1]) : '';
    const lastUserText = extractMessageText(messages[messages.length - 1]);
    const inputTokens = await estimateTokens(messages);

    if (logUri) { void appendLogLine(logUri, `🔢 预估 input: **${inputTokens}** tokens`); }

    // token 门禁
    if (effectiveMaxTokens && inputTokens > effectiveMaxTokens) {
        throw new Error(`token 预算超限：预估 ${inputTokens}，上限 ${effectiveMaxTokens}`);
    }
    await updateConversationTokenUsed(uri, inputTokens, effectiveMaxTokens);

    // ─── 工具上下文 ──────────────────────────────────────────
    const tools = getToolsForRole(role);
    const toolContext: ToolExecContext = {
        role,
        conversationUri: uri,
        signal,
        autonomous: isAutonomous,
        onHeartbeat,
    };

    // ─── LLM 请求 + 工具循环 ────────────────────────────────
    if (logUri) {
        // 请求快照节点
        if (runNumber > 0) {
            const requestSnapshot = messages.map((m, i) => {
                const roleLabel = (m as { role?: number }).role === 1 ? 'user' : 'assistant';
                const text = extractMessageText(m);
                return `### [${i}] ${roleLabel}\n\n${text}`;
            }).join('\n\n---\n\n');
            const toolNames = tools.map(t => t.name).join(', ');
            const fullContent = `**模型**: ${effectiveModelFamily} | **工具**: ${toolNames} | **tokens**: ${inputTokens}\n\n---\n\n${requestSnapshot}`;
            try {
                const reqFileName = await createToolCallNode(logUri, 'llm_request', { model: effectiveModelFamily, tools: toolNames, inputTokens }, fullContent, 0, {
                    success: true, description: 'LLM 请求快照', sequence: 0, runNumber,
                });
                const reqLink = reqFileName ? `[发起 LLM 请求](IssueDir/${reqFileName})` : '发起 LLM 请求';
                void appendLogLine(logUri, `🚀 ${reqLink}`);
            } catch { void appendLogLine(logUri, '🚀 发起 LLM 请求...'); }
        } else {
            void appendLogLine(logUri, '🚀 发起 LLM 请求...');
        }
    }

    let toolCallSeq = 0;
    let currentRound = 0;
    const roundReasonings = new Map<number, string>();
    const toolCallItems: ToolCallItem[] = [];

    const result = await LLMService.streamWithTools(
        messages,
        tools,
        onChunk,
        async (toolName, input) => {
            const tcStart = Date.now();
            toolCallSeq++;
            onToolActivity?.();

            const isDelegation = toolName === 'delegate_to_role';

            // 日志：工具调用开始
            if (logUri && !isDelegation) {
                void appendLogLine(logUri, `⏳ 调用 \`${toolName}\`...`);
            }

            // 委派意图日志
            if (isDelegation && logUri) {
                const targetRole = String((input as Record<string, unknown>).roleNameOrId || '');
                const taskStr = String((input as Record<string, unknown>).task || '');
                if (runNumber > 0) {
                    try {
                        const intentFileName = await createToolCallNode(logUri, `delegate_intent:${targetRole}`, input, taskStr, 0, {
                            success: true, description: `委派任务给「${targetRole}」`, sequence: toolCallSeq, runNumber,
                        });
                        const intentLink = intentFileName ? `[「${targetRole}」](IssueDir/${intentFileName})` : `「${targetRole}」`;
                        void appendLogLine(logUri, `📤 **委派给${intentLink}**`);
                    } catch { void appendLogLine(logUri, `📤 **委派给「${targetRole}」**`); }
                } else {
                    void appendLogLine(logUri, `📤 **委派给「${targetRole}」**`);
                }
            }

            // 工具调用（含超时；委派工具不限时，由父的 signal 兜底）
            const isDelegationTool = isDelegation || toolName === 'continue_delegation';
            let res: Awaited<ReturnType<typeof executeChatTool>>;
            if (isDelegationTool) {
                // 委派内联执行：不加 per-call 超时，依赖共享的 AbortSignal（空闲超时 + 总执行超时）
                res = await executeChatTool(toolName, input, toolContext);
            } else {
                try {
                    res = await Promise.race([
                        executeChatTool(toolName, input, toolContext),
                        new Promise<never>((_, reject) => {
                            setTimeout(() => reject(new Error(`工具 ${toolName} 执行超时（${toolTimeout / 1000}s）`)), toolTimeout);
                        }),
                    ]);
                } catch {
                    const dur = Date.now() - tcStart;
                    if (logUri) { void appendLogLine(logUri, `⏰ \`${toolName}\` 超时 (${fmtDuration(dur)})`); }
                    toolCallItems.push({ name: toolName, time: new Date(tcStart), dur, fileName: null, success: false, round: currentRound });
                    onToolActivity?.();
                    return `[工具执行失败] ${toolName} 超时（${toolTimeout / 1000}s），请尝试其他方式或跳过此步骤。`;
                }
            }
            const dur = Date.now() - tcStart;
            onToolActivity?.();

            // 工具调用详情节点 + 日志
            let fileName: string | null = null;
            if (logUri && runNumber > 0) {
                const toolDef = tools.find((t: { name: string }) => t.name === toolName);
                try {
                    fileName = await createToolCallNode(logUri, toolName, input, res.content, dur, {
                        success: res.success, description: toolDef?.description, sequence: toolCallSeq, runNumber,
                    });
                } catch { /* ignore */ }

                const toolLink = fileName ? `[\`${toolName}\`](IssueDir/${fileName})` : `\`${toolName}\``;
                const statusIcon = res.success ? '✓' : '❌';
                if (isDelegation) {
                    void appendLogLine(logUri, `📥${statusIcon} **委派结果** ${toolLink} (${fmtDuration(dur)})`);
                } else {
                    void appendLogLine(logUri, `${statusIcon} ${toolLink} (${fmtDuration(dur)})`);
                }
            } else if (logUri) {
                const statusIcon = res.success ? '✓' : '❌';
                if (isDelegation) {
                    void appendLogLine(logUri, `📥${statusIcon} **委派结果** (${fmtDuration(dur)})`);
                } else {
                    void appendLogLine(logUri, `${statusIcon} \`${toolName}\` (${fmtDuration(dur)})`);
                }
            }

            // 委派摘要
            let delegationHint: string | undefined;
            if (isDelegationTool && res.success) {
                const targetRole = String((input as Record<string, unknown>).roleNameOrId || (input as Record<string, unknown>).convoId || '');
                const roleMatch = /\*\*\[(.+?) 的(?:追问)?回复\]\*\*/.exec(res.content);
                const replyRole = roleMatch?.[1] || targetRole;
                const bodyMatch = res.content.match(/\*\*\n\n([\s\S]*?)\n\n---/);
                const replyPreview = bodyMatch?.[1] ? summarize(bodyMatch[1].replace(/\n+/g, ' ').trim(), 60) : '';
                delegationHint = replyPreview ? `→ ${replyRole}: ${replyPreview}` : `→ ${replyRole}`;
            }

            toolCallItems.push({ name: toolName, time: new Date(tcStart), dur, fileName, success: res.success, round: currentRound, delegationHint });
            return buildToolResultForLlm(res.content, fileName);
        },
        {
            signal,
            modelFamily: effectiveModelFamily,
            onToolStatus,
            onToolsDecided: (info) => {
                currentRound = info.round;
                if (info.roundText) { roundReasonings.set(info.round, info.roundText.trim()); }
                if (logUri) {
                    const names = info.toolNames.map(n => `\`${n}\``).join(', ');
                    if (info.roundText) {
                        const thought = info.roundText.replace(/\n+/g, ' ').trim();
                        void appendLogLine(logUri, `🤖 **LLM 第${info.round}轮** → 调用 ${names} | 思考: ${summarize(thought, 80)}`);
                    } else {
                        void appendLogLine(logUri, `🤖 **LLM 第${info.round}轮** → 调用 ${names}`);
                    }
                }
                // 状态栏反馈
                const toolList = info.toolNames.join(', ');
                vscode.window.setStatusBarMessage(`$(loading~spin) ${role.name}: ${toolList}...`, 30000);
            },
            onFinalRound: (info) => {
                if (!logUri) { return; }
                const hint = info.toolCallsTotal > 0 ? `（完成 ${info.toolCallsTotal} 轮工具调用后）` : '（无工具调用）';
                void appendLogLine(logUri, `⏳ **LLM 第${info.round}轮（最终）** → 期望：生成完整回复 ${hint}`);
            },
        },
    );

    if (!result?.text) {
        const hint = toolCallSeq > 0 ? `（已完成 ${toolCallSeq} 次工具调用）` : '';
        throw new Error(`LLM 返回空响应${hint}，可能原因：上下文过长 / 模型响应异常`);
    }

    // ─── 构建工具调用摘要 ────────────────────────────────────
    let toolPrologue: string | undefined;
    if (toolCallSeq > 0) {
        const lines: string[] = [];
        let lastRound = -1;
        for (const item of toolCallItems) {
            if (item.round !== lastRound) {
                const reasoning = roundReasonings.get(item.round);
                if (reasoning) {
                    lines.push(`> 💭 ${reasoning.replace(/\n+/g, ' ').slice(0, 200)}`);
                }
                lastRound = item.round;
            }
            const t = fmtHms(item.time);
            const icon = item.success ? '✓' : '❌';
            const nameStr = item.fileName ? `[\`${item.name}\`](IssueDir/${item.fileName})` : `\`${item.name}\``;
            const delegSuffix = item.delegationHint ? ` ${item.delegationHint}` : '';
            lines.push(`> 📎 \`${t}\` ${icon} ${nameStr} (${fmtDuration(item.dur)})${delegSuffix}`);
        }
        if (logUri) {
            const logId = logUri.fsPath.split('/').pop()?.replace('.md', '') || '';
            lines.push(`> [执行详情](IssueDir/${logId}.md)`);
        }
        toolPrologue = lines.join('\n');
    }

    // ─── Token 统计 ──────────────────────────────────────────
    const outputMsg = vscode.LanguageModelChatMessage.Assistant(result.text);
    const outputTokens = await estimateTokens([outputMsg]);
    await updateConversationTokenUsed(uri, inputTokens + outputTokens, effectiveMaxTokens);

    // ─── 日志：完成 ──────────────────────────────────────────
    if (logUri && result.text) {
        const preview = result.text.trim().replace(/\n+/g, ' ');
        void appendLogLine(logUri, `💭 **助手回复**: ${summarize(preview, 200)}`);
    }
    if (logUri) {
        void appendLogLine(logUri, `✓ **成功** | input ${inputTokens} + output ${outputTokens} = ${inputTokens + outputTokens} tokens`);
    }

    return {
        text: result.text.trim(),
        toolPrologue,
        inputTokens,
        outputTokens,
        isFirstResponse,
        firstUserText,
        lastUserText,
    };
}

// ─── 内部类型与辅助函数 ────────────────────────────────────────

interface ToolCallItem {
    name: string;
    time: Date;
    dur: number;
    fileName: string | null;
    success: boolean;
    round: number;
    delegationHint?: string;
}

/** 从 LanguageModelChatMessage 中提取纯文本内容 */
function extractMessageText(msg: vscode.LanguageModelChatMessage): string {
    if (msg.content instanceof Array) {
        return msg.content
            .map((p: unknown) => (p && typeof p === 'object' && 'value' in p) ? String((p as { value: unknown }).value ?? '') : '')
            .join('');
    }
    return String((msg as unknown as { content: unknown }).content ?? '');
}

const INLINE_MAX_CHARS = 16000;

function buildToolResultForLlm(content: string, fileName: string | null): string {
    if (content.length <= INLINE_MAX_CHARS) { return content; }
    if (fileName) {
        const preview = content.slice(0, 300).trimEnd();
        return `[工具结果（${content.length} 字符）](IssueDir/${fileName})\n预览：${preview}${content.length > 300 ? '\n...' : ''}\n如需完整内容，请调用 read_issue("${fileName}")`;
    }
    return content.slice(0, INLINE_MAX_CHARS) + `\n...[内容已截断，原始长度 ${content.length} 字符]`;
}

function summarize(text: string, maxLen: number): string {
    return text.length <= maxLen ? text : text.slice(0, maxLen - 1) + '…';
}

function fmtHms(d: Date): string {
    const p = (n: number) => n.toString().padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function fmtDuration(ms: number): string {
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}
