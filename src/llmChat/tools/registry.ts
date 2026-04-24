/**
 * 工具注册表与工具集组装
 *
 * 只导入各领域的 Schema 数组（不导入 execute 函数），
 * 避免与需要反向引用 getToolsForRole 的模块形成循环依赖。
 */
import * as vscode from 'vscode';
import type { ChatRoleInfo } from '../types';
import { Logger } from '../../core/utils/Logger';
import { McpManager } from '../mcp';

import { BASE_ISSUE_TOOLS, ISSUE_RELATION_TOOLS } from './issueTools';
import { TODO_TOOLS } from './todoTools';
// memory 工具集已废弃，记忆由 knowledge_base 统一管理
// import { MEMORY_TOOLS } from './memoryTools';
import { DELEGATION_TOOLS } from './delegationTools';
import { ROLE_MANAGEMENT_TOOLS } from './roleManagementTools';
import { PLANNING_TOOLS } from './planningTools';
import { TERMINAL_TOOLS } from './terminalTools';
import { GROUP_COORDINATOR_TOOLS } from './groupTools';
import { BROWSING_TOOLS } from './browsingTools';
import { KNOWLEDGE_BASE_TOOLS } from './knowledgeBaseTools';
import { SKILL_TOOLS } from './skillTools';
import { DIAGRAM_TOOLS } from './diagramTools';

const logger = Logger.getInstance();

/** 聊天角色可用的基础工具集（笔记管理 + 关联管理 + todo） */
export const CHAT_TOOLS: vscode.LanguageModelChatTool[] = [
    ...BASE_ISSUE_TOOLS,
    ...ISSUE_RELATION_TOOLS,
    ...TODO_TOOLS,
];

/** 内置工具包注册表，新增工具包只需在此添加一条记录 */
const TOOL_SET_REGISTRY: Record<string, vscode.LanguageModelChatTool[]> = {
    delegation:           DELEGATION_TOOLS,
    role_management:      ROLE_MANAGEMENT_TOOLS,
    planning:             PLANNING_TOOLS,
    terminal:             TERMINAL_TOOLS,
    group_coordinator:    GROUP_COORDINATOR_TOOLS,
    browsing:             BROWSING_TOOLS,
    knowledge_base:       KNOWLEDGE_BASE_TOOLS,
    diagram:              DIAGRAM_TOOLS,
};

/**
 * 根据角色的工具集配置，组装该角色可用的完整工具集。
 * - toolSets: 内置工具包名称列表
 * - mcpServers / extraTools / excludedTools: 从 McpManager 获取 MCP 工具
 */
export function getToolsForRole(role: ChatRoleInfo): vscode.LanguageModelChatTool[] {
    const tools = [...CHAT_TOOLS];

    // 内置工具包
    for (const name of role.toolSets) {
        const bundle = TOOL_SET_REGISTRY[name];
        if (bundle) {
            tools.push(...bundle);
        } else {
            logger.warn(`[ChatTools] 未知工具包: "${name}"，已跳过`);
        }
    }

    // 全局排除（excludedTools 适用于所有工具，包括 BASE_ISSUE_TOOLS）
    // 示例：excluded_tools: [search_issues, get_library_stats]
    if (role.excludedTools && role.excludedTools.length > 0) {
        const excluded = new Set(role.excludedTools);
        for (let i = tools.length - 1; i >= 0; i--) {
            if (excluded.has(tools[i].name)) { tools.splice(i, 1); }
        }
    }

    // ─── Skills 工具注入 ──────────────────────────────────────
    // 单 skill 角色：完整指令已由 context pipeline 直接注入 system prompt，
    // 不需要 activate_skill 工具（省 1 轮工具调用）。
    // 多 skill 角色：注入 activate_skill 用于按需加载。
    if (role.skills && role.skills.length > 1) {
        tools.push(...SKILL_TOOLS);
    }

    // ─── MCP 工具注入 ────────────────────────────────────────
    const hasMcpConfig =
        (role.mcpServers && role.mcpServers.length > 0) ||
        (role.extraTools && role.extraTools.length > 0) ||
        (role.excludedTools && role.excludedTools.length > 0);

    if (hasMcpConfig) {
        const mcpManager = McpManager.getInstance();
        const mcpToolNames = new Set<string>();

        // 收集来自指定 MCP server 的所有工具（"*" 表示引入全部）
        if (role.mcpServers && role.mcpServers.length > 0) {
            const mcpTools = mcpManager.getToolsByServers(role.mcpServers);
            for (const t of mcpTools) { mcpToolNames.add(t.name); }
        }

        // 额外引入的具体工具
        if (role.extraTools) {
            for (const name of role.extraTools) { mcpToolNames.add(name); }
        }

        // 排除的工具
        if (role.excludedTools) {
            for (const name of role.excludedTools) { mcpToolNames.delete(name); }
        }

        // 将筛选出的 MCP 工具转换为 LanguageModelChatTool 格式后追加
        const allMcpTools = mcpManager.getAllTools();
        for (const t of allMcpTools) {
            if (!mcpToolNames.has(t.name)) { continue; }
            tools.push({
                name: t.name,
                description: t.description,
                inputSchema: t.inputSchema as vscode.LanguageModelChatTool['inputSchema'],
            });
        }
    }

    // 按工具名去重（工具包之间可能存在重叠）
    const seen = new Set<string>();
    return tools.filter(t => {
        if (seen.has(t.name)) { return false; }
        seen.add(t.name);
        return true;
    });
}
