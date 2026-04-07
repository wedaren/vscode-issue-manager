/**
 * 角色管理工具：list_available_tools / create_chat_role / update_role_config / evaluate_role / read_role_execution_logs
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { Logger } from '../../core/utils/Logger';
import type { ChatRoleInfo } from '../types';
import type { ToolCallResult, ToolExecContext } from './types';
import { findRole } from './shared';
import { findOrCreateMemoryFile } from './memoryTools';
import {
    getAllChatRoles, getChatRoleById, createChatRole as dataCreateChatRole,
    getConversationsForRole, getRoleSystemPrompt, updateRoleSystemPrompt,
    getConversationConfig,
} from '../llmChatDataManager';
import {
    getIssueMarkdownsByType, extractFrontmatterAndBody, updateIssueMarkdownBody,
} from '../../data/IssueMarkdowns';
import { getIssueDir } from '../../config';
import { updateIssueMarkdownFrontmatter } from '../../data/IssueMarkdowns';
import { McpManager } from '../mcp';
import { SkillManager } from '../SkillManager';

const logger = Logger.getInstance();

// ─── 工具 schema ─────────────────────────────────────────────

/** 角色管理工具（role_management_enabled 时注入） */
export const ROLE_MANAGEMENT_TOOLS: vscode.LanguageModelChatTool[] = [
    {
        name: 'list_available_tools',
        description: '列出当前可用的内置工具包（tool_sets）和已注册的 MCP server（mcp_servers）及其工具，供创建或配置角色时参考。',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'create_chat_role',
        description: '创建一个新的聊天角色。调用前必须先调用 list_available_tools，了解可用的工具包、MCP server、Agent Skills 以及内置角色配置示例，再按角色职责全面配置。创建后可立即用 delegate_to_role 委派任务（需要委派能力）。',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '角色名称（如"法律顾问"、"数学专家"）' },
                systemPrompt: { type: 'string', description: '角色的系统提示词，详细描述其职责、能力和行为准则' },
                avatar: {
                    type: 'string',
                    description: 'VS Code ThemeIcon 名称，如 scale、beaker、code、book、shield、person、globe、lightbulb 等',
                },
                modelFamily: {
                    type: 'string',
                    enum: ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5-20251001'],
                    description: '指定使用的 AI 模型。不填则使用全局默认。claude-sonnet-4-6 适合大多数场景，claude-haiku-4-5-20251001 速度更快适合简单任务，claude-opus-4-6 能力最强适合复杂推理。',
                },
                toolSets: {
                    type: 'array',
                    items: { type: 'string', enum: ['memory', 'delegation', 'role_management', 'group_coordinator', 'terminal', 'browsing'] },
                    description: '为新角色启用的工具包列表。group_coordinator 用于群组协调者角色（配合 groupMembers 使用），delegation 用于委派任务给其他角色，memory 用于读写记忆，browsing 用于抓取网页内容（fetch_url），默认为空',
                },
                groupMembers: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '群组成员的角色 ID 列表。仅当 toolSets 包含 group_coordinator 时使用。成员必须已存在，填写其 ID（如 create_chat_role 返回的 ID）。',
                },
                mcpServers: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '要注入的 MCP server 名称列表，如 ["memory", "fetch"]。请先调用 list_available_tools 确认实际可用的 server 名称，再按角色职责按需选择。避免使用 "*"（引入全部），会导致 token 上下文爆炸。默认为空',
                },
                skills: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Agent Skills 名称列表。Skills 提供领域知识指令，会注入到角色 system prompt。请先调用 list_available_tools 确认可用的 skill 名称。使用 vendor 前缀（如 "weibo-cli"）可引入该 vendor 下所有 skills。',
                },
                contextStrategy: {
                    type: 'string',
                    enum: ['generous', 'focused', 'minimal'],
                    description: '上下文注入策略：generous=全量注入（记忆/计划/文件/编辑器/git 等全部），适合需要全局感知的中枢角色；focused=按 contextSources 精选注入，适合专注特定领域的角色；minimal=仅注入基本信息，适合自主长任务角色以节省 token。默认不设置（继承全局）',
                },
                contextSources: {
                    type: 'array',
                    items: { type: 'string', enum: ['memory', 'plan', 'linked_files', 'active_editor', 'selection', 'git_diff', 'datetime'] },
                    description: '当 contextStrategy 为 focused 时，精选注入的上下文源列表。如研究员用 ["memory", "plan", "linked_files", "datetime"]，编程助手用 ["active_editor", "selection", "git_diff"]',
                },
                autonomous: {
                    type: 'boolean',
                    description: '是否启用自主执行模式。true=自主执行（工具调用无需用户确认），适合长篇创作等需要连续执行的角色；false=交互模式（默认）',
                },
            },
            required: ['name', 'systemPrompt'],
        },
    },
    {
        name: 'update_role_config',
        description: '根据实际表现更新指定角色的系统提示词，优化其行为。',
        inputSchema: {
            type: 'object',
            properties: {
                roleNameOrId: { type: 'string', description: '要更新的角色名称或 ID' },
                newSystemPrompt: { type: 'string', description: '新的系统提示词（完整替换）' },
                reason: { type: 'string', description: '更新原因（可选，用于记录）' },
            },
            required: ['roleNameOrId', 'newSystemPrompt'],
        },
    },
    {
        name: 'evaluate_role',
        description: '记录对某个角色的绩效评估。结果会写入本角色的记忆文件（需要同时启用记忆能力）。',
        inputSchema: {
            type: 'object',
            properties: {
                roleNameOrId: { type: 'string', description: '角色名称或 ID' },
                outcome: {
                    type: 'string',
                    enum: ['success', 'partial', 'failed'],
                    description: 'success=完成良好, partial=部分完成, failed=未完成或质量差',
                },
                notes: { type: 'string', description: '详细评价：做得好的地方、不足之处、改进建议' },
            },
            required: ['roleNameOrId', 'outcome', 'notes'],
        },
    },
    {
        name: 'read_role_execution_logs',
        description: '读取指定角色的执行日志，统计工具实际调用情况、成功率、token 消耗，并与角色配置对比，找出冗余或缺失的工具配置。',
        inputSchema: {
            type: 'object',
            properties: {
                roleNameOrId: { type: 'string', description: '角色名称或 ID' },
                maxConversations: { type: 'number', description: '分析最近 N 个对话的日志，默认 5' },
            },
            required: ['roleNameOrId'],
        },
    },
];

