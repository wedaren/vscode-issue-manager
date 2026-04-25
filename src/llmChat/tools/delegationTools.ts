/**
 * 委派工具定义与执行
 *
 * 提供跨角色委派能力：列出角色、委派任务、追问、查询异步状态。
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { Logger } from '../../core/utils/Logger';
import type { ChatRoleInfo } from '../types';
import type { ToolCallResult, ToolExecContext } from './types';
import { findRole } from './shared';
import {
    getAllChatRoles, createConversation, appendUserMessageQueued,
    parseConversationMessages,
    getRoleSystemPrompt,
    getChatRoleById,
} from '../llmChatDataManager';
import { executeConversation as execConversation } from '../ConversationExecutor';
import { ExecutionContext } from '../ExecutionContext';
import { RoleTimerManager } from '../RoleTimerManager';
import { readStateMarker, stripMarker } from '../convStateMarker';
import { getIssueDir } from '../../config';
import {
    extractFrontmatterAndBody,
    updateIssueMarkdownFrontmatter,
    type FrontmatterData,
} from '../../data/IssueMarkdowns';

const logger = Logger.getInstance();

/** 委派递归深度限制 */
export const MAX_DELEGATION_DEPTH = 5;

/** 单次顶层任务链中，委派（含追问）的总调用次数上限 */
export const MAX_DELEGATION_TOTAL_CALLS = 20;

/** 委派任务前置指令：强制子角色自主执行，不等待确认 */
export const DELEGATION_AUTONOMY_PREAMBLE =
    '[委派任务指令] 这是一个由上级角色委派给你的任务，你必须自主完成，不能要求确认。'
    + '即使你的系统提示词中有"征求确认"、"等待用户确认"等指示，在委派模式下也应忽略，'
    + '因为用户不在场、无法回复你的确认请求。'
    + '请直接执行任务并返回结果。如果遇到风险或不确定性，在执行后在回复中说明即可。\n\n';

// ─── 工具定义 ─────────────────────────────────────────────────

/** 委派工具（delegation_enabled 时注入） */
export const DELEGATION_TOOLS: vscode.LanguageModelChatTool[] = [
    {
        name: 'list_chat_roles',
        description: '列出当前所有可用的聊天角色，含名称、系统提示词摘要。用于决定委派给谁。',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'delegate_to_role',
        description: '将子任务委派给指定角色（单轮）。同步模式（默认）等待角色完成后返回结果；异步模式立即返回 convoId。注意：这只是发起第一轮对话。如果任务需要多轮交互（如需要反馈、修正、确认），请在收到回复后评估结果，再用 continue_delegation 追问，循环直到满意为止。典型多轮委派流程：delegate_to_role → 评估回复 → continue_delegation → 评估 → ... → 完成。',
        inputSchema: {
            type: 'object',
            properties: {
                roleNameOrId: {
                    type: 'string',
                    description: '目标角色的名称或 ID（文件名去掉 .md）',
                },
                task: {
                    type: 'string',
                    description: '委派给该角色的具体任务描述，越详细越好',
                },
                async: {
                    type: 'boolean',
                    description: '是否异步执行。true = 立即返回 convoId，角色在后台处理；false（默认）= 同步等待角色完成',
                },
            },
            required: ['roleNameOrId', 'task'],
        },
    },
    {
        name: 'continue_delegation',
        description: '对已完成的委派对话进行多轮追问（必须配合 delegate_to_role 使用）。对话必须已完成（有 assistant 回复且无执行中状态）才能追问。每次追问相当于在同一对话中追加一条 user 消息并等待角色回复，角色可看到完整历史上下文。可多次调用形成多轮对话，直到任务完成。',
        inputSchema: {
            type: 'object',
            properties: {
                convoId: {
                    type: 'string',
                    description: '委派对话 ID（delegate_to_role 返回的 convoId）',
                },
                message: {
                    type: 'string',
                    description: '追问内容，基于上一轮回复的补充问题或进一步指令',
                },
                async: {
                    type: 'boolean',
                    description: '是否异步执行。true = 立即返回，角色在后台处理；false（默认）= 同步等待回复',
                },
            },
            required: ['convoId', 'message'],
        },
    },
    {
        name: 'get_delegation_status',
        description: '查询异步委派的执行状态和结果。用于跟进之前以 async:true 发起的委派任务或 continue_delegation 的异步追问。',
        inputSchema: {
            type: 'object',
            properties: {
                convoId: {
                    type: 'string',
                    description: '委派时返回的对话 ID（如 20240115-103045）',
                },
            },
            required: ['convoId'],
        },
    },
];

