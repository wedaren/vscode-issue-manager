// 解析 Markdown 文档中的 "ImageDir/xxx.png" 别名路径，
// 将其展开为真实绝对路径，使 VSCode 能正确打开/预览图片；
// 同时提供 hover 时的内联图片预览（Markdown 悬浮卡片）和轻量交互查看面板。

import * as vscode from 'vscode';
import * as fs from 'fs';
import { IMAGE_DIR_PREFIX } from '../services/storage/ImageStorageService';
import { getImageDir } from '../config';
import * as path from 'path';

// 匹配 Markdown 图片 ![alt](ImageDir/xxx) 和普通链接 [text](ImageDir/xxx)
const IMAGE_DIR_LINK_RE = /\]\((ImageDir\/[^)\s]+)\)/g;

// 支持预览的图片扩展名
const PREVIEWABLE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

/** 格式化字节数为可读字符串（KB / MB），用于 hover 显示。 */
function formatBytes(bytes: number): string {
    if (bytes >= 1024 * 1024) { return `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }
    return `${Math.round(bytes / 1024)} KB`;
}

function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) { text += possible.charAt(Math.floor(Math.random() * possible.length)); }
    return text;
}

/**
 * 为 Markdown 文档中的 "ImageDir/xxx" 路径提供可点击链接（跳转到真实文件）。
 */
export class ImageDocumentLinkProvider implements vscode.DocumentLinkProvider {
    /**
     * 扫描文档，为所有 ImageDir/ 路径生成 DocumentLink。
     */
    provideDocumentLinks(document: vscode.TextDocument): vscode.DocumentLink[] {
        if (document.languageId !== 'markdown') { return []; }

        const imageDir = getImageDir();
        if (!imageDir) { return []; }

        const links: vscode.DocumentLink[] = [];
        const text = document.getText();

        for (const match of text.matchAll(IMAGE_DIR_LINK_RE)) {
            const aliasPath = match[1]; // e.g. "ImageDir/paste_2026-04-23_120000.png"
            const fileName = aliasPath.slice(`${IMAGE_DIR_PREFIX}/`.length);
            const absolutePath = path.join(imageDir, fileName);

            // match[1] 在 match[0] 中的偏移量（跳过开头的 "]("）
            const startOffset = match.index! + 2;
            const endOffset = startOffset + aliasPath.length;

            const range = new vscode.Range(
                document.positionAt(startOffset),
                document.positionAt(endOffset),
            );

            const link = new vscode.DocumentLink(range, vscode.Uri.file(absolutePath));
            link.tooltip = absolutePath;
            links.push(link);
        }

        return links;
    }
}

/**
 * 为 Markdown 文档中的 "ImageDir/xxx" 路径提供 hover 图片预览卡片。
 * 悬停时在 tooltip 中渲染图片缩略图，支持 png/jpg/gif/webp/svg。
 */
export class ImageDocumentHoverProvider implements vscode.HoverProvider {
    /**
     * 检测光标所在位置是否为 ImageDir/ 图片路径，并返回带图片预览的 Hover。
     */
    provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
    ): vscode.Hover | undefined {
        if (document.languageId !== 'markdown') { return; }

        const imageDir = getImageDir();
        if (!imageDir) { return; }

        const text = document.getText();

        for (const match of text.matchAll(IMAGE_DIR_LINK_RE)) {
            const aliasPath = match[1];
            const startOffset = match.index! + 2;
            const endOffset = startOffset + aliasPath.length;

            const range = new vscode.Range(
                document.positionAt(startOffset),
                document.positionAt(endOffset),
            );

            if (!range.contains(position)) { continue; }

            const fileName = aliasPath.slice(`${IMAGE_DIR_PREFIX}/`.length);
            const absolutePath = path.join(imageDir, fileName);
            const ext = path.extname(fileName).toLowerCase();

            if (!PREVIEWABLE_EXTS.has(ext)) { return; }

            const fileUri = vscode.Uri.file(absolutePath);
            const lightboxArgs = encodeURIComponent(JSON.stringify([absolutePath]));
            const lightboxCmd = `command:issueManager.previewImageLightbox?${lightboxArgs}`;

            let sizeLabel = '';
            try {
                sizeLabel = ` · ${formatBytes(fs.statSync(absolutePath).size)}`;
            } catch { /* 文件缺失或 iCloud 占位符读不到，降级不显示 */ }

            // HTML 布局：图片下方右对齐放交互预览按钮，避免绝对定位兼容问题
            const md = new vscode.MarkdownString(
                `**${fileName}**${sizeLabel}\n\n` +
                `\`${aliasPath}\` → \`${absolutePath}\`\n\n` +
                `<img src="${fileUri.toString()}" style="max-width:520px;max-height:360px;object-fit:contain;border-radius:4px;display:block">\n\n` +
                `<div style="text-align:right;margin-top:4px"><a href="${lightboxCmd}" title="在交互预览面板中打开（支持缩放/平移）" ` +
                `style="background:rgba(80,80,80,.7);color:#ddd;padding:3px 10px;border-radius:4px;font-size:11px;text-decoration:none">` +
                `⊕ 交互预览</a></div>`,
            );
            md.isTrusted = true;
            md.supportHtml = true;

            return new vscode.Hover(md, range);
        }

        return;
    }
}