// ─── 工具实现 ────────────────────────────────────────────────

function executeListAvailableTools(): ToolCallResult {
    const BUILT_IN = [
        { id: '(基础)',            tools: 'read_todos、write_todos、update_todo',               desc: '对话级 todo 管理，所有角色默认可用，无需配置' },
        { id: 'memory',            tools: 'write_memory',                                       desc: '持久记忆（记忆内容自动注入上下文，无需手动读取），适合长期任务角色' },
        { id: 'delegation',        tools: 'delegate_to_role、continue_delegation、list_chat_roles、get_delegation_status', desc: '委派能力（delegate_to_role 发起 → continue_delegation 多轮追问直到完成），适合中枢调度角色' },
        { id: 'planning',          tools: 'create_plan、read_plan、check_step、add_step、update_progress_note', desc: '执行计划管理，将复杂任务分解为有序步骤并持久化进度，适合多步骤长任务角色' },
        { id: 'role_management',   tools: 'list_available_tools、create_chat_role、update_role_config 等', desc: '角色管理，仅管理型角色需要' },
        { id: 'terminal',          tools: 'read_file、search_files、run_command',              desc: '工作区文件读取/搜索（静默）+ 终端命令执行（需确认），适合开发角色' },
        { id: 'group_coordinator', tools: 'ask_group_member、ask_all_group_members',            desc: '群组协调者，配合 group_members 配置，协调多角色并行协作' },
        { id: 'browsing',          tools: 'fetch_url',                                          desc: '网页抓取，将 URL 内容转为 Markdown，适合需要联网查资料的角色' },
    ];

    const builtInSection = [
        '## 内置工具包（tool_sets）',
        ...BUILT_IN.map(s => `- ${s.id}: ${s.tools} — ${s.desc}`),
    ].join('\n');

    // ─── MCP Server 列表 ────────────────────────────────────────
    const mcpManager = McpManager.getInstance();
    const serversWithTools = mcpManager.getServersWithTools();

    let mcpSection: string;
    if (serversWithTools.size === 0) {
        mcpSection = '## 已注册 MCP Server（mcp_servers）\n（当前未注册任何 MCP 工具）';
    } else {
        const lines = [...serversWithTools.entries()].map(([server, tools]) =>
            `- ${server} (${tools.length} 个工具): ${tools.map(t => t.originalName).join('、')}`
        );
        mcpSection = ['## 已注册 MCP Server（mcp_servers）', '> 按角色职责按需选择 server，避免使用 "*"（会将全部工具注入上下文，消耗大量 token）', ...lines].join('\n');
    }

    // ─── Agent Skills 列表 ──────────────────────────────────────
    const skillManager = SkillManager.getInstance();
    const allSkills = skillManager.getAllSkills();
    let skillSection: string;
    if (allSkills.length === 0) {
        skillSection = '## 可用 Agent Skills（skills）\n（当前未安装任何 skill）';
    } else {
        // 按 vendor 前缀分组展示，并展示依赖工具
        const byVendor = new Map<string, typeof allSkills>();
        for (const s of allSkills) {
            const dash = s.name.indexOf('-');
            const vendor = dash > 0 ? s.name.slice(0, dash) : s.name;
            if (!byVendor.has(vendor)) { byVendor.set(vendor, []); }
            byVendor.get(vendor)!.push(s);
        }
        const formatSkill = (s: typeof allSkills[0]) => {
            const parts: string[] = [];
            if (s.allowedTools?.length) {
                parts.push(`需要工具: ${s.allowedTools.join('、')}`);
            }
            if (s.compatibility) {
                parts.push(`环境: ${s.compatibility.slice(0, 80)}`);
            }
            const suffix = parts.length ? ` [${parts.join(' | ')}]` : '';
            return `- ${s.name}: ${s.description}${suffix}`;
        };
        const lines: string[] = [];
        for (const [vendor, skills] of byVendor) {
            if (skills.length === 1) {
                lines.push(formatSkill(skills[0]));
            } else {
                lines.push(`- ${vendor} (${skills.length} 个): ${skills.map(s => s.name).join('、')}`);
                for (const s of skills) {
                    lines.push(`  ${formatSkill(s)}`);
                }
            }
        }
        skillSection = [
            '## 可用 Agent Skills（skills）',
            '> Skills 提供领域知识指令，注入角色 system prompt。配置时填 skill 名称列表。',
            '> ⚠️ **重要**：Skills 只是知识注入，不提供执行能力。如果 skill 依赖终端命令（如 CLI 工具），角色必须同时配置 terminal 工具集（toolSets 包含 "terminal"），否则角色知道怎么做但无法执行。',
            ...lines,
        ].join('\n');
    }

    // ─── 上下文策略说明 ─────────────────────────────────────────
    const contextSection = [
        '## 上下文策略（contextStrategy + contextSources）',
        '角色的 contextStrategy 决定注入多少环境信息到 system prompt：',
        '- generous: 全量注入（记忆、计划、关联文件、活动编辑器、选区、git diff、日期时间）。适合需要全局感知的中枢角色（如个人助理）',
        '- focused: 仅注入 contextSources 指定的信息源。适合专注特定领域的角色（如编程助手只需 active_editor + selection + git_diff）',
        '- minimal: 仅注入最基本信息。适合自主长任务角色（如长篇创作），节省 token',
        '',
        '可选 contextSources: memory、plan、linked_files、active_editor、selection、git_diff、datetime',
    ].join('\n');

    // ─── 内置角色配置示例 ───────────────────────────────────────
    const templateSection = [
        '## 内置角色配置参考',
        '> 以下是内置角色的配置模式，创建新角色时可参考相近职责的配置：',
        '',
        '**个人助理**（中枢调度）: contextStrategy=generous, toolSets=[memory, delegation, role_management, planning]',
        '- 全量上下文 + 记忆 + 委派 + 角色管理 + 计划，适合作为用户的全能入口',
        '',
        '**思维伙伴**（深度对话）: contextStrategy=generous, toolSets=[memory]',
        '- 全量上下文 + 记忆，不需要工具执行能力，专注思维碰撞',
        '',
        '**深度研究员**（系统研究）: contextStrategy=focused, contextSources=[memory, plan, linked_files, datetime], toolSets=[planning, memory]',
        '- 精选上下文避免干扰 + 计划管理持久化研究进度',
        '',
        '**长篇创作**（自主写作）: contextStrategy=minimal, toolSets=[planning, memory], autonomous=true, timerEnabled=true',
        '- 最小上下文节省 token + 自主模式 + 定时器自动续写',
        '',
        '**编程助手**（代码专注）: contextStrategy=focused, contextSources=[active_editor, selection, git_diff]',
        '- 仅编辑器/选区/git 上下文，不需要记忆或计划',
    ].join('\n');

    return { success: true, content: `${builtInSection}\n\n${mcpSection}\n\n${skillSection}\n\n${contextSection}\n\n${templateSection}` };
}

