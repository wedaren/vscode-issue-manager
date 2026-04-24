// 调查板编辑器（多板版本）：每块板子通过 boardId 独立持久化，
// 支持图片条目和 Issue 文档卡片，数据由 BoardStorageService 统一管理。
// 每个 boardId 对应一个独立 WebviewPanel，通过静态 Map 管理防止重复打开。

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ImageStorageService } from '../services/storage/ImageStorageService';
import { BoardStorageService, BoardItem, BoardData } from '../services/storage/BoardStorageService';
import { getImageDir, getIssueDir } from '../config';
import { getAllIssueMarkdowns } from '../data/IssueMarkdowns';
import { getNonce } from './webviewUtils';

// ── webview 消息联合类型 ──────────────────────────────────────────────────────

type BoardWebviewMessage =
    | { type: 'updateState'; canvasX: number; canvasY: number; canvasScale: number; items: BoardItem[] }
    | { type: 'saveImage'; data: string; fileName?: string; x?: number; y?: number }
    | { type: 'resolveUri'; id: string; filePath: string }
    | { type: 'pickFiles'; cx?: number; cy?: number }
    | { type: 'pickIssue'; cx?: number; cy?: number }
    | { type: 'openIssue'; filePath: string }
    | { type: 'newIssue'; cx?: number; cy?: number; title?: string }
    | { type: 'clearBoard' }
    | { type: 'toggleZenMode' };

// ── 辅助 ──────────────────────────────────────────────────────────────────────

/** 读取 Issue 文件全文（去除 YAML Frontmatter） */
function readExcerpt(filePath: string): string {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        if (content.startsWith('---')) {
            const end = content.indexOf('---', 3);
            if (end !== -1) { return content.slice(end + 3).trimStart(); }
        }
        return content;
    } catch {
        return '';
    }
}

// ── Provider ──────────────────────────────────────────────────────────────────

/**
 * 调查板编辑器 Provider：通过 boardId 支持多个独立调查板面板。
 * 静态 open(boardId) 保证同一块板子只有一个 WebviewPanel。
 */
export class ImageBoardEditorProvider {
    /** 静态注册表：boardId → provider 实例 */
    private static readonly _panels = new Map<string, ImageBoardEditorProvider>();

    private _panel?: vscode.WebviewPanel;
    private _data: BoardData = {
        id: '', name: '调查板', createdAt: 0, updatedAt: 0,
        canvasX: 0, canvasY: 0, canvasScale: 1, items: [],
    };

    private constructor(private readonly _extensionUri: vscode.Uri) {}

    /**
     * 打开或聚焦指定 boardId 的调查板面板。
     * @param boardId - 调查板唯一 ID
     * @param extensionUri - 扩展 Uri
     */
    public static open(boardId: string, extensionUri: vscode.Uri): void {
        const existing = ImageBoardEditorProvider._panels.get(boardId);
        if (existing?._panel) {
            existing._panel.reveal();
            return;
        }
        const provider = new ImageBoardEditorProvider(extensionUri);
        ImageBoardEditorProvider._panels.set(boardId, provider);
        provider._openPanel(boardId);
    }

    /**
     * 将图片文件添加到已打开的指定调查板。
     * @param boardId - 目标调查板 ID
     * @param filePath - 图片文件绝对路径
     */
    public static addImageToBoard(boardId: string, filePath: string): void {
        const provider = ImageBoardEditorProvider._panels.get(boardId);
        if (!provider?._panel) { return; }
        const uri = provider._panel.webview.asWebviewUri(vscode.Uri.file(filePath));
        provider._panel.webview.postMessage({
            type: 'imageAdded',
            filePath,
            webviewUri: uri.toString(),
            x: 100,
            y: 100,
        });
    }

    // ── 面板生命周期 ──────────────────────────────────────────────────────────

    private _openPanel(boardId: string): void {
        const data = BoardStorageService.readBoard(boardId);
        if (!data) {
            void vscode.window.showWarningMessage(`找不到调查板：${boardId}`);
            ImageBoardEditorProvider._panels.delete(boardId);
            return;
        }
        this._data = data;

        const imageDir = getImageDir();
        const issueDir = getIssueDir();
        const roots: vscode.Uri[] = [this._extensionUri];
        if (imageDir) { roots.push(vscode.Uri.file(imageDir)); }
        if (issueDir) { roots.push(vscode.Uri.file(issueDir)); }

        this._panel = vscode.window.createWebviewPanel(
            'issueManager.imageBoard',
            data.name,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: roots,
            },
        );

        this._panel.webview.html = this._buildHtml(this._panel.webview);

        this._panel.webview.onDidReceiveMessage(async (msg: BoardWebviewMessage) => {
            await this._handleMessage(msg);
        });

