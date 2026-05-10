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
    createToolCallNode,
    createToolCallNodePending,
    finalizeToolCallNode,
} from './llmChatDataManager';
import { executeChatTool, getToolsForRole, type ToolExecContext } from './chatTools';
import { buildConversationMessages } from './messageBuilder';
import type { ChatRoleInfo } from './types';
import { ExecutionContext } from './ExecutionContext';
import { Logger } from '../core/utils/Logger';

const logger = Logger.getInstance();

// ─── 公共接口 ─────────────────────────────────────────────────

export interface ExecutionOptions {
    /** 触发方式 */
    trigger: 'direct' | 'timer' | 'save' | 'a2a';
    /** 统一执行上下文（必须） */
    ctx: ExecutionContext;
    /**
     * 预构建的消息列表（可选）。提供时跳过内部 buildConversationMessages，
     * 用于协调者对话等需要自定义消息构建逻辑的场景。
     */
    prebuiltMessages?: vscode.LanguageModelChatMessage[];
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
    const { ctx } = options;

    const convoConfig = await getConversationConfig(uri);
    const effectiveModelFamily = convoConfig?.modelFamily || role.modelFamily;
    const toolTimeout = ctx.toolTimeout;
    const isAutonomous = ctx.autonomous;
    const log = (line: string) => ctx.log(line);

    // ─── 构建消息 ────────────────────────────────────────────
    if (!options.prebuiltMessages) { log('📦 构建消息（上下文管道 + token 估算）...'); }
    const msgBuildStart = Date.now();
    const messages = options.prebuiltMessages ?? await buildConversationMessages(uri, role);
    const isFirstResponse = !options.prebuiltMessages && messages.length === 2;
    const firstUserText = isFirstResponse ? extractMessageText(messages[1]) : '';
    const lastUserText = extractMessageText(messages[messages.length - 1]);
    const inputTokens = await estimateTokens(messages);
    const msgBuildDur = Date.now() - msgBuildStart;
    ctx.heartbeat(); // 消息构建完成，重置 idle timer

    log(`🔢 预估 input: **${inputTokens}** tokens${msgBuildDur > 3000 ? ` | 消息构建耗时 ${(msgBuildDur / 1000).toFixed(1)}s` : ''}`);

    await updateConversationTokenUsed(uri, inputTokens);

    // ─── 工具上下文 ──────────────────────────────────────────
    const tools = getToolsForRole(role);
    const toolContext: ToolExecContext = {
        role,
        conversationUri: uri,
        signal: ctx.signal,
        autonomous: isAutonomous,
        onHeartbeat: () => ctx.heartbeat(),
        delegationDepth: ctx.delegationDepth,
        delegationTotalCalls: ctx.delegationTotalCalls,
        ctx,
    };

    // ─── LLM 请求 + 工具循环 ────────────────────────────────
    if (ctx.logUri) {
        // 请求快照节点
        if (ctx.runNumber > 0) {
            const requestSnapshot = messages.map((m, i) => {
                const roleLabel = (m as { role?: number }).role === 1 ? 'user' : 'assistant';
                const text = extractMessageText(m);
                return `### [${i}] ${roleLabel}\n\n${text}`;
            }).join('\n\n---\n\n');
            const toolNames = tools.map(t => t.name).join(', ');
            const fullContent = `**模型**: ${effectiveModelFamily} | **工具**: ${toolNames} | **tokens**: ${inputTokens}\n\n---\n\n${requestSnapshot}`;
            try {
                const reqFileName = await createToolCallNode(ctx.logUri, 'llm_request', { model: effectiveModelFamily, tools: toolNames, inputTokens }, fullContent, 0, {
                    success: true, description: 'LLM 请求快照', sequence: 0, runNumber: ctx.runNumber,
                });
                const reqLink = reqFileName ? `[发起 LLM 请求](IssueDir/${reqFileName})` : '发起 LLM 请求';
                log(`🚀 ${reqLink}`);
            } catch { log('🚀 发起 LLM 请求...'); }
        } else {
            log('🚀 发起 LLM 请求...');
        }
    }

    let toolCallSeq = 0;
    let currentRound = 0;
    const roundReasonings = new Map<number, string>();
    const toolCallItems: ToolCallItem[] = [];

