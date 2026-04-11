/**
 * 终端工具：read_file / search_files / run_command
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { Logger } from '../../core/utils/Logger';
import type { ToolCallResult, ToolExecContext } from './types';

const logger = Logger.getInstance();

// ─── 常量 ────────────────────────────────────────────────────

const TERMINAL_MAX_TIMEOUT = 600_000;
const TERMINAL_DEFAULT_TIMEOUT = 30_000;
const HEARTBEAT_INTERVAL = 10_000;
const TERMINAL_MAX_OUTPUT = 32_000;
const READ_FILE_MAX_LINES = 500;
const READ_FILE_DEFAULT_LINES = 200;

// ─── 辅助函数 ────────────────────────────────────────────────

function resolveWorkspacePath(relativePath: string): { resolved: string; workspaceRoot: string } | { error: string } {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) { return { error: '未打开工作区' }; }
    const resolved = path.resolve(workspaceRoot, relativePath);
    return { resolved, workspaceRoot };
}

function escapeShellArg(s: string): string {
    return `'${s.replace(/'/g, "'\\''")}'`;
}

// ─── 工具 schema ─────────────────────────────────────────────

/** 终端工具（terminal 工具包） */
export const TERMINAL_TOOLS: vscode.LanguageModelChatTool[] = [
    {
        name: 'read_file',
        description: '读取工作区内文件的内容。支持通过 offset 和 limit 读取大文件的指定部分。返回带行号的文件内容。',
        inputSchema: {
            type: 'object',
            properties: {
                filePath: { type: 'string', description: '文件路径（相对于工作区根目录，如 "src/index.ts"、"package.json"）' },
                offset: { type: 'number', description: '起始行号（从 1 开始，可选，默认 1）' },
                limit: { type: 'number', description: '读取行数（可选，默认 200，最大 500）' },
            },
            required: ['filePath'],
        },
    },
    {
        name: 'search_files',
        description: '在工作区内搜索。支持两种模式：1) pattern 模式：按 glob 匹配文件名（如 "**/*.ts"）；2) grep 模式：按正则搜索文件内容。两种模式可组合使用。',
        inputSchema: {
            type: 'object',
            properties: {
                pattern: { type: 'string', description: '文件名 glob 模式（如 "**/*.ts"、"src/**/*.test.js"），可选' },
                grep: { type: 'string', description: '内容搜索的正则表达式（如 "export class"、"TODO"），可选' },
                include: { type: 'string', description: '与 grep 配合使用：限定搜索的文件 glob（如 "*.ts"），可选' },
                maxResults: { type: 'number', description: '最大返回条数（可选，默认 50，最大 200）' },
            },
        },
    },
    {
        name: 'run_command',
        description: '在工作区终端执行 shell 命令并返回输出。适用于 git 操作、构建、测试、文件修改等开发任务。每次调用都需要用户确认。命令在工作区根目录执行，超时后自动终止。优先使用 read_file 和 search_files 进行只读操作，仅在需要执行副作用时使用本工具。',
        inputSchema: {
            type: 'object',
            properties: {
                command: { type: 'string', description: '要执行的 shell 命令（如 "git status"、"npm test"、"ls -la src/"）' },
                cwd: { type: 'string', description: '工作目录（相对于工作区根目录的路径，可选，默认为工作区根目录）' },
                timeout: { type: 'number', description: '超时时间（毫秒），可选，默认 30000（30秒），最大 600000（10分钟）' },
            },
            required: ['command'],
        },
    },
];

// ─── 工具实现 ────────────────────────────────────────────────