async function executeCreateChatRole(input: Record<string, unknown>): Promise<ToolCallResult> {
    const name = String(input.name || '').trim();
    const systemPrompt = String(input.systemPrompt || '').trim();
    const avatar = String(input.avatar || 'hubot').trim();
    const modelFamily = input.modelFamily ? String(input.modelFamily).trim() : undefined;
    const toolSets: string[] = Array.isArray(input.toolSets)
        ? (input.toolSets as unknown[]).map(String)
        : [];
    const mcpServers: string[] = Array.isArray(input.mcpServers)
        ? (input.mcpServers as unknown[]).map(String)
        : [];
    const skills: string[] = Array.isArray(input.skills)
        ? (input.skills as unknown[]).map(String)
        : [];
    const contextStrategy = typeof input.contextStrategy === 'string'
        ? input.contextStrategy as 'generous' | 'focused' | 'minimal'
        : undefined;
    const contextSources: string[] | undefined = Array.isArray(input.contextSources)
        ? (input.contextSources as unknown[]).map(String)
        : undefined;
    const autonomous = typeof input.autonomous === 'boolean' ? input.autonomous : undefined;
    const groupMembers: string[] = Array.isArray(input.groupMembers)
        ? (input.groupMembers as unknown[]).map(String).filter(Boolean)
        : [];

    if (!name) { return { success: false, content: '请提供角色名称' }; }
    if (!systemPrompt) { return { success: false, content: '请提供系统提示词' }; }

    const roleId = await dataCreateChatRole(name, systemPrompt, avatar, modelFamily, toolSets, mcpServers, {
        autonomous,
        contextStrategy,
        contextSources,
        skills,
    });
    if (!roleId) {
        return { success: false, content: '创建角色失败' };
    }

    // 写入 group_members frontmatter（group_coordinator 专用）
    if (groupMembers.length > 0) {
        const issueDir = getIssueDir();
        if (issueDir) {
            const roleUri = vscode.Uri.file(path.join(issueDir, `${roleId}.md`));
            await updateIssueMarkdownFrontmatter(roleUri, { group_members: groupMembers });
        }
    }

    void vscode.commands.executeCommand('issueManager.llmChat.refresh');

    const capStr = toolSets.length > 0 ? `，工具集：${toolSets.join('/')}` : '';
    const mcpStr = mcpServers.length > 0 ? `，MCP：${mcpServers.join('/')}` : '';
    const modelNote = modelFamily ? `，模型：${modelFamily}` : '';
    const skillStr = skills.length > 0 ? `，Skills：${skills.join('/')}` : '';
    const ctxStr = contextStrategy ? `，上下文策略：${contextStrategy}` : '';
    const autoStr = autonomous ? '，自主模式' : '';
    const membersStr = groupMembers.length > 0 ? `，成员：${groupMembers.length} 人` : '';
    return {
        success: true,
        content: `✓ 已创建角色「${name}」(ID: \`${roleId}\`${modelNote}${capStr}${mcpStr}${skillStr}${ctxStr}${autoStr}${membersStr})。`,
    };
}

