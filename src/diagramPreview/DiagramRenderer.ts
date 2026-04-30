import * as vscode from 'vscode';
import { DiagramCache } from './cache';
import { normalizeSvg } from './svgUtils';
import { ImageLightboxPanel } from '../providers/ImageDocumentLinkProvider';
import type { DiagramBlock } from './types';

/**
 * 单例 Webview 渲染器（后台用）：
 * - mermaid → SVG 字符串，写入缓存文件。
 * - 「查看图」由 [ImageLightboxPanel] 接管（复用图片预览的缩放/拖拽 UX）。
 *
 * Webview 仅作渲染管线，不再承担 viewer 角色，UI 极简。
 */
export class DiagramRenderer implements vscode.Disposable {
    private static _instance: DiagramRenderer | undefined;

    static init(context: vscode.ExtensionContext): DiagramRenderer {
        if (!DiagramRenderer._instance) {
            DiagramRenderer._instance = new DiagramRenderer(context);
        }
        return DiagramRenderer._instance;
    }

    static get(): DiagramRenderer {
        if (!DiagramRenderer._instance) {
            throw new Error('DiagramRenderer not initialized');
        }
        return DiagramRenderer._instance;
    }

    private panel: vscode.WebviewPanel | undefined;
    private ready = false;
    private readyWaiters: Array<() => void> = [];
    private pendingRenders = new Map<string, { resolve: (svg: string) => void; reject: (err: Error) => void }>();
    private cache: DiagramCache;
    private warmQueue = new Set<string>();
    /** 渲染空闲后自动关闭 panel 的定时器（让 panel 别一直占着列） */
    private idleTimer: NodeJS.Timeout | undefined;
    /** 自上次渲染请求起多久关掉 panel */
    private static readonly IDLE_DISPOSE_MS = 8000;

    private constructor(private context: vscode.ExtensionContext) {
        this.cache = new DiagramCache(context.globalStorageUri);
    }

    /** 同步查询内存缓存：hover 路径用，避免磁盘 IO */
    peekCache(hash: string): string | undefined {
        const v = this.cache.peek(hash);
        // normalizeSvg 幂等，对老缓存（未规范化）也能修复
        return v ? normalizeSvg(v) : undefined;
    }

    /** 异步查询：磁盘 fallback */
    async getCached(hash: string): Promise<string | undefined> {
        const v = await this.cache.get(hash);
        return v ? normalizeSvg(v) : undefined;
    }

    /** 后台预热：批量发起渲染，已缓存的跳过 */
    async warmCache(blocks: DiagramBlock[]): Promise<void> {
        const targets = blocks.filter(b => b.type === 'mermaid' && !this.warmQueue.has(b.hash));
        if (targets.length === 0) { return; }

        for (const b of targets) {
            this.warmQueue.add(b.hash);
            // 已缓存就不再渲染
            const cached = await this.cache.get(b.hash);
            if (cached !== undefined) { continue; }
            // 失败不抛，让其他块继续
            this.renderMermaid(b.source, b.hash).catch(err => {
                console.warn('[diagramPreview] warm render failed:', err);
            });
        }
    }

    /**
     * 渲染 mermaid，返回 SVG 文本。命中缓存直接返回；否则懒拉起 webview。
     */
    async renderMermaid(source: string, hash: string): Promise<string> {
        const cached = await this.cache.get(hash);
        if (cached !== undefined) { return cached; }

        await this.ensurePanel();
        await this.waitReady();
        this.bumpIdleTimer();

        const rawSvg = await new Promise<string>((resolve, reject) => {
            this.pendingRenders.set(hash, { resolve, reject });
            this.panel!.webview.postMessage({
                type: 'render',
                id: hash,
                diagramType: 'mermaid',
                source,
                theme: getMermaidTheme(),
            });
            // 软超时，避免永久挂起
            setTimeout(() => {
                if (this.pendingRenders.has(hash)) {
                    this.pendingRenders.delete(hash);
                    reject(new Error('render timeout'));
                }
            }, 15000);
        });

        // 入缓存前规范化 SVG（写入显式像素尺寸），让消费侧（hover img / viewer 内嵌）尺寸行为一致
        const svg = normalizeSvg(rawSvg);
        await this.cache.set(hash, svg);
        this.bumpIdleTimer();
        return svg;
    }

    /** 推迟 panel 自动关闭：每次渲染请求都重置计时器，最后一次后空闲 N 秒关闭 */
    private bumpIdleTimer(): void {
        if (this.idleTimer) { clearTimeout(this.idleTimer); }
        this.idleTimer = setTimeout(() => {
            // 仍有未完成的渲染就别关
            if (this.pendingRenders.size > 0) { this.bumpIdleTimer(); return; }
            this.panel?.dispose();
        }, DiagramRenderer.IDLE_DISPOSE_MS);
    }