async function executeReadFile(input: Record<string, unknown>, context?: ToolExecContext): Promise<ToolCallResult> {
    if (!context?.role?.toolSets.includes('terminal')) {
        return { success: false, content: '当前角色未启用终端能力（terminal）' };
    }

    const filePath = String(input.filePath || '').trim();
    if (!filePath) { return { success: false, content: '请提供文件路径（filePath）' }; }

    const res = resolveWorkspacePath(filePath);
    if ('error' in res) { return { success: false, content: res.error }; }

    try {
        const stat = await vscode.workspace.fs.stat(vscode.Uri.file(res.resolved));
        if (stat.type === vscode.FileType.Directory) {
            return { success: false, content: `"${filePath}" 是目录，请使用 search_files 浏览目录内容` };
        }
    } catch {
        return { success: false, content: `文件不存在: ${filePath}` };
    }

    const raw = Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.file(res.resolved))).toString('utf8');
    const lines = raw.split('\n');
    const totalLines = lines.length;

    const offset = Math.max(1, Math.floor(Number(input.offset) || 1));
    const limit = Math.min(Math.max(1, Math.floor(Number(input.limit) || READ_FILE_DEFAULT_LINES)), READ_FILE_MAX_LINES);

    const startIdx = offset - 1;
    const slice = lines.slice(startIdx, startIdx + limit);
    const numbered = slice.map((line, i) => `${String(startIdx + i + 1).padStart(5)} │ ${line}`).join('\n');

    const endLine = Math.min(startIdx + limit, totalLines);
    const header = `**${filePath}** (${totalLines} 行) — 显示第 ${offset}–${endLine} 行`;
    const hint = endLine < totalLines ? `\n\n> 还有 ${totalLines - endLine} 行未显示，可用 offset=${endLine + 1} 继续读取` : '';

    return { success: true, content: `${header}\n\n\`\`\`\n${numbered}\n\`\`\`${hint}` };
}

async function executeSearchFiles(input: Record<string, unknown>, context?: ToolExecContext): Promise<ToolCallResult> {
    if (!context?.role?.toolSets.includes('terminal')) {
        return { success: false, content: '当前角色未启用终端能力（terminal）' };
    }

    const pattern = String(input.pattern || '').trim();
    const grep = String(input.grep || '').trim();
    if (!pattern && !grep) {
        return { success: false, content: '请至少提供 pattern（文件名 glob）或 grep（内容搜索）之一' };
    }

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) { return { success: false, content: '未打开工作区' }; }

    const maxResults = Math.min(Math.max(1, Math.floor(Number(input.maxResults) || 50)), 200);
    const results: string[] = [];

    if (pattern && !grep) {
        // 纯 glob 模式：列出匹配的文件
        const globPattern = new vscode.RelativePattern(workspaceRoot, pattern);
        const uris = await vscode.workspace.findFiles(globPattern, '**/node_modules/**', maxResults);
        if (uris.length === 0) {
            return { success: true, content: `未找到匹配 "${pattern}" 的文件` };
        }
        for (const uri of uris) {
            const rel = path.relative(workspaceRoot, uri.fsPath);
            results.push(rel);
        }
        return { success: true, content: `匹配 \`${pattern}\` 的文件（${results.length} 个）：\n\n${results.map(r => `- ${r}`).join('\n')}` };
    }

    // grep 模式（可能带 pattern/include 过滤）
    const { exec } = await import('child_process');
    const includeGlob = String(input.include || pattern || '').trim();
    const escapedGlob = includeGlob ? escapeShellArg(includeGlob) : '';
    const globArgs = escapedGlob ? `--glob ${escapedGlob}` : '';

    return new Promise<ToolCallResult>((resolve) => {
        const cmd = `rg --no-heading --line-number --max-count 5 --max-columns 200 ${globArgs} -e ${escapeShellArg(grep)} . 2>/dev/null || grep -rn --include=${escapedGlob || "'*'"} -m 5 ${escapeShellArg(grep)} . 2>/dev/null`;
        exec(cmd, {
            cwd: workspaceRoot,
            timeout: 15_000,
            maxBuffer: 2 * 1024 * 1024,
            env: { ...process.env, FORCE_COLOR: '0' },
            shell: '/bin/sh',
        }, (error, stdout) => {
            const output = (stdout || '').trim();
            if (!output) {
                resolve({ success: true, content: `未找到匹配 \`${grep}\` 的内容${includeGlob ? `（在 ${includeGlob} 中）` : ''}` });
                return;
            }
            // 截取前 maxResults 行
            const lines = output.split('\n');
            const truncated = lines.length > maxResults;
            const shown = lines.slice(0, maxResults);
            const header = `搜索 \`${grep}\`${includeGlob ? ` (在 ${includeGlob} 中)` : ''} — ${truncated ? `前 ${maxResults} 条（共 ${lines.length}+ 条）` : `${shown.length} 条结果`}`;
            resolve({ success: true, content: `${header}\n\n\`\`\`\n${shown.join('\n')}\n\`\`\`` });
        });
    });
}