async function executeUpdateRoleConfig(input: Record<string, unknown>): Promise<ToolCallResult> {
    const roleNameOrId = String(input.roleNameOrId || '').trim();
    const newSystemPrompt = String(input.newSystemPrompt || '').trim();
    const reason = input.reason ? String(input.reason) : undefined;

    if (!roleNameOrId) { return { success: false, content: '请提供角色名称或 ID' }; }
    if (!newSystemPrompt) { return { success: false, content: '请提供新的系统提示词' }; }

    const role = await findRole(roleNameOrId);
    if (!role) { return { success: false, content: `未找到角色「${roleNameOrId}」` }; }

    try {
        const ok = await updateRoleSystemPrompt(role.uri, newSystemPrompt);
        if (!ok) { return { success: false, content: '更新失败' }; }
        void vscode.commands.executeCommand('issueManager.llmChat.refresh');
        const reasonStr = reason ? `\n更新原因：${reason}` : '';
        return { success: true, content: `✓ 已更新角色「${role.name}」的系统提示词${reasonStr}` };
    } catch (e) {
        logger.error('[ChatTools] 更新角色配置失败', e);
        return { success: false, content: '更新角色配置失败' };
    }
}

async function executeEvaluateRole(input: Record<string, unknown>, context?: ToolExecContext): Promise<ToolCallResult> {
    const roleNameOrId = String(input.roleNameOrId || '').trim();
    const outcome = String(input.outcome || 'partial') as 'success' | 'partial' | 'failed';
    const notes = String(input.notes || '').trim();

    if (!roleNameOrId) { return { success: false, content: '请提供角色名称或 ID' }; }
    if (!notes) { return { success: false, content: '请提供评估说明' }; }

    const outcomeLabel = outcome === 'success' ? '✓ 良好' : outcome === 'partial' ? '⚠️ 部分完成' : '❌ 未完成';

    // 如果当前角色有记忆能力，将评估写入记忆
    if (context?.role?.toolSets.includes('memory') && context.role.id) {
        const memUri = await findOrCreateMemoryFile(context.role.id);
        if (memUri) {
            try {
                const raw = Buffer.from(await vscode.workspace.fs.readFile(memUri)).toString('utf8');
                const { body } = extractFrontmatterAndBody(raw);
                const timestamp = new Date().toISOString().slice(0, 10);
                const entry = `\n### ${roleNameOrId} — ${timestamp} ${outcomeLabel}\n${notes}\n`;
                let newBody: string;
                if (body.includes('## 角色绩效')) {
                    newBody = body.replace('## 角色绩效', `## 角色绩效${entry}`);
                } else {
                    newBody = body + `\n## 角色绩效${entry}`;
                }
                await updateIssueMarkdownBody(memUri, newBody);
            } catch (e) {
                logger.error('[ChatTools] 写入评估到记忆失败', e);
            }
        }
    }

    return { success: true, content: `✓ 已记录角色「${roleNameOrId}」的绩效评估：${outcomeLabel}` };
}

