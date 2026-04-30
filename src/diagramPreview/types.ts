import * as vscode from 'vscode';

export type DiagramType = 'mermaid' | 'math';

export interface DiagramBlock {
    /** 块类型 */
    type: DiagramType;
    /** 内部源码（不含 fence 或 $$ 包裹） */
    source: string;
    /** 整块范围，包含 fence/`$$` 行，用于 hover 命中、CodeLens 锚点 */
    fullRange: vscode.Range;
    /** 内容哈希，用作缓存 key（不含 type，避免不同类型同源冲突由调用方加前缀） */
    hash: string;
}