        this._panel.onDidDispose(() => {
            ImageBoardEditorProvider._panels.delete(boardId);
            this._panel = undefined;
        });
    }

    // ── 消息处理 ──────────────────────────────────────────────────────────────

    private async _handleMessage(msg: BoardWebviewMessage): Promise<void> {
        switch (msg.type) {
            case 'updateState': {
                this._data.canvasX = msg.canvasX;
                this._data.canvasY = msg.canvasY;
                this._data.canvasScale = msg.canvasScale;
                this._data.items = msg.items;
                BoardStorageService.saveBoard(this._data);
                break;
            }
            case 'saveImage': {
                const relativePath = await ImageStorageService.saveBase64(
                    msg.data,
                    'image/png',
                    msg.fileName,
                    'board',
                );
                if (relativePath && this._panel) {
                    const uri = ImageStorageService.resolve(relativePath);
                    if (uri) {
                        const webviewUri = this._panel.webview.asWebviewUri(uri);
                        this._panel.webview.postMessage({
                            type: 'imageAdded',
                            filePath: uri.fsPath,
                            webviewUri: webviewUri.toString(),
                            x: msg.x ?? 100,
                            y: msg.y ?? 100,
                        });
                    }
                }
                break;
            }
            case 'resolveUri': {
                if (this._panel) {
                    const uri = this._panel.webview.asWebviewUri(vscode.Uri.file(msg.filePath));
                    this._panel.webview.postMessage({
                        type: 'uriResolved',
                        id: msg.id,
                        webviewUri: uri.toString(),
                    });
                }
                break;
            }
            case 'pickFiles': {
                if (!this._panel) { break; }
                const dir = getImageDir();
                const files = await vscode.window.showOpenDialog({
                    canSelectMany: true,
                    filters: { '图片': ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
                    defaultUri: dir ? vscode.Uri.file(dir) : undefined,
                });
                if (!files || files.length === 0) { break; }
                let offsetX = 0;
                for (const file of files) {
                    let targetPath = file.fsPath;
                    if (dir) {
                        const normalizedDir = path.normalize(dir);
                        const normalizedFile = path.normalize(file.fsPath);
                        if (!normalizedFile.startsWith(normalizedDir + path.sep)) {
                            const ext = path.extname(file.fsPath);
                            const base = path.basename(file.fsPath, ext);
                            const destName = `${base}-${Date.now()}${ext}`;
                            const destPath = path.join(dir, destName);
                            try {
                                fs.mkdirSync(dir, { recursive: true });
                                fs.copyFileSync(file.fsPath, destPath);
                                targetPath = destPath;
                            } catch (err) {
                                console.error('[ImageBoardEditorProvider] copy file error:', err);
                                continue;
                            }
                        }
                    }
                    const uri = this._panel.webview.asWebviewUri(vscode.Uri.file(targetPath));
                    this._panel.webview.postMessage({
                        type: 'imageAdded',
                        filePath: targetPath,
                        webviewUri: uri.toString(),
                        x: (msg.cx ?? 100) + offsetX,
                        y: msg.cy ?? 100,
                    });
                    offsetX += 320;
                }
                break;
            }
            case 'pickIssue': {
                if (!this._panel) { break; }
                let offsetX = 0;
                let pickedPaths: Array<{ filePath: string; title: string }> = [];
                try {
                    const all = await getAllIssueMarkdowns();
                    const choices = all.map(im => ({
                        label: im.title || path.basename(im.uri.fsPath, '.md'),
                        description: path.basename(im.uri.fsPath),
                        filePath: im.uri.fsPath,
                    }));
                    const selected = await vscode.window.showQuickPick(choices, {
                        canPickMany: true,
                        placeHolder: '选择要添加到调查板的 Issue（可多选）',
                    });
                    if (!selected || selected.length === 0) { break; }
                    pickedPaths = selected.map(s => ({ filePath: s.filePath, title: s.label }));
                } catch {
                    const issueDir = getIssueDir();
                    const picked = await vscode.window.showOpenDialog({
                        canSelectMany: true,
                        filters: { 'Issue 文档': ['md'] },
                        defaultUri: issueDir ? vscode.Uri.file(issueDir) : undefined,
                    });
                    if (!picked || picked.length === 0) { break; }
                    pickedPaths = picked.map(f => ({
                        filePath: f.fsPath,
                        title: path.basename(f.fsPath, '.md'),
                    }));
                }
                for (const item of pickedPaths) {
                    const excerpt = readExcerpt(item.filePath);
                    this._panel.webview.postMessage({
                        type: 'issueAdded',
                        filePath: item.filePath,
                        title: item.title,
                        excerpt,
                        x: (msg.cx ?? 100) + offsetX,
                        y: msg.cy ?? 100,
                    });
                    offsetX += 280;
                }
                break;
            }
            case 'openIssue': {
                try {
                    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(msg.filePath));
                } catch { /* ignore */ }
                break;
            }
            case 'newIssue': {
                if (!this._panel) { break; }
                const issueDir = getIssueDir();
                if (!issueDir) {
                    void vscode.window.showWarningMessage('请先配置 Issue 目录（issueManager.issueDir）');
                    break;
                }
                const titleInput = msg.title ?? await vscode.window.showInputBox({
                    prompt: '输入新 Issue 标题',
                    placeHolder: '例如：登录页面样式问题',
                    value: msg.title,
                });
                if (!titleInput) { break; }
                const safeName = titleInput.replace(/[\\/:\*\?"<>|]/g, '-').trim() || 'new-issue';
                const fileName = `${safeName}-${Date.now()}.md`;
                const targetPath = path.join(issueDir, fileName);
                const content = `---\ntitle: ${titleInput}\ncreatedAt: ${new Date().toISOString()}\n---\n\n# ${titleInput}\n\n`;
                try {
                    fs.mkdirSync(issueDir, { recursive: true });
                    fs.writeFileSync(targetPath, content, 'utf-8');
                } catch (err) {
                    void vscode.window.showErrorMessage(`创建 Issue 文件失败：${String(err)}`);
                    break;
                }
                const excerpt = readExcerpt(targetPath);
                this._panel.webview.postMessage({
                    type: 'issueAdded',
                    filePath: targetPath,
                    title: titleInput,
                    excerpt,
                    x: msg.cx ?? 100,
                    y: msg.cy ?? 100,
                });
                break;
            }
            case 'clearBoard': {
                const confirm = await vscode.window.showWarningMessage(
                    '清空调查板上所有内容？（仅清除画布，不删除文件）',
                    { modal: true },
                    '清空',
                );
                if (confirm === '清空') {
                    this._data.items = [];
                    this._data.canvasX = 0;
                    this._data.canvasY = 0;
                    this._data.canvasScale = 1;
                    BoardStorageService.saveBoard(this._data);
                    this._panel?.webview.postMessage({ type: 'boardCleared' });
                }
                break;
            }
            case 'toggleZenMode': {
                void vscode.commands.executeCommand('workbench.action.toggleZenMode');
                break;
            }
        }
    }

    // ── HTML ──────────────────────────────────────────────────────────────────

    private _buildHtml(webview: vscode.Webview): string {
        const nonce = getNonce();

        const itemsWithUri = this._data.items.map(item => {
            if (item.type === 'image') {
                return { ...item, webviewUri: webview.asWebviewUri(vscode.Uri.file(item.filePath)).toString() };
            }
            return item;
        });

        const stateJson = JSON.stringify({
            canvasX: this._data.canvasX,
            canvasY: this._data.canvasY,
            canvasScale: this._data.canvasScale,
            items: itemsWithUri,
        }).replace(/</g, '\\u003c');

        const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'resources', 'boardClient.css'));
        const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'resources', 'boardClient.js'));

        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${cssUri}">