/**
 * 轻量图片交互查看面板：单例 WebviewPanel，支持滚轮缩放（以鼠标位置为中心）和拖拽平移。
 * 同目录时复用面板并用 postMessage 更新图片；不同目录时重建面板（localResourceRoots 限制）。
 */
export class ImageLightboxPanel {
    private static _panel?: vscode.WebviewPanel;
    private static _rootDir?: string;

    /**
     * 打开图片交互预览面板（支持缩放/平移）。
     * @param filePath - 要预览的图片绝对路径
     */
    static open(filePath: string): void {
        const fileUri = vscode.Uri.file(filePath);
        const dirPath = path.dirname(filePath);
        const fileName = path.basename(filePath);
        const column = vscode.ViewColumn.Beside;

        if (ImageLightboxPanel._panel && ImageLightboxPanel._rootDir === dirPath) {
            const imgUri = ImageLightboxPanel._panel.webview.asWebviewUri(fileUri);
            ImageLightboxPanel._panel.title = fileName;
            ImageLightboxPanel._panel.webview.postMessage({ type: 'load', src: imgUri.toString(), title: fileName });
            ImageLightboxPanel._panel.reveal(column, true);
            return;
        }

        ImageLightboxPanel._panel?.dispose();

        const panel = vscode.window.createWebviewPanel(
            'issueManager.imageLightbox',
            fileName,
            { viewColumn: column, preserveFocus: true },
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.file(dirPath)],
                retainContextWhenHidden: true,
            },
        );

        ImageLightboxPanel._panel = panel;
        ImageLightboxPanel._rootDir = dirPath;

        const imgUri = panel.webview.asWebviewUri(fileUri);
        panel.webview.html = ImageLightboxPanel._buildHtml(panel.webview, imgUri.toString(), fileName);

        panel.onDidDispose(() => {
            ImageLightboxPanel._panel = undefined;
            ImageLightboxPanel._rootDir = undefined;
        });
    }

    private static _buildHtml(webview: vscode.Webview, imgSrc: string, fileName: string): string {
        const nonce = getNonce();
        const safeFileName = fileName.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
* { margin:0; padding:0; box-sizing:border-box; }
html, body { width:100%; height:100%; overflow:hidden; background:#141414; font-family:var(--vscode-font-family); }
#vp { width:100%; height:100%; position:relative; overflow:hidden; cursor:grab; user-select:none; }
#vp.drag { cursor:grabbing; }
#img { position:absolute; top:50%; left:50%; transform-origin:0 0; will-change:transform; max-width:none; max-height:none; display:block; }
#fname { position:fixed; top:12px; left:14px; color:#888; font-size:11px; max-width:60vw; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; pointer-events:none; }
#scale { position:fixed; bottom:10px; left:50%; transform:translateX(-50%); background:rgba(0,0,0,.55); color:#bbb; padding:4px 14px; border-radius:12px; font-size:11px; pointer-events:none; }
#ctrl { position:fixed; top:8px; right:10px; display:flex; gap:5px; }
.btn { background:rgba(255,255,255,.13); border:none; color:#d0d0d0; height:30px; min-width:30px; padding:0 8px; border-radius:5px; cursor:pointer; font-size:14px; display:flex; align-items:center; justify-content:center; transition:background .1s; font-family:inherit; }
.btn:hover { background:rgba(255,255,255,.26); }
</style>
</head>
<body>
<div id="fname">${safeFileName}</div>
<div id="vp"><img id="img" src="${imgSrc}" draggable="false" alt="${safeFileName}"></div>
<div id="ctrl">
  <button class="btn" id="btnZoomIn" title="放大 (+)">＋</button>
  <button class="btn" id="btnZoomOut" title="缩小 (-)">－</button>
  <button class="btn" id="btnFit" title="适应窗口 (0)" style="font-size:11px">适应</button>
  <button class="btn" id="btnOrigin" title="原始大小 (1)" style="font-size:11px">1:1</button>
</div>
<div id="scale">100%</div>
<script nonce="${nonce}">
(function () {
    const vp = document.getElementById('vp');
    const img = document.getElementById('img');
    const scaleEl = document.getElementById('scale');
    const fname = document.getElementById('fname');
    let s = 1, tx = 0, ty = 0;

    function apply() {
        img.style.transform = 'translate(calc(-50% + ' + tx + 'px), calc(-50% + ' + ty + 'px)) scale(' + s + ')';
        scaleEl.textContent = Math.round(s * 100) + '%';
    }
    function fit() {
        const vw = vp.clientWidth, vh = vp.clientHeight;
        const iw = img.naturalWidth || img.offsetWidth;
        const ih = img.naturalHeight || img.offsetHeight;
        if (!iw || !ih) { return; }
        s = Math.min(vw / iw, vh / ih, 1);
        tx = 0; ty = 0; apply();
    }
    img.addEventListener('load', fit);
    if (img.complete && img.naturalWidth) { fit(); }

    vp.addEventListener('wheel', e => {
        e.preventDefault();
        const r = vp.getBoundingClientRect();
        const mx = e.clientX - r.left - r.width / 2;
        const my = e.clientY - r.top - r.height / 2;
        const d = e.deltaY < 0 ? 1.12 : 0.89;
        const ns = Math.min(Math.max(s * d, 0.02), 100);
        tx = mx - (mx - tx) * (ns / s);
        ty = my - (my - ty) * (ns / s);
        s = ns; apply();
    }, { passive: false });

    let drag = false, ox, oy, otx, oty;
    vp.addEventListener('pointerdown', e => {
        drag = true; ox = e.clientX; oy = e.clientY; otx = tx; oty = ty;
        vp.setPointerCapture(e.pointerId); vp.classList.add('drag');
    });
    vp.addEventListener('pointermove', e => {
        if (!drag) { return; }
        tx = otx + e.clientX - ox; ty = oty + e.clientY - oy; apply();
    });
    vp.addEventListener('pointerup', () => { drag = false; vp.classList.remove('drag'); });

    document.getElementById('btnZoomIn').onclick = () => { s *= 1.2; apply(); };
    document.getElementById('btnZoomOut').onclick = () => { s /= 1.2; apply(); };
    document.getElementById('btnFit').onclick = fit;
    document.getElementById('btnOrigin').onclick = () => { s = 1; tx = 0; ty = 0; apply(); };

    document.addEventListener('keydown', e => {
        if (e.key === '=' || e.key === '+') { s *= 1.2; apply(); }
        else if (e.key === '-') { s /= 1.2; apply(); }
        else if (e.key === '0') { fit(); }
        else if (e.key === '1') { s = 1; tx = 0; ty = 0; apply(); }
    });

    window.addEventListener('message', e => {
        if (e.data?.type === 'load') {
            img.src = e.data.src || '';
            if (e.data.title) { fname.textContent = e.data.title; }
        }
    });
})();
</script>
</body>
</html>`;
    }
}