async function executeReadRoleExecutionLogs(input: Record<string, unknown>): Promise<ToolCallResult> {
    const roleNameOrId = String(input.roleNameOrId || '').trim();
    const maxConversations = typeof input.maxConversations === 'number' ? Math.max(1, input.maxConversations) : 5;

    if (!roleNameOrId) { return { success: false, content: '请提供角色名称或 ID' }; }

    const role = await findRole(roleNameOrId);
    if (!role) { return { success: false, content: `未找到角色: ${roleNameOrId}` }; }

    const issueDir = getIssueDir();
    if (!issueDir) { return { success: false, content: '未找到 issueDir' }; }

    const conversations = await getConversationsForRole(role.id);
    const recentConvos = conversations.sort((a, b) => b.mtime - a.mtime).slice(0, maxConversations);

    if (recentConvos.length === 0) {
        return { success: true, content: `角色「${role.name}」没有对话记录。` };
    }

    // ─── 聚合统计 ────────────────────────────────────────────
    const toolCallCounts: Record<string, number> = {};
    let totalRuns = 0;
    let successRuns = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    const recentErrors: string[] = [];
    /** 失败原因分类计数 */
    const failureCategories: Record<string, number> = {};
    let analyzedLogs = 0;

    for (const convo of recentConvos) {
        if (!convo.logId) { continue; }
        const logUri = vscode.Uri.file(path.join(issueDir, `${convo.logId}.md`));
        try {
            const raw = Buffer.from(await vscode.workspace.fs.readFile(logUri)).toString('utf8');
            analyzedLogs++;

            // Run 数量
            const runMatches = [...raw.matchAll(/## Run #(\d+)/g)];
            totalRuns += runMatches.length;

            // 成功数：匹配 "✓ **成功**"
            const successMatches = raw.match(/✓ \*\*成功\*\*/g);
            successRuns += successMatches?.length ?? 0;

            // 工具调用：匹配 backtick 包裹的工具名 + 括号内的耗时
            // 覆盖多种日志格式：
            //   Timer:  ✓ [`tool_name`](link) (1.2s)  或  ✓ `tool_name` (250ms)
            //   Direct: 🔧 `tool_name` (250ms) → result
            //   委派:   📥✓ **委派结果** [`delegate_to_role`](link) (3.2s)
            for (const m of raw.matchAll(/`([^`]+)`[^\n]*?\((\d+(?:\.\d+)?(?:ms|s))\)/g)) {
                const t = m[1];
                // 排除非工具调用行（如 LLM 轮次摘要中的工具名列表）
                // 工具调用行包含状态图标 ✓❌🔧📥 或 ⏳
                const lineStart = raw.lastIndexOf('\n', m.index!) + 1;
                const linePrefix = raw.slice(lineStart, m.index!);
                if (/[✓❌🔧📥]/.test(linePrefix)) {
                    toolCallCounts[t] = (toolCallCounts[t] ?? 0) + 1;
                }
            }

            // Token 消耗
            for (const m of raw.matchAll(/input (\d+) \+ output (\d+)/g)) {
                totalInputTokens += parseInt(m[1], 10);
                totalOutputTokens += parseInt(m[2], 10);
            }

            // 错误信息：匹配 "❌ **失败...** | 耗时 ... | 错误详情"
            for (const m of raw.matchAll(/❌ \*\*失败[^|]*\|[^|]*\| (.+)/g)) {
                const errMsg = m[1];
                recentErrors.push(errMsg);
                // 归类失败原因
                const cat = /空响应/.test(errMsg) ? '空响应'
                    : /超时|timeout/i.test(errMsg) ? '超时'
                    : /abort|中止/i.test(errMsg) ? '用户中止'
                    : '其他错误';
                failureCategories[cat] = (failureCategories[cat] ?? 0) + 1;
            }

            // 空闲超时（单独的日志格式）
            const idleTimeouts = raw.match(/⏰ \*\*空闲超时\*\*/g);
            if (idleTimeouts) {
                failureCategories['空闲超时'] = (failureCategories['空闲超时'] ?? 0) + idleTimeouts.length;
            }
        } catch {
            // 日志文件不可读，跳过
        }
    }

    if (analyzedLogs === 0) {
        return { success: true, content: `角色「${role.name}」有 ${recentConvos.length} 个对话，但均无执行日志。` };
    }

    // ─── 与配置对比 ──────────────────────────────────────────
    const { getToolsForRole } = await import('./registry');
    const configuredTools = getToolsForRole(role).map((t: { name: string }) => t.name);
    const usedTools = Object.keys(toolCallCounts);
    const neverUsed = configuredTools.filter((t: string) => !usedTools.includes(t));

    // ─── 读取 system prompt 长度 ─────────────────────────────
    let promptLength = 0;
    try {
        const fullPrompt = await getRoleSystemPrompt(role.uri);
        promptLength = fullPrompt.length;
    } catch { /* 读取失败不影响报告 */ }

    // ─── 组装报告 ────────────────────────────────────────────
    let report = `## 角色「${role.name}」执行日志分析\n\n`;
    report += `**分析范围**: 最近 ${recentConvos.length} 个对话 / ${analyzedLogs} 份日志 / ${totalRuns} 次执行\n\n`;

    report += `### 当前配置\n`;
    report += `- 工具集 (tool_sets): ${role.toolSets.length > 0 ? role.toolSets.join(', ') : '（无）'}\n`;
    report += `- MCP servers: ${role.mcpServers?.length ? role.mcpServers.join(', ') : '（无）'}\n`;
    report += `- 配置工具总数: **${configuredTools.length}**\n`;
    if (promptLength > 0) {
        report += `- System prompt 长度: ${promptLength} 字（需查看全文请调用 read_issue）\n`;
    }
    report += '\n';

    if (totalRuns > 0) {
        const successRate = Math.round(successRuns / totalRuns * 100);
        const totalTokens = totalInputTokens + totalOutputTokens;
        report += `### 执行指标\n`;
        report += `- 成功率: ${successRuns}/${totalRuns} (**${successRate}%**)\n`;
        report += `- 累计 token: input ${totalInputTokens} + output ${totalOutputTokens} = **${totalTokens}**\n`;
        report += `- 平均 token/次: ${Math.round(totalTokens / totalRuns)}\n\n`;

        const totalCalls = Object.values(toolCallCounts).reduce((a, b) => a + b, 0);
        if (usedTools.length > 0) {
            report += `### 实际工具调用（共 ${totalCalls} 次）\n`;
            for (const [tool, count] of Object.entries(toolCallCounts).sort((a, b) => b[1] - a[1])) {
                const pct = Math.round(count / totalCalls * 100);
                report += `- \`${tool}\`: ${count} 次 (${pct}%)\n`;
            }
            report += '\n';
        } else {
            report += `### 实际工具调用\n无任何工具调用记录。\n\n`;
        }

        if (neverUsed.length > 0) {
            // 按来源分组：内置工具 vs MCP 工具，避免冗长的逐个列举
            const neverUsedBuiltin = neverUsed.filter((t: string) => !t.startsWith('mcp_'));
            const neverUsedMcp = neverUsed.filter((t: string) => t.startsWith('mcp_'));
            report += `### ⚠️ 配置但从未调用的工具（${neverUsed.length}/${configuredTools.length}）\n`;
            report += `> 这些工具占用了 LLM 上下文 token，但从未被使用，可考虑移除。\n\n`;
            if (neverUsedBuiltin.length > 0) {
                report += `**内置工具** (${neverUsedBuiltin.length})：${neverUsedBuiltin.map((t: string) => `\`${t}\``).join(', ')}\n`;
            }
            if (neverUsedMcp.length > 0) {
                // MCP 工具按 server 前缀分组汇总，不逐个列出
                const mcpGroups: Record<string, number> = {};
                for (const t of neverUsedMcp) {
                    const parts = t.split('_');
                    const server = parts.length >= 3 ? `${parts[0]}_${parts[1]}` : t;
                    mcpGroups[server] = (mcpGroups[server] ?? 0) + 1;
                }
                const groupSummary = Object.entries(mcpGroups).map(([s, n]) => `${s} (${n})`).join(', ');
                report += `**MCP 工具** (${neverUsedMcp.length})：${groupSummary}\n`;
            }
            report += '\n';
        }

        // 失败原因分布
        const failureCats = Object.entries(failureCategories);
        if (failureCats.length > 0) {
            report += `### 失败原因分布\n`;
            for (const [cat, count] of failureCats.sort((a, b) => b[1] - a[1])) {
                report += `- ${cat}: ${count} 次\n`;
            }
            report += '\n';
        }

        if (recentErrors.length > 0) {
            const uniqueErrors = [...new Set(recentErrors)].slice(0, 3);
            report += `### 近期错误样例（取 ${uniqueErrors.length} 条去重）\n`;
            for (const e of uniqueErrors) { report += `- ${e}\n`; }
            report += '\n';
        }
    }

    return { success: true, content: report };
}

// ─── 导出 ────────────────────────────────────────────────────

export const ROLE_MANAGEMENT_HANDLERS: Record<string, (input: Record<string, unknown>, context?: ToolExecContext) => Promise<ToolCallResult> | ToolCallResult> = {
    list_available_tools: () => executeListAvailableTools(),
    create_chat_role: executeCreateChatRole,
    update_role_config: executeUpdateRoleConfig,
    evaluate_role: executeEvaluateRole,
    read_role_execution_logs: executeReadRoleExecutionLogs,
};
