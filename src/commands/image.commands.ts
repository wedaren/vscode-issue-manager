// 图片相关命令：粘贴图片到 Markdown 编辑器、刷新 Gallery、复制 Markdown 引用。
// 核心入口：registerImageCommands(context, galleryProvider)。
// macOS 粘贴路径：osascript 将剪贴板 PNG 写临时文件 → ImageStorageService.save → 插入 Markdown。

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import { ImageStorageService } from '../services/storage/ImageStorageService';
import { ImageGalleryViewProvider } from '../views/ImageGalleryViewProvider';

/** 非 macOS 平台降级提示只展示一次，避免刷屏 */
let _nonMacPasteHintShown = false;
/**
 * 注册所有图片相关命令到 context.subscriptions。
 * @param context - 扩展上下文
 * @param galleryProvider - Gallery 视图提供者实例，用于刷新视图
 */
export function registerImageCommands(
    context: vscode.ExtensionContext,
    galleryProvider: ImageGalleryViewProvider,
): void {
    // 粘贴图片（从剪贴板读取，写入 ImageDir，插入 Markdown 引用）
    context.subscriptions.push(
        vscode.commands.registerCommand('issueManager.image.pasteImage', async () => {
            await _pasteImageToEditor(galleryProvider);
        }),
    );

    // 刷新图片库
    context.subscriptions.push(
        vscode.commands.registerCommand('issueManager.image.refreshGallery', () => {
            galleryProvider.refresh();
        }),
    );

    // 删除图片（由 Gallery 内部或命令调用）
    context.subscriptions.push(
        vscode.commands.registerCommand('issueManager.image.deleteImage', async (absolutePath: string) => {
            if (!absolutePath) { return; }
            const confirm = await vscode.window.showWarningMessage(
                `删除图片 ${absolutePath.split('/').pop()}？`,
                { modal: true },
                '删除',
            );
            if (confirm === '删除') {
                await ImageStorageService.delete(absolutePath);
                galleryProvider.refresh();
            }
        }),
    );

    // 在 Finder 中显示
    context.subscriptions.push(
        vscode.commands.registerCommand('issueManager.image.revealInFinder', (absolutePath: string) => {
            if (!absolutePath) { return; }
            void vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(absolutePath));
        }),
    );
}

// ── 私有辅助 ──────────────────────────────────────────────────────────────────

async function _pasteImageToEditor(galleryProvider: ImageGalleryViewProvider): Promise<void> {
    const editor = vscode.window.activeTextEditor;

    // ① 通过平台原生方式读取剪贴板图片
    const clipboard = await _readImageFromClipboard();
    if (clipboard) {
        const customName = await _askImageName(clipboard.mimeType);
        if (customName === undefined) { return; } // ESC → 取消
        const result = await ImageStorageService.save(clipboard.data, clipboard.mimeType, 'paste', customName || undefined);
        if (result) {
            await _insertMarkdownImage(editor, result.relativePath);
            galleryProvider.refresh();
            vscode.window.setStatusBarMessage(_savedMessage(result.relativePath, result.originalSize, result.compressedSize), 3000);
        }
        return;
    }

    // ② 剪贴板是图片文件路径（某些截图工具会这样）
    const clipText = await vscode.env.clipboard.readText();
    if (clipText) {
        const trimmed = clipText.trim();
        const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
        const isImagePath = imageExtensions.some(ext => trimmed.toLowerCase().endsWith(ext));
        if (isImagePath && trimmed.startsWith('/')) {
            try {
                const fileData = await vscode.workspace.fs.readFile(vscode.Uri.file(trimmed));
                const ext = trimmed.split('.').pop()?.toLowerCase() ?? 'png';
                const mimeType = `image/${ext === 'jpg' ? 'jpeg' : ext}`;
                const customName = await _askImageName(mimeType);
                if (customName === undefined) { return; } // ESC → 取消
                const result = await ImageStorageService.save(fileData, mimeType, 'paste', customName || undefined);
                if (result) {
                    await _insertMarkdownImage(editor, result.relativePath);
                    galleryProvider.refresh();
                    vscode.window.setStatusBarMessage(_savedMessage(result.relativePath, result.originalSize, result.compressedSize), 3000);
                }
                return;
            } catch {
                // 文件读取失败，继续透传
            }
        }
    }

    // 剪贴板无可识别图片 → 在非 macOS 上首次提示用户使用原生粘贴，然后透传给默认粘贴命令
    if (process.platform !== 'darwin' && !_nonMacPasteHintShown) {
        _nonMacPasteHintShown = true;
        void vscode.window.showInformationMessage(
            '图片粘贴命令的剪贴板图片读取目前仅支持 macOS。请直接使用 VSCode 原生 Cmd+V/Ctrl+V 粘贴图片，会自动保存到 ImageDir。',
        );
    }
    await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
}

