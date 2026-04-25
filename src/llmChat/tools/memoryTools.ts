/**
 * 角色记忆工具：持久化记忆的读写与区块更新
 */
import * as vscode from 'vscode';
import {
    getAllIssueMarkdowns, createIssueMarkdown,
    extractFrontmatterAndBody, updateIssueMarkdownBody,
    type FrontmatterData,
} from '../../data/IssueMarkdowns';
import { Logger } from '../../core/utils/Logger';
import type { RoleMemoryFrontmatter } from '../types';
import type { ToolCallResult, ToolExecContext } from './types';

const logger = Logger.getInstance();

// ─── 工具定义 ─────────────────────────────────────────────────

/** 记忆工具（memory_enabled 时注入） */
const MEMORY_TOOLS: vscode.LanguageModelChatTool[] = [
    {
        name: 'write_memory',
        description: '更新本角色的持久记忆。对话结束前调用，将新认知、决策、用户状态变化写入记忆。'
            + '记忆已在对话开始时自动注入上下文，无需调用 read_memory。\n\n'
            + '推荐结构（保持三个区块，缺少的区块可省略）：\n'
            + '## Profile\n用户身份、背景、技术栈（低频变化）\n\n'
            + '## State\n当前专注、未解问题、近期决策（每次对话后更新）\n\n'
            + '## History\n重要里程碑和关键决策，带日期（仅记录值得长期保留的内容）',
        inputSchema: {
            type: 'object',
            properties: {
                content: {
                    type: 'string',
                    description: '新的记忆内容（Markdown 格式）',
                },
                section: {
                    type: 'string',
                    enum: ['profile', 'state', 'history'],
                    description: '只更新指定区块（profile/state/history），留空则替换全文。'
                        + '推荐优先用 section，避免覆盖其他区块的内容。',
                },
            },
            required: ['content'],
        },
    },
];

// ─── 工具实现 ─────────────────────────────────────────────────

/** 查找或创建角色的记忆文件，返回 URI */
export async function findOrCreateMemoryFile(roleId: string): Promise<vscode.Uri | null> {
    const all = await getAllIssueMarkdowns({});
    for (const md of all) {
        if (md.frontmatter?.role_memory === true
            && md.frontmatter?.role_memory_owner_id === roleId) {
            return md.uri;
        }
    }
    // 不存在 → 创建
    const fm: Partial<FrontmatterData> & RoleMemoryFrontmatter = {
        role_memory: true,
        role_memory_owner_id: roleId,
    } as Partial<FrontmatterData> & RoleMemoryFrontmatter;
    const body = `# 角色记忆\n\n（暂无，将在对话中逐步积累）\n`;
    const uri = await createIssueMarkdown({ frontmatter: fm as Partial<FrontmatterData>, markdownBody: body });
    if (uri) {
        logger.info(`[ChatTools] 已创建角色 ${roleId} 的记忆文件: ${uri.fsPath}`);
    }
    return uri ?? null;
}

async function executeWriteMemory(input: Record<string, unknown>, context?: ToolExecContext): Promise<ToolCallResult> {
    if (!context?.role?.toolSets.includes('memory') || !context.role.id) {
        return { success: false, content: '当前角色未启用记忆能力' };
    }
    const content = String(input.content || '').trim();
    if (!content) { return { success: false, content: '请提供记忆内容' }; }
    const section = (input.section as string | undefined)?.toLowerCase();
    const memUri = await findOrCreateMemoryFile(context.role.id);
    if (!memUri) { return { success: false, content: '记忆文件不存在且创建失败' }; }
    try {
        let newBody: string;
        if (section && ['profile', 'state', 'history'].includes(section)) {
            // 只更新指定区块，保留其他区块
            const raw = Buffer.from(await vscode.workspace.fs.readFile(memUri)).toString('utf8');
            const { body: existingBody } = extractFrontmatterAndBody(raw);
            newBody = upsertMemorySection(existingBody, section, content);
        } else {
            newBody = content;
        }
        const ok = await updateIssueMarkdownBody(memUri, newBody);
        return ok
            ? { success: true, content: section ? `✓ 记忆区块 [${section}] 已更新` : '✓ 记忆已更新' }
            : { success: false, content: '记忆更新失败' };
    } catch (e) {
        logger.error('[ChatTools] 写入记忆失败', e);
        return { success: false, content: '记忆写入失败' };
    }
}

/**
 * 在记忆正文中插入或替换指定区块（## Profile / ## State / ## History）。
 * 不影响其他区块的内容。
 */
export function upsertMemorySection(existingBody: string, section: string, newContent: string): string {
    const heading = `## ${section.charAt(0).toUpperCase() + section.slice(1)}`;
    // 匹配区块：从 heading 开始到下一个 ## 或文件末尾
    const sectionRegex = new RegExp(`(${heading}\\s*\\n)[\\s\\S]*?(?=^## |\\z)`, 'mi');
    const replacement = `${heading}\n${newContent.trim()}\n\n`;
    if (sectionRegex.test(existingBody)) {
        return existingBody.replace(sectionRegex, replacement);
    }
    // 区块不存在，追加到末尾
    return existingBody.trimEnd() + `\n\n${replacement}`;
}

// ─── 导出 ─────────────────────────────────────────────────────

export { MEMORY_TOOLS };

export const MEMORY_HANDLERS: Record<string, (input: Record<string, unknown>, ctx?: ToolExecContext) => Promise<ToolCallResult>> = {
    'write_memory': executeWriteMemory,
};