</head>
<body>
<div id="toolbar">
    <button class="tb-btn" id="btnUndo" disabled title="撤销 (Cmd+Z)">↩ 撤销</button>
    <button class="tb-btn" id="btnRedo" disabled title="重做 (Cmd+Shift+Z)">↪ 重做</button>
    <button class="tb-btn" id="btnAdd">+ 添加图片</button>
    <button class="tb-btn" id="btnAddIssue">+ 添加 Issue</button>
    <button class="tb-btn" id="btnZen" title="全屏 / Zen 模式 (F11)">⛶ 全屏</button>
    <button class="tb-btn danger" id="btnClear">清空</button>
</div>
<div id="viewport">
    <div id="canvas"></div>
</div>
<div id="hint">滚轮缩放 · 拖拽背景平移 · 拖拽条目移动 · Cmd+V 粘贴图片</div>
<div id="lightbox"><img id="lbImg" src="" alt=""></div>
<div id="hud">
    <div id="minimap-wrap"><canvas id="minimap" width="160" height="100"></canvas></div>
    <div id="zoom-bar">
        <button class="z-btn" id="btnZoomOut" title="缩小">−</button>
        <span id="zoomLabel">100%</span>
        <button class="z-btn" id="btnZoomIn" title="放大">+</button>
        <button class="z-btn z-sm" id="btnZoom100" title="实际大小">1:1</button>
        <button class="z-btn z-sm" id="btnZoomFit" title="适配所有内容">适配</button>
    </div>
</div>
<script nonce="${nonce}">window.__BOARD_STATE__ = ${stateJson};</script>
<script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
    }
}