    /**
     * 「查看图」入口：mermaid → 渲染落盘 → 复用 ImageLightboxPanel；math → 暂显示源码（Phase 2 接渲染）。
     */
    async showInPanel(block: DiagramBlock): Promise<void> {
        if (block.type === 'mermaid') {
            try {
                await this.renderMermaid(block.source, block.hash);
            } catch (err) {
                void vscode.window.showErrorMessage(`渲染 mermaid 失败：${(err as Error).message}`);
                return;
            }
            const svgPath = this.cache.fsPath(block.hash);
            ImageLightboxPanel.open(svgPath, { allowUpscale: 4 });
            return;
        }

        // math：Phase 1 不渲染，open 行为退化为复制源码 + 提示
        const action = await vscode.window.showInformationMessage(
            'Math 公式渲染将在 Phase 2 启用，当前仅支持复制源码。',
            '复制源码',
        );
        if (action === '复制源码') {
            await vscode.env.clipboard.writeText(block.source);
        }
    }

    private async ensurePanel(): Promise<void> {
        if (this.panel) { return; }

        const panel = vscode.window.createWebviewPanel(
            'issueManager.diagramRenderer',
            'Diagram Renderer',
            { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview')],
            },
        );
        this.panel = panel;
        this.ready = false;
        panel.webview.html = this.buildHtml(panel.webview);

        panel.webview.onDidReceiveMessage((msg: { type: string; id?: string; svg?: string; message?: string }) => {
            if (msg.type === 'ready') {
                this.ready = true;
                const waiters = this.readyWaiters.splice(0);
                waiters.forEach(fn => fn());
                return;
            }
            if (msg.type === 'rendered' && msg.id && typeof msg.svg === 'string') {
                const waiter = this.pendingRenders.get(msg.id);
                if (waiter) {
                    this.pendingRenders.delete(msg.id);
                    waiter.resolve(msg.svg);
                }
                return;
            }
            if (msg.type === 'render-error' && msg.id) {
                const waiter = this.pendingRenders.get(msg.id);
                if (waiter) {
                    this.pendingRenders.delete(msg.id);
                    waiter.reject(new Error(msg.message ?? 'render error'));
                }
                return;
            }
        });

        panel.onDidDispose(() => {
            this.panel = undefined;
            this.ready = false;
            if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = undefined; }
            // 进行中的渲染：reject 让上层降级
            this.pendingRenders.forEach(w => w.reject(new Error('renderer closed')));
            this.pendingRenders.clear();
            this.readyWaiters.splice(0).forEach(fn => fn());
        });
    }

    private waitReady(): Promise<void> {
        if (this.ready) { return Promise.resolve(); }
        return new Promise(resolve => this.readyWaiters.push(resolve));
    }

    private buildHtml(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'diagram-renderer.js'),
        );
        const nonce = makeNonce();
        const csp = `default-src 'none'; img-src ${webview.cspSource} data: blob:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource}; font-src ${webview.cspSource} data:;`;
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
html, body { margin:0; padding:0; width:100%; height:100%; font-family: var(--vscode-font-family, sans-serif); color: var(--vscode-descriptionForeground); background: var(--vscode-editor-background); display:flex; align-items:center; justify-content:center; }
#hint { font-size: 12px; padding: 16px; text-align:center; line-height:1.6; max-width: 480px; }
.kbd { background: var(--vscode-keybindingLabel-background, rgba(128,128,128,.2)); padding: 1px 6px; border-radius: 3px; font-family: var(--vscode-editor-font-family); font-size: 11px; }
/* 隐藏 mermaid 渲染时的临时 DOM（mermaid 会把测量元素挂到 body 末尾） */
body > svg, body > div:not(#hint) { position: absolute !important; left: -99999px !important; top: 0 !important; visibility: hidden; pointer-events: none; }
</style>
</head>
<body>
<div id="hint">
  <strong>Diagram Renderer</strong><br>
  此面板仅用于后台渲染 mermaid → SVG，可关闭。<br>
  在编辑器中点击「查看图」会在右侧 <span class="kbd">Image Lightbox</span> 显示渲染结果（支持滚轮缩放/拖拽）。
</div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }

    dispose(): void {
        this.panel?.dispose();
        this.panel = undefined;
        DiagramRenderer._instance = undefined;
    }
}

function makeNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let s = '';
    for (let i = 0; i < 32; i++) { s += chars.charAt(Math.floor(Math.random() * chars.length)); }
    return s;
}

function getMermaidTheme(): 'default' | 'dark' {
    const cfg = vscode.workspace.getConfiguration('issueManager.diagramPreview');
    const setting = cfg.get<string>('theme', 'auto');
    if (setting === 'dark') { return 'dark'; }
    if (setting === 'light') { return 'default'; }
    const kind = vscode.window.activeColorTheme.kind;
    return (kind === vscode.ColorThemeKind.Dark || kind === vscode.ColorThemeKind.HighContrast)
        ? 'dark'
        : 'default';
}
