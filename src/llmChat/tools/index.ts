/**
 * 工具系统公共入口
 *
 * 聚合所有领域的 HANDLERS，提供统一的 executeChatTool 分发函数。
 * 外部消费者通过此模块（或原 chatTools.ts 的薄转发层）访问工具系统。
 */
import { Logger } from '../../core/utils/Logger';
import { McpManager } from '../mcp';
import type { ToolCallResult, ToolExecContext } from './types';
import { checkToolPermission } from './security';

// 导入所有领域的 HANDLERS
import { ISSUE_HANDLERS } from './issueTools';
import { TODO_HANDLERS } from './todoTools';
// memory 工具集已废弃，记忆由 knowledge_base 统一管理
// import { MEMORY_HANDLERS } from './memoryTools';
import { DELEGATION_HANDLERS } from './delegationTools';
import { GROUP_HANDLERS } from './groupTools';
import { PLANNING_HANDLERS } from './planningTools';
import { TERMINAL_HANDLERS } from './terminalTools';
import { BROWSING_HANDLERS } from './browsingTools';
import { SKILL_HANDLERS } from './skillTools';
import { ROLE_MANAGEMENT_HANDLERS } from './roleManagementTools';
import { KNOWLEDGE_BASE_HANDLERS } from './knowledgeBaseTools';

const logger = Logger.getInstance();

/** 所有内置工具的处理器注册表 */
const ALL_HANDLERS: Record<string, (input: Record<string, unknown>, ctx?: ToolExecContext) => ToolCallResult | Promise<ToolCallResult>> = {
    ...ISSUE_HANDLERS,
    ...TODO_HANDLERS,
    ...DELEGATION_HANDLERS,
    ...GROUP_HANDLERS,
    ...PLANNING_HANDLERS,
    ...TERMINAL_HANDLERS,
    ...BROWSING_HANDLERS,
    ...SKILL_HANDLERS,
    ...ROLE_MANAGEMENT_HANDLERS,
    ...KNOWLEDGE_BASE_HANDLERS,
};

/**
 * 执行指定工具并返回结果文本。
 * 能力工具（记忆/委派/角色管理）需要传入 context 提供角色信息。
 */
export async function executeChatTool(
    toolName: string,
    input: Record<string, unknown>,
    context?: ToolExecContext,
): Promise<ToolCallResult> {
    // 入口前置中止检查：signal 已经 abort 时，不做任何副作用直接抛
    context?.signal?.throwIfAborted();

    // ─── 安全确认门 ──────────────────────────────────────
    const permission = await checkToolPermission(toolName, input, context?.autonomous ?? false);
    if (!permission.allowed) {
        return { success: false, content: permission.reason || '用户已拒绝执行此操作' };
    }

    try {
        const handler = ALL_HANDLERS[toolName];
        if (handler) {
            return await handler(input, context);
        }

        // 尝试通过 McpManager 调用 MCP 工具
        const mcpManager = McpManager.getInstance();
        if (!mcpManager.isMcpTool(toolName)) {
            return { success: false, content: `未知工具: ${toolName}` };
        }
        return await mcpManager.invokeTool(toolName, input, context?.signal);
    } catch (e) {
        // AbortError 穿透：让上层 ConversationExecutor 的 catch 统一处理为中止
        if (context?.signal?.aborted || (e as { name?: string })?.name === 'AbortError') {
            throw e;
        }
        const msg = e instanceof Error ? e.message : String(e);
        logger.error(`[ChatTools] 执行工具 ${toolName} 失败`, e);
        return { success: false, content: `工具执行失败: ${msg}` };
    }
}

// ─── 公共 API re-export ─────────────────────────────────────
export { CHAT_TOOLS, getToolsForRole } from './registry';
export type { ToolExecContext, ToolCallResult, ToolRiskLevel } from './types';
