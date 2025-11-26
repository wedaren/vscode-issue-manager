/**
 * 共享的 Webview 消息和数据类型定义
 * 当前仅包含 MindMap 面板使用的类型，后续可以在此基础上扩展。
 */

/**
 * 思维导图数据节点接口
 */
export interface MindMapNode {
  id: string;
  title: string;
  filePath?: string;
  children?: MindMapNode[];
  hasError?: boolean;
  errorMessage?: string;
}

/**
 * 扩展端发送给 Webview（前端）的消息
 */
export type MindMapToWebviewMessage =
  | {
      type: 'updateData';
      data: MindMapNode;
    };

/**
 * Webview（前端）发送给扩展端的消息
 */
export type MindMapFromWebviewMessage =
  | {
      type: 'ready';
    }
  | {
      type: 'openFile';
      filePath: string;
    }
  | {
      type: 'export';
      dataUrl: string;
      format: 'png' | 'svg';
    }
  | {
      type: 'error';
      message: string;
    };


