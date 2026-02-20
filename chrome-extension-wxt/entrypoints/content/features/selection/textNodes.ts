export interface TextNodeInfo {
    id: number;
    node: Text;
    original: string;
}

const activeTextNodesMap = new Map<string, TextNodeInfo[]>();

/**
 * 遍历 DOM 树，提取出所有非空的实质性文本节点，并储存到全局映射中
 * @param root 选定的根 DOM
 * @param blockId 关联的翻译任 ID
 * @returns 发送给大模型进行端到端翻译的高密度 XML 字符串
 */
export function extractAndStoreTextNodes(root: HTMLElement, blockId: string): string {
    const result: TextNodeInfo[] = [];
    let id = 0;

    function walk(node: Node) {
        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent || '';
            // 只翻译有可见字符的文本
            if (text.trim().length > 0) {
                result.push({ id: id++, node: node as Text, original: text });
            }
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as HTMLElement;
            // 跳过脚本、样式和代码块等不需要翻译的内容
            if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'NOSCRIPT' || el.tagName === 'CODE') {
                return;
            }
            for (let i = 0; i < el.childNodes.length; i++) {
                walk(el.childNodes[i]);
            }
        }
    }

    walk(root);
    activeTextNodesMap.set(blockId, result);

    // 组装 Prompt 专用的 XML 列表
    let promptContent = '';
    result.forEach(item => {
        // 粗略规避尖括号导致的 XML 解析紊乱
        const safeText = item.original.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        promptContent += `<t id="${item.id}">${safeText}</t>\\n`;
    });

    return promptContent;
}

export function getTextNodes(blockId: string): TextNodeInfo[] | undefined {
    return activeTextNodesMap.get(blockId);
}

export function removeTextNodes(blockId: string): void {
    activeTextNodesMap.delete(blockId);
}