// ── 剪贴板图片读取 ────────────────────────────────────────────────────────────

/** 格式化字节数为可读字符串（KB / MB） */
function _formatSize(bytes: number): string {
    if (bytes >= 1024 * 1024) { return `${(bytes / (1024 * 1024)).toFixed(1)}MB`; }
    return `${Math.round(bytes / 1024)}KB`;
}

/** 构建保存成功的状态栏消息，有压缩时追加压缩比 */
function _savedMessage(relativePath: string, originalSize?: number, compressedSize?: number): string {
    const fileName = relativePath.split('/').pop() ?? '';
    if (originalSize !== undefined && compressedSize !== undefined) {
        return `$(check) 图片已保存：${fileName}（已压缩 ${_formatSize(originalSize)} → ${_formatSize(compressedSize)}）`;
    }
    return `$(check) 图片已保存：${fileName}`;
}

interface ClipboardImage {
    data: Uint8Array;
    mimeType: string;
}

/**
 * 从系统剪贴板读取图片数据（平台分发入口）。
 * 目前仅支持 macOS（通过 osascript）；其他平台返回 undefined。
 */
async function _readImageFromClipboard(): Promise<ClipboardImage | undefined> {
    if (process.platform === 'darwin') {
        return _readImageFromClipboardMac();
    }
    return undefined;
}

/**
 * macOS：用 AppleScript 将剪贴板中的 PNG 数据写入临时文件，再读回内存。
 * 若剪贴板无图片内容则返回 undefined。
 */
async function _readImageFromClipboardMac(): Promise<ClipboardImage | undefined> {
    const tmpFile = path.join(os.tmpdir(), `issue_mgr_paste_${Date.now()}.png`);
    // AppleScript：尝试将剪贴板强转为 PNG，失败则返回 "error"
    const script = [
        'try',
        '  set theData to (the clipboard as «class PNGf»)',
        `  set f to open for access POSIX file "${tmpFile}" with write permission`,
        '  set eof f to 0',
        '  write theData to f',
        '  close access f',
        '  return "ok"',
        'on error',
        '  return "error"',
        'end try',
    ].join('\n');

    return new Promise(resolve => {
        execFile('osascript', ['-e', script], async (err, stdout) => {
            if (err || !stdout.trim().startsWith('ok')) {
                resolve(undefined);
                return;
            }
            try {
                const buf = await fs.promises.readFile(tmpFile);
                void fs.promises.unlink(tmpFile).catch(() => undefined);
                resolve({ data: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), mimeType: 'image/png' });
            } catch {
                resolve(undefined);
            }
        });
    });
}

async function _insertMarkdownImage(
    editor: vscode.TextEditor | undefined,
    relativePath: string,
): Promise<void> {
    const mdText = `![](${relativePath})`;
    if (editor) {
        const insertStart = editor.selection.start;
        await editor.edit(eb => {
            for (const sel of editor.selections) {
                eb.replace(sel, mdText);
            }
        });
        // 光标移到 alt 文本位置（`![|…`）
        const cursorPos = insertStart.translate(0, 2);
        editor.selection = new vscode.Selection(cursorPos, cursorPos);
    } else {
        await vscode.env.clipboard.writeText(mdText);
        void vscode.window.showInformationMessage(`Markdown 引用已复制：${mdText}`);
    }
}

/**
 * 弹出输入框，让用户为图片命名。
 * @param mimeType - MIME 类型，用于生成默认文件名
 * @returns 自定义文件名（含扩展名），空字符串表示用默认，undefined 表示取消
 */
async function _askImageName(mimeType: string): Promise<string | undefined> {
    const suggested = ImageStorageService.suggestFileName('paste', mimeType);
    const ext = suggested.split('.').pop() ?? 'png';
    const suggestedBase = suggested.slice(0, -(ext.length + 1));
    const input = await vscode.window.showInputBox({
        prompt: '为图片起个名字（直接回车使用时间戳命名）',
        placeHolder: suggestedBase,
        value: '',
    });
    if (input === undefined) { return undefined; } // ESC
    const trimmed = input.trim();
    return trimmed ? `${trimmed}.${ext}` : ''; // 空字符串 → 调用方用默认
}