async function executeRunCommand(input: Record<string, unknown>, context?: ToolExecContext): Promise<ToolCallResult> {
    if (!context?.role?.toolSets.includes('terminal')) {
        return { success: false, content: '当前角色未启用终端能力（terminal）' };
    }

    const command = String(input.command || '').trim();
    if (!command) { return { success: false, content: '请提供要执行的命令' }; }

    // 工作目录
    const cwdInput = String(input.cwd || '.').trim();
    const res = resolveWorkspacePath(cwdInput);
    if ('error' in res) { return { success: false, content: res.error }; }
    const { resolved: cwd } = res;

    // 超时
    const rawTimeout = Number(input.timeout) || TERMINAL_DEFAULT_TIMEOUT;
    const timeout = Math.min(Math.max(rawTimeout, 1000), TERMINAL_MAX_TIMEOUT);

    // 执行（扩展 PATH 以包含用户常用目录，如 ~/.local/bin、homebrew）
    const { exec } = await import('child_process');
    const home = process.env.HOME || '';
    const userPaths = [
        `${home}/.local/bin`,
        '/opt/homebrew/bin',
        '/usr/local/bin',
    ];
    const extendedPath = [...userPaths, process.env.PATH].filter(Boolean).join(':');
    return new Promise<ToolCallResult>((resolve) => {
        const heartbeatFn = context?.ctx ? () => context.ctx!.heartbeat() : context?.onHeartbeat;
        const heartbeatId = heartbeatFn
            ? setInterval(() => heartbeatFn(), HEARTBEAT_INTERVAL)
            : undefined;

        const proc = exec(command, {
            cwd,
            timeout,
            maxBuffer: 2 * 1024 * 1024,
            env: { ...process.env, PATH: extendedPath, FORCE_COLOR: '0' },
            shell: process.env.SHELL || '/bin/zsh',
        }, (error, stdout, stderr) => {
            if (heartbeatId) { clearInterval(heartbeatId); }
            const exitCode = error && 'code' in error ? (error as { code?: number }).code ?? 1 : 0;
            const killed = error && 'killed' in error ? (error as { killed?: boolean }).killed : false;

            let output = '';
            if (stdout) { output += stdout; }
            if (stderr) { output += (output ? '\n--- stderr ---\n' : '') + stderr; }
            if (!output && error) { output = error.message; }

            // 截断过长输出
            let truncated = false;
            if (output.length > TERMINAL_MAX_OUTPUT) {
                const half = Math.floor(TERMINAL_MAX_OUTPUT / 2);
                const omitted = output.length - TERMINAL_MAX_OUTPUT;
                output = output.slice(0, half) + `\n\n... [省略 ${omitted} 字符] ...\n\n` + output.slice(-half);
                truncated = true;
            }

            const header = killed
                ? `⏰ 命令超时（${timeout / 1000}s）已终止`
                : exitCode === 0
                    ? '✓ 命令执行成功'
                    : `❌ 命令退出码: ${exitCode}`;
            const meta = [
                `**命令**: \`${command}\``,
                `**工作目录**: ${cwd}`,
                `**退出码**: ${exitCode}${killed ? '（超时终止）' : ''}`,
                truncated ? `**输出已截断**（原始 ${stdout.length + stderr.length} 字符）` : '',
            ].filter(Boolean).join('\n');

            resolve({
                success: exitCode === 0 && !killed,
                content: `${header}\n\n${meta}\n\n\`\`\`\n${output || '（无输出）'}\n\`\`\``,
            });
        });

        // 支持外部中止
        if (context?.signal) {
            const onAbort = () => { proc.kill(); };
            context.signal.addEventListener('abort', onAbort, { once: true });
        }
    });
}

// ─── 导出 ────────────────────────────────────────────────────

export const TERMINAL_HANDLERS: Record<string, (input: Record<string, unknown>, context?: ToolExecContext) => Promise<ToolCallResult>> = {
    read_file: executeReadFile,
    search_files: executeSearchFiles,
    run_command: executeRunCommand,
};
