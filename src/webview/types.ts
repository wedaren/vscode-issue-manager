/**
 * Webview 消息通信协议类型定义
 * 用于扩展宿主和 Webview 之间的类型安全通信
 */

// G6 图数据结构
export interface G6Node {
    id: string;
    label: string;
    filePath: string;
    type?: string;
}

export interface G6Edge {
    source: string;
    target: string;
    label?: string;
}

export interface G6GraphData {
    nodes: G6Node[];
    edges: G6Edge[];
}

// 主题配置
export interface ThemeConfig {
    mode: 'light' | 'dark';
    backgroundColor: string;
    nodeColor: string;
    edgeColor: string;
    textColor: string;
}

// 消息协议 - 从扩展宿主发送到 Webview
export type HostToWebviewMessage =
    | { type: 'INIT_GRAPH'; payload: G6GraphData }
    | { type: 'UPDATE_DATA'; payload: G6GraphData }
    | { type: 'THEME_CHANGED'; payload: ThemeConfig }
    | { type: 'RESIZE'; payload: { width: number; height: number } };

// 消息协议 - 从 Webview 发送到扩展宿主
export type WebviewToHostMessage =
    | { type: 'READY' }
    | { type: 'NODE_CLICKED'; payload: { nodeId: string; filePath: string } }
    | { type: 'ERROR'; payload: { message: string } };

// 联合消息类型
export type MessageProtocol = HostToWebviewMessage | WebviewToHostMessage;
