/**
 * 规划工具定义与执行
 *
 * 提供对话级执行计划能力：创建计划、读取进度、标记步骤、追加步骤、
 * 更新进度说明、排队续写。
 */
import * as vscode from 'vscode';
import { Logger } from '../../core/utils/Logger';
import type { ToolCallResult, ToolExecContext } from './types';
import {
    createPlanFile, readPlanContent, checkPlanStep, addPlanStep,
    updatePlanProgressNote, getAutoQueueCount,
    setPendingContinuation,
    getConversationConfig,
} from '../llmChatDataManager';

const logger = Logger.getInstance();

// ─── 工具定义 ─────────────────────────────────────────────────

/** 规划工具（planning 工具集时注入） */
export const PLANNING_TOOLS: vscode.LanguageModelChatTool[] = [
    {
        name: 'create_plan',
        description: '收到需要多步骤才能完成的复杂任务时调用（自主模式下长任务必须调用）。将任务分解为有序步骤，计划持久化后会在每次执行时自动注入到上下文，帮助你跨 run 维持进度。每个对话只能创建一个计划，已有计划时请用 read_plan 查看。',
        inputSchema: {
            type: 'object',
            properties: {
                title: { type: 'string', description: '计划标题（简洁描述任务目标，15字以内）' },
                steps: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '步骤列表，每条描述一个具体可执行的子任务（20字以内）',
                    minItems: 1,
                },
            },
            required: ['title', 'steps'],
        },
    },
    {
        name: 'read_plan',
        description: '读取当前对话的执行计划，查看所有步骤及完成状态。',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'check_step',
        description: '将指定步骤标记为完成或未完成。完成一个步骤后立即调用此工具更新进度，保持计划与实际执行同步。',
        inputSchema: {
            type: 'object',
            properties: {
                step_index: { type: 'number', description: '步骤序号（从 1 开始）' },
                done: { type: 'boolean', description: 'true = 标记完成，false = 取消完成' },
            },
            required: ['step_index', 'done'],
        },
    },
    {
        name: 'add_step',
        description: '向计划末尾追加一个新步骤。当执行中发现遗漏的子任务时使用。',
        inputSchema: {
            type: 'object',
            properties: {
                step: { type: 'string', description: '新步骤描述（20字以内）' },
            },
            required: ['step'],
        },
    },
    {
        name: 'update_progress_note',
        description: '更新计划的进度说明。记录当前执行到哪里、遇到什么情况、下一步的具体计划等。每次 run 开始或结束时更新，帮助下一次 run 快速恢复上下文。',
        inputSchema: {
            type: 'object',
            properties: {
                note: { type: 'string', description: '进度说明（自由格式，100字以内）' },
            },
            required: ['note'],
        },
    },
    {
        name: 'queue_continuation',
        description: '【仅自主模式可用 · 通常无需调用】系统会在 run 结束后自动检查计划进度并续写。仅当你需要覆盖默认的"按计划顺序执行下一步"行为时才调用此工具（如跳过步骤、插入临时任务、指定特殊执行指令）。message 将作为下一次 run 的 user 消息，优先级高于系统自动续写。',
        inputSchema: {
            type: 'object',
            properties: {
                message: { type: 'string', description: '下一次执行的指令，描述要完成的具体步骤（如"跳过第3步，先完成第5步"）' },
            },
            required: ['message'],
        },
    },
];

// ─── 常量 ─────────────────────────────────────────────────────

/** 连续自动续写的最大次数，防止无限循环 */
export const MAX_CONSECUTIVE_AUTO_QUEUE = 30;

// ─── 工具执行函数 ─────────────────────────────────────────────

async function executeCreatePlan(input: Record<string, unknown>, context?: ToolExecContext): Promise<ToolCallResult> {
    if (!context?.role?.toolSets.includes('planning')) {
        return { success: false, content: '当前角色未启用规划能力（planning）' };
    }
    if (!context.conversationUri) {
        return { success: false, content: '无法获取当前对话 URI' };
    }
    const title = String(input.title || '').trim();
    const stepsRaw = Array.isArray(input.steps) ? (input.steps as unknown[]).map(String) : [];
    if (!title) { return { success: false, content: '请提供计划标题' }; }
    if (stepsRaw.length === 0) { return { success: false, content: '请至少提供一个步骤' }; }

    const result = await createPlanFile(context.conversationUri, title, stepsRaw);
    if (!result) {
        return { success: false, content: '计划已存在，请用 read_plan 查看当前计划' };
    }
    return { success: true, content: `✓ 已创建执行计划「${title}」（${stepsRaw.length} 步）\n\n${result.content}` };
}

