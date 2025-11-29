import { Graph } from '@antv/g6';

// VS Code API
declare const acquireVsCodeApi: any;
const vscode = acquireVsCodeApi();

let graph: Graph | null = null;
let currentTheme: 'light' | 'dark' = 'dark';

/**
 * 初始化 G6 v5 图表
 */
function initGraph() {
    const container = document.getElementById('container');
    if (!container) {
        console.error('Container not found');
        return;
    }

    container.innerHTML = '';
    const bodyClass = document.body.className;
    currentTheme = bodyClass.includes('vscode-light') ? 'light' : 'dark';

    // G6 v5 简化配置
    graph = new Graph({
        container: 'container',
        autoFit: 'view',
        data: { nodes: [], edges: [] },
        node: {
            style: {
                size: 40,
                fill: currentTheme === 'light' ? '#5B8FF9' : '#69c0ff',
                stroke: currentTheme === 'light' ? '#999999' : '#666666',
                lineWidth: 2,
            },
        },
        edge: {
            style: {
                stroke: currentTheme === 'light' ? '#999999' : '#666666',
                lineWidth: 1,
                endArrow: true,
            },
        },
        layout: {
            type: 'd3-force',
            preventOverlap: true,
        },
        behaviors: ['drag-canvas', 'zoom-canvas', 'drag-element'],
    });

    // 监听节点点击
    graph.on('node:click', (evt: any) => {
        try {
            const nodeData = graph!.getNodeData(evt.itemId);
            vscode.postMessage({
                type: 'NODE_CLICKED',
                payload: {
                    nodeId: evt.itemId,
                    filePath: (nodeData as any).filePath || ''
                }
            });
        } catch (error) {
            console.error('Error handling node click:', error);
        }
    });

    graph.render();
    vscode.postMessage({ type: 'READY' });
}

/**
 * 更新图数据
 */
function updateGraphData(data: any) {
    if (!graph) {
        console.error('Graph not initialized');
        return;
    }

    try {
        graph.setData(data);
        graph.render();
        graph.fitView();
    } catch (error) {
        console.error('Error updating graph:', error);
        vscode.postMessage({
            type: 'ERROR',
            payload: { message: String(error) }
        });
    }
}

/**
 * 处理窗口大小变化
 */
function handleResize() {
    if (!graph) {
        return;
    }

    try {
        const container = document.getElementById('container');
        if (container) {
            graph.setSize(container.clientWidth, container.clientHeight);
            graph.fitView();
        }
    } catch (error) {
        console.error('Error handling resize:', error);
    }
}

// 监听消息
window.addEventListener('message', (event: any) => {
    const message = event.data;

    switch (message.type) {
        case 'INIT_GRAPH':
        case 'UPDATE_DATA':
            updateGraphData(message.payload);
            break;
        case 'RESIZE':
            handleResize();
            break;
    }
});

// 监听窗口大小变化
const resizeObserver = new ResizeObserver(() => {
    requestAnimationFrame(handleResize);
});

// 初始化
window.addEventListener('DOMContentLoaded', () => {
    initGraph();

    const container = document.getElementById('container');
    if (container) {
        resizeObserver.observe(container);
    }
});

// 清理
window.addEventListener('beforeunload', () => {
    if (graph) {
        graph.destroy();
    }
    resizeObserver.disconnect();
});
