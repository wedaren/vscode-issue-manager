/**
 * 个人助手专用工具
 *
 * 在 CHAT_TOOLS 基础上追加：
 * - read_memory / write_memory：持久记忆读写
 * - delegate_to_role：将任务委派给指定角色
 * - list_chat_roles：列出所有可用角色
 * - create_chat_role：创建新角色
 * - update_role_config：更新角色系统提示词
 * - evaluate_role：记录角色绩效评估
 */
import * as vscode from 'vscode';
import { CHAT_TOOLS, executeChatTool, type ToolCallResult } from './chatTools';
import { PersonalAssistantService } from './PersonalAssistantService';
import { createChatRole } from './llmChatDataManager';
import { Logger } from '../core/utils/Logger';

const logger = Logger.getInstance();

// ─── 工具定义 ─────────────────────────────────────────────────

/** 个人助手专属的额外工具定义 */
const ASSISTANT_EXTRA_TOOLS: vscode.LanguageModelChatTool[] = [
    {
        name: 'read_memory',
        description: '读取个人助手的持久记忆，包含用户背景、历史任务摘要、角色绩效记录和自我反思。对话开始时应首先调用此工具。',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'write_memory',
        description: '更新个人助手的持久记忆。在任务完成后调用，记录本次任务经验、角色表现、对用户的新了解等。内容为 Markdown 格式，会替换现有记忆。',
        inputSchema: {
            type: 'object',
            properties: {
                content: {
                    type: 'string',
                    description: '新的记忆内容（Markdown 格式）。建议保留以下结构：## 用户背景、## 历史任务、## 角色绩效、## 自我反思',
                },
            },
            required: ['content'],
        },
    },
    {
        name: 'list_chat_roles',
        description: '列出当前所有可用的专业角色（排除个人助手自身），含名称、系统提示词摘要。用于决定委派给谁。',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'delegate_to_role',
        description: '将一个子任务委派给指定的专业角色，获取该角色的回复。角色可以使用笔记和浏览器工具。返回角色的完整回复文本。',
        inputSchema: {
            type: 'object',
            properties: {
                roleNameOrId: {
                    type: 'string',
                    description: '目标角色的名称（如"深度研究员"）或 ID（文件名去掉 .md）',
                },
                task: {
                    type: 'string',
                    description: '委派给该角色的具体任务描述，越详细越好',
                },
            },
            required: ['roleNameOrId', 'task'],
        },
    },
    {
        name: 'create_chat_role',
        description: '创建一个新的专业角色。当现有角色无法胜任某类任务时使用。创建后可立即用 delegate_to_role 委派任务。',
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
                    description: '指定使用的 AI 模型。可选值：gpt-5-mini（默认，轻快）、gpt-4o（均衡）、gpt-4.1（深度）、gpt-4.1-mini、o3-mini（推理）、claude-3.5-sonnet。不填则使用全局默认。',
                },
            },
            required: ['name', 'systemPrompt'],
        },
    },
    {
        name: 'update_role_config',
        description: '根据实际表现更新指定角色的系统提示词，优化其行为。用于持续改进团队质量。',
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
        description: '记录对某个角色的绩效评估，包括表现评分和改进建议。结果会写入记忆文件。',
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
];

/** 个人助手完整工具集 = 普通工具 + 助手专属工具 */
export const PERSONAL_ASSISTANT_TOOLS: vscode.LanguageModelChatTool[] = [
    ...CHAT_TOOLS,
    ...ASSISTANT_EXTRA_TOOLS,
];

// ─── 工具执行 ─────────────────────────────────────────────────

/**
 * 执行个人助手工具（包含助手专属工具 + 普通聊天工具的 fallback）
 */
export async function executePersonalAssistantTool(
    toolName: string,
    input: Record<string, unknown>,
    signal?: AbortSignal,
): Promise<ToolCallResult> {
    const service = PersonalAssistantService.getInstance();

    try {
        switch (toolName) {
            case 'read_memory':
                return await executeReadMemory(service);

            case 'write_memory':
                return await executeWriteMemory(service, input);

            case 'list_chat_roles':
                return await executeListChatRoles(service);

            case 'delegate_to_role':
                return await executeDelegateToRole(service, input, signal);

            case 'create_chat_role':
                return await executeCreateChatRole(input);

            case 'update_role_config':
                return await executeUpdateRoleConfig(service, input);

            case 'evaluate_role':
                return await executeEvaluateRole(service, input);

            default:
                // 其余工具降级到普通聊天工具
                return executeChatTool(toolName, input);
        }
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.error(`[PA Tools] 执行工具 ${toolName} 失败`, e);
        return { success: false, content: `工具执行失败: ${msg}` };
    }
}

// ─── 各工具实现 ───────────────────────────────────────────────

async function executeReadMemory(service: PersonalAssistantService): Promise<ToolCallResult> {
    const memory = await service.readMemory();
    return { success: true, content: `**[助手记忆]**\n\n${memory}` };
}

async function executeWriteMemory(
    service: PersonalAssistantService,
    input: Record<string, unknown>,
): Promise<ToolCallResult> {
    const content = String(input.content || '').trim();
    if (!content) {
        return { success: false, content: '请提供记忆内容' };
    }

    const ok = await service.writeMemory(content);
    return ok
        ? { success: true, content: '✅ 记忆已更新' }
        : { success: false, content: '记忆更新失败' };
}

