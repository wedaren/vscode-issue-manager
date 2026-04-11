/**
 * 对话诊断报告生成器
 *
 * 聚合对话文件、执行日志、角色配置、注入上下文，
 * 生成一份还原「LLM 视角」的诊断 markdown 文件。
 * 用于事后排查问题或发送给外部 LLM 分析优化。
 */
import * as vscode from 'vscode';
import * as path from 'path';
import {
    extractFrontmatterAndBody,
    createIssueMarkdown,
} from '../data/IssueMarkdowns';
import type { FrontmatterData } from '../data/IssueMarkdowns';
import {
    getChatRoleById,
    getRoleSystemPrompt,
    parseConversationMessages,
    readAutoMemoryForInjection,
} from './llmChatDataManager';
import { getIssueDir } from '../config';
import { Logger } from '../core/utils/Logger';

const logger = Logger.getInstance();

// ─── 工具函数 ────────────────────────────────────────────────

function now(): string {
    const d = new Date();
    const p = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function truncate(text: string, maxLen: number): string {
    if (text.length <= maxLen) { return text; }
    return text.slice(0, maxLen) + `\n\n…（共 ${text.length} 字，已截断）`;
}

// ─── 执行日志解析 ─────────────────────────────────────────────

interface RunSummary {
    runNumber: number;
    timestamp: string;
    success: boolean;
    durationStr: string;
    trigger: string;
    modelFamily: string;
    inputTokens: string;
    toolLines: string[];   // 工具调用摘要行
    replyPreview: string;  // 助手回复摘要
    errorMsg: string;      // 失败时的错误信息
}

function parseRunsFromLog(logRaw: string): RunSummary[] {
    const runHeaderRe = /## Run #(\d+) \((\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\)/g;
    const positions: { run: number; ts: string; idx: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = runHeaderRe.exec(logRaw)) !== null) {
        positions.push({ run: Number(m[1]), ts: m[2], idx: m.index });
    }

    return positions.map((h, i) => {
        const end = i + 1 < positions.length ? positions[i + 1].idx : logRaw.length;
        const section = logRaw.slice(h.idx, end);

        const ctxMatch = /📋 \*\*开始执行\*\* \| (.+)/.exec(section);
        const ctxParts = ctxMatch?.[1] ?? '';
        const trigger   = /触发: ([^|]+)/.exec(ctxParts)?.[1]?.trim() ?? '—';
        const model     = /模型: ([^|]+)/.exec(ctxParts)?.[1]?.trim() ?? '—';

        const tokenMatch = /预估 input: \*\*(\d+)\*\* tokens/.exec(section);
        const inputTokens = tokenMatch?.[1] ?? '—';

        const success = /✓ \*\*成功\*\*/.test(section);

        const durMatch = /✓ \*\*成功\*\* \| 耗时 ([^\s|]+)/.exec(section);
        const durationStr = durMatch?.[1] ?? '—';

        const errMatch = /❌ \*\*失败[^:]*: (.+)/.exec(section);
        const errorMsg = errMatch?.[1]?.trim() ?? '';

        // 工具调用行：✓/❌ `工具名` (耗时)
        const toolLines = [...section.matchAll(/^- `\d{2}:\d{2}:\d{2}` [✓❌].+$/gm)]
            .map(x => x[0].trim());

        // 助手回复摘要
        const replyMatch = /💭 \*\*助手回复\*\*: (.+)/.exec(section);
        const replyPreview = replyMatch?.[1]?.trim() ?? '';

        return { runNumber: h.run, timestamp: h.ts, success, durationStr, trigger, modelFamily: model, inputTokens, toolLines, replyPreview, errorMsg };
    });
}

// ─── 报告主体构建 ─────────────────────────────────────────────