// ─── 辅助函数 ─────────────────────────────────────────────────

/** 读取委派对话的 chat_log_id，返回追溯链接文本（无日志时返回空字符串） */
async function getDelegationLogTrace(convoUri: vscode.Uri, convoId: string): Promise<string> {
    try {
        const raw = Buffer.from(await vscode.workspace.fs.readFile(convoUri)).toString('utf8');
        const { frontmatter } = extractFrontmatterAndBody(raw);
        const logId = (frontmatter as Record<string, unknown> | null)?.chat_log_id as string | undefined;
        if (logId) {
            return `\n> 📋 执行日志 [${logId}](IssueDir/${logId}.md)（对话 ${convoId} 的完整执行记录）`;
        }
    } catch { /* ignore */ }
    return '';
}

/**
 * 写入用户消息并设置指定状态标记（用于同步委派，避免 queued 被定时器 tick 捡到）。
 */
async function appendUserMessageWithMarker(
    uri: vscode.Uri,
    content: string,
    markerStatus: 'executing' | 'queued',
): Promise<void> {
    const raw = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
    const stripped = stripMarker(raw);
    const d = new Date();
    const p = (n: number) => n.toString().padStart(2, '0');
    const ts = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    const marker = markerStatus === 'executing'
        ? `<!-- llm:executing startedAt="${ts}" retryCount="0" -->`
        : `<!-- llm:queued -->`;
    const block = `\n## User (${ts})\n\n${content}\n\n${marker}\n`;
    await vscode.workspace.fs.writeFile(uri, Buffer.from(stripped + block, 'utf8'));
}

/** 将助手回复写入对话文件（去除状态标记，追加 ## Assistant + ready 标记） */
async function writeAssistantReply(convoUri: vscode.Uri, content: string): Promise<void> {
    try {
        const raw = Buffer.from(await vscode.workspace.fs.readFile(convoUri)).toString('utf8');
        const stripped = stripMarker(raw);
        const d = new Date();
        const p = (n: number) => n.toString().padStart(2, '0');
        const ts = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
        const block = `\n## Assistant (${ts})\n\n${content}\n\n<!-- llm:ready -->\n`;
        await vscode.workspace.fs.writeFile(convoUri, Buffer.from(stripped + block, 'utf8'));
    } catch (e) {
        logger.warn('[ChatTools] 写入委派回复失败', e);
    }
}

// ─── 工具执行函数 ─────────────────────────────────────────────

async function executeListChatRoles(context?: ToolExecContext): Promise<ToolCallResult> {
    const roles = await getAllChatRoles();
    // 排除自身、排除 disabled 角色
    const filtered = roles.filter(r =>
        r.id !== context?.role?.id && r.roleStatus !== 'disabled',
    );
    if (filtered.length === 0) {
        return { success: true, content: '当前没有其他可用角色。可以用 create_chat_role 创建新角色。' };
    }
    const config = vscode.workspace.getConfiguration('issueManager');
    const globalDefault = config.get<string>('llm.modelFamily') || 'gpt-5-mini';
    const prompts = await Promise.all(filtered.map(r => getRoleSystemPrompt(r.uri)));
    const lines = filtered.map((r, i) => {
        const prompt = prompts[i];
        const promptPreview = prompt
            ? prompt.slice(0, 60) + (prompt.length > 60 ? '…' : '')
            : '（无提示词）';
        const model = r.modelFamily ? r.modelFamily : `${globalDefault}（全局默认）`;
        const capStr = r.toolSets.length > 0 ? ` · 工具集: ${r.toolSets.join('/')}` : '';
        const statusTag = r.roleStatus === 'testing' ? ' ⚠️ 调试中' : '';
        return `- **${r.name}**${statusTag} (ID: \`${r.id}\`) · 模型: ${model}${capStr}\n  ${promptPreview}`;
    });
    return { success: true, content: `可用角色（共 ${filtered.length} 个）：\n\n${lines.join('\n\n')}` };
}

