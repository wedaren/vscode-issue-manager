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
    console.log('[G6] 开始初始化图表...');
    const container = document.getElementById('container');
    if (!container) {
        console.error('[G6] Container not found');
        return;
    }

    container.innerHTML = '';
    const bodyClass = document.body.className;
    currentTheme = bodyClass.includes('vscode-light') ? 'light' : 'dark';
    console.log('[G6] 当前主题:', currentTheme);

    try {
        // G6 v5 配置
        graph = new Graph({
            container: 'container',
            width: container.clientWidth,
            height: container.clientHeight,
            autoFit: 'view',
            data: { nodes: [], edges: [] },
            node: {
                style: {
                    size: 40,
                    fill: currentTheme === 'light' ? '#5B8FF9' : '#69c0ff',
                    stroke: currentTheme === 'light' ? '#999999' : '#666666',
                    lineWidth: 2,
                    labelText: (d: any) => d.label || d.id,
                    labelFill: currentTheme === 'light' ? '#000000' : '#ffffff',
                    labelFontSize: 12,
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
                linkDistance: 150,
            },
            behaviors: ['drag-canvas', 'zoom-canvas', 'drag-element'],
        });

        console.log('[G6] 图表实例创建成功');

        // 监听节点点击
        graph.on('node:click', (evt: any) => {
            console.log('[G6] 节点点击:', evt.itemId);
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
                console.error('[G6] 处理节点点击失败:', error);
            }
        });

        graph.render();
        console.log('[G6] 图表渲染完成');

        vscode.postMessage({ type: 'READY' });
        console.log('[G6] 已发送 READY 消息');
    } catch (error) {
        console.error('[G6] 初始化失败:', error);
        vscode.postMessage({
            type: 'ERROR',
            payload: { message: `初始化失败: ${error}` }
        });
    }
}

/**
 * 更新图数据
 */
function updateGraphData(data: any) {
    console.log('[G6] 收到数据更新请求:', data);
    if (!graph) {
        console.error('[G6] Graph not initialized');
        return;
    }

    try {
        console.log('[G6] 节点数量:', data.nodes?.length || 0);
        console.log('[G6] 边数量:', data.edges?.length || 0);

        graph.setData(data);
        graph.render();
        graph.fitView();

        console.log('[G6] 数据更新成功');
    } catch (error) {
        console.error('[G6] 更新图数据失败:', error);
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
