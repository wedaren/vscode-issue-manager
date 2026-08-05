import * as vscode from 'vscode';
import * as path from 'path';
import { perfMetrics, PerfSnapshot } from '../services/PerfMetrics';
import { getIssueDir } from '../config';
import { PerfMetricsPanel } from '../views/PerfMetricsPanel';

/** 性能指标历史日志文件名（位于 <issueDir>/.issueManager/ 下） */
const PERF_LOG_FILE = 'perf-log.jsonl';

/** 性能指标报告输出通道（懒创建，全局复用） */
let outputChannel: vscode.OutputChannel | undefined;

/** 获取 perf-log.jsonl 的路径；issueDir 未配置时返回 null */
function getPerfLogPath(): string | null {
    const issueDir = getIssueDir();
    if (!issueDir) {
        return null;
    }
    return path.join(issueDir, '.issueManager', PERF_LOG_FILE);
}

/**
 * 把一条快照追加到 <issueDir>/.issueManager/perf-log.jsonl（目录不存在则创建）。
 * 每行格式：{ timestamp, counters, timings, memoryMB }
 */
export async function appendPerfLog(snapshot: PerfSnapshot): Promise<void> {
    const logPath = getPerfLogPath();
    if (!logPath) {
        return;
    }
    const line = JSON.stringify({
        timestamp: snapshot.timestamp,
        counters: snapshot.counters,
        timings: snapshot.timings,
        memoryMB: snapshot.memoryMB,
    });
    const logUri = vscode.Uri.file(logPath);
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(logPath)));
    // 追加写入：读旧内容再整体写回（日志文件很小，代价可忽略）
    let existing: Uint8Array = new Uint8Array(0);
    try {
        existing = await vscode.workspace.fs.readFile(logUri);
    } catch {
        // 文件不存在时忽略，直接新建
    }
    const content = Buffer.concat([Buffer.from(existing), Buffer.from(line + '\n', 'utf8')]);
    await vscode.workspace.fs.writeFile(logUri, content);
}

/** 读取 perf-log.jsonl 最近 limit 条记录（按时间升序）；文件不存在或 issueDir 未配置时返回空数组 */
export async function readPerfLog(limit = 50): Promise<PerfSnapshot[]> {
    const logPath = getPerfLogPath();
    if (!logPath) {
        return [];
    }
    try {
        const content = await vscode.workspace.fs.readFile(vscode.Uri.file(logPath));
        const lines = Buffer.from(content).toString('utf8').split('\n').filter(l => l.trim().length > 0);
        const recent = lines.slice(-limit);
        const result: PerfSnapshot[] = [];
        for (const line of recent) {
            try {
                result.push(JSON.parse(line) as PerfSnapshot);
            } catch {
                // 跳过损坏行
            }
        }
        return result;
    } catch {
        return [];
    }
}

/** 输出 Markdown 报告到 OutputChannel，并追加一条 perf-log 记录 */
async function showPerfReport(): Promise<void> {
    if (!outputChannel) {
        outputChannel = vscode.window.createOutputChannel('Issue Manager 性能指标');
    }
    const snapshot = perfMetrics.snapshot();
    outputChannel.appendLine(perfMetrics.generateMarkdownReport());
    if (!getIssueDir()) {
        outputChannel.appendLine('\n> issueDir 未配置，已跳过写入 perf-log.jsonl。');
    } else {
        try {
            await appendPerfLog(snapshot);
            outputChannel.appendLine(`\n> 快照已追加到 ${getPerfLogPath()}`);
        } catch (err) {
            outputChannel.appendLine(`\n> 写入 perf-log.jsonl 失败：${err}`);
        }
    }
    outputChannel.show(true);
}

/**
 * 注册性能指标相关命令
 */
export function registerPerfCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('issueManager.perf.showPanel', () => {
            PerfMetricsPanel.show(context);
        }),
        vscode.commands.registerCommand('issueManager.perf.showReport', async () => {
            await showPerfReport();
        }),
        vscode.commands.registerCommand('issueManager.perf.reset', () => {
            perfMetrics.reset();
            vscode.window.showInformationMessage('性能指标计数已重置。');
        })
    );
}