async function executeDelegateToRole(input: Record<string, unknown>, context?: ToolExecContext): Promise<ToolCallResult> {
    if (!context?.role?.toolSets.includes('delegation')) {
        return { success: false, content: '当前角色未启用委派能力' };
    }
    const roleNameOrId = String(input.roleNameOrId || '').trim();
    const task = String(input.task || '').trim();
    const isAsync = input.async === true;
    if (!roleNameOrId) { return { success: false, content: '请提供角色名称或 ID' }; }
    if (!task) { return { success: false, content: '请提供委派任务描述' }; }

    const currentDepth = context.delegationDepth ?? 0;
    const currentTotalCalls = context.delegationTotalCalls ?? 0;

    // 总调用次数保护
    if (currentTotalCalls >= MAX_DELEGATION_TOTAL_CALLS) {
        return { success: false, content: `委派总调用次数超限（最大 ${MAX_DELEGATION_TOTAL_CALLS} 次），请简化任务链` };
    }

    // 递归深度保护（异步委派不占深度）
    if (!isAsync && currentDepth >= MAX_DELEGATION_DEPTH) {
        return { success: false, content: `委派深度超限（最大 ${MAX_DELEGATION_DEPTH} 层），请简化任务链` };
    }

    const role = await findRole(roleNameOrId);
    if (!role) {
        return { success: false, content: `找不到角色「${roleNameOrId}」，请先用 list_chat_roles 查看可用角色。` };
    }
    if (role.roleStatus === 'disabled') {
        return { success: false, content: `角色「${role.name}」已被禁用（role_status: disabled），无法接受委派。请选择其他角色。` };
    }
    const delegationWarning = role.roleStatus === 'testing'
        ? `⚠️ 注意：角色「${role.name}」处于调试状态，执行结果可能不稳定。\n\n`
        : '';

    // 创建对话文件（用于记录，非驱动执行）
    const taskPreview = task.length > 30 ? task.slice(0, 30) + '…' : task;
    const convoTitle = `[委派] ${taskPreview}`;
    const convoUri = await createConversation(role.id, convoTitle);
    if (!convoUri) {
        return { success: false, content: '创建委派对话文件失败' };
    }
    await updateIssueMarkdownFrontmatter(convoUri, { chat_autonomous: true } as Partial<FrontmatterData>);
    const convoId = path.basename(convoUri.fsPath, '.md');
    logger.info(`[ChatTools] 委派开始 → 角色「${role.name}」| 对话 ${convoId} | 模式: ${isAsync ? '异步' : '内联'}`);

    const taskWithPreamble = DELEGATION_AUTONOMY_PREAMBLE + task;

    // ── 异步模式：走老路径（queued 标记 + triggerConversation） ──
    if (isAsync) {
        await appendUserMessageQueued(convoUri, taskWithPreamble);
        await RoleTimerManager.getInstance().triggerConversation(convoUri);
        return {
            success: true,
            content: `${delegationWarning}✓ 已异步委派给「${role.name}」，对话 ID: \`${convoId}\`\n用 get_delegation_status 查询结果。\n> 💬 [${convoId}](IssueDir/${convoId}.md)`,
        };
    }

    // ── 同步模式：通过 ConversationExecutor 内联执行（获得日志 + 工具记录 + 状态追踪） ──
    await appendUserMessageWithMarker(convoUri, taskWithPreamble, 'executing');

    const timerManager = RoleTimerManager.getInstance();
    timerManager.registerExecution(convoUri);
    let success = false;
    try {
        const childCtx = context?.ctx
            ? await context.ctx.createChildContext(role, convoUri, {
                autonomous: true,
                toolTimeout: role.timerToolTimeout ?? 60_000,
            })
            : await ExecutionContext.create({
                role,
                conversationUri: convoUri,
                signal: context?.signal,
                trigger: 'direct',
                autonomous: true,
                logEnabled: true,
                toolTimeout: role.timerToolTimeout ?? 60_000,
                delegationDepth: (context?.delegationDepth ?? 0) + 1,
                delegationTotalCalls: (context?.delegationTotalCalls ?? 0) + 1,
            });
        const result = await execConversation(convoUri, role, { trigger: 'direct', ctx: childCtx });

        const reply = result.text.trim() || '（角色未返回任何内容）';
        logger.info(`[ChatTools] 委派结束 → 角色「${role.name}」| 回复长度: ${reply.length}`);

        // 将结果写回对话文件（记录留痕）
        await writeAssistantReply(convoUri, reply);
        void vscode.commands.executeCommand('issueManager.llmChat.refresh');

        const logTraceInfo = await getDelegationLogTrace(convoUri, convoId);
        success = true;

        return {
            success: true,
            content: `${delegationWarning}**[${role.name} 的回复]** (对话: \`${convoId}\`)\n\n${reply}${result.toolPrologue ? `\n\n${result.toolPrologue}` : ''}\n\n---\n💡 如需继续与该角色对话，请使用 \`continue_delegation(convoId="${convoId}", message="你的追问")\`。\n> 💬 委派对话 [${convoId}](IssueDir/${convoId}.md)${logTraceInfo}`,
        };
    } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        logger.error(`[ChatTools] 委派内联执行失败 → 角色「${role.name}」| ${errMsg}`);
        await writeAssistantReply(convoUri, `委派执行失败: ${errMsg}`);
        return { success: false, content: `委派给「${role.name}」时出错: ${errMsg}` };
    } finally {
        timerManager.unregisterExecution(convoUri, role.id, success);
    }
}

