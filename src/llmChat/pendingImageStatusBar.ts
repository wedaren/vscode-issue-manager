import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { IMAGE_DIR_PREFIX } from '../services/storage/ImageStorageService';
import { getImageDir } from '../config';

/**
 * 在编辑器编辑 chat conversation 文件时，扫描"当前待发送用户消息"中的 `![](ImageDir/...)` 引用，
 * 在状态栏展示图片数量和合计大小，避免用户在不自觉中发送过量或超大图片给 LLM。
 *
 * 识别"待发送"的规则：最后一个 `## User (...)` 标题之后、到文件末尾之间的片段；
 * 若该片段之后已有 `## Assistant (...)`，则说明没有未发送消息。
 * 首条消息尚未打标头时，退化为 frontmatter 之后的 body 全体。
 */

const IMAGE_RE = /!\[[^\]]*\]\(ImageDir\/([^)\s]+)\)/g;
const DEBOUNCE_MS = 300;
const COMMAND_ID = 'issueManager.llmChat.showPendingImages';

interface PendingImage {
    alias: string;
    absolutePath: string;
    size: number;
}

function formatBytes(bytes: number): string {
    if (bytes >= 1024 * 1024) { return `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }
    return `${Math.round(bytes / 1024)} KB`;
}

function isChatConversationDocument(doc: vscode.TextDocument): boolean {
    if (doc.languageId !== 'markdown') { return false; }
    // 仅检查文件头部的 frontmatter
    const head = doc.getText(new vscode.Range(0, 0, Math.min(30, doc.lineCount), 0));
    return /^chat_role_id:\s*\S/m.test(head);
}

/**
 * 抽取"当前待发送用户消息"文本片段。返回 undefined 表示没有未发送内容。
 */
function extractPendingUserText(text: string): string | undefined {
    const lastUserIdx = text.lastIndexOf('\n## User (');
    if (lastUserIdx === -1) {
        // 无历史消息：将 frontmatter 后的 body 视为 pending
        const fmClose = text.indexOf('\n---\n', 4);
        const start = text.startsWith('---\n') && fmClose !== -1 ? fmClose + 5 : 0;
        return text.slice(start);
    }
    const tail = text.slice(lastUserIdx);
    // 如果最后 User 之后又出现 Assistant，则已经回复过，没有未发送消息
    if (tail.includes('\n## Assistant (')) { return undefined; }
    return tail;
}

async function collectStats(text: string, imageDir: string): Promise<PendingImage[]> {
    const items: PendingImage[] = [];
    const seen = new Set<string>();
    for (const m of text.matchAll(IMAGE_RE)) {
        const fileName = m[1];
        const alias = `${IMAGE_DIR_PREFIX}/${fileName}`;
        if (seen.has(alias)) { continue; }
        seen.add(alias);
        const abs = path.join(imageDir, fileName);
        try {
            const stat = await fs.promises.stat(abs);
            items.push({ alias, absolutePath: abs, size: stat.size });
        } catch { /* 文件缺失或 iCloud 占位符：跳过不计入统计 */ }
    }
    return items;
}

export function registerPendingImageStatusBar(context: vscode.ExtensionContext): void {
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 94);
    item.command = COMMAND_ID;
    item.tooltip = '当前 chat 待发送用户消息中的图片（点击查看列表）';
    context.subscriptions.push(item);

    let latest: PendingImage[] = [];
    let updateTimer: ReturnType<typeof setTimeout> | undefined;

    const update = async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !isChatConversationDocument(editor.document)) {
            latest = [];
            item.hide();
            return;
        }
        const imageDir = getImageDir();
        if (!imageDir) {
            latest = [];
            item.hide();
            return;
        }
        const pending = extractPendingUserText(editor.document.getText());
        if (!pending) {
            latest = [];
            item.hide();
            return;
        }
        latest = await collectStats(pending, imageDir);
        if (latest.length === 0) {
            item.hide();
            return;
        }
        const total = latest.reduce((s, i) => s + i.size, 0);
        item.text = `$(file-media) 待发送 ${latest.length} 张图 · ~${formatBytes(total)}`;
        item.show();
    };

    const schedule = () => {
        if (updateTimer) { clearTimeout(updateTimer); }
        updateTimer = setTimeout(() => void update(), DEBOUNCE_MS);
    };

    // 初次 + 监听激活编辑器 / 文档改动 / 文档保存
    schedule();
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(schedule),
        vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document === vscode.window.activeTextEditor?.document) { schedule(); }
        }),
        vscode.workspace.onDidSaveTextDocument(doc => {
            if (doc === vscode.window.activeTextEditor?.document) { schedule(); }
        }),
        vscode.commands.registerCommand(COMMAND_ID, async () => {
            if (latest.length === 0) { return; }
            const picks = latest.map(i => ({
                label: path.basename(i.absolutePath),
                description: formatBytes(i.size),
                detail: i.absolutePath,
                absolutePath: i.absolutePath,
            }));
            const total = latest.reduce((s, i) => s + i.size, 0);
            const picked = await vscode.window.showQuickPick(picks, {
                placeHolder: `待发送 ${latest.length} 张图 · 合计 ~${formatBytes(total)}（选择一项打开预览）`,
            });
            if (picked) {
                await vscode.commands.executeCommand('issueManager.previewImageLightbox', picked.absolutePath);
            }
        }),
    );
}
