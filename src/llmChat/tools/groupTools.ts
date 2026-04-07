/**
 * 群组协调者工具定义与执行
 *
 * 提供群组协调能力：向单个成员或全部成员分配任务并收集回复。
 */
import * as vscode from 'vscode';
import { Logger } from '../../core/utils/Logger';
import type { ChatRoleInfo } from '../types';
import type { ToolCallResult, ToolExecContext } from './types';
import { getChatRoleById, getOrCreateGroupMemberConversation } from '../llmChatDataManager';
import { executeConversation as execConversation } from '../ConversationExecutor';
import { ExecutionContext } from '../ExecutionContext';
import { buildMemberMessagesForCoordinator, appendToMemberConversation } from '../GroupConversationExecutor';

const logger = Logger.getInstance();

// ─── 工具定义 ─────────────────────────────────────────────────

/** 群组协调者工具（group_coordinator 工具集时注入） */
export const GROUP_COORDINATOR_TOOLS: vscode.LanguageModelChatTool[] = [
    {
        name: 'ask_group_member',
        description: '向群组中的某一位成员分配任务并同步等待其回复。适用于需要顺序协作或依赖上一位成员结果的场景。' +
            '若需同时咨询多位成员，请改用 ask_all_group_members（并行，速度更快）。',
        inputSchema: {
            type: 'object',
            properties: {
                memberName: {
                    type: 'string',
                    description: '成员名称（群组定义中的角色名）',
                },
                task: {
                    type: 'string',
                    description: '交给该成员的具体任务描述，越详细越好',
                },
            },
            required: ['memberName', 'task'],
        },
    },
    {
        name: 'ask_all_group_members',
        description: '同时向多位群组成员分配任务，并行等待所有人回复后一起返回。' +
            '适合需要独立获取多方视角的场景（如同时咨询增长、财务、产品三位顾问）。' +
            '比多次调用 ask_group_member 快得多——所有成员同时执行，总耗时取决于最慢的那位。',
        inputSchema: {
            type: 'object',
            properties: {
                tasks: {
                    type: 'array',
                    description: '给每位成员的任务列表，每项包含成员名称和任务描述',
                    items: {
                        type: 'object',
                        properties: {
                            memberName: { type: 'string', description: '成员名称' },
                            task: { type: 'string', description: '该成员的具体任务' },
                        },
                        required: ['memberName', 'task'],
                    },
                },
            },
            required: ['tasks'],
        },
    },
];

// ─── 工具执行函数 ─────────────────────────────────────────────

async function executeAskGroupMember(input: Record<string, unknown>, context?: ToolExecContext): Promise<ToolCallResult> {
    const memberName = String(input.memberName || '').trim();
    const task = String(input.task || '').trim();

    // 成员列表来自协调者角色自身的 groupMembers 配置
    const memberIds = context?.role?.groupMembers;
    if (!memberIds?.length) {
        return { success: false, content: '此工具仅在协调者角色（配置了 group_members）下可用' };
    }
    if (!memberName) { return { success: false, content: '请提供成员名称（memberName）' }; }
    if (!task) { return { success: false, content: '请提供任务描述（task）' }; }

    const allMembers = memberIds.map(id => getChatRoleById(id)).filter((r): r is ChatRoleInfo => !!r);
    const member = allMembers.find(m => m.name === memberName);
    if (!member) {
        const names = allMembers.map(m => m.name).join('、');
        return { success: false, content: `找不到成员「${memberName}」。可用成员：${names}` };
    }

    if (!context) { return { success: false, content: '缺少执行上下文' }; }
    const coordinatorConvUri = context.conversationUri;
    if (!coordinatorConvUri) { return { success: false, content: '缺少协调者对话文件 URI' }; }

    // 以协调者对话文件的 ID 作为成员文件的关联 key
    const coordinatorConvId = coordinatorConvUri.fsPath.split('/').pop()?.replace(/\.md$/i, '') ?? '';
    const coordinatorName = context.role?.name ?? '协调者';

    logger.info(`[ChatTools] ask_group_member → 成员「${member.name}」| 任务: ${task.slice(0, 60)}`);

    try {
        // 获取或创建成员在此协调者对话下的专属对话文件
        const memberConvUri = await getOrCreateGroupMemberConversation(
            coordinatorConvId, member.id, member.name, coordinatorName,
        );

        // 从成员自己的对话历史构建消息 + 新任务作为最终 User 消息
        const messages = await buildMemberMessagesForCoordinator(memberConvUri, member, allMembers, task);

        // 子上下文指向成员的对话文件
        const childCtx = context.ctx
            ? await context.ctx.createChildContext(member, memberConvUri, {
                autonomous: true,
                toolTimeout: member.timerToolTimeout ?? 60_000,
            })
            : await ExecutionContext.create({
                role: member,
                conversationUri: memberConvUri,
                signal: context.signal,
                trigger: 'direct',
                autonomous: true,
                logEnabled: false,
                toolTimeout: member.timerToolTimeout ?? 60_000,
                retryCount: 0,
            });

        const result = await execConversation(memberConvUri, member, {
            trigger: 'direct',
            ctx: childCtx,
            prebuiltMessages: messages,
        });

        const reply = result.text.trim() || '（成员未返回内容）';

        // 将任务和回复持久化到成员的专属对话文件
        await appendToMemberConversation(memberConvUri, 'user', task);
        await appendToMemberConversation(memberConvUri, 'assistant', reply);

        logger.info(`[ChatTools] ask_group_member ✓ → 「${member.name}」回复长度: ${reply.length}`);
        // 仅将结果返回给协调者；协调者的综合输出统一写入群组文件
        return {
            success: true,
            content: reply,
        };
    } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        logger.error(`[ChatTools] ask_group_member 失败 → 「${member.name}」| ${errMsg}`);
        return { success: false, content: `「${member.name}」执行失败: ${errMsg}` };
    }
}

async function executeAskAllGroupMembers(input: Record<string, unknown>, context?: ToolExecContext): Promise<ToolCallResult> {
    const tasks = Array.isArray(input.tasks) ? input.tasks as Array<{ memberName: unknown; task: unknown }> : [];
    if (!tasks.length) {
        return { success: false, content: '请提供至少一个成员任务（tasks）' };
    }

    // 前置检查：groupMembers 必须存在（与 ask_group_member 相同守卫）
    const memberIds = context?.role?.groupMembers;
    if (!memberIds?.length) {
        return { success: false, content: '此工具仅在协调者角色（配置了 group_members）下可用' };
    }

    logger.info(`[ChatTools] ask_all_group_members → 并行咨询 ${tasks.length} 位成员`);

    // 并行执行所有成员任务
    const results = await Promise.all(
        tasks.map(t => executeAskGroupMember(
            { memberName: t.memberName, task: t.task },
            context,
        )),
    );

    // 将所有结果拼接返回给协调者
    const parts = results.map((r, i) => {
        const name = String(tasks[i].memberName);
        return r.success
            ? `## ${name}\n\n${r.content}`
            : `## ${name}\n\n[执行失败] ${r.content}`;
    });

    const allSuccess = results.every(r => r.success);
    return {
        success: allSuccess,
        content: parts.join('\n\n---\n\n'),
    };
}

// ─── 导出 handler 映射 ───────────────────────────────────────

export const GROUP_HANDLERS: Record<string, (input: Record<string, unknown>, context?: ToolExecContext) => Promise<ToolCallResult>> = {
    ask_group_member: executeAskGroupMember,
    ask_all_group_members: executeAskAllGroupMembers,
};
