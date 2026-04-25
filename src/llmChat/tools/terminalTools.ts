/**
 * 终端工具：read_file / search_files / run_command
 *
 * run_command 采用双模式架构：
 *   - background（默认）：child_process.spawn 静默执行，适合短命令和批量操作
 *   - terminal：VSCode Shell Integration API 可见终端，适合长时间构建和需要用户可见进度的命令
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { spawn } from 'child_process';
import { Logger } from '../../core/utils/Logger';
import { resolveShellEnvironment } from '../../core/ShellEnvironmentResolver';
import type { ToolCallResult, ToolExecContext } from './types';

const logger = Logger.getInstance();

// ─── 常量 ────────────────────────────────────────────────────

const TERMINAL_MAX_TIMEOUT = 600_000;
const TERMINAL_DEFAULT_TIMEOUT = 30_000;
const HEARTBEAT_INTERVAL = 10_000;
const TERMINAL_MAX_OUTPUT = 32_000;
const READ_FILE_MAX_LINES = 500;
const READ_FILE_DEFAULT_LINES = 200;
/** Shell Integration 就绪等待超时 */
const SHELL_INTEGRATION_TIMEOUT = 4_000;
/** 可见终端名称 */
const VISIBLE_TERMINAL_NAME = 'LLM Tools';

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

/**
 * 智能截断：尾部优先（前 30% + 后 70%）。
 * LLM 通常更关注最近的输出（错误信息、最终状态）。
 */
