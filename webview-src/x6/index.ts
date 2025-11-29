import { Graph } from '@antv/x6';
import { Scroller } from '@antv/x6-plugin-scroller';
import { Keyboard } from '@antv/x6-plugin-keyboard';
import { Selection } from '@antv/x6-plugin-selection';
import Hierarchy from '@antv/hierarchy';

// VS Code API
declare const acquireVsCodeApi: any;
const vscode = acquireVsCodeApi();

let graph: Graph | null = null;

// 初始化图表
function initGraph() {
    console.log('[X6] 开始初始化思维导图...');
    const container = document.getElementById('container');
    if (!container) {
        console.error('[X6] Container not found');
        return;
    }

    graph = new Graph({
        container: container,
        background: {
            color: 'var(--vscode-editor-background)',
        },
        connecting: {
            connectionPoint: 'anchor',
        },
        interacting: false, // 默认禁止节点移动
    });

    // 注册插件
    graph.use(
        new Scroller({
            enabled: true,
            pannable: true,
            pageVisible: false,
            pageBreak: false,
        })
    );
    graph.use(new Keyboard());
    graph.use(new Selection());

    // 快捷键
    graph.bindKey(['meta+plus', 'ctrl+plus'], () => {
        const zoom = graph?.zoom();
        if (zoom) {
            graph?.zoom(0.1);
        }
        return false;
    });
    graph.bindKey(['meta+minus', 'ctrl+minus'], () => {
        const zoom = graph?.zoom();
        if (zoom) {
            graph?.zoom(-0.1);
        }
        return false;
    });

    // 事件监听
    graph.on('node:click', ({ node }) => {
        const data = node.getData();
        console.log('[X6] 节点点击:', data);
        vscode.postMessage({
            type: 'NODE_CLICKED',
            payload: {
                nodeId: node.id,
                label: data.label
            }
        });
    });

    console.log('[X6] 初始化完成');
    vscode.postMessage({ type: 'READY' });
}

// 渲染思维导图
function renderMindMap(data: any) {
    if (!graph) {
        return;
    }

    console.log('[X6] 渲染数据:', data);

    // 使用 hierarchy 计算布局
    // @ts-ignore
    const result = Hierarchy.mindmap(data, {
        direction: 'H',
        getHeight: () => 30,
        getWidth: (d: any) => {
            // 简单估算宽度
            return d.label.length * 12 + 20;
        },
        getHGap: () => 40,
        getVGap: () => 10,
        getSide: () => 'right',
    });

    const cells: any[] = [];

    const traverse = (node: any) => {
        if (!node) {
            return;
        }

        const data = node.data;

        // 创建节点
        cells.push(
            graph!.createNode({
                id: data.id,
                x: node.x,
                y: node.y,
                width: data.label.length * 12 + 20,
                height: 30,
                label: data.label,
                data: { label: data.label }, // 存储原始数据
                attrs: {
                    body: {
                        fill: 'var(--vscode-editor-background)',
                        stroke: 'var(--vscode-textLink-foreground)',
                        rx: 4,
                        ry: 4,
                    },
                    label: {
                        fill: 'var(--vscode-editor-foreground)',
                    },
                },
            })
        );

        // 创建边
        if (node.children) {
            node.children.forEach((child: any) => {
                cells.push(
                    graph!.createEdge({
                        source: data.id,
                        target: child.data.id,
                        attrs: {
                            line: {
                                stroke: 'var(--vscode-textLink-foreground)',
                            },
                        },
                    })
                );
                traverse(child);
            });
        }
    };

    traverse(result);

    graph.resetCells(cells);
    graph.centerContent();
}

// 监听消息
window.addEventListener('message', (event) => {
    const message = event.data;
    console.log('[X6] 收到消息:', message.type);

    switch (message.type) {
        case 'INIT_MINDMAP':
            renderMindMap(message.payload);
            break;
    }
});

// 启动
initGraph();
