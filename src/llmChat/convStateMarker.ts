/**
 * 对话文件状态标记工具
 *
 * 在对话文件末尾通过 HTML 注释标记当前处理状态：
 *
 *   <!-- llm:ready -->                                                  等待用户输入
 *   <!-- llm:queued -->                                                 用户已提交，等待处理
 *   <!-- llm:executing startedAt="2026-03-10 14:21:00" retryCount="0" --> 执行中
 *   <!-- llm:retrying retryAt="2026-03-10 14:22:00" retryCount="1" -->  等待重试
 *   <!-- llm:error message="timeout" -->                                执行失败
 *
 * HTML 注释在 Markdown 渲染中不可见，不影响正常阅读。
 * 标记始终位于文件末尾，每次只存在一个。
 * stripMarker() 会移除所有 llm:xxx 标记（包括 ready）。
 */
import * as vscode from 'vscode';

export type ConvStatus = 'ready' | 'queued' | 'executing' | 'retrying' | 'error';

export interface ConvStateMarker {
    status: ConvStatus;
    /** 已尝试次数（executing/retrying/error 时有值） */
    retryCount?: number;
    /** 开始执行的时间戳（executing 时有值，用于崩溃检测） */
    startedAt?: number;
    /** 下次重试的时间戳（retrying 时有值） */
    retryAt?: number;
    /** 错误信息（error 时有值） */
    message?: string;
}

/** 匹配文件末尾的状态标记（s 标志允许 . 匹配换行，用于属性值跨行） */
const MARKER_RE = /<!--\s*llm:(\w+)([^>]*?)-->\s*$/s;

/** 从文件内容解析末尾的状态标记 */
export function parseStateMarker(content: string): ConvStateMarker | null {
    // 只检查最后 512 字符，提升大文件性能
    const tail = content.length > 512 ? content.slice(-512) : content;
    const match = MARKER_RE.exec(tail);
    if (!match) { return null; }

    const status = match[1] as ConvStatus;
    const attrsStr = match[2];
    const attrs: Record<string, string> = {};

    const attrRe = /(\w+)="([^"]*)"/g;
    let m: RegExpExecArray | null;
    while ((m = attrRe.exec(attrsStr)) !== null) {
        attrs[m[1]] = m[2];
    }

    return {
        status,
        retryCount: attrs.retryCount !== undefined ? Number(attrs.retryCount) : undefined,
        startedAt: attrs.startedAt !== undefined ? parseTs(attrs.startedAt) : undefined,
        retryAt: attrs.retryAt !== undefined ? parseTs(attrs.retryAt) : undefined,
        message: attrs.message,
    };
}

/** 将状态标记序列化为 HTML 注释字符串，时间戳使用人类可读格式 */
export function formatStateMarker(marker: ConvStateMarker): string {
    const parts: string[] = [];
    if (marker.retryCount !== undefined) { parts.push(`retryCount="${marker.retryCount}"`); }
    if (marker.startedAt !== undefined) { parts.push(`startedAt="${fmtTs(marker.startedAt)}"`); }
    if (marker.retryAt !== undefined) { parts.push(`retryAt="${fmtTs(marker.retryAt)}"`); }
    if (marker.message !== undefined) {
        // 截断并转义引号
        const safe = marker.message.slice(0, 200).replace(/"/g, "'");
        parts.push(`message="${safe}"`);
    }
    const attrs = parts.length > 0 ? ' ' + parts.join(' ') : '';
    return `<!-- llm:${marker.status}${attrs} -->`;
}

/** "2026-03-10 14:21:00" 或纯数字 epoch → epoch ms，兼容新旧格式 */
function parseTs(str: string): number {
    const n = Number(str);
    if (Number.isFinite(n)) { return n; }
    return new Date(str.replace(' ', 'T')).getTime();
}

/** 时间戳 → "2026-03-10 14:21:00" */
function fmtTs(ts: number): string {
    const d = new Date(ts);
    const p = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 读取对话文件中的状态标记，文件不存在或无标记时返回 null */
export async function readStateMarker(uri: vscode.Uri): Promise<ConvStateMarker | null> {
    try {
        const content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
        return parseStateMarker(content);
    } catch {
        return null;
    }
}

/**
 * 写入（替换）文件末尾的状态标记。
 * marker 为 null 时仅移除已有标记。
 * 单次文件写入，保证原子性。
 */
export async function writeStateMarker(uri: vscode.Uri, marker: ConvStateMarker | null): Promise<void> {
    const raw = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
    const stripped = stripMarker(raw);
    const updated = marker
        ? stripped + '\n\n' + formatStateMarker(marker) + '\n'
        : stripped + '\n';
    await vscode.workspace.fs.writeFile(uri, Buffer.from(updated, 'utf8'));
}

/** 移除文件末尾的状态标记（若存在） */
export async function removeStateMarker(uri: vscode.Uri): Promise<void> {
    await writeStateMarker(uri, null);
}

/**
 * 从文件内容字符串中去掉末尾的状态标记，返回清理后的字符串（已 trimEnd）。
 * 供 llmChatDataManager 内部使用，避免标记污染消息内容。
 */
export function stripMarker(content: string): string {
    return content.replace(/\n?<!--\s*llm:[^>]*-->\s*$/s, '').trimEnd();
}
