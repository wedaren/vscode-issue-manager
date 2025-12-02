import { Graph } from '@antv/x6';
import { Scroller } from '@antv/x6-plugin-scroller';
import { Keyboard } from '@antv/x6-plugin-keyboard';
import { Selection } from '@antv/x6-plugin-selection';
import Hierarchy from '@antv/hierarchy';

// VS Code API
declare const acquireVsCodeApi: any;
const vscode = acquireVsCodeApi();

// 全局错误处理
window.onerror = function(message, source, lineno, colno, error) {
    console.error('[Webview Error]', message, source, lineno, colno, error);
    vscode.postMessage({
        type: 'ERROR',
        payload: {
            message: `[Webview Error] ${message} (${source}:${lineno}:${colno})`
        }
    });
};

let graph: Graph | null = null;

// 全局数据
let rawData: any = null;

// 初始化图表
function initGraph() {
    try {
        console.log('[X6] 开始初始化思维导图...');
        const container = document.getElementById('container');
        if (!container) {
            throw new Error('Container not found');
        }

        // 注册自定义事件
        Graph.registerNodeTool('collapse-expand', {
            inherit: 'button',
            markup: [
                {
                    tagName: 'circle',
                    selector: 'button',
                    attrs: {
                        r: 6,
                        fill: 'var(--vscode-editor-background)',
                        stroke: 'var(--vscode-textLink-foreground)',
                        cursor: 'pointer',
                    },
                },
                {
                    tagName: 'path',
                    selector: 'icon',
                    attrs: {
                        fill: 'none',
                        stroke: 'var(--vscode-editor-foreground)',
                        'stroke-width': 1,
                        pointerEvents: 'none',
                    },
                },
            ],
            onClick({ cell }: { cell: any }) {
                const data = cell.getData();
                toggleNodeCollapse(data.id);
            },
        });

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

        // 绑定工具栏按钮事件
        const bindToolbarEvents = () => {
            const zoomInBtn = document.getElementById('zoom-in');
            const zoomOutBtn = document.getElementById('zoom-out');
            const fitViewBtn = document.getElementById('fit-view');
            const centerContentBtn = document.getElementById('center-content');

            if (zoomInBtn) {
                zoomInBtn.addEventListener('click', () => {
                    graph?.zoom(0.1);
                });
            }

            if (zoomOutBtn) {
                zoomOutBtn.addEventListener('click', () => {
                    graph?.zoom(-0.1);
                });
            }

            if (fitViewBtn) {
                fitViewBtn.addEventListener('click', () => {
                    graph?.zoomToFit({ padding: 20 });
                });
            }

            if (centerContentBtn) {
                centerContentBtn.addEventListener('click', () => {
                    graph?.centerContent();
                });
            }
        };
        bindToolbarEvents();

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
    } catch (error) {
        console.error('[X6] 初始化失败:', error);
        vscode.postMessage({
            type: 'ERROR',
            payload: {
                message: `X6 初始化失败: ${error}`
            }
        });
    }
}

// 切换节点折叠状态
function toggleNodeCollapse(nodeId: string) {
    if (!rawData) return;

    const findAndToggle = (node: any) => {
        if (node.id === nodeId) {
            node.collapsed = !node.collapsed;
            return true;
        }
        if (node.children) {
            for (const child of node.children) {
                if (findAndToggle(child)) return true;
            }
        }
        return false;
    };

    if (findAndToggle(rawData)) {
        renderMindMap(rawData);
    }
}

// 查找节点
function findNodeById(root: any, id: string): any {
    if (root.id === id) return root;
    if (root.children) {
        for (const child of root.children) {
            const found = findNodeById(child, id);
            if (found) return found;
        }
    }
    return null;
}

// 获取用于布局的数据（处理折叠）
function getLayoutData(data: any) {
    const traverse = (node: any) => {
        const newNode = { ...node };
        if (node.collapsed) {
            newNode.children = [];
        } else if (node.children) {
            newNode.children = node.children.map(traverse);
        }
        return newNode;
    };
    return traverse(data);
}

// 渲染思维导图
function renderMindMap(data: any) {
    if (!graph) {
        return;
    }
    
    // 更新全局数据
    if (rawData !== data) {
        // 如果是新数据（非折叠操作触发），保留之前的折叠状态？
        // 简单起见，这里假设外部传入的 data 是全量的
        // 如果 data 对象引用变了，说明是初始化或刷新。
        // 如果是内部重绘，我们传入的还是 rawData（但内容可能变了）
        if (!rawData || rawData.id !== data.id) {
            rawData = JSON.parse(JSON.stringify(data)); // 深拷贝一份
        }
    }
    
    // 使用当前 rawData 进行布局计算（因为 toggle 修改的是 rawData）
    // 但这里 renderMindMap 接收的 data 参数可能是来自 init 的
    // 如果是 init，我们已经赋值给了 rawData。
    // 如果是 toggle 调用的 renderMindMap(rawData)，也是对的。
    
    console.log('[X6] 渲染数据:', rawData);
    const layoutData = getLayoutData(rawData);

    // 使用 hierarchy 计算布局
    // @ts-ignore
    const result = Hierarchy.mindmap(layoutData, {
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
        const originalNode = rawData ? findNodeById(rawData, data.id) : null;

        // 创建节点
        const x6Node = graph!.createNode({
            id: data.id,
            x: node.x,
            y: node.y,
            width: data.label.length * 12 + 20,
            height: 30,
            label: data.label,
            data: { label: data.label, id: data.id, collapsed: !!originalNode?.collapsed },
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
        });

        // 添加折叠工具
        if (originalNode && originalNode.children && originalNode.children.length > 0) {
             x6Node.addTools({
                name: 'collapse-expand',
                args: {
                    x: '100%',
                    y: '50%',
                    offset: { x: 10, y: 0 },
                    attrs: {
                        icon: {
                            d: originalNode.collapsed 
                                ? 'M -3 0 3 0 M 0 -3 0 3' // +
                                : 'M -3 0 3 0' // -
                        }
                    }
                },
            });
        }

        cells.push(x6Node);

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