    const result = await LLMService.streamWithTools(
        messages,
        tools,
        (chunk: string) => { ctx.heartbeat(); ctx.onChunk?.(chunk); },
        async (toolName, input) => {
            const tcStart = Date.now();
            toolCallSeq++;
            ctx.heartbeat();

            const isDelegation = toolName === 'delegate_to_role';
            const isDelegationTool = isDelegation || toolName === 'continue_delegation';
            const toolDef = tools.find((t: { name: string }) => t.name === toolName);

            // ─── 阶段 1：执行前创建工具调用文档（记录输入参数） ────
            let pendingFileName: string | null = null;
            if (ctx.logUri && ctx.runNumber > 0 && !isDelegation) {
                try {
                    pendingFileName = await createToolCallNodePending(ctx.logUri, toolName, input, {
                        description: toolDef?.description, sequence: toolCallSeq, runNumber: ctx.runNumber,
                    });
                } catch { /* ignore */ }
            }

            // 日志：工具调用开始（含输入摘要 + 文档链接）
            if (!isDelegation) {
                const inputHint = summarizeToolInput(toolName, input as Record<string, unknown>);
                const toolRef = pendingFileName ? `[\`${toolName}\`](IssueDir/${pendingFileName})` : `\`${toolName}\``;
                log(`⏳ 调用 ${toolRef}${inputHint ? ` — ${inputHint}` : ''}...`);
            }

            // 委派意图日志
            if (isDelegation) {
                const targetRole = String((input as Record<string, unknown>).roleNameOrId || '');
                const taskStr = String((input as Record<string, unknown>).task || '');
                if (ctx.logUri && ctx.runNumber > 0) {
                    try {
                        const intentFileName = await createToolCallNode(ctx.logUri, `delegate_intent:${targetRole}`, input, taskStr, 0, {
                            success: true, description: `委派任务给「${targetRole}」`, sequence: toolCallSeq, runNumber: ctx.runNumber,
                        });
                        const intentLink = intentFileName ? `[「${targetRole}」](IssueDir/${intentFileName})` : `「${targetRole}」`;
                        log(`📤 **委派给${intentLink}**`);
                    } catch { log(`📤 **委派给「${targetRole}」**`); }
                } else {
                    log(`📤 **委派给「${targetRole}」**`);
                }
            }

            // ─── 执行工具（委派工具不限时，由父 signal 兜底；普通工具有独立超时） ──
            let res: Awaited<ReturnType<typeof executeChatTool>>;
            if (isDelegationTool) {
                res = await executeChatTool(toolName, input, toolContext);
            } else {
                // Per-tool AbortController：超时时真正取消底层请求
                const toolAc = new AbortController();
                const onParentAbort = () => toolAc.abort();
                ctx.signal?.addEventListener('abort', onParentAbort);
                const timeoutId = setTimeout(
                    () => toolAc.abort(new Error(`工具 ${toolName} 执行超时（${toolTimeout / 1000}s）`)),
                    toolTimeout,
                );
                try {
                    res = await executeChatTool(toolName, input, { ...toolContext, signal: toolAc.signal });
                } catch (e) {
                    const dur = Date.now() - tcStart;
                    const errMsg = e instanceof Error ? e.message : String(e);
                    if (pendingFileName) {
                        void finalizeToolCallNode(pendingFileName, toolName, input, `[失败] ${errMsg}`, dur, {
                            success: false, description: toolDef?.description, sequence: toolCallSeq, runNumber: ctx.runNumber,
                        });
                    }
                    log(`⏰ \`${toolName}\` 失败 (${fmtDuration(dur)})`);
                    toolCallItems.push({ name: toolName, time: new Date(tcStart), dur, fileName: pendingFileName, success: false, round: currentRound });
                    ctx.heartbeat();
                    return `[工具执行失败] ${toolName} 失败（${errMsg}），请尝试其他方式或跳过此步骤。`;
                } finally {
                    clearTimeout(timeoutId);
                    ctx.signal?.removeEventListener('abort', onParentAbort);
                }
            }
            const dur = Date.now() - tcStart;
            ctx.heartbeat();

            // ─── 阶段 2：执行后补充文档结果 ─────────────────────────
            let fileName: string | null = pendingFileName;
            if (ctx.logUri && ctx.runNumber > 0) {
                if (pendingFileName) {
                    void finalizeToolCallNode(pendingFileName, toolName, input, res.content, dur, {
                        success: res.success, description: toolDef?.description, sequence: toolCallSeq, runNumber: ctx.runNumber,
                    });
                } else if (!isDelegation) {
                    try {
                        fileName = await createToolCallNode(ctx.logUri, toolName, input, res.content, dur, {
                            success: res.success, description: toolDef?.description, sequence: toolCallSeq, runNumber: ctx.runNumber,
                        });
                    } catch { /* ignore */ }
                }

                const toolLink = fileName ? `[\`${toolName}\`](IssueDir/${fileName})` : `\`${toolName}\``;
                const statusIcon = res.success ? '✓' : '❌';
                if (isDelegation) {
                    log(`📥${statusIcon} **委派结果** ${toolLink} (${fmtDuration(dur)})`);
                } else {
                    log(`${statusIcon} ${toolLink} (${fmtDuration(dur)})`);
                }
            } else {
                const statusIcon = res.success ? '✓' : '❌';
                if (isDelegation) {
                    log(`📥${statusIcon} **委派结果** (${fmtDuration(dur)})`);
                } else {
                    log(`${statusIcon} \`${toolName}\` (${fmtDuration(dur)})`);
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
            signal: ctx.signal,
            modelFamily: effectiveModelFamily,
            onToolStatus: ctx.onToolStatus,
            onToolsDecided: (info) => {
                currentRound = info.round;
                ctx.heartbeat();
                if (info.roundText) { roundReasonings.set(info.round, info.roundText.trim()); }
                const names = info.toolNames.map(n => `\`${n}\``).join(', ');
                if (info.roundText) {
                    const thought = info.roundText.replace(/\n+/g, ' ').trim();
                    log(`🤖 **LLM 第${info.round}轮** → 调用 ${names} | 思考: ${summarize(thought, 80)}`);
                } else {
                    log(`🤖 **LLM 第${info.round}轮** → 调用 ${names}`);
                }
                const toolList = info.toolNames.join(', ');
                vscode.window.setStatusBarMessage(`$(loading~spin) ${role.name}: ${toolList}...`, 30000);
            },
            maxToolRounds: role.maxToolRounds,
            onRoundStart: () => { ctx.heartbeat(); },
            onFinalRound: (info) => {
                const hint = info.toolCallsTotal > 0 ? `（完成 ${info.toolCallsTotal} 轮工具调用后）` : '（无工具调用）';
                log(`⏳ **LLM 第${info.round}轮（最终）** → 期望：生成完整回复 ${hint}`);
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
        if (ctx.logUri) {
            const logId = ctx.logUri.fsPath.split('/').pop()?.replace('.md', '') || '';
            lines.push(`> [执行详情](IssueDir/${logId}.md)`);
        }
        toolPrologue = lines.join('\n');
    }

    // ─── Token 统计 ──────────────────────────────────────────
    const outputMsg = vscode.LanguageModelChatMessage.Assistant(result.text);
    const outputTokens = await estimateTokens([outputMsg]);
    await updateConversationTokenUsed(uri, inputTokens + outputTokens);

    // ─── 日志：完成 ──────────────────────────────────────────
    if (result.text) {
        const preview = result.text.trim().replace(/\n+/g, ' ');
        log(`💭 **助手回复**: ${summarize(preview, 200)}`);
    }
    log(`✓ **成功** | input ${inputTokens} + output ${outputTokens} = ${inputTokens + outputTokens} tokens`);

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

/** 从工具输入中提取关键信息的一行摘要（用于日志预览） */
function summarizeToolInput(toolName: string, input: Record<string, unknown>): string {
    const s = (key: string, max = 80) => {
        const v = input[key];
        if (v == null) { return ''; }
        const str = String(v).replace(/\n+/g, ' ').trim();
        return str.length > max ? str.slice(0, max - 1) + '…' : str;
    };
    switch (toolName) {
        case 'run_command':      return s('command', 120);
        case 'read_file':        return s('filePath');
        case 'search_files':     return [s('pattern'), s('grep')].filter(Boolean).join(' + ') || '';
        case 'search_issues':    return [s('query'), input.type ? `type:${input.type}` : ''].filter(Boolean).join(' ');
        case 'read_issue':       return s('fileName');
        case 'create_issue':     return s('title');
        case 'update_issue':     return s('fileName');
        case 'activate_skill':   return s('name');
        case 'create_plan':      return s('title');
        case 'check_step':       return `step ${input.step_index}`;
        case 'write_memory':     return '(更新记忆)';
        case 'delegate_to_role': return `→ ${s('roleNameOrId')}`;
        default:                 return '';
    }
}