async function executeContinueDelegation(input: Record<string, unknown>, context?: ToolExecContext): Promise<ToolCallResult> {
    if (!context?.role?.toolSets.includes('delegation')) {
        return { success: false, content: '当前角色未启用委派能力' };
    }

    const convoId = String(input.convoId || '').trim().replace(/\.md$/, '');
    const message = String(input.message || '').trim();
    const isAsync = input.async === true;
    if (!convoId) { return { success: false, content: '请提供委派对话 ID（convoId）' }; }
    if (!message) { return { success: false, content: '请提供追问内容' }; }

    const currentDepth = context?.delegationDepth ?? 0;
    const currentTotalCalls = context?.delegationTotalCalls ?? 0;

    // 总调用次数保护
    if (currentTotalCalls >= MAX_DELEGATION_TOTAL_CALLS) {
        return { success: false, content: `委派总调用次数超限（最大 ${MAX_DELEGATION_TOTAL_CALLS} 次），请简化任务链` };
    }

    // 递归深度保护（异步追问不占深度）
    if (!isAsync && currentDepth >= MAX_DELEGATION_DEPTH) {
        return { success: false, content: `委派深度超限（最大 ${MAX_DELEGATION_DEPTH} 层），请简化任务链` };
    }

    // 解析对话文件
    const issueDir = getIssueDir();
    if (!issueDir) { return { success: false, content: 'issue 目录未配置' }; }

    const convoUri = vscode.Uri.joinPath(vscode.Uri.file(issueDir), `${convoId}.md`);
    try { await vscode.workspace.fs.stat(convoUri); } catch {
        return { success: false, content: `找不到委派对话文件: ${convoId}` };
    }

    // ── 前置检查 ──

    // 检查并发锁：对话不能正在执行中
    const timerManager = RoleTimerManager.getInstance();
    if (timerManager.isExecuting(convoUri)) {
        return { success: false, content: '该对话正在执行中，请等待完成后再追问' };
    }

    // 检查状态标记：对话不能有 queued/executing/retrying 标记
    const marker = await readStateMarker(convoUri);
    if (marker && marker.status !== 'error') {
        return { success: false, content: `该对话当前状态为 ${marker.status}，无法追加消息。请等待当前轮次完成。` };
    }

    // 检查最后一条消息必须是 assistant（确认上轮已完成）
    const messages = await parseConversationMessages(convoUri);
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.role !== 'assistant') {
        return { success: false, content: '上一轮对话尚未收到回复，无法追问。请先等待或用 get_delegation_status 检查状态。' };
    }

    // 从对话文件获取角色信息
    const convoContent = Buffer.from(await vscode.workspace.fs.readFile(convoUri)).toString('utf8');
    const roleIdMatch = /^chat_role_id:\s*(.+)$/m.exec(convoContent);
    const roleId = roleIdMatch?.[1]?.trim();
    if (!roleId) {
        return { success: false, content: '无法从对话文件中获取角色 ID' };
    }
    const role = await getChatRoleById(roleId);
    const roleName = role?.name ?? roleId;

    logger.info(`[ChatTools] 追问委派 → 角色「${roleName}」| 对话 ${convoId} | 模式: ${isAsync ? '异步' : '内联'}`);

    // ── 异步模式：queued 标记 + triggerConversation ──
    if (isAsync) {
        await appendUserMessageQueued(convoUri, message);
        await timerManager.triggerConversation(convoUri);
        return {
            success: true,
            content: `✓ 已异步追问「${roleName}」，对话 ID: \`${convoId}\`\n用 get_delegation_status 查询结果。\n> 💬 [${convoId}](IssueDir/${convoId}.md)`,
        };
    }

    // ── 同步模式：通过 ConversationExecutor 内联执行 ──
    await appendUserMessageWithMarker(convoUri, message, 'executing');
    const targetRole = role ?? { id: roleId, name: roleName, uri: convoUri, toolSets: [], modelFamily: undefined } as unknown as ChatRoleInfo;

    timerManager.registerExecution(convoUri);
    let success = false;
    try {
        const childCtx = context?.ctx
            ? await context.ctx.createChildContext(targetRole, convoUri, {
                autonomous: true,
                toolTimeout: targetRole.timerToolTimeout ?? 60_000,
            })
            : await ExecutionContext.create({
                role: targetRole,
                conversationUri: convoUri,
                signal: context?.signal,
                trigger: 'direct',
                autonomous: true,
                logEnabled: true,
                toolTimeout: targetRole.timerToolTimeout ?? 60_000,
                delegationDepth: (context?.delegationDepth ?? 0) + 1,
                delegationTotalCalls: (context?.delegationTotalCalls ?? 0) + 1,
            });
        const result = await execConversation(convoUri, targetRole, { trigger: 'direct', ctx: childCtx });

        const reply = result.text.trim() || '（角色未返回任何内容）';
        logger.info(`[ChatTools] 追问完成 → 角色「${roleName}」| 对话 ${convoId} | 回复长度: ${reply.length}`);

        await writeAssistantReply(convoUri, reply);
        void vscode.commands.executeCommand('issueManager.llmChat.refresh');

        const logTraceInfo = await getDelegationLogTrace(convoUri, convoId);
        success = true;

        return {
            success: true,
            content: `**[${roleName} 的追问回复]** (对话: \`${convoId}\`)\n\n${reply}${result.toolPrologue ? `\n\n${result.toolPrologue}` : ''}\n\n---\n💡 如需继续追问，请使用 \`continue_delegation(convoId="${convoId}", message="你的追问")\`。如果任务已完成，无需再调用。\n> 💬 委派对话 [${convoId}](IssueDir/${convoId}.md)${logTraceInfo}`,
        };
    } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        logger.error(`[ChatTools] 追问内联执行失败 → 角色「${roleName}」| ${errMsg}`);
        await writeAssistantReply(convoUri, `追问执行失败: ${errMsg}`);
        return { success: false, content: `追问「${roleName}」时出错: ${errMsg}` };
    } finally {
        timerManager.unregisterExecution(convoUri, targetRole.id, success);
    }
}

