import * as vscode from 'vscode';
import { perfMetrics } from '../services/PerfMetrics';
import { appendPerfLog, readPerfLog } from '../commands/perfCommands';
import { getNonce } from './webviewUtils';

/**
 * 性能指标面板（命令触发的 WebviewPanel，单例）。
 *
 * - 「当前快照」区：计数器 + 耗时表格，页面可见时每 2 秒向扩展请求最新快照自动刷新
 * - 「历史趋势」区：读取 perf-log.jsonl 最近 50 条，关键指标渲染为表格并高亮各列最大值
 * - 消息协议：webview 发送 { type: 'refresh' | 'reset' | 'export' }，
 *   扩展端回复 { type: 'snapshot', payload } / { type: 'history', payload }
 */
export class PerfMetricsPanel {
    private static currentPanel: PerfMetricsPanel | undefined;

    private readonly panel: vscode.WebviewPanel;
    private disposables: vscode.Disposable[] = [];

    /** 打开面板；已存在则直接 reveal */
    public static show(context: vscode.ExtensionContext): void {
        if (PerfMetricsPanel.currentPanel) {
            PerfMetricsPanel.currentPanel.panel.reveal();
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            'issueManager.perfMetrics',
            '性能指标',
            vscode.ViewColumn.One,
            { enableScripts: true }
        );
        PerfMetricsPanel.currentPanel = new PerfMetricsPanel(panel, context.extensionUri);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this.panel = panel;
        this.panel.webview.html = this.buildHtml();

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        this.panel.webview.onDidReceiveMessage(async (msg: { type?: string }) => {
            switch (msg?.type) {
                case 'refresh':
                    this.postSnapshot();
                    break;
                case 'reset':
                    perfMetrics.reset();
                    this.postSnapshot();
                    break;
                case 'export':
                    // 导出即追加一条 jsonl 记录并刷新历史区
                    try {
                        await appendPerfLog(perfMetrics.snapshot());
                    } catch (err) {
                        console.error('导出性能指标失败:', err);
                    }
                    this.postSnapshot();
                    await this.postHistory();
                    break;
            }
        }, null, this.disposables);

        // 初始数据
        this.postSnapshot();
        void this.postHistory();
    }

    private postSnapshot(): void {
        void this.panel.webview.postMessage({ type: 'snapshot', payload: perfMetrics.snapshot() });
    }

    private async postHistory(): Promise<void> {
        const history = await readPerfLog(50);
        void this.panel.webview.postMessage({ type: 'history', payload: history });
    }

    /** 面板关闭时清理单例引用与订阅（自动刷新定时器位于 webview 侧，随页面销毁自动清理） */
    public dispose(): void {
        PerfMetricsPanel.currentPanel = undefined;
        this.panel.dispose();
        while (this.disposables.length) {
            const d = this.disposables.pop();
            if (d) {
                d.dispose();
            }
        }
    }