async function executeListChatRoles(service: PersonalAssistantService): Promise<ToolCallResult> {
    const roles = await service.listRoles();
    if (roles.length === 0) {
        return {
            success: true,
            content: '当前没有可用的专业角色。可以用 create_chat_role 创建新角色。',
        };
    }

    const config = vscode.workspace.getConfiguration('issueManager');
    const globalDefault = config.get<string>('llm.modelFamily') || 'gpt-5-mini';

    const lines = roles.map(r => {
        const promptPreview = r.systemPrompt
            ? r.systemPrompt.slice(0, 60) + (r.systemPrompt.length > 60 ? '…' : '')
            : '（无提示词）';
        const model = r.modelFamily ? r.modelFamily : `${globalDefault}（全局默认）`;
        return `- **${r.name}** (ID: \`${r.id}\`) · 模型: ${model}\n  ${promptPreview}`;
    });

    return {
        success: true,
        content: `当前可用角色（共 ${roles.length} 个）：\n\n${lines.join('\n\n')}`,
    };
}

async function executeDelegateToRole(
    service: PersonalAssistantService,
    input: Record<string, unknown>,
    signal?: AbortSignal,
): Promise<ToolCallResult> {
    const roleNameOrId = String(input.roleNameOrId || '').trim();
    const task = String(input.task || '').trim();

    if (!roleNameOrId) { return { success: false, content: '请提供角色名称或 ID' }; }
    if (!task) { return { success: false, content: '请提供委派任务描述' }; }

    logger.info(`[PA Tools] 委派任务给「${roleNameOrId}」`);
    const reply = await service.delegateToRole(roleNameOrId, task, signal);
    // 委派结果：包含角色回复 + 提示用户可在树视图查看完整对话
    return {
        success: true,
        content: `**[${roleNameOrId} 的回复]**\n\n${reply}\n\n> 💬 此次委派已在「${roleNameOrId}」下创建对话记录，可在侧边栏查看完整历史。`,
    };
}

async function executeCreateChatRole(input: Record<string, unknown>): Promise<ToolCallResult> {
    const name = String(input.name || '').trim();
    const systemPrompt = String(input.systemPrompt || '').trim();
    const avatar = String(input.avatar || 'hubot').trim();
    const modelFamily = input.modelFamily ? String(input.modelFamily).trim() : undefined;

    if (!name) { return { success: false, content: '请提供角色名称' }; }
    if (!systemPrompt) { return { success: false, content: '请提供系统提示词' }; }

    const roleId = await createChatRole(name, systemPrompt, avatar, modelFamily);
    if (!roleId) {
        return { success: false, content: '创建角色失败' };
    }

    // 刷新视图
    void vscode.commands.executeCommand('issueManager.llmChat.refresh');

    const modelNote = modelFamily ? `，使用模型：${modelFamily}` : '，使用全局默认模型';
    return {
        success: true,
        content: `✅ 已创建角色「${name}」(ID: \`${roleId}\`${modelNote})。现在可以用 delegate_to_role 向他委派任务。`,
    };
}

async function executeUpdateRoleConfig(
    service: PersonalAssistantService,
    input: Record<string, unknown>,
): Promise<ToolCallResult> {
    const roleNameOrId = String(input.roleNameOrId || '').trim();
    const newSystemPrompt = String(input.newSystemPrompt || '').trim();
    const reason = input.reason ? String(input.reason) : undefined;

    if (!roleNameOrId) { return { success: false, content: '请提供角色名称或 ID' }; }
    if (!newSystemPrompt) { return { success: false, content: '请提供新的系统提示词' }; }

    const ok = await service.updateRoleSystemPrompt(roleNameOrId, newSystemPrompt);
    if (!ok) {
        return { success: false, content: `未找到角色「${roleNameOrId}」或更新失败` };
    }

    // 刷新视图
    void vscode.commands.executeCommand('issueManager.llmChat.refresh');

    const reasonStr = reason ? `\n更新原因：${reason}` : '';
    return {
        success: true,
        content: `✅ 已更新角色「${roleNameOrId}」的系统提示词${reasonStr}`,
    };
}

async function executeEvaluateRole(
    service: PersonalAssistantService,
    input: Record<string, unknown>,
): Promise<ToolCallResult> {
    const roleNameOrId = String(input.roleNameOrId || '').trim();
    const outcome = String(input.outcome || 'partial') as 'success' | 'partial' | 'failed';
    const notes = String(input.notes || '').trim();

    if (!roleNameOrId) { return { success: false, content: '请提供角色名称或 ID' }; }
    if (!notes) { return { success: false, content: '请提供评估说明' }; }

    // 将评估追加到记忆文件
    const existingMemory = await service.readMemory();
    const timestamp = new Date().toISOString().slice(0, 10);
    const outcomeLabel = outcome === 'success' ? '✅ 良好' : outcome === 'partial' ? '⚠️ 部分完成' : '❌ 未完成';

    const evaluationEntry = `\n### ${roleNameOrId} — ${timestamp} ${outcomeLabel}\n${notes}\n`;

    // 在记忆文件的"角色绩效"章节插入
    let newMemory: string;
    if (existingMemory.includes('## 角色绩效')) {
        newMemory = existingMemory.replace(
            '## 角色绩效',
            `## 角色绩效${evaluationEntry}`,
        );
    } else {
        newMemory = existingMemory + `\n## 角色绩效${evaluationEntry}`;
    }

    await service.writeMemory(newMemory);

    return {
        success: true,
        content: `✅ 已记录角色「${roleNameOrId}」的绩效评估：${outcomeLabel}`,
    };
}
