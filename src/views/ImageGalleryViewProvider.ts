// Gallery 侧边栏视图：展示 ImageDir 中所有图片，支持粘贴保存、复制 Markdown 引用、
// 插入到活动编辑器、在 Finder 中显示、删除等操作。
// 适配自 vscode-screenshot-manager/galleryViewProvider.ts。

import * as vscode from 'vscode';
import * as path from 'path';
import { execFile } from 'child_process';
import { ImageStorageService, ImageInfo } from '../services/storage/ImageStorageService';
import { getImageDir } from '../config';
import { getNonce, escapeHtml } from './webviewUtils';

/**
 * 图片库侧边栏 WebviewView 提供者：展示 ImageDir 中所有图片，按修改时间倒序。
 * 支持拖放、粘贴、复制 Markdown 引用、插入编辑器、删除、预览等操作。
 */
export class ImageGalleryViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewId = 'issueManager.views.imageGallery';

    private _view?: vscode.WebviewView;

    constructor(private readonly _extensionUri: vscode.Uri) {}

    /** 刷新 Gallery 视图内容 */
    public refresh(): void {
        if (this._view) {
            this._view.webview.html = this._buildHtml(this._view.webview);
        }
    }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ): void {
        this._view = webviewView;

        const imageDirUri = ImageStorageService.getImageDirUri();
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri,
                ...(imageDirUri ? [imageDirUri] : []),
            ],
        };

        webviewView.webview.html = this._buildHtml(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
            await this._handleMessage(message, webviewView.webview);
        });
    }

    // ── 消息处理 ──────────────────────────────────────────────────────────────

    private async _handleMessage(message: WebviewMessage, webview: vscode.Webview): Promise<void> {
        switch (message.type) {
            case 'saveImage': {
                const relativePath = await ImageStorageService.saveBase64(
                    message.data,
                    message.mimeType ?? 'image/png',
                    message.fileName,
                    message.prefix ?? 'paste',
                );
                if (relativePath) {
                    this.refresh();
                }
                break;
            }
            case 'copyMarkdownLink': {
                const mdLink = `![](${message.relativePath})`;
                await vscode.env.clipboard.writeText(mdLink);
                void vscode.window.showInformationMessage(`已复制：${mdLink}`);
                break;
            }
            case 'copyFile': {
                if (process.platform === 'darwin') {
                    await new Promise<void>((resolve, reject) => {
                        execFile('osascript', [
                            '-e', `set the clipboard to (POSIX file "${message.absolutePath.replace(/"/g, '\\"')}")`,
                        ], (err) => (err ? reject(err) : resolve()));
                    });
                    void vscode.window.showInformationMessage(`文件已复制：${path.basename(message.absolutePath)}`);
                } else {
                    void vscode.window.showWarningMessage('复制文件仅支持 macOS');
                }
                break;
            }
            case 'openWithPreview': {
                if (process.platform === 'darwin') {
                    execFile('open', ['-a', 'Preview', message.absolutePath]);
                } else {
                    void vscode.window.showWarningMessage('在 Preview 中打开仅支持 macOS');
                }
                break;
            }
            case 'revealInFinder': {
                await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(message.absolutePath));
                break;
            }
            case 'deleteImage': {
                const confirm = await vscode.window.showWarningMessage(
                    `删除 ${path.basename(message.absolutePath)}？`,
                    { modal: true },
                    '删除',
                );
                if (confirm === '删除') {
                    await ImageStorageService.delete(message.absolutePath);
                    this.refresh();
                }
                break;
            }
            case 'openPreview': {
                const panel = vscode.window.createWebviewPanel(
                    'issueManager.imagePreview',
                    path.basename(message.absolutePath),
                    vscode.ViewColumn.One,
                    {
                        enableScripts: false,
                        localResourceRoots: [vscode.Uri.file(path.dirname(message.absolutePath))],
                    },
                );
                const imageUri = panel.webview.asWebviewUri(vscode.Uri.file(message.absolutePath));
                panel.webview.html = this._buildPreviewHtml(imageUri.toString(), path.basename(message.absolutePath));
                break;
            }
            case 'openBoard': {
                await vscode.commands.executeCommand('issueManager.image.openBoard');
                break;
            }
        }
    }

    // ── HTML 构建 ─────────────────────────────────────────────────────────────

    private _buildHtml(webview: vscode.Webview): string {
        const images = ImageStorageService.list();
        const nonce = getNonce();

        const imageDirUri = ImageStorageService.getImageDirUri();
        if (imageDirUri) {
            webview.options = {
                enableScripts: true,
                localResourceRoots: [this._extensionUri, imageDirUri],
            };
        }

        const imageItems = images.map(img => {
            const webviewUri = webview.asWebviewUri(vscode.Uri.file(img.absolutePath));
            return `
                <div class="grid-item" data-path="${escapeHtml(img.absolutePath)}" data-rel="${escapeHtml(img.relativePath)}">
                    <img src="${webviewUri}" alt="${escapeHtml(img.name)}" loading="lazy" />
                    <div class="overlay">
                        <span class="file-name">${escapeHtml(img.name)}</span>
                        <div class="actions">
                            <button class="action-btn" data-action="copyFile" title="复制文件">
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4 4h3v1H4v7h7v-3h1v3.5a.5.5 0 0 1-.5.5h-8a.5.5 0 0 1-.5-.5v-8a.5.5 0 0 1 .5-.5z"/><path d="M7 1.5a.5.5 0 0 1 .5-.5h8a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-.5.5h-8a.5.5 0 0 1-.5-.5v-8zM8 2v7h7V2H8z"/></svg>
                            </button>
                            <button class="action-btn" data-action="copyMarkdownLink" title="复制 Markdown 引用">
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4.715 6.542L3.343 7.914a3 3 0 1 0 4.243 4.243l1.828-1.829A3 3 0 0 0 8.586 5.5L8 6.086a1.002 1.002 0 0 0-.154.199 2 2 0 0 1 .861 3.337L6.88 11.45a2 2 0 1 1-2.83-2.83l.793-.792a4.018 4.018 0 0 1-.128-1.287z"/><path d="M6.586 4.672A3 3 0 0 0 7.414 9.5l.775-.776a2 2 0 0 1-.896-3.346L9.12 3.55a2 2 0 1 1 2.83 2.83l-.793.792c.112.42.155.855.128 1.287l1.372-1.372a3 3 0 1 0-4.243-4.243L6.586 4.672z"/></svg>
                            </button>
                            <button class="action-btn" data-action="openWithPreview" title="用 Preview 打开">
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M16 8s-3-5.5-8-5.5S0 8 0 8s3 5.5 8 5.5S16 8 16 8zM1.173 8a13.133 13.133 0 0 1 1.66-2.043C4.12 4.668 5.88 3.5 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13.133 13.133 0 0 1 14.828 8c-.058.087-.122.183-.195.288-.335.48-.83 1.12-1.465 1.755C11.879 11.332 10.119 12.5 8 12.5c-2.12 0-3.879-1.168-5.168-2.457A13.134 13.134 0 0 1 1.172 8z"/><path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM4.5 8a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0z"/></svg>
                            </button>
                            <button class="action-btn" data-action="openPreview" title="全屏预览">
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 1h4a.5.5 0 0 1 0 1H2v3.5a.5.5 0 0 1-1 0V1.5A.5.5 0 0 1 1.5 1zm7 0h4a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-1 0V2h-3.5a.5.5 0 0 1 0-1zm-7 9a.5.5 0 0 1 .5.5V14h3.5a.5.5 0 0 1 0 1h-4a.5.5 0 0 1-.5-.5v-4a.5.5 0 0 1 .5-.5zm11 0a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-.5.5h-4a.5.5 0 0 1 0-1H14v-3.5a.5.5 0 0 1 .5-.5z"/></svg>
                            </button>
                            <button class="action-btn" data-action="revealInFinder" title="在 Finder 中显示">
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 1h6l1 1H14.5a.5.5 0 0 1 .5.5v11a.5.5 0 0 1-.5.5h-13a.5.5 0 0 1-.5-.5v-12a.5.5 0 0 1 .5-.5z"/></svg>
                            </button>
                            <button class="action-btn action-delete" data-action="deleteImage" title="删除">
                                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 5.5a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4L4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/></svg>
                            </button>
                        </div>
                    </div>
                </div>`;
        }).join('\n');

        const imageDirDisplay = getImageDir() ?? '（未配置）';

        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { padding: 8px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }

    .toolbar { display: flex; gap: 4px; margin-bottom: 8px; align-items: center; }
    .toolbar-btn {
        background: var(--vscode-button-secondaryBackground, rgba(128,128,128,0.15));
        border: 1px solid var(--vscode-button-border, transparent);
        border-radius: 3px; color: var(--vscode-foreground); cursor: pointer;
        padding: 3px 8px; font-size: 11px; display: flex; align-items: center; gap: 4px;
    }
    .toolbar-btn:hover { background: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,0.25)); }
    .dir-label { font-size: 10px; color: var(--vscode-descriptionForeground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }

    .drop-zone {
        border: 2px dashed var(--vscode-input-border, #555); border-radius: 6px;
        padding: 16px 12px; text-align: center; margin-bottom: 10px; cursor: pointer;
        transition: border-color .2s, background .2s; color: var(--vscode-descriptionForeground); font-size: 11px; line-height: 1.6;
    }
    .drop-zone:focus-within, .drop-zone.drag-over {
        border-color: var(--vscode-focusBorder); background: var(--vscode-list-hoverBackground);
    }
    .drop-zone kbd {
        background: var(--vscode-keybindingLabel-background, rgba(128,128,128,0.17));
        border: 1px solid var(--vscode-keybindingLabel-border, rgba(128,128,128,0.4));
        border-radius: 3px; padding: 1px 5px; font-family: var(--vscode-font-family); font-size: 10px;
    }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    .grid-item {
        position: relative; border-radius: 4px; overflow: hidden; cursor: pointer;
        aspect-ratio: 1; background: var(--vscode-editor-background);
        border: 1px solid var(--vscode-panel-border, transparent);
    }
    .grid-item img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .grid-item .overlay {
        position: absolute; inset: 0; background: rgba(0,0,0,.65);
        display: flex; flex-direction: column; justify-content: flex-end;
        padding: 6px; opacity: 0; transition: opacity .15s;
    }
    .grid-item:hover .overlay { opacity: 1; }
    .file-name { font-size: 10px; color: #eee; margin-bottom: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .actions { display: flex; gap: 3px; flex-wrap: wrap; }
    .action-btn {
        background: rgba(255,255,255,.15); border: none; border-radius: 3px; color: #eee;
        cursor: pointer; padding: 3px 5px; display: flex; align-items: center; justify-content: center;
        transition: background .15s;
    }
    .action-btn:hover { background: rgba(255,255,255,.3); }
    .action-delete:hover { background: rgba(255,80,80,.6); }
    .empty-state { text-align: center; padding: 20px 12px; color: var(--vscode-descriptionForeground); font-size: 12px; }
</style>
</head>
<body>
<div class="toolbar">
    <button class="toolbar-btn" id="btnBoard">调查板</button>
    <span class="dir-label" title="${escapeHtml(imageDirDisplay)}">${escapeHtml(imageDirDisplay)}</span>
</div>
<div class="drop-zone" id="dropZone" tabindex="0">
    <kbd>Cmd+Shift+V</kbd> 粘贴 或 拖拽图片到此处
</div>
${images.length > 0
    ? `<div class="grid">${imageItems}</div>`
    : '<div class="empty-state">暂无图片</div>'}

<script nonce="${nonce}">
(function() {
    const vscode = acquireVsCodeApi();
    const dropZone = document.getElementById('dropZone');
    document.getElementById('btnBoard').addEventListener('click', () => vscode.postMessage({ type: 'openBoard' }));

    // ── 粘贴 ──
    document.addEventListener('paste', (e) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        for (const item of items) {
            if (item.type.startsWith('image/')) {
                e.preventDefault();
                const blob = item.getAsFile();
                if (blob) readAndSend(blob, undefined, item.type, 'paste');
                return;
            }
        }
    });

    // ── 拖放 ──
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault(); dropZone.classList.remove('drag-over');
        const files = e.dataTransfer?.files;
        if (!files) return;
        for (const file of files) {
            if (file.type.startsWith('image/')) readAndSend(file, file.name, file.type, 'screenshot');
        }
    });

    function readAndSend(blob, name, mimeType, prefix) {
        const reader = new FileReader();
        reader.onload = () => {
            const base64 = reader.result.split(',')[1];
            vscode.postMessage({ type: 'saveImage', data: base64, fileName: name, mimeType, prefix });
        };
        reader.readAsDataURL(blob);
    }

    // ── 点击操作 ──
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.action-btn');
        if (btn) {
            e.stopPropagation();
            const action = btn.dataset.action;
            const item = btn.closest('.grid-item');
            const absolutePath = item.dataset.path;
            const relativePath = item.dataset.rel;
            vscode.postMessage({ type: action, absolutePath, relativePath });
            return;
        }
        const gridItem = e.target.closest('.grid-item');
        if (gridItem) vscode.postMessage({ type: 'openPreview', absolutePath: gridItem.dataset.path });
    });
})();
</script>
</body>
</html>`;
    }

    private _buildPreviewHtml(imageUri: string, title: string): string {
        const nonce = getNonce();
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${imageUri.startsWith('vscode-') ? 'vscode-resource:' : 'https:'} data:; style-src 'nonce-${nonce}';">
<style nonce="${nonce}">
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { display: flex; align-items: center; justify-content: center; min-height: 100vh;
           background: var(--vscode-editor-background); padding: 16px; }
    img { max-width: 100%; max-height: 90vh; object-fit: contain; border-radius: 4px; }
    h3 { position: fixed; top: 8px; left: 12px; font-size: 12px; color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
<h3>${escapeHtml(title)}</h3>
<img src="${imageUri}" alt="${escapeHtml(title)}" />
</body>
</html>`;
    }
}

// ── 内部消息类型 ─────────────────────────────────────────────────────────────

type WebviewMessage =
    | { type: 'saveImage'; data: string; mimeType: string; fileName?: string; prefix?: string }
    | { type: 'copyMarkdownLink'; relativePath: string; absolutePath: string }
    | { type: 'copyFile'; absolutePath: string }
    | { type: 'openWithPreview'; absolutePath: string }
    | { type: 'revealInFinder'; absolutePath: string }
    | { type: 'deleteImage'; absolutePath: string }
    | { type: 'openPreview'; absolutePath: string }
    | { type: 'openBoard' };
