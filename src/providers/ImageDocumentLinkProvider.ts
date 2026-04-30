// 解析 Markdown 文档中的 "ImageDir/xxx.png" 别名路径，
// 将其展开为真实绝对路径，使 VSCode 能正确打开/预览图片；
// 同时提供 hover 时的内联图片预览（Markdown 悬浮卡片）和轻量交互查看面板。

import * as vscode from 'vscode';
import { IMAGE_DIR_PREFIX } from '../services/storage/ImageStorageService';
import { getImageDir } from '../config';
import * as path from 'path';

// 匹配 Markdown 图片 ![alt](ImageDir/xxx) 和普通链接 [text](ImageDir/xxx)
const IMAGE_DIR_LINK_RE = /\]\((ImageDir\/[^)\s]+)\)/g;

// 支持预览的图片扩展名
const PREVIEWABLE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

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

            // 统一 hover 风格：整张图作为「点击进 lightbox」的入口（与 mermaid hover 一致）
            const md = new vscode.MarkdownString();
            md.isTrusted = true;
            md.supportHtml = true;
            md.appendMarkdown(
                `<a href="${lightboxCmd}" title="点击在 Image Lightbox 打开（支持缩放/拖拽/复制）">` +
                `<img src="${fileUri.toString()}" style="width:100%;display:block;background:white;border-radius:4px;cursor:zoom-in">` +
                `</a>\n\n` +
                `<div style="text-align:right;font-size:11px">` +
                `<a href="${lightboxCmd}">⊕ 大图查看（带缩放/拖拽/复制）</a>` +
                `</div>`,
            );

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
     * @param options.allowUpscale - fit 时允许的最大放大倍数；矢量图（SVG）传 4 让小图也能填满面板，
     *                                光栅图保持默认 1（不放大避免模糊）
     */
    static open(filePath: string, options: { allowUpscale?: number } = {}): void {
        const fileUri = vscode.Uri.file(filePath);
        const dirPath = path.dirname(filePath);
        const fileName = path.basename(filePath);
        const column = vscode.ViewColumn.Beside;
        const maxFitScale = options.allowUpscale ?? 1;

        if (ImageLightboxPanel._panel && ImageLightboxPanel._rootDir === dirPath) {
            const imgUri = ImageLightboxPanel._panel.webview.asWebviewUri(fileUri);
            ImageLightboxPanel._panel.title = fileName;
            ImageLightboxPanel._panel.webview.postMessage({ type: 'load', src: imgUri.toString(), title: fileName, path: filePath, maxFitScale });
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
        panel.webview.html = ImageLightboxPanel._buildHtml(panel.webview, imgUri.toString(), fileName, filePath, maxFitScale);

        // webview → extension：处理「在 Finder 中显示」之类需要原生 API 的请求
        panel.webview.onDidReceiveMessage((msg: { type?: string; path?: string }) => {
            if (msg?.type === 'revealInOS' && typeof msg.path === 'string') {
                void vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(msg.path));
            }
        });

        panel.onDidDispose(() => {
            ImageLightboxPanel._panel = undefined;
            ImageLightboxPanel._rootDir = undefined;
        });
    }

    private static _buildHtml(webview: vscode.Webview, imgSrc: string, fileName: string, filePath: string, maxFitScale: number = 1): string {
        const nonce = getNonce();
        const safeFileName = fileName.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data: blob:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src ${webview.cspSource};">
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
<div id="vp"><img id="img" src="${imgSrc}" draggable="false" alt="${safeFileName}" crossorigin="anonymous"></div>
<div id="ctrl">
  <button class="btn" id="btnZoomIn" title="放大 (+)">＋</button>
  <button class="btn" id="btnZoomOut" title="缩小 (-)">－</button>
  <button class="btn" id="btnFit" title="适应窗口 (0)" style="font-size:11px">适应</button>
  <button class="btn" id="btnOrigin" title="原始大小 (1)" style="font-size:11px">1:1</button>
  <button class="btn" id="btnCopy" title="复制图片到剪贴板 (c)" style="font-size:11px">复制</button>
  <button class="btn" id="btnReveal" title="在 Finder 中显示 (f)" style="font-size:11px">Finder</button>
</div>
<div id="scale">100%</div>
<script nonce="${nonce}">
(function () {
    const vscodeApi = acquireVsCodeApi();
    const vp = document.getElementById('vp');
    const img = document.getElementById('img');
    const scaleEl = document.getElementById('scale');
    const fname = document.getElementById('fname');
    let s = 1, tx = 0, ty = 0;
    let maxFitScale = ${maxFitScale};
    let currentPath = ${JSON.stringify(filePath)};

    function apply() {
        img.style.transform = 'translate(calc(-50% + ' + tx + 'px), calc(-50% + ' + ty + 'px)) scale(' + s + ')';
        scaleEl.textContent = Math.round(s * 100) + '%';
    }
    function fit() {
        const vw = vp.clientWidth, vh = vp.clientHeight;
        const iw = img.naturalWidth || img.offsetWidth;
        const ih = img.naturalHeight || img.offsetHeight;
        if (!iw || !ih) { return; }
        s = Math.min(vw / iw, vh / ih, maxFitScale);
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

    // 复制图片：写入系统剪贴板的 PNG。
    // - SVG：拉源码 → 把 width/height 放大 3x → 新 img 加载 → 1:1 drawImage（让浏览器在 3x 尺寸**重新栅格化**，
    //         否则直接放大已栅格化的位图会模糊）
    // - 光栅（PNG/JPG）：1:1 drawImage 即可（上采样无意义还会糊）
    // 用户在 lightbox 内点击触发，document 已聚焦 + 用户激活，navigator.clipboard.write 可用。
    const btnCopy = document.getElementById('btnCopy');
    const btnReveal = document.getElementById('btnReveal');
    // 上采样最大倍数（小图加倍提升清晰度），同时用 TARGET_MAX_DIM 限制最终最长边，
    // 避免大 SVG（比如 viewBox 1500x800）×4 后产出 1MB 量级的 PNG
    const SVG_COPY_SCALE = 4;
    const TARGET_MAX_DIM = 3000;

    function isSvgPath(p) {
        // 直接看本地文件路径扩展名，不受 webview URI 的 query 参数影响
        return /\\.svg$/i.test(p || '');
    }

    function rasterizeImageToBlob(srcImg, scale) {
        return new Promise((resolve, reject) => {
            const w = srcImg.naturalWidth || srcImg.width;
            const h = srcImg.naturalHeight || srcImg.height;
            if (!w || !h) { reject(new Error('图片尚未加载')); return; }
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(w * scale);
            canvas.height = Math.round(h * scale);
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(srcImg, 0, 0, canvas.width, canvas.height);
            canvas.toBlob(b => b ? resolve(b) : reject(new Error('canvas.toBlob 返回 null')), 'image/png');
        });
    }

    function readSvgDims(svgText) {
        const PIXEL_RE = /^(\\d+(?:\\.\\d+)?)(px)?$/i;
        let w, h;
        const wMatch = svgText.match(/<svg\\b[^>]*?\\swidth="([^"]+)"/i);
        if (wMatch && PIXEL_RE.test(wMatch[1])) { w = parseFloat(wMatch[1]); }
        const hMatch = svgText.match(/<svg\\b[^>]*?\\sheight="([^"]+)"/i);
        if (hMatch && PIXEL_RE.test(hMatch[1])) { h = parseFloat(hMatch[1]); }
        if (!w || !h) {
            const vb = svgText.match(/viewBox="([^"]+)"/i);
            if (vb) {
                const parts = vb[1].trim().split(/\\s+/).map(parseFloat);
                if (parts.length === 4 && isFinite(parts[2]) && isFinite(parts[3])) {
                    if (!w) { w = parts[2]; }
                    if (!h) { h = parts[3]; }
                }
            }
        }
        return (w && h) ? { w, h } : null;
    }

    function upscaleSvgWH(svgText, scale) {
        const dims = readSvgDims(svgText);
        if (!dims) { return svgText; }
        const newW = Math.round(dims.w * scale);
        const newH = Math.round(dims.h * scale);
        let result = svgText;

        // 去掉 mermaid 的 inline style（含 max-width，可能干扰渲染尺寸）
        result = result.replace(/(<svg\\b[^>]*?)\\sstyle="[^"]*"/i, '$1');
        // 写入/覆盖 width
        if (/<svg\\b[^>]*?\\swidth=/i.test(result)) {
            result = result.replace(/(<svg\\b[^>]*?)\\swidth="[^"]*"/i, '$1 width="' + newW + '"');
        } else {
            result = result.replace(/<svg\\b/i, '<svg width="' + newW + '"');
        }
        // 写入/覆盖 height
        if (/<svg\\b[^>]*?\\sheight=/i.test(result)) {
            result = result.replace(/(<svg\\b[^>]*?)\\sheight="[^"]*"/i, '$1 height="' + newH + '"');
        } else {
            result = result.replace(/<svg\\b/i, '<svg height="' + newH + '"');
        }
        return result;
    }

    async function rasterizeSvgHiDpi() {
        const res = await fetch(img.src);
        if (!res.ok) { throw new Error('fetch SVG 失败：HTTP ' + res.status); }
        const svgText = await res.text();
        // 自适应 scale：小 SVG 用 SVG_COPY_SCALE 上采样，大 SVG 限制最长边到 TARGET_MAX_DIM
        let scale = SVG_COPY_SCALE;
        const dims = readSvgDims(svgText);
        if (dims) {
            const maxDim = Math.max(dims.w, dims.h);
            scale = Math.min(SVG_COPY_SCALE, Math.max(1, TARGET_MAX_DIM / maxDim));
        }
        const upscaled = upscaleSvgWH(svgText, scale);
        const svgBlob = new Blob([upscaled], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(svgBlob);
        try {
            const tempImg = new Image();
            await new Promise((resolve, reject) => {
                tempImg.onload = resolve;
                tempImg.onerror = () => reject(new Error('SVG 重栅格化加载失败'));
                tempImg.src = url;
            });
            return await rasterizeImageToBlob(tempImg, 1);
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    async function copyImage() {
        const original = btnCopy.textContent;
        try {
            const blob = isSvgPath(currentPath)
                ? await rasterizeSvgHiDpi()
                : await rasterizeImageToBlob(img, 1);
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            btnCopy.textContent = '✓ 已复制';
            setTimeout(() => { btnCopy.textContent = original; }, 1500);
        } catch (err) {
            console.error('copyImage failed:', err);
            btnCopy.textContent = '× 失败';
            setTimeout(() => { btnCopy.textContent = original; }, 2000);
        }
    }
    btnCopy.onclick = copyImage;

    function revealInOS() {
        if (!currentPath) { return; }
        vscodeApi.postMessage({ type: 'revealInOS', path: currentPath });
    }
    btnReveal.onclick = revealInOS;

    document.addEventListener('keydown', e => {
        if (e.key === '=' || e.key === '+') { s *= 1.2; apply(); }
        else if (e.key === '-') { s /= 1.2; apply(); }
        else if (e.key === '0') { fit(); }
        else if (e.key === '1') { s = 1; tx = 0; ty = 0; apply(); }
        else if (e.key === 'c' || e.key === 'C') { copyImage(); }
        else if (e.key === 'f' || e.key === 'F') { revealInOS(); }
    });

    window.addEventListener('message', e => {
        if (e.data?.type === 'load') {
            // 重新设置 crossOrigin，确保 canvas 复制不被污染（src 变更时浏览器会重新发请求）
            img.crossOrigin = 'anonymous';
            img.src = e.data.src || '';
            if (e.data.title) { fname.textContent = e.data.title; }
            if (typeof e.data.path === 'string') { currentPath = e.data.path; }
            if (typeof e.data.maxFitScale === 'number') { maxFitScale = e.data.maxFitScale; }
        }
    });
})();
</script>
</body>
</html>`;
    }
}