async function executeReadPlan(context?: ToolExecContext): Promise<ToolCallResult> {
    if (!context?.role?.toolSets.includes('planning')) {
        return { success: false, content: '当前角色未启用规划能力（planning）' };
    }
    if (!context.conversationUri) {
        return { success: false, content: '无法获取当前对话 URI' };
    }
    const content = await readPlanContent(context.conversationUri);
    if (!content) {
        return { success: false, content: '当前对话没有执行计划，请先用 create_plan 创建' };
    }
    return { success: true, content };
}

async function executeCheckStep(input: Record<string, unknown>, context?: ToolExecContext): Promise<ToolCallResult> {
    if (!context?.role?.toolSets.includes('planning')) {
        return { success: false, content: '当前角色未启用规划能力（planning）' };
    }
    if (!context.conversationUri) {
        return { success: false, content: '无法获取当前对话 URI' };
    }
    const stepIndex = Number(input.step_index);
    const done = Boolean(input.done);
    if (!Number.isInteger(stepIndex) || stepIndex < 1) {
        return { success: false, content: 'step_index 必须为正整数（从 1 开始）' };
    }
    const result = await checkPlanStep(context.conversationUri, stepIndex, done);
    return { success: result.success, content: result.message };
}

async function executeAddStep(input: Record<string, unknown>, context?: ToolExecContext): Promise<ToolCallResult> {
    if (!context?.role?.toolSets.includes('planning')) {
        return { success: false, content: '当前角色未启用规划能力（planning）' };
    }
    if (!context.conversationUri) {
        return { success: false, content: '无法获取当前对话 URI' };
    }
    const step = String(input.step || '').trim();
    if (!step) { return { success: false, content: '请提供步骤描述' }; }
    const result = await addPlanStep(context.conversationUri, step);
    return { success: result.success, content: result.message };
}

async function executeUpdateProgressNote(input: Record<string, unknown>, context?: ToolExecContext): Promise<ToolCallResult> {
    if (!context?.role?.toolSets.includes('planning')) {
        return { success: false, content: '当前角色未启用规划能力（planning）' };
    }
    if (!context.conversationUri) {
        return { success: false, content: '无法获取当前对话 URI' };
    }
    const note = String(input.note || '').trim();
    if (!note) { return { success: false, content: '请提供进度说明' }; }
    const result = await updatePlanProgressNote(context.conversationUri, note);
    return { success: result.success, content: result.message };
}

async function executeQueueContinuation(input: Record<string, unknown>, context?: ToolExecContext): Promise<ToolCallResult> {
    if (!context?.role?.toolSets.includes('planning')) {
        return { success: false, content: '当前角色未启用规划能力（planning）' };
    }
    if (!context.conversationUri) {
        return { success: false, content: '无法获取当前对话 URI' };
    }

    // 仅自主模式允许调用
    const convoConfig = await getConversationConfig(context.conversationUri);
    const autonomous = convoConfig?.autonomous ?? context.role.autonomous ?? false;
    if (!autonomous) {
        return { success: false, content: 'queue_continuation 仅在自主模式（chat_autonomous: true）下可用' };
    }

    const message = String(input.message || '').trim();
    if (!message) { return { success: false, content: '请提供下一次执行的指令' }; }

    // 从 frontmatter 读取累计计数，超限则拒绝（计数在 run 成功后才实际递增）
    const currentCount = await getAutoQueueCount(context.conversationUri);
    if (currentCount >= MAX_CONSECUTIVE_AUTO_QUEUE) {
        return {
            success: false,
            content: `已累计自动续写 ${currentCount} 次，达到上限（${MAX_CONSECUTIVE_AUTO_QUEUE}）。如需继续，请将对话 frontmatter 中的 chat_auto_queue_count 手动清零。`,
        };
    }

    // 两阶段提交：run 执行期间对话处于 executing 状态，无法直接 appendUserMessageQueued。
    // 将消息暂存到 chat_pending_continuation frontmatter 字段，
    // run 成功结束后由 RoleTimerManager 统一提升为 queued 消息并递增计数。
    try {
        await setPendingContinuation(context.conversationUri, `${message}\n\n<!-- llm-auto-queued -->`);
        return {
            success: true,
            content: `✓ 已暂存续写指令，本次 run 结束后自动触发下一次执行（当前累计 ${currentCount} 次，上限 ${MAX_CONSECUTIVE_AUTO_QUEUE}）`,
        };
    } catch (e) {
        logger.error('[PlanTools] queue_continuation 失败', e);
        return { success: false, content: `暂存失败: ${e instanceof Error ? e.message : String(e)}` };
    }
}

// ─── 导出 handler 映射 ───────────────────────────────────────

export const PLANNING_HANDLERS: Record<string, (input: Record<string, unknown>, context?: ToolExecContext) => Promise<ToolCallResult>> = {
    create_plan: executeCreatePlan,
    read_plan: (_input, context) => executeReadPlan(context),
    check_step: executeCheckStep,
    add_step: executeAddStep,
    update_progress_note: executeUpdateProgressNote,
    queue_continuation: executeQueueContinuation,
};