async function executeGetDelegationStatus(input: Record<string, unknown>): Promise<ToolCallResult> {
    const convoId = String(input.convoId || '').trim().replace(/\.md$/, '');
    if (!convoId) { return { success: false, content: '请提供委派对话 ID（convoId）' }; }

    const issueDir = getIssueDir();
    if (!issueDir) { return { success: false, content: 'issue 目录未配置' }; }

    const convoUri = vscode.Uri.joinPath(vscode.Uri.file(issueDir), `${convoId}.md`);
    try { await vscode.workspace.fs.stat(convoUri); } catch {
        return { success: false, content: `找不到委派对话文件: ${convoId}` };
    }

    const marker = await readStateMarker(convoUri);

    // 无 marker = 执行成功（RoleTimerManager 成功后会移除标记）
    if (!marker) {
        const messages = await parseConversationMessages(convoUri);
        const last = messages.filter(m => m.role === 'assistant').pop();
        const reply = last?.content?.trim() || '（角色未返回任何内容）';
        return {
            success: true,
            content: `✓ **委派已完成** | 对话: [${convoId}](IssueDir/${convoId}.md)\n\n${reply}`,
        };
    }

    switch (marker.status) {
        case 'queued':
            return { success: true, content: `⏳ **等待执行中** | 对话: [${convoId}](IssueDir/${convoId}.md)` };
        case 'executing':
            return { success: true, content: `🔄 **执行中** | 对话: [${convoId}](IssueDir/${convoId}.md)` };
        case 'retrying': {
            const retryAt = marker.retryAt
                ? new Date(marker.retryAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                : '未知';
            return { success: true, content: `⚠️ **重试中（第 ${marker.retryCount} 次）** | 预计 ${retryAt} 重试 | 对话: [${convoId}](IssueDir/${convoId}.md)` };
        }
        case 'error':
            return { success: false, content: `❌ **委派失败** | ${marker.message || '未知错误'} | 对话: [${convoId}](IssueDir/${convoId}.md)` };
        default:
            return { success: true, content: `❓ 未知状态 | 对话: [${convoId}](IssueDir/${convoId}.md)` };
    }
}

// ─── 导出 handler 映射 ───────────────────────────────────────

export const DELEGATION_HANDLERS: Record<string, (input: Record<string, unknown>, context?: ToolExecContext) => Promise<ToolCallResult>> = {
    list_chat_roles: (_input, context) => executeListChatRoles(context),
    delegate_to_role: executeDelegateToRole,
    continue_delegation: executeContinueDelegation,
    get_delegation_status: (input) => executeGetDelegationStatus(input),
};