function truncateOutput(output: string, maxLen: number = TERMINAL_MAX_OUTPUT): string {
    if (output.length <= maxLen) { return output; }
    const headSize = Math.floor(maxLen * 0.3);
    const tailSize = maxLen - headSize;
    const omitted = output.length - maxLen;
    return output.slice(0, headSize)
        + `\n\n... [省略 ${omitted} 字符] ...\n\n`
        + output.slice(-tailSize);
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
        description: '在工作区执行 shell 命令并返回输出。支持两种模式：background（默认，静默执行）和 terminal（在 VSCode 可见终端中执行，适合长时间构建）。适用于 git 操作、构建、测试、文件修改等开发任务。每次调用都需要用户确认。命令在工作区根目录执行，超时后自动终止。优先使用 read_file 和 search_files 进行只读操作，仅在需要执行副作用时使用本工具。',
        inputSchema: {
            type: 'object',
            properties: {
                command: { type: 'string', description: '要执行的 shell 命令（如 "git status"、"npm test"、"ls -la src/"）' },
                cwd: { type: 'string', description: '工作目录（相对于工作区根目录的路径，可选，默认为工作区根目录）' },
                timeout: { type: 'number', description: '超时时间（毫秒），可选，默认 30000（30秒），最大 600000（10分钟）' },
                mode: { type: 'string', enum: ['background', 'terminal'], description: '执行模式：background（默认，静默后台执行）或 terminal（VSCode 可见终端，适合 npm install、构建等长时间操作）' },
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

    // grep 模式（可能带 pattern/include 过滤）— 使用 resolved env
    const { exec } = await import('child_process');
    const env = resolveShellEnvironment();
    const includeGlob = String(input.include || pattern || '').trim();
    const escapedGlob = includeGlob ? escapeShellArg(includeGlob) : '';
    const globArgs = escapedGlob ? `--glob ${escapedGlob}` : '';

    return new Promise<ToolCallResult>((resolve) => {
        const cmd = `rg --no-heading --line-number --max-count 5 --max-columns 200 ${globArgs} -e ${escapeShellArg(grep)} . 2>/dev/null || grep -rn --include=${escapedGlob || "'*'"} -m 5 ${escapeShellArg(grep)} . 2>/dev/null`;
        exec(cmd, {
            cwd: workspaceRoot,
            timeout: 15_000,
            maxBuffer: 2 * 1024 * 1024,
            env: { ...env, FORCE_COLOR: '0' },
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

// ─── run_command 双模式实现 ──────────────────────────────────

/**
 * Mode B: 后台执行 — child_process.spawn
 * 适合短命令、批量操作、无需用户可见的场景
 */
function spawnBackground(command: string, opts: {
    cwd: string;
    timeout: number;
    signal?: AbortSignal;
    onHeartbeat?: () => void;
}): Promise<{ exitCode: number; stdout: string; stderr: string; killed: boolean; killedBy?: 'timeout' | 'abort' }> {
    return new Promise((resolve) => {
        const env = resolveShellEnvironment();
        const shell = env.SHELL || process.env.SHELL || '/bin/zsh';
        const proc = spawn(shell, ['-c', command], {
            cwd: opts.cwd,
            env: { ...env, FORCE_COLOR: '0' },
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        const stdoutChunks: string[] = [];
        const stderrChunks: string[] = [];
        let killed = false;
        let killedBy: 'timeout' | 'abort' | undefined;

        proc.stdout.setEncoding('utf8');
        proc.stderr.setEncoding('utf8');
        proc.stdout.on('data', (chunk: string) => stdoutChunks.push(chunk));
        proc.stderr.on('data', (chunk: string) => stderrChunks.push(chunk));

        // 心跳
        const heartbeatId = opts.onHeartbeat
            ? setInterval(opts.onHeartbeat, HEARTBEAT_INTERVAL)
            : undefined;

        // 超时终止
        const timer = setTimeout(() => {
            killed = true;
            killedBy = 'timeout';
            proc.kill('SIGTERM');
        }, opts.timeout);

        // 外部中止
        if (opts.signal) {
            const onAbort = () => {
                killed = true;
                killedBy = 'abort';
                proc.kill('SIGTERM');
            };
            opts.signal.addEventListener('abort', onAbort, { once: true });
        }

        proc.on('close', (code) => {
            clearTimeout(timer);
            if (heartbeatId) { clearInterval(heartbeatId); }
            resolve({
                exitCode: code ?? 1,
                stdout: stdoutChunks.join(''),
                stderr: stderrChunks.join(''),
                killed,
                killedBy,
            });
        });
    });
}

/**
 * Mode A: 可见终端执行 — VSCode Shell Integration API
 * 适合长时间构建（npm install、npm run build）和需要用户可见进度的场景
 *
 * 如果 Shell Integration 不可用，自动回退到 Mode B (spawn)。
 */
async function executeInTerminal(command: string, opts: {
    cwd: string;
    timeout: number;
    signal?: AbortSignal;
    onHeartbeat?: () => void;
}): Promise<{ exitCode: number | undefined; output: string; killed: boolean; killedBy?: 'timeout' | 'abort'; mode: 'terminal' | 'background-fallback' }> {
    // 复用或创建终端
    let terminal = vscode.window.terminals.find(t => t.name === VISIBLE_TERMINAL_NAME);
    if (!terminal) {
        terminal = vscode.window.createTerminal({
            name: VISIBLE_TERMINAL_NAME,
            cwd: opts.cwd,
        });
    }
    terminal.show(true); // preserveFocus = true

    // 等待 Shell Integration 就绪
    const si = terminal.shellIntegration ?? await new Promise<vscode.TerminalShellIntegration | undefined>(
        (resolve) => {
            const timeout = setTimeout(() => {
                disposable.dispose();
                resolve(undefined);
            }, SHELL_INTEGRATION_TIMEOUT);
            const disposable = vscode.window.onDidChangeTerminalShellIntegration(e => {
                if (e.terminal === terminal) {
                    clearTimeout(timeout);
                    disposable.dispose();
                    resolve(e.shellIntegration);
                }
            });
        }
    );

    if (!si) {
        logger.warn('[TerminalTools] Shell Integration 不可用，回退到后台模式');
        const bg = await spawnBackground(command, opts);
        return {
            exitCode: bg.exitCode,
            output: bg.stdout + (bg.stderr ? '\n--- stderr ---\n' + bg.stderr : ''),
            killed: bg.killed,
            killedBy: bg.killedBy,
            mode: 'background-fallback',
        };
    }

    // 通过 Shell Integration 执行命令
    const execution = si.executeCommand(command);

    // 流式收集输出
    const chunks: string[] = [];
    let killed = false;
    let killedBy: 'timeout' | 'abort' | undefined;

    // 心跳
    const heartbeatId = opts.onHeartbeat
        ? setInterval(opts.onHeartbeat, HEARTBEAT_INTERVAL)
        : undefined;

    // 超时终止（通过发送 Ctrl+C）
    const timer = setTimeout(() => {
        killed = true;
        killedBy = 'timeout';
        terminal!.sendText('\x03', false); // Ctrl+C
    }, opts.timeout);

    // 外部中止
    let abortDisposable: { dispose(): void } | undefined;
    if (opts.signal) {
        const onAbort = () => {
            killed = true;
            killedBy = 'abort';
            terminal!.sendText('\x03', false);
        };
        opts.signal.addEventListener('abort', onAbort, { once: true });
        abortDisposable = { dispose: () => opts.signal!.removeEventListener('abort', onAbort) };
    }

    // 读取输出流
    try {
        for await (const data of execution.read()) {
            chunks.push(data);
        }
    } catch (err) {
        logger.warn('[TerminalTools] Shell Integration read() 出错', err);
    }

    // 获取退出码
    const exitCode = await new Promise<number | undefined>(resolve => {
        const exitTimeout = setTimeout(() => {
            exitDisposable.dispose();
            resolve(undefined);
        }, 3000);
        const exitDisposable = vscode.window.onDidEndTerminalShellExecution(e => {
            if (e.execution === execution) {
                clearTimeout(exitTimeout);
                exitDisposable.dispose();
                resolve(e.exitCode);
            }
        });
    });

    // 清理
    clearTimeout(timer);
    if (heartbeatId) { clearInterval(heartbeatId); }
    abortDisposable?.dispose();

    return {
        exitCode,
        output: chunks.join(''),
        killed,
        killedBy,
        mode: 'terminal',
    };
}

// ─── run_command 统一入口 ────────────────────────────────────

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

    // 执行模式
    const mode = String(input.mode || 'background').trim();
    const heartbeatFn = context?.ctx ? () => context.ctx!.heartbeat() : context?.onHeartbeat;

    if (mode === 'terminal') {
        return _executeTerminalMode(command, cwd, timeout, heartbeatFn, context?.signal);
    }
    return _executeBackgroundMode(command, cwd, timeout, heartbeatFn, context?.signal);
}

/** Mode B: background — 后台 spawn */
async function _executeBackgroundMode(
    command: string, cwd: string, timeout: number,
    onHeartbeat?: () => void, signal?: AbortSignal,
): Promise<ToolCallResult> {
    const result = await spawnBackground(command, { cwd, timeout, signal, onHeartbeat });

    let output = '';
    if (result.stdout) { output += result.stdout; }
    if (result.stderr) { output += (output ? '\n--- stderr ---\n' : '') + result.stderr; }
    if (!output && result.exitCode !== 0) { output = `进程退出码 ${result.exitCode}`; }

    const rawLen = output.length;
    const isTruncated = rawLen > TERMINAL_MAX_OUTPUT;
    output = truncateOutput(output);

    const header = result.killed
        ? result.killedBy === 'timeout'
            ? `⏰ 命令超时（${timeout / 1000}s）已终止`
            : `⛔ 命令已被中止`
        : result.exitCode === 0
            ? '✓ 命令执行成功'
            : `❌ 命令退出码: ${result.exitCode}`;

    const meta = [
        `**命令**: \`${command}\``,
        `**工作目录**: ${cwd}`,
        `**退出码**: ${result.exitCode}${result.killed ? `（${result.killedBy === 'timeout' ? '超时终止' : '外部中止'}）` : ''}`,
        isTruncated ? `**输出已截断**（原始 ${rawLen} 字符）` : '',
    ].filter(Boolean).join('\n');

    return {
        success: result.exitCode === 0 && !result.killed,
        content: `${header}\n\n${meta}\n\n\`\`\`\n${output || '（无输出）'}\n\`\`\``,
    };
}

/** Mode A: terminal — 可见终端 */
async function _executeTerminalMode(
    command: string, cwd: string, timeout: number,
    onHeartbeat?: () => void, signal?: AbortSignal,
): Promise<ToolCallResult> {
    const result = await executeInTerminal(command, { cwd, timeout, signal, onHeartbeat });

    const rawLen = result.output.length;
    const isTruncated = rawLen > TERMINAL_MAX_OUTPUT;
    const output = truncateOutput(result.output);

    const modeLabel = result.mode === 'terminal' ? '可见终端' : '后台回退';
    const exitDisplay = result.exitCode !== undefined ? String(result.exitCode) : '未知';
    const success = result.exitCode === 0 && !result.killed;

    const header = result.killed
        ? result.killedBy === 'timeout'
            ? `⏰ 命令超时（${timeout / 1000}s）已终止`
            : `⛔ 命令已被中止`
        : success
            ? '✓ 命令执行成功'
            : `❌ 命令退出码: ${exitDisplay}`;

    const meta = [
        `**命令**: \`${command}\``,
        `**工作目录**: ${cwd}`,
        `**模式**: ${modeLabel}`,
        `**退出码**: ${exitDisplay}${result.killed ? `（${result.killedBy === 'timeout' ? '超时终止' : '外部中止'}）` : ''}`,
        isTruncated ? `**输出已截断**（原始 ${rawLen} 字符）` : '',
    ].filter(Boolean).join('\n');

    return {
        success,
        content: `${header}\n\n${meta}\n\n\`\`\`\n${output || '（无输出）'}\n\`\`\``,
    };
}

// ─── 导出 ────────────────────────────────────────────────────

export const TERMINAL_HANDLERS: Record<string, (input: Record<string, unknown>, context?: ToolExecContext) => Promise<ToolCallResult>> = {
    read_file: executeReadFile,
    search_files: executeSearchFiles,
    run_command: executeRunCommand,
};
