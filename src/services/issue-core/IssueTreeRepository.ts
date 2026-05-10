import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { Storage } from "./Storage";

/**
 * 持久化到磁盘的节点结构(tree.json 中的格式)。
 *
 * 与 [`PersistedIssueNode`](../../data/issueTreeManager.ts) 等价,
 * 但不带 vscode 运行时属性(`resourceUri`、`parent`),让 service 层与 MCP server 都能用。
 */
export interface PersistedIssueNode {
    id: string;
    /** 相对 issueDir 的文件路径(通常就是 fileName) */
    filePath: string;
    expanded?: boolean;
    children: PersistedIssueNode[];
}

export interface PersistedTreeData {
    version: string;
    lastModified: string;
    rootNodes: PersistedIssueNode[];
}

const DEFAULT_TREE: PersistedTreeData = {
    version: "1.0.0",
    lastModified: "1970-01-01T00:00:00.000Z",
    rootNodes: [],
};

/**
 * tree.json 的读写 + 节点增删改查。
 *
 * 与扩展端的 [issueTreeManager.ts](../../data/issueTreeManager.ts) 不同:
 * - 不带进程内 mtime 缓存(每次读盘)
 * - 不发事件(扩展端的 TreeView 由 adapter 层负责)
 * - 无 `resourceUri` / `parent` 运行时属性
 */
export class IssueTreeRepository {
    constructor(
        private readonly storage: Storage,
        private readonly issueDir: string,
    ) {}

    private treePath(): string {
        return path.join(this.issueDir, ".issueManager", "tree.json");
    }

    /** 读取 tree.json,文件不存在或损坏时返回默认空结构。 */
    async read(): Promise<PersistedTreeData> {
        const p = this.treePath();
        if (!(await this.storage.exists(p))) {
            return { ...DEFAULT_TREE, rootNodes: [] };
        }
        try {
            const content = await this.storage.readText(p);
            const data = JSON.parse(content) as PersistedTreeData;
            return {
                version: data.version ?? "1.0.0",
                lastModified: data.lastModified ?? new Date().toISOString(),
                rootNodes: Array.isArray(data.rootNodes) ? data.rootNodes : [],
            };
        } catch (err) {
            console.warn("[issue-core] tree.json 解析失败,返回默认空结构", err);
            return { ...DEFAULT_TREE, rootNodes: [] };
        }
    }

    /** 写入 tree.json。会自动更新 lastModified 字段。 */
    async write(data: PersistedTreeData): Promise<void> {
        const out: PersistedTreeData = {
            ...data,
            lastModified: new Date().toISOString(),
        };
        await this.storage.ensureDir(path.dirname(this.treePath()));
        await this.storage.writeText(this.treePath(), JSON.stringify(out, null, 2));
    }

    /**
     * 为给定 filePath 列表创建新节点,并加入到 parentId 之下(parentId 不传则加到根)。
     * 返回创建的节点列表。
     */
    async createNodes(
        filePaths: string[],
        parentId?: string,
    ): Promise<PersistedIssueNode[]> {
        const tree = await this.read();
        const newNodes: PersistedIssueNode[] = filePaths.map(fp => ({
            id: randomUUID(),
            filePath: fp,
            expanded: true,
            children: [],
        }));

        if (parentId === undefined) {
            tree.rootNodes.unshift(...newNodes);
        } else {
            const found = findNodeById(tree.rootNodes, parentId);
            if (found) {
                found.node.children.unshift(...newNodes);
            } else {
                tree.rootNodes.unshift(...newNodes);
            }
        }
        await this.write(tree);
        return newNodes;
    }

    /**
     * 移动节点到新父节点的指定位置。
     * - `targetParentId` 为 null 表示移到根
     * - `targetIndex` 是新父节点 children 中的插入位置
     */
    async moveNode(
        sourceId: string,
        targetParentId: string | null,
        targetIndex: number,
    ): Promise<boolean> {
        const tree = await this.read();
        const ok = moveNode(tree, sourceId, targetParentId, targetIndex);
        if (ok) {
            await this.write(tree);
        }
        return ok;
    }

    /**
     * 删除节点。返回被删除的所有 filePath(包含后代,用于 caller 决定要不要也删除文件)。
     */
    async removeNode(nodeId: string): Promise<{ removedFilePaths: string[] }> {
        const tree = await this.read();
        const found = findNodeById(tree.rootNodes, nodeId);
        if (!found) {
            return { removedFilePaths: [] };
        }
        const removedFilePaths: string[] = [];
        walkTree([found.node], n => removedFilePaths.push(n.filePath));
        const idx = found.parentList.findIndex(n => n.id === nodeId);
        if (idx > -1) {
            found.parentList.splice(idx, 1);
            await this.write(tree);
        }
        return { removedFilePaths };
    }

