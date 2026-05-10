// Diagram Renderer Webview（仅后台渲染）
// 接收扩展端的 render 请求 → 调 mermaid → 回传 SVG 字符串。
// 显示与"复制图片"都交给 ImageLightboxPanel（复用图片预览的 UX）。

import mermaid from 'mermaid';

declare const acquireVsCodeApi: () => {
    postMessage(msg: unknown): void;
    setState(state: unknown): void;
    getState(): unknown;
};

const vscode = acquireVsCodeApi();

interface RenderRequest {
    type: 'render';
    id: string;
    diagramType: 'mermaid';
    source: string;
    theme?: 'default' | 'dark';
}

let mermaidInitialized = false;
let mermaidTheme: 'default' | 'dark' = 'default';

function ensureMermaid(theme: 'default' | 'dark'): void {
    if (mermaidInitialized && mermaidTheme === theme) { return; }
    mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme,
        flowchart: { htmlLabels: true },
        fontFamily: 'var(--vscode-font-family, sans-serif)',
    });
    mermaidInitialized = true;
    mermaidTheme = theme;
}

async function renderMermaid(id: string, source: string, theme: 'default' | 'dark'): Promise<string> {
    ensureMermaid(theme);
    const renderId = `mmd-${id}-${Date.now()}`;
    const { svg } = await mermaid.render(renderId, source);
    document.querySelectorAll(`#${CSS.escape(renderId)}, [id^="${renderId}"]`).forEach(el => el.remove());
    return svg;
}

async function handleRender(req: RenderRequest): Promise<void> {
    try {
        const svg = await renderMermaid(req.id, req.source, req.theme ?? 'default');
        vscode.postMessage({ type: 'rendered', id: req.id, svg });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.postMessage({ type: 'render-error', id: req.id, message });
    }
}

window.addEventListener('message', (e: MessageEvent<RenderRequest>) => {
    const msg = e.data;
    if (!msg) { return; }
    if (msg.type === 'render') { void handleRender(msg); return; }
});

vscode.postMessage({ type: 'ready' });
