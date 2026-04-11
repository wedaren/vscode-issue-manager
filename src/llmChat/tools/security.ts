/**
 * 工具安全等级与权限检查
 */
import * as vscode from 'vscode';
import type { ToolRiskLevel } from './types';

/** 内置工具的风险等级声明 */
export const TOOL_RISK: Record<string, ToolRiskLevel> = {
    // 只读 — 永远放行
    search_issues: 'safe',
    read_issue: 'safe',
    list_issue_tree: 'safe',
    get_issue_relations: 'safe',
    read_todos: 'safe',
    read_memory: 'safe',
    read_plan: 'safe',
    list_chat_roles: 'safe',
    list_available_tools: 'safe',
    get_delegation_status: 'safe',
    read_role_execution_logs: 'safe',
    evaluate_role: 'safe',
    read_file: 'safe',
    search_files: 'safe',

    // 写入 — 放行（信任内置工具设计）
    create_issue: 'write',
    create_issue_tree: 'write',
    update_issue: 'write',
    link_issue: 'write',
    unlink_issue: 'write',
    move_issue_node: 'write',
    sort_issue_children: 'write',
    write_todos: 'write',
    update_todo: 'write',
    write_memory: 'write',
    create_plan: 'write',
    check_step: 'write',
    add_step: 'write',
    update_progress_note: 'write',
    create_chat_role: 'write',
    update_role_config: 'write',
    continue_delegation: 'write',

    // 危险 — 非自主模式下必须确认
    delete_issue: 'destructive',
    batch_delete_issues: 'destructive',
    delegate_to_role: 'destructive',
    queue_continuation: 'destructive',
    run_command: 'destructive',
};

/** MCP 工具本 session 已授权的 server 集合 */
const _mcpAuthorizedServers = new Set<string>();

/** 本 session 已信任的 destructive 工具集合（仅限 run_command 等可信任工具） */
const _sessionTrustedTools = new Set<string>();
/** 允许 session 级信任的 destructive 工具白名单 */
const SESSION_TRUSTABLE_TOOLS = new Set(['run_command']);

/** 获取工具风险等级（MCP 工具默认 write） */
export function getToolRisk(toolName: string): ToolRiskLevel {
    if (toolName in TOOL_RISK) { return TOOL_RISK[toolName]; }
    // MCP 工具：默认 write
    if (/^mcp_[^_]+_.+$/.test(toolName)) { return 'write'; }
    return 'write';
}

/**
 * 生成删除操作的预览描述（用于确认弹框）。
 */
function buildDeletePreview(toolName: string, input: Record<string, unknown>): string {
    if (toolName === 'delete_issue') {
        const fileName = String(input.fileName || '').trim();
        const removeChildren = input.removeChildren === true;
        return `删除笔记 "${fileName}"${removeChildren ? '（含所有子笔记）' : ''}`;
    }
    if (toolName === 'batch_delete_issues') {
        const fileNames = Array.isArray(input.fileNames) ? input.fileNames : [];
        const count = fileNames.length;
        const preview = fileNames.slice(0, 5).map((n: unknown) => `"${String(n)}"`).join(', ');
        const more = count > 5 ? ` 等 ${count} 个` : '';
        return `批量删除 ${count} 个笔记: ${preview}${more}`;
    }
    return '';
}

/**
 * 生成确认描述（用于非删除的 destructive 工具）。
 */
function buildDestructiveDescription(toolName: string, input: Record<string, unknown>): string {
    if (toolName === 'delegate_to_role') {
        const target = String(input.roleNameOrId || '');
        const task = String(input.task || '');
        const taskPreview = task.length > 80 ? task.slice(0, 77) + '…' : task;
        return `委派任务给「${target}」: ${taskPreview}`;
    }
    if (toolName === 'queue_continuation') {
        return '排队自动续写（将在当前执行结束后自动触发下一次执行）';
    }
    if (toolName === 'run_command') {
        const cmd = String(input.command || '').trim();
        const cwd = input.cwd ? ` (在 ${input.cwd})` : '';
        return `执行终端命令${cwd}: ${cmd}`;
    }
    return `执行 ${toolName}`;
}

/**
 * 检查工具是否需要确认，如果需要则弹框询问用户。
 * 返回 true = 允许执行，false = 用户拒绝。
 */
export async function checkToolPermission(
    toolName: string,
    input: Record<string, unknown>,
    autonomous: boolean,
): Promise<{ allowed: boolean; reason?: string }> {
    // 自主模式：全部放行
    if (autonomous) { return { allowed: true }; }

    const risk = getToolRisk(toolName);

    // safe / write：放行
    if (risk !== 'destructive') {
        // MCP 工具首次需确认（session 级）
        if (/^mcp_([^_]+)_.+$/.test(toolName)) {
            const serverId = toolName.match(/^mcp_([^_]+)_/)?.[1] || '';
            if (!_mcpAuthorizedServers.has(serverId)) {
                const action = await vscode.window.showInformationMessage(
                    `首次调用 MCP server "${serverId}" 的工具 "${toolName}"，是否允许？`,
                    { modal: true },
                    '允许（本次会话）',
                );
                if (action) {
                    _mcpAuthorizedServers.add(serverId);
                    return { allowed: true };
                }
                return { allowed: false, reason: '用户拒绝调用 MCP 工具' };
            }
        }
        return { allowed: true };
    }

    // destructive：已信任的工具直接放行
    if (_sessionTrustedTools.has(toolName)) {
        return { allowed: true };
    }

    // destructive：弹确认框
    let message: string;
    if (toolName === 'delete_issue' || toolName === 'batch_delete_issues') {
        message = `⚠️ ${buildDeletePreview(toolName, input)}`;
    } else {
        message = `⚠️ ${buildDestructiveDescription(toolName, input)}`;
    }

    const canTrust = SESSION_TRUSTABLE_TOOLS.has(toolName);
    const actions = canTrust ? ['确认执行', '信任本次会话'] : ['确认执行'];
    const action = await vscode.window.showWarningMessage(
        message,
        { modal: true },
        ...actions,
    );

    if (action === '信任本次会话') {
        _sessionTrustedTools.add(toolName);
        return { allowed: true };
    }
    if (action === '确认执行') {
        return { allowed: true };
    }
    return { allowed: false, reason: '用户已拒绝执行此操作' };
}