    /**
     * 查询某个 filePath 在树中的关系:返回该 file 在树中所有出现位置的 ancestors / parent / siblings / children 信息。
     * 一个文件可能对应多个节点(树中可重复链接),所以返回数组。
     */
    async getRelations(filePath: string): Promise<Array<{
        nodeId: string;
        ancestors: PersistedIssueNode[];
        parent: PersistedIssueNode | null;
        siblings: PersistedIssueNode[];
        children: PersistedIssueNode[];
    }>> {
        const tree = await this.read();
        const out: Array<{
            nodeId: string;
            ancestors: PersistedIssueNode[];
            parent: PersistedIssueNode | null;
            siblings: PersistedIssueNode[];
            children: PersistedIssueNode[];
        }> = [];

        const visit = (
            nodes: PersistedIssueNode[],
            parents: PersistedIssueNode[],
            parentList: PersistedIssueNode[],
        ) => {
            for (const n of nodes) {
                if (n.filePath === filePath) {
                    out.push({
                        nodeId: n.id,
                        ancestors: [...parents],
                        parent: parents.length > 0 ? parents[parents.length - 1] : null,
                        siblings: parentList.filter(s => s.id !== n.id),
                        children: n.children.slice(),
                    });
                }
                if (n.children && n.children.length > 0) {
                    visit(n.children, [...parents, n], n.children);
                }
            }
        };

        visit(tree.rootNodes, [], tree.rootNodes);
        return out;
    }
}

// ─── 纯辅助函数(与 IssueTreeRepository 解耦,可单独使用) ────────────────────

/**
 * 遍历树,对每个节点执行回调。
 * 不修改 node(不再注入 `parent` 运行时属性)。
 */
export function walkTree(
    nodes: PersistedIssueNode[],
    callback: (node: PersistedIssueNode, ancestors: PersistedIssueNode[]) => void,
    ancestors: PersistedIssueNode[] = [],
): void {
    for (const node of nodes) {
        callback(node, ancestors);
        if (node.children) {
            walkTree(node.children, callback, [...ancestors, node]);
        }
    }
}

/** 在树中按 id 查找节点。 */
export function findNodeById(
    nodes: PersistedIssueNode[],
    id: string,
): { node: PersistedIssueNode; parentList: PersistedIssueNode[] } | null {
    for (const node of nodes) {
        if (node.id === id) {
            return { node, parentList: nodes };
        }
        if (node.children && node.children.length > 0) {
            const found = findNodeById(node.children, id);
            if (found) {
                return found;
            }
        }
    }
    return null;
}

/** 直接返回节点引用(找不到返回 null)。 */
export function getTreeNodeById(
    tree: PersistedTreeData,
    nodeId: string,
): PersistedIssueNode | null {
    const r = findNodeById(tree.rootNodes, nodeId);
    return r ? r.node : null;
}

/** 从树中移除节点(就地修改)。返回被移除节点。 */
export function removeNodeInPlace(
    tree: PersistedTreeData,
    nodeId: string,
): { removedNode: PersistedIssueNode | null; success: boolean } {
    const found = findNodeById(tree.rootNodes, nodeId);
    if (!found) { return { removedNode: null, success: false }; }
    const idx = found.parentList.findIndex(n => n.id === nodeId);
    if (idx > -1) {
        found.parentList.splice(idx, 1);
        return { removedNode: found.node, success: true };
    }
    return { removedNode: null, success: false };
}

/** 移动节点(就地修改)。 */
export function moveNode(
    tree: PersistedTreeData,
    sourceId: string,
    targetParentId: string | null,
    targetIndex: number,
): boolean {
    const { removedNode } = removeNodeInPlace(tree, sourceId);
    if (!removedNode) { return false; }
    if (targetParentId === null) {
        tree.rootNodes.splice(targetIndex, 0, removedNode);
        return true;
    }
    const found = findNodeById(tree.rootNodes, targetParentId);
    if (found) {
        found.node.children.splice(targetIndex, 0, removedNode);
    } else {
        tree.rootNodes.push(removedNode);
    }
    return true;
}

/** 检查 potentialAncestorId 是否是 nodeId 的祖先。 */
export function isAncestor(
    tree: PersistedTreeData,
    potentialAncestorId: string,
    nodeId: string,
): boolean {
    const start = findNodeById(tree.rootNodes, potentialAncestorId);
    if (!start) { return false; }
    let found = false;
    walkTree(start.node.children, n => {
        if (n.id === nodeId) { found = true; }
    });
    return found;
}

/** 返回从根到给定节点的祖先链(不包含节点自身)。 */
export function getAncestors(
    tree: PersistedTreeData,
    nodeId: string,
): PersistedIssueNode[] {
    const ancestors: PersistedIssueNode[] = [];
    const findPath = (
        nodes: PersistedIssueNode[],
        currentPath: PersistedIssueNode[],
    ): boolean => {
        for (const node of nodes) {
            const next = [...currentPath, node];
            if (node.id === nodeId) {
                ancestors.push(...next.slice(0, -1));
                return true;
            }
            if (node.children && findPath(node.children, next)) {
                return true;
            }
        }
        return false;
    };
    findPath(tree.rootNodes, []);
    return ancestors;
}