export async function generateDiagnosticReport(conversationUri: vscode.Uri): Promise<vscode.Uri | null> {
    try {
        // ── 读取对话文件 ──
        const convoRaw = Buffer.from(await vscode.workspace.fs.readFile(conversationUri)).toString('utf8');
        const { frontmatter: convoFm } = extractFrontmatterAndBody(convoRaw);
        if (!convoFm || !convoFm.chat_conversation) {
            vscode.window.showErrorMessage('当前文件不是对话文件');
            return null;
        }
        const fm = convoFm as Record<string, unknown>;
        const convoId    = path.basename(conversationUri.fsPath, '.md');
        const convoTitle = (fm.chat_title as string) || convoId;
        const roleId     = fm.chat_role_id as string;
        const logId      = fm.chat_log_id as string | undefined;
        const intent     = (fm.chat_intent as string) || '';
        const tokenUsed  = fm.chat_token_used as number | undefined;
        const modelOverride = fm.chat_model_family as string | undefined;

        // ── 读取角色信息 ──
        const role = getChatRoleById(roleId);
        const systemPrompt = role ? await getRoleSystemPrompt(role.uri) : '';
        const roleModel    = modelOverride || role?.modelFamily || '（全局默认）';
        const toolSets     = role?.toolSets?.join(' / ') || '（无）';

        // ── 解析对话消息 ──
        const messages = await parseConversationMessages(conversationUri);
        const userCount      = messages.filter(m => m.role === 'user').length;
        const assistantCount = messages.filter(m => m.role === 'assistant').length;

        // ── 读取执行日志 ──
        let runs: RunSummary[] = [];
        let logRaw = '';
        if (logId) {
            const dir = getIssueDir();
            if (dir) {
                const logUri = vscode.Uri.file(path.join(dir, `${logId}.md`));
                try {
                    logRaw = Buffer.from(await vscode.workspace.fs.readFile(logUri)).toString('utf8');
                    runs = parseRunsFromLog(logRaw);
                } catch { /* 日志文件不存在时跳过 */ }
            }
        }
        const successCount = runs.filter(r => r.success).length;
        const failCount    = runs.filter(r => !r.success).length;

        // ── 读取自动注入记忆 ──
        const autoMemory = roleId ? await readAutoMemoryForInjection(roleId) : '';

        // ══════════════════════════════════════
        // 组装报告 Markdown
        // ══════════════════════════════════════
        const lines: string[] = [];

        lines.push(`# 🔍 对话诊断报告：${convoTitle}`);
        lines.push('');
        lines.push(`> 生成时间：${now()}  ·  对话 ID：\`${convoId}\``);
        lines.push('');

        // ── 概览 ──
        lines.push('## 概览');
        lines.push('');
        lines.push(`| 项目 | 值 |`);
        lines.push(`|---|---|`);
        lines.push(`| 意图 | ${intent || '（未提取）'} |`);
        lines.push(`| 角色 | ${role?.name || roleId} |`);
        lines.push(`| 模型 | ${roleModel} |`);
        lines.push(`| 工具集 | ${toolSets} |`);
        lines.push(`| 对话轮次 | ${assistantCount} 轮（User×${userCount} / Assistant×${assistantCount}）|`);
        lines.push(`| 执行次数 | ${runs.length} 次（${successCount}✓ ${failCount}✗）|`);
        lines.push(`| Token 消耗 | ${tokenUsed ?? '—'} |`);
        lines.push('');

        // ── LLM 实际看到的上下文 ──
        lines.push('## LLM 实际看到的上下文');
        lines.push('');
        lines.push('> 这是 system prompt 注入后、历史消息之前，LLM 实际收到的上下文片段。');
        lines.push('');

        lines.push('### System Prompt');
        lines.push('');
        lines.push('```');
        lines.push(truncate(systemPrompt || '（空）', 2000));
        lines.push('```');
        lines.push('');

        if (intent) {
            lines.push('### 意图锚点');
            lines.push('');
            lines.push(`\`[当前任务] ${intent}\``);
            lines.push('');
        }

        if (autoMemory) {
            lines.push('### 自动注入记忆');
            lines.push('');
            lines.push('```');
            lines.push(truncate(autoMemory, 1500));
            lines.push('```');
            lines.push('');
        }

        // ── 执行时间线 ──
        if (runs.length > 0) {
            lines.push('## 执行时间线');
            lines.push('');
            for (const run of runs) {
                const icon = run.success ? '✓' : '❌';
                lines.push(`### Run #${run.runNumber} · ${run.timestamp} · ${icon} ${run.durationStr}`);
                lines.push('');
                lines.push(`- **触发**: ${run.trigger}  ·  **模型**: ${run.modelFamily}  ·  **输入 tokens**: ${run.inputTokens}`);
                if (run.toolLines.length > 0) {
                    lines.push(`- **工具调用链**:`);
                    for (const tl of run.toolLines) {
                        lines.push(`  ${tl}`);
                    }
                }
                if (run.replyPreview) {
                    lines.push(`- **助手回复摘要**: ${run.replyPreview}`);
                }
                if (!run.success && run.errorMsg) {
                    lines.push(`- **错误**: ${run.errorMsg}`);
                }
                lines.push('');
            }
        } else if (logId) {
            lines.push('## 执行时间线');
            lines.push('');
            lines.push('（执行日志文件未找到或格式不匹配）');
            lines.push('');
        }

        // ── 完整对话 ──
        lines.push('## 完整对话');
        lines.push('');
        for (const msg of messages) {
            const label = msg.role === 'user' ? '### User' : '### Assistant';
            const ts = new Date(msg.timestamp).toLocaleString('zh-CN');
            lines.push(`${label}  _(${ts})_`);
            lines.push('');
            lines.push(msg.content.trim());
            lines.push('');
        }

        // ══════════════════════════════════════
        // 写入新文件并打开
        // ══════════════════════════════════════
        const reportFm: Partial<FrontmatterData> & { chat_diagnostic_report: true; chat_report_source_id: string } = {
            chat_diagnostic_report: true,
            chat_report_source_id: convoId,
        };
        const reportBody = lines.join('\n');
        const reportUri = await createIssueMarkdown({
            frontmatter: reportFm as Partial<FrontmatterData>,
            markdownBody: reportBody,
        });

        if (!reportUri) {
            vscode.window.showErrorMessage('生成报告失败：无法创建文件');
            return null;
        }

        await vscode.commands.executeCommand('vscode.open', reportUri);
        logger.info(`[DiagnosticReport] 已生成报告: ${reportUri.fsPath}`);
        return reportUri;
    } catch (e) {
        logger.error('[DiagnosticReport] 生成失败', e);
        vscode.window.showErrorMessage(`生成报告失败：${e instanceof Error ? e.message : String(e)}`);
        return null;
    }
}
