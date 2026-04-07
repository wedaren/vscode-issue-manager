/**
 * 对话级 Todo 工具：读取、写入、更新当前对话的 todo 列表
 */
import * as vscode from 'vscode';
import { extractFrontmatterAndBody, updateIssueMarkdownFrontmatter, type FrontmatterData } from '../../data/IssueMarkdowns';
import type { ToolCallResult, ToolExecContext } from './types';

// ─── 工具定义 ─────────────────────────────────────────────────

const TODO_TOOLS: vscode.LanguageModelChatTool[] = [
    {
        name: 'read_todos',
        description: '读取当前对话的 todo 列表。返回 JSON 数组，每项含 id、content（任务描述）、status（pending/in_progress/done）。建议在处理复杂任务前先读取，了解已有计划。',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'write_todos',
        description: '整体写入当前对话的 todo 列表（覆盖已有列表）。适合初始规划或大幅调整任务列表。每个 todo 需含 content 和 status 字段，id 自动分配。建议在收到复杂任务时先拆分为 todo 列表再逐项执行。',
        inputSchema: {
            type: 'object',
            properties: {
                todos: {
                    type: 'array',
                    description: 'todo 项数组',
                    items: {
                        type: 'object',
                        properties: {
                            content: { type: 'string', description: '任务描述' },
                            status: { type: 'string', enum: ['pending', 'in_progress', 'done'], description: '状态，默认 pending' },
                        },
                        required: ['content'],
                    },
                },
            },
            required: ['todos'],
        },
    },
    {
        name: 'update_todo',
        description: '更新当前对话 todo 列表中的单个 todo 项。可修改状态或内容。完成一个子任务后应立即调用此工具将对应 todo 标记为 done。',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'number', description: 'todo 的 id（从 read_todos 获取）' },
                status: { type: 'string', enum: ['pending', 'in_progress', 'done'], description: '新状态' },
                content: { type: 'string', description: '新的任务描述（可选，不传则不修改）' },
            },
            required: ['id'],
        },
    },
];

// ─── 内部类型与辅助 ──────────────────────────────────────────

interface TodoItem {
    id: number;
    content: string;
    status: 'pending' | 'in_progress' | 'done';
}

/** 从对话文件 frontmatter 读取 chat_todos 字段 */
async function readTodosFromConversation(uri: vscode.Uri): Promise<TodoItem[]> {
    const raw = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
    const { frontmatter } = extractFrontmatterAndBody(raw);
    const fm = frontmatter as Record<string, unknown> | null;
    const todos = fm?.chat_todos;
    if (!Array.isArray(todos)) { return []; }
    return todos.map((t: Record<string, unknown>, i: number) => ({
        id: typeof t.id === 'number' ? t.id : i + 1,
        content: String(t.content ?? ''),
        status: (['pending', 'in_progress', 'done'].includes(String(t.status)) ? String(t.status) : 'pending') as TodoItem['status'],
    }));
}

/** 将 todo 列表写回对话文件 frontmatter */
async function writeTodosToConversation(uri: vscode.Uri, todos: TodoItem[]): Promise<void> {
    // 转为纯对象数组用于 YAML 序列化
    const payload = todos.map(t => ({ id: t.id, content: t.content, status: t.status }));
    await updateIssueMarkdownFrontmatter(uri, { chat_todos: payload } as unknown as FrontmatterData);
}

// ─── 工具实现 ─────────────────────────────────────────────────

async function executeReadTodos(context?: ToolExecContext): Promise<ToolCallResult> {
    if (!context?.conversationUri) {
        return { success: false, content: '无法获取当前对话文件' };
    }
    try {
        const todos = await readTodosFromConversation(context.conversationUri);
        if (todos.length === 0) {
            return { success: true, content: '当前对话暂无 todo 项。可使用 write_todos 创建任务列表。' };
        }
        return { success: true, content: JSON.stringify(todos, null, 2) };
    } catch (e) {
        return { success: false, content: `读取 todo 失败: ${e}` };
    }
}

async function executeWriteTodos(input: Record<string, unknown>, context?: ToolExecContext): Promise<ToolCallResult> {
    if (!context?.conversationUri) {
        return { success: false, content: '无法获取当前对话文件' };
    }
    const rawTodos = input.todos;
    if (!Array.isArray(rawTodos)) {
        return { success: false, content: '参数 todos 必须是数组' };
    }
    const todos: TodoItem[] = rawTodos.map((t: Record<string, unknown>, i: number) => ({
        id: i + 1,
        content: String(t.content ?? ''),
        status: (['pending', 'in_progress', 'done'].includes(String(t.status)) ? String(t.status) : 'pending') as TodoItem['status'],
    }));
    try {
        await writeTodosToConversation(context.conversationUri, todos);
        const summary = todos.map(t => {
            const icon = t.status === 'done' ? '✓' : t.status === 'in_progress' ? '🔄' : '⬚';
            return `${icon} ${t.id}. ${t.content}`;
        }).join('\n');
        return { success: true, content: `已写入 ${todos.length} 个 todo 项：\n${summary}` };
    } catch (e) {
        return { success: false, content: `写入 todo 失败: ${e}` };
    }
}

async function executeUpdateTodo(input: Record<string, unknown>, context?: ToolExecContext): Promise<ToolCallResult> {
    if (!context?.conversationUri) {
        return { success: false, content: '无法获取当前对话文件' };
    }
    const id = Number(input.id);
    if (!id || isNaN(id)) {
        return { success: false, content: '请提供有效的 todo id（数字）' };
    }
    try {
        const todos = await readTodosFromConversation(context.conversationUri);
        const target = todos.find(t => t.id === id);
        if (!target) {
            return { success: false, content: `找不到 id=${id} 的 todo 项。当前 id 列表: ${todos.map(t => t.id).join(', ') || '（空）'}` };
        }
        if (input.status && ['pending', 'in_progress', 'done'].includes(String(input.status))) {
            target.status = String(input.status) as TodoItem['status'];
        }
        if (typeof input.content === 'string' && input.content.trim()) {
            target.content = input.content.trim();
        }
        await writeTodosToConversation(context.conversationUri, todos);
        const icon = target.status === 'done' ? '✓' : target.status === 'in_progress' ? '🔄' : '⬚';
        return { success: true, content: `已更新: ${icon} ${target.id}. ${target.content} [${target.status}]` };
    } catch (e) {
        return { success: false, content: `更新 todo 失败: ${e}` };
    }
}

// ─── 导出 ─────────────────────────────────────────────────────

export { TODO_TOOLS };

export const TODO_HANDLERS: Record<string, (input: Record<string, unknown>, ctx?: ToolExecContext) => Promise<ToolCallResult>> = {
    'read_todos': (_input, ctx) => executeReadTodos(ctx),
    'write_todos': executeWriteTodos,
    'update_todo': executeUpdateTodo,
};