    private buildHtml(): string {
        const nonce = getNonce();
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<title>性能指标</title>
<style nonce="${nonce}">
    body { font-family: var(--vscode-font-family); padding: 0 16px 16px; color: var(--vscode-foreground); }
    h2 { margin-top: 20px; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 4px; }
    table { border-collapse: collapse; margin: 8px 0 16px; min-width: 480px; }
    th, td { border: 1px solid var(--vscode-panel-border); padding: 4px 10px; text-align: left; font-size: 12px; }
    th { background: var(--vscode-editor-background); }
    td.num { text-align: right; font-variant-numeric: tabular-nums; }
    td.max { background: var(--vscode-editor-findMatchHighlightBackground); font-weight: bold; }
    .toolbar { margin: 12px 0; display: flex; gap: 8px; }
    button {
        background: var(--vscode-button-background); color: var(--vscode-button-foreground);
        border: none; padding: 4px 12px; cursor: pointer; border-radius: 2px;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    .meta { color: var(--vscode-descriptionForeground); font-size: 12px; margin: 4px 0; }
    .empty { color: var(--vscode-descriptionForeground); font-style: italic; }
</style>
</head>
<body>
<h1>性能指标</h1>
<div class="toolbar">
    <button id="btn-refresh">立即刷新</button>
    <button id="btn-reset">重置计数</button>
    <button id="btn-export">导出报告到日志</button>
</div>

<h2>当前快照</h2>
<div class="meta" id="snapshot-meta">加载中…</div>
<h3>计数器</h3>
<div id="counters"></div>
<h3>耗时</h3>
<div id="timings"></div>

<h2>历史趋势（最近 50 条 perf-log 记录）</h2>
<div class="meta">列 = cache.*.diskRead 计数、view.*.getTreeItem 平均耗时、heapUsed 内存；各列最大值已高亮。</div>
<div id="history"></div>

<script nonce="${nonce}">
(function () {
    const vscode = acquireVsCodeApi();

    function el(tag, text, className) {
        const e = document.createElement(tag);
        if (text !== undefined) { e.textContent = text; }
        if (className) { e.className = className; }
        return e;
    }

    function renderTable(container, headers, rows, colMax) {
        container.textContent = '';
        if (rows.length === 0) {
            container.appendChild(el('div', '暂无数据', 'empty'));
            return;
        }
        const table = el('table');
        const thead = el('thead');
        const hr = el('tr');
        for (const h of headers) { hr.appendChild(el('th', h)); }
        thead.appendChild(hr);
        table.appendChild(thead);
        const tbody = el('tbody');
        for (const row of rows) {
            const tr = el('tr');
            row.forEach(function (cell, idx) {
                let cls = idx > 0 ? 'num' : '';
                // 数值列中等于列最大值（且为正）的单元格高亮
                if (idx > 0 && colMax && colMax[idx] > 0 && cell === colMax[idx]) {
                    cls += ' max';
                }
                tr.appendChild(el('td', String(cell), cls || undefined));
            });
            tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        container.appendChild(table);
    }

    function renderSnapshot(snap) {
        const meta = document.getElementById('snapshot-meta');
        meta.textContent = '时间：' + new Date(snap.timestamp).toLocaleString()
            + '　内存：RSS ' + snap.memoryMB.rss + ' MB / HeapUsed ' + snap.memoryMB.heapUsed + ' MB';

        const counterRows = Object.keys(snap.counters).sort().map(function (name) {
            return [name, snap.counters[name]];
        });
        renderTable(document.getElementById('counters'), ['指标', '次数'], counterRows);

        const timingRows = Object.keys(snap.timings).sort().map(function (name) {
            const t = snap.timings[name];
            return [name, t.count, t.avgMs, t.maxMs, t.lastMs];
        });
        renderTable(document.getElementById('timings'), ['指标', '次数', '平均(ms)', '最大(ms)', '最近(ms)'], timingRows);
    }

    function renderHistory(records) {
        const container = document.getElementById('history');
        if (!records || records.length === 0) {
            container.textContent = '';
            container.appendChild(el('div', '暂无历史记录（点击「导出报告到日志」或执行「性能指标：输出报告」命令生成）', 'empty'));
            return;
        }
        // 动态收集关键指标列：cache.*.diskRead、view.*.getTreeItem、heapUsed
        const diskReadKeys = new Set();
        const getTreeItemKeys = new Set();
        for (const r of records) {
            for (const k of Object.keys(r.counters || {})) {
                if (/^cache\\..*\\.diskRead$/.test(k)) { diskReadKeys.add(k); }
            }
            for (const k of Object.keys(r.timings || {})) {
                if (/^view\\..*\\.getTreeItem$/.test(k)) { getTreeItemKeys.add(k); }
            }
        }
        const cols = [...diskReadKeys].sort().concat([...getTreeItemKeys].sort());
        const headers = ['时间'].concat(cols.map(function (c) { return c; })).concat(['heapUsed (MB)']);

        const rows = [];
        const colMax = new Array(headers.length).fill(-Infinity);
        for (const r of records) {
            const row = [new Date(r.timestamp).toLocaleString()];
            cols.forEach(function (c, i) {
                let v;
                if (diskReadKeys.has(c)) { v = (r.counters && r.counters[c]) || 0; }
                else { v = (r.timings && r.timings[c]) ? r.timings[c].avgMs : 0; }
                row.push(v);
                if (v > colMax[i + 1]) { colMax[i + 1] = v; }
            });
            const heap = r.memoryMB ? r.memoryMB.heapUsed : 0;
            row.push(heap);
            if (heap > colMax[headers.length - 1]) { colMax[headers.length - 1] = heap; }
            rows.push(row);
        }
        // 各列最大值（仅当最大值为正时才高亮对应单元格）
        renderTable(container, headers, rows, colMax);
    }

    window.addEventListener('message', function (event) {
        const msg = event.data;
        if (msg.type === 'snapshot') { renderSnapshot(msg.payload); }
        if (msg.type === 'history') { renderHistory(msg.payload); }
    });

    document.getElementById('btn-refresh').addEventListener('click', function () {
        vscode.postMessage({ type: 'refresh' });
    });
    document.getElementById('btn-reset').addEventListener('click', function () {
        vscode.postMessage({ type: 'reset' });
    });
    document.getElementById('btn-export').addEventListener('click', function () {
        vscode.postMessage({ type: 'export' });
    });

    // 页面可见时每 2 秒自动请求最新快照
    setInterval(function () {
        if (!document.hidden) {
            vscode.postMessage({ type: 'refresh' });
        }
    }, 2000);
})();
</script>
</body>
</html>`;
    }
}
