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
import { MEMORY_HANDLERS } from './memoryTools';
import { DELEGATION_HANDLERS } from './delegationTools';
import { GROUP_HANDLERS } from './groupTools';
import { PLANNING_HANDLERS } from './planningTools';
import { TERMINAL_HANDLERS } from './terminalTools';
import { BROWSING_HANDLERS } from './browsingTools';
import { SKILL_HANDLERS } from './skillTools';
import { ROLE_MANAGEMENT_HANDLERS } from './roleManagementTools';

const logger = Logger.getInstance();

/** 所有内置工具的处理器注册表 */
const ALL_HANDLERS: Record<string, (input: Record<string, unknown>, ctx?: ToolExecContext) => ToolCallResult | Promise<ToolCallResult>> = {
    ...ISSUE_HANDLERS,
    ...TODO_HANDLERS,
    ...MEMORY_HANDLERS,
    ...DELEGATION_HANDLERS,
    ...GROUP_HANDLERS,
    ...PLANNING_HANDLERS,
    ...TERMINAL_HANDLERS,
    ...BROWSING_HANDLERS,
    ...SKILL_HANDLERS,
    ...ROLE_MANAGEMENT_HANDLERS,
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
        return await mcpManager.invokeTool(toolName, input);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.error(`[ChatTools] 执行工具 ${toolName} 失败`, e);
        return { success: false, content: `工具执行失败: ${msg}` };
    }
}

// ─── 公共 API re-export ─────────────────────────────────────
export { CHAT_TOOLS, getToolsForRole } from './registry';
export type { ToolExecContext, ToolCallResult, ToolRiskLevel } from './types';
