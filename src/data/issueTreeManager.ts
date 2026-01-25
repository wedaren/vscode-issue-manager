import * as vscode from "vscode";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import { getIssueDir } from "../config";
import { getIssueFilePath, getIssueMarkdown, getIssueMarkdownTitleFromCache, IssueMarkdown } from "./IssueMarkdowns";
import { getCategoryIcon, getIssueCategory } from "./paraManager";

/**
 * 持久化到磁盘的节点结构（tree.json 中的格式）。
 * children 使用同样的持久化类型。
 */
export interface PersistedIssueNode {
    id: string;
    filePath: string;
    expanded?: boolean;
    children: PersistedIssueNode[];
}


/**
 * Issue, 其背后是 IssueMarkdwon ，即 filePath 所指向的文件。
 * 一个 IssueMarkdown 可能对应多个 IssueNode。
 */
export interface IssueNode  extends PersistedIssueNode {
    resourceUri: vscode.Uri; // 运行时属性，不持久化
    parent: IssueNode[]; // 运行时属性，不持久化，祖先链（从根到直接父节点）
    children: IssueNode[]; // 覆盖 PersistedIssueNode 中的 children 类型
}
export interface TreeData {
    version: string;
    lastModified: string;
    rootNodes: IssueNode[];
}

/**
 * 扁平化树节点接口，包含父节点路径和标题
 */
export interface FlatTreeNode extends IssueNode {
    parentPath: FlatTreeNode[];
    title: string;
    resourceUri: vscode.Uri;
    mtime: number;
    ctime: number;
}

/**
 * 遍历树并对每个节点执行回调。
 * @param nodes 节点数组。
 * @param callback 回调函数。
 */
function walkTree(nodes: IssueNode[], callback: (node: IssueNode) => void, parents: IssueNode[] = []) {
    for (const node of nodes) {
        // 在回调前构建并赋值祖先链，callback 可直接读取 node.parent
        node.parent = [...parents];
        callback(node);
        if (node.children) {
            walkTree(node.children, callback, [...parents, node]);
        }
    }
}

/**
 * 获取扁平化的树结构，并自动加载所有节点的标题。
 * 这是一个便捷函数，自动读取树、扁平化并批量加载标题。
 * @returns 扁平化后的节点数组，每个节点包含 title 属性
 */
export async function getFlatTree(): Promise<FlatTreeNode[]> {
    const { treeData } = await getIssueData();

    const result: FlatTreeNode[] = [];

    async function buildFlatNodes(nodes: IssueNode[], parents: FlatTreeNode[]) {
        for (const node of nodes) {
            const issue = await getIssueMarkdown(node.filePath);
            const title = issue ? issue.title : "不合法 issueMarkdown";
            const ctime = issue ? issue.ctime : 0;
            const mtime = issue ? issue.mtime : 0;
            // 创建 FlatTreeNode，parentPath 指向已创建的父节点（即 FlatTreeNode 类型）
            const flatNode: FlatTreeNode = {
                ...node,
                title,
                ctime,
                mtime,
                parentPath: [...parents],
                resourceUri: node.resourceUri,
            };

            result.push(flatNode);

            if (node.children && node.children.length > 0) {
                await buildFlatNodes(node.children, [...parents, flatNode]);
            }
        }
    }
    await buildFlatNodes(treeData.rootNodes, []);
    return result;
}

/**
 * 查找树中所有引用的文件路径。
 * @returns A set of relative file paths.
 */
export async function getAssociatedFiles(): Promise<Set<string>> {
    const { treeData } = await getIssueData();
    const associatedFiles = new Set<string>();
    walkTree(treeData.rootNodes, node => {
        associatedFiles.add(node.filePath);
    });
    return associatedFiles;
}

/**
 * 获取 tree.json 文件的绝对路径。
 * @returns 如果 issueDir 未配置，则返回 null。
 */
const getTreeDataPath = (): string | null => {
    const issueDir = getIssueDir();
    if (!issueDir) {
        return null;
    }
    // 确保 .issueManager 目录存在
    const dataDir = path.join(issueDir, ".issueManager");
    try {
        if (!require("fs").existsSync(dataDir)) {
            require("fs").mkdirSync(dataDir, { recursive: true });
        }
    } catch (e) {
        vscode.window.showErrorMessage("创建 .issueManager 目录失败。");
        return null;
    }
    return path.join(dataDir, "tree.json");
};

const defaultTreeData: TreeData = {
    version: "1.0.0",
    lastModified: new Date().toISOString(),
    rootNodes: [],
};

/**
 * 读取 tree.json 文件。
 * @returns 返回解析后的 TreeData 对象，如果文件不存在或损坏则返回默认结构。
 */
export const readTree = async (): Promise<TreeData> => {
    const { treeData } = await getIssueData();
    return treeData;
};


/**
 * 根据 IssueMarkdown 的 URI 获取对应的 IssueNode 列表。
 */
export const getIssueNodesByUri = async (uri: vscode.Uri): Promise<IssueNode[]> => {
    const issueMarkdown = await getIssueMarkdown(uri);
    if (!issueMarkdown) return [];
    return getIssueNodesBy(issueMarkdown);
};

/**
 * 根据 IssueMarkdown 获取对应的 IssueNode 列表。
 */
const getIssueNodesBy = async (issueMarkdown: IssueMarkdown): Promise<IssueNode[]> => {
    const { issueFilePathsMap } = await getIssueData();
    const filePath = getIssueFilePath(issueMarkdown.uri); //
    if(filePath === null) { return []; }
    return issueFilePathsMap.get(filePath) || [];
};

/**
 * 根据 ID 获取 IssueNode。
 */
export const getIssueNodeById = async (id: string): Promise<IssueNode | undefined> => {
    const { issueIdMap } = await getIssueData();
    return issueIdMap.get(id);
};

export interface IssueDataResult {
    treeData: TreeData;
    issueIdMap: Map<string, IssueNode>;
    issueFilePathsMap: Map<string, IssueNode[]>;
}

export interface IssueDataCache extends IssueDataResult {
    mtime: number;
}

const createDefaultIssueDataStore = (): IssueDataResult => ({
    treeData: { ...defaultTreeData, rootNodes: [] },
    issueIdMap: new Map(),
    issueFilePathsMap: new Map(),
});
const cache: IssueDataCache = { mtime: 0, ...createDefaultIssueDataStore() };

export function getIssueTitleSync(issueOrId: string | IssueNode) {
    // 支持传入 id 或 IssueNode（不再支持 IssueMarkdown）
    if (typeof issueOrId === "string") {
        const realId = stripFocusedId(issueOrId);
        const issueNode = cache.issueIdMap.get(realId);
        return issueNode?.resourceUri
            ? getIssueMarkdownTitleFromCache(issueNode.filePath)
            : "[Unknown Issue: " + realId + "]";
    }

    // IssueNode
    if (isIssueNode(issueOrId)) {
        return getIssueMarkdownTitleFromCache(issueOrId.filePath);
    }

    return "[Unknown Issue]";
}

const onIssueTreeUpdateEmitter = new vscode.EventEmitter<void>();

export const onIssueTreeUpdate = onIssueTreeUpdateEmitter.event;

async function getIssueData(): Promise<IssueDataResult> {
    const treePath = getTreeDataPath();
    const issueDir = getIssueDir();

    if (!treePath || !issueDir) {
        return createDefaultIssueDataStore();
    }

    const stat = await vscode.workspace.fs.stat(vscode.Uri.file(treePath));
    if (cache.mtime === stat.mtime) {
        return cache;
    }

    let treeData: TreeData;
    try {
        const content = await vscode.workspace.fs.readFile(vscode.Uri.file(treePath));
        treeData = JSON.parse(content.toString());
    } catch (error) {
        // 记录错误有助于调试，特别是对于文件损坏或格式错误的情况
        console.error(`Failed to read or parse tree data from ${treePath}:`, error);
        return createDefaultIssueDataStore();
    }
    const issueIdMap = new Map<string, IssueNode>();
    const issueFilePathsMap = new Map<string, IssueNode[]>();
    // 运行时动态添加 resourceUri 并建立 parent 引用（由 walkTree 负责构建祖先链）
    walkTree(treeData.rootNodes, node => {
        // 确保 filePath 存在再创建 Uri
        if (node.filePath) {
            node.resourceUri = vscode.Uri.joinPath(vscode.Uri.file(issueDir), node.filePath);
            getIssueMarkdownTitleFromCache(node.id); // 预加载标题到缓存
            const arr = issueFilePathsMap.get(node.filePath) || [];
            arr.push(node);
            issueFilePathsMap.set(node.filePath, arr);
        }
        issueIdMap.set(node.id, node);
    });

    cache.mtime = stat.mtime;
    cache.treeData = treeData;
    cache.issueIdMap = issueIdMap;
    cache.issueFilePathsMap = issueFilePathsMap;
    onIssueTreeUpdateEmitter.fire();

    return { treeData, issueIdMap, issueFilePathsMap };
}

export async function getIssueTitle(issueOrId: string | IssueNode) {
    // 支持传入 id 或 IssueNode（不再支持 IssueMarkdown）
    if (typeof issueOrId === "string") {
        const realId = stripFocusedId(issueOrId);
        const { issueIdMap } = await getIssueData();
        const issueNode = issueIdMap.get(realId);
        if (issueNode?.resourceUri) {
            const issue = await getIssueMarkdown(issueNode.filePath);
            return issue ? issue.title : "不合法 issueMarkdown";
        } else {
            return "[Unknown Issue: " + realId + "]";
        }
    }

    // IssueNode：直接通过 filePath 读取 IssueMarkdown
    if (isIssueNode(issueOrId)) {
        const issue = await getIssueMarkdown(issueOrId.filePath);
        return issue ? issue.title : "不合法 issueMarkdown";
    }

    return "[Unknown Issue]";
}
/**
 * 将树状数据写入 tree.json 文件。
 * @param data 要写入的 TreeData 对象。
 */
export const writeTree = async (data: TreeData): Promise<void> => {
    const treePath = getTreeDataPath();
    if (!treePath) {
        vscode.window.showErrorMessage("无法写入树状结构，问题目录未配置。");
        return;
    }

    data.lastModified = new Date().toISOString();

    // 使用 replacer 函数在序列化时忽略运行时属性（如 resourceUri、parent）
    const replacer = (key: string, value: unknown) => {
        if (key === "resourceUri" || key === "parent") {
            return undefined; // 忽略此类运行时属性
        }
        return value;
    };

    const content = Buffer.from(JSON.stringify(data, replacer, 2), "utf8");

    try {
        await vscode.workspace.fs.writeFile(vscode.Uri.file(treePath), content);
    } catch (error) {
        vscode.window.showErrorMessage(`写入 tree.json 失败: ${error}`);
    }
};

/**
 * IssueNode 的文件路径类型别名。是相对于 issueDir 的路径。
 */
type IssueFilePath = string;

function _createIssueNode(issueFilePath: IssueFilePath, issueDir: string): IssueNode {
    return {
        id: uuidv4(),
        filePath: issueFilePath,
        children: [],
        expanded: true,
        resourceUri: vscode.Uri.joinPath(vscode.Uri.file(issueDir), issueFilePath),
        parent: [],
    };
}

export async function createIssueNodes(issueFiles: vscode.Uri[], parentId?: string) {
    const issueDir = getIssueDir();
    if (!issueDir) {
        return null;
    } else {
        const newNodes = issueFiles.map(uri => {
            const issueFilePath = path.relative(issueDir, uri.fsPath);
            return _createIssueNode(issueFilePath, issueDir);
        });
        const { treeData } = await getIssueData();
        if (parentId === undefined) {
            treeData.rootNodes.unshift(...newNodes);
        } else {
            const parent = await getIssueNodeById(parentId);
            if (parent) {
                // 为新节点设置 parent 祖先链（复制父节点的祖先链并追加父节点本身）
                for (const n of newNodes) {
                    n.parent = [...(parent.parent || []), parent];
                }
                parent.children.unshift(...newNodes);
            } else {
                treeData.rootNodes.unshift(...newNodes);
            }
        }
        await writeTree(treeData);
        return newNodes;
    }
}

/**
 * 从树中移除一个节点。
 * @param tree The tree data to modify.
 * @param nodeId The id of the node to remove.
 * @returns An object containing the removed node and a success flag.
 */
export function removeNode(
    tree: TreeData,
    nodeId: string
): { removedNode: IssueNode | null; success: boolean } {
    const found = findNodeById(tree.rootNodes, nodeId);
    if (!found) {
        return { removedNode: null, success: false };
    }

    const { node, parentList } = found;
    const index = parentList.findIndex(n => n.id === nodeId);
    if (index > -1) {
        parentList.splice(index, 1);
        return { removedNode: node, success: true };
    }

    return { removedNode: null, success: false };
}

/**
 * 移动一个节点到新的位置。
 * @param tree The tree data to modify.
 * @param sourceId The id of the node to move.
 * @param targetParentId The id of the new parent. If null, moves to root.
 * @param targetIndex The index to move to in the new parent's children array.
 */
export function moveNode(
    tree: TreeData,
    sourceId: string,
    targetParentId: string | null,
    targetIndex: number
) {
    const { removedNode } = removeNode(tree, sourceId);

    if (!removedNode) {
        return; // Source node not found
    }

    if (targetParentId === null) {
        // Move to root
        tree.rootNodes.splice(targetIndex, 0, removedNode);
    } else {
        const { node: targetParent } = findNodeById(tree.rootNodes, targetParentId) || {};
        if (targetParent) {
            targetParent.children.splice(targetIndex, 0, removedNode);
        } else {
            // If target parent doesn't exist, add it back to the root to avoid data loss.
            tree.rootNodes.push(removedNode);
        }
    }
}

/**
 * 递归地在树中根据 ID 查找节点。
 * @param nodes The list of nodes to search in.
 * @param id The id of the node to find.
 * @returns An object containing the found node and its parent list, or null if not found.
 */
export function findNodeById(
    nodes: IssueNode[],
    id: string
): { node: IssueNode; parentList: IssueNode[] } | null {
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
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

/**
 * 在完整树数据中查找节点并直接返回节点引用。
 * @param tree 树数据
 * @param nodeId 节点 ID
 * @returns 匹配的节点，若未找到则返回 null
 */
export function getTreeNodeById(tree: TreeData, nodeId: string): IssueNode | null {
    const result = findNodeById(tree.rootNodes, nodeId);
    return result ? result.node : null;
}

/**
 * 在树中查找目标节点的直接父节点。
 * @param roots 根节点集合。
 * @param targetId 目标节点 ID。
 * @param comparator 可选的自定义匹配逻辑，默认按 ID 全等。
 */
export function findParentNodeById<T extends { id: string; children?: T[] }>(
    roots: T[],
    targetId: string,
    comparator: (child: T, target: string) => boolean = (child, target) => child.id === target
): T | null {
    const queue: T[] = [...roots]; // 使用队列进行广度优先搜索

    while (queue.length > 0) {
        const node = queue.shift()!; // 从队列头部取出一个节点

        if (node.children) {
            // 检查当前节点的子节点是否是目标
            for (const child of node.children) {
                if (comparator(child, targetId)) {
                    return node; // 如果是，当前节点就是父节点
                }
                // 将子节点加入队列，以便后续遍历
                queue.push(child);
            }
        }
    }

    return null; // 遍历完整棵树都未找到
}

/**
 * 检查一个节点是否是另一个节点的祖先。
 * @param tree The tree data.
 * @param potentialAncestorId The ID of the potential ancestor node.
 * @param nodeId The ID of the node to check.
 * @returns True if the first node is an ancestor of the second, false otherwise.
 */
export function isAncestor(tree: TreeData, potentialAncestorId: string, nodeId: string): boolean {
    const { node: startNode } = findNodeById(tree.rootNodes, potentialAncestorId) || {};
    if (!startNode) {
        return false;
    }

    let found = false;
    walkTree(startNode.children, node => {
        if (node.id === nodeId) {
            found = true;
        }
    });
    return found;
}

/**
 * 查找并返回给定节点的所有祖先。
 * @param nodeId 要查找其祖先的节点的 ID。
 * @param tree 完整的树数据。
 * @returns 一个包含所有祖先节点的数组，从根节点到直接父节点排序。
 */
export function getAncestors(nodeId: string, tree: TreeData): IssueNode[] {
    const ancestors: IssueNode[] = [];

    // 查找从根到一个节点的路径
    const findPath = (nodes: IssueNode[], path: IssueNode[]): boolean => {
        for (const node of nodes) {
            const currentPath = [...path, node];
            if (node.id === nodeId) {
                // 找到了节点，路径（不包括节点自身）就是其祖先
                ancestors.push(...currentPath.slice(0, -1));
                return true;
            }
            if (node.children && findPath(node.children, currentPath)) {
                return true;
            }
        }
        return false;
    };

    findPath(tree.rootNodes, []);
    return ancestors;
}

// ========== focused.json 相关 ========== //

export interface FocusedData {
    version: string;
    focusList: string[]; // 节点 id 列表
}

const FOCUSED_FILE = "focused.json";

/**
 * 获取 focused.json 文件的绝对路径。
 * @returns 如果 issueDir 未配置，则返回 null。
 */
const getFocusedDataPath = (): string | null => {
    const issueDir = getIssueDir();
    if (!issueDir) {
        return null;
    }
    // 确保 .issueManager 目录存在
    const dataDir = path.join(issueDir, ".issueManager");
    try {
        if (!require("fs").existsSync(dataDir)) {
            require("fs").mkdirSync(dataDir, { recursive: true });
        }
    } catch (e) {
        vscode.window.showErrorMessage("创建 .issueManager 目录失败。");
        return null;
    }
    return path.join(dataDir, FOCUSED_FILE);
};

const defaultFocusedData: FocusedData = {
    version: "1.0.0",
    focusList: [],
};

// focused.json 缓存，使用 mtime 避免重复读取
const focusedCache: { mtime: number; data: FocusedData } = {
    mtime: 0,
    data: { ...defaultFocusedData },
};

/**
 * 读取 focused.json 文件。
 * @returns FocusedData 对象，若不存在或损坏则返回默认结构。
 */
export const readFocused = async (): Promise<FocusedData> => {
    const focusedPath = getFocusedDataPath();
    if (!focusedPath) {
        return { ...defaultFocusedData };
    }

    try {
        // 先尝试获取文件状态以比较 mtime
        const stat = await vscode.workspace.fs.stat(vscode.Uri.file(focusedPath));
        if (focusedCache.mtime === stat.mtime) {
            return focusedCache.data;
        }

        const content = await vscode.workspace.fs.readFile(vscode.Uri.file(focusedPath));
        const data = JSON.parse(content.toString());
        // 简单校验
        if (!Array.isArray(data.focusList)) {
            throw new Error("focusList 必须为数组");
        }

        const res: FocusedData = {
            version: typeof data.version === "string" ? data.version : "1.0.0",
            focusList: data.focusList.filter((id: unknown): id is string => typeof id === "string"),
        };

        // 更新缓存
        focusedCache.mtime = stat.mtime;
        focusedCache.data = res;

        return res;
    } catch (error) {
        // 文件不存在或解析失败，返回默认并不更新缓存
        return { ...defaultFocusedData };
    }
};

// =====================
// FocusedRoot 工具函数
// =====================

/**
 * 判断给定的 id 是否为“聚焦”状态。
 *
 * 如果 id 字符串中包含 '::'，则认为该 id 处于聚焦状态。
 *
 * @param id - 要检查的字符串 id。
 * @returns 如果 id 包含 '::'，返回 true；否则返回 false。
 */
export function isFocusedId(id: string): boolean {
    return id.includes("::");
}

/**
 * 将给定的 `id` 和 `focusedRootID` 组合成一个聚焦ID字符串。
 *
 * @param id - 要组合的节点ID。
 * @param focusedRootID - 当前聚焦的根节点ID。
 * @returns 由 `id` 和 `focusedRootID` 通过 "::" 连接组成的字符串。
 */
export function toFocusedId(id: string, focusedRootID: string): string {
    return id + "::" + focusedRootID;
}

/**
 * 从给定的字符串 ID 中移除聚焦部分，仅返回冒号前的部分。
 *
 * @param id - 包含聚焦部分的字符串 ID，格式通常为 "主ID::聚焦ID"。
 * @returns 移除聚焦部分后的主 ID 字符串。
 */
export function stripFocusedId(id: string): string {
    return id.split("::")[0];
}

export function isFocusedRootId(id: string): boolean {
    // 判断 id 是否包含 '::'，如果包含则认为是聚焦根节点
    const [nodeID, rootID] = id.split("::");
    return nodeID === rootID;
}
// 新增：递归查找并更新节点 expanded 字段的工具函数
/**
 * 递归查找并更新指定节点的 expanded 字段。
 * @param nodes 节点数组
 * @param id 目标节点 id
 * @param expanded 展开状态
 * @returns 是否找到并更新
 */
export function updateNodeExpanded(nodes: IssueNode[], id: string, expanded: boolean): boolean {
    for (const node of nodes) {
        if (node.id === id) {
            node.expanded = expanded;
            return true;
        }
        if (node.children && updateNodeExpanded(node.children, id, expanded)) {
            return true;
        }
    }
    return false;
}

// ========== QuickPick 数据相关 ========== //

export interface QuickPickPersistedData {
    version: string;
    searchHistory: string[];
    queryResultCache: [string, vscode.QuickPickItem[]][];
}

const QUICKPICK_FILE = "quickPickData.json";

/**
 * 获取 quickPickData.json 文件的绝对路径。
 * @returns 如果 issueDir 未配置，则返回 null。
 */
const getQuickPickDataPath = (): string | null => {
    const issueDir = getIssueDir();
    if (!issueDir) {
        return null;
    }
    const dataDir = path.join(issueDir, ".issueManager");
    try {
        if (!require("fs").existsSync(dataDir)) {
            require("fs").mkdirSync(dataDir, { recursive: true });
        }
    } catch (e) {
        vscode.window.showErrorMessage("创建 .issueManager 目录失败。");
        return null;
    }
    return path.join(dataDir, QUICKPICK_FILE);
};

const defaultQuickPickData: QuickPickPersistedData = {
    version: "1.0.0",
    searchHistory: [],
    queryResultCache: [],
};

/**
 * 读取 quickPickData.json 文件。
 * @returns QuickPickPersistedData 对象，若不存在或损坏则返回默认结构。
 */
export const readQuickPickData = async (): Promise<QuickPickPersistedData> => {
    const quickPickPath = getQuickPickDataPath();
    if (!quickPickPath) {
        return { ...defaultQuickPickData };
    }
    try {
        const content = await vscode.workspace.fs.readFile(vscode.Uri.file(quickPickPath));
        const data = JSON.parse(content.toString());
        if (!Array.isArray(data.searchHistory)) {
            console.error("searchHistory 必须为数组");
            return { ...defaultQuickPickData };
        }
        if (!Array.isArray(data.queryResultCache)) {
            console.error("queryResultCache 必须为数组");
            return { ...defaultQuickPickData };
        }
        return {
            version: typeof data.version === "string" ? data.version : "1.0.0",
            searchHistory: data.searchHistory.filter((item: any) => typeof item === "string"),
            queryResultCache: data.queryResultCache,
        };
    } catch (error) {
        console.error(`Failed to read or parse QuickPick data from ${quickPickPath}:`, error);
        return { ...defaultQuickPickData };
    }
};

/**
 * 将 QuickPick 数据写入 quickPickData.json 文件。
 * @param data 要写入的 QuickPickPersistedData 对象。
 */
export const writeQuickPickData = async (data: QuickPickPersistedData): Promise<void> => {
    const quickPickPath = getQuickPickDataPath();
    if (!quickPickPath) {
        vscode.window.showErrorMessage("无法写入 QuickPick 数据，问题目录未配置。");
        return;
    }

    const content = Buffer.from(JSON.stringify(data, null, 2), "utf8");

    try {
        await vscode.workspace.fs.writeFile(vscode.Uri.file(quickPickPath), content);
    } catch (error) {
        vscode.window.showErrorMessage(`写入 quickPickData.json 失败: ${error}`);
    }
};
/**
 * 构造包含 PARA 元数据的 contextValue（异步版）。
 * @param nodeId 节点 ID（支持带 focused 后缀的 ID）
 * @param baseContextValue 基础 contextValue（如 'issueNode'）
 * @returns 带有 PARA 元数据的 contextValue 字符串
 */
export async function getIssueNodeContextValue(
    nodeId: string,
    baseContextValue: string
): Promise<string> {
    const realId = stripFocusedId(nodeId);
    try {
        const paraCategory = await getIssueCategory(realId);
        const segments: string[] = [baseContextValue];
        if (paraCategory) {
            segments.push(`paraAssigned:${paraCategory}`);
        } else {
            segments.push("paraAssignable");
        }
        return segments.join("|");
    } catch (e) {
        console.error("获取 PARA 分类失败:", e);
        return `${baseContextValue}|paraAssignable`;
    }
}

/**
 * 根据关注索引返回对应的图标
 * @param focusIndex 关注列表中的索引
 */

export async function getIssueNodeIconPath(
    issueId?: string
): Promise<vscode.ThemeIcon | undefined> {
    // 先尝试从聚焦列表中读取 focusIndex
    let focusIndex: number = -1;
    try {
        if (issueId) {
            const focused = await readFocused();
            focusIndex = focused.focusList.indexOf(issueId);
        }
    } catch (e) {
        console.error("读取 focused.json 失败:", e);
    }

    // 根据关注索引返回对应的图标
    switch (focusIndex) {
        case 0:
            return new vscode.ThemeIcon("star-full");
        case 1:
        case 2:
            return new vscode.ThemeIcon("star-half");
        case 3:
        case 4:
        case 5:
            return new vscode.ThemeIcon("star-empty");
    }

    // 当提供 issueId 时，尝试异步查询其 PARA 分类并使用分类图标
    if (issueId) {
        try {
            const paraCategory = await getIssueCategory(issueId);
            if (paraCategory) {
                return new vscode.ThemeIcon(getCategoryIcon(paraCategory));
            }
        } catch (e) {
            console.error("查询 PARA 分类失败:", e);
        }
    }

    if (focusIndex && focusIndex !== -1) {
        return new vscode.ThemeIcon("sparkle");
    }

    return new vscode.ThemeIcon("symbol-file");
}

/**
 * 类型守卫：判断对象是否为 IssueNode
 * 目的：避免在多个文件中重复实现相同的检查逻辑
 */

export function isIssueNode(item: unknown): item is IssueNode {
    return !!item && typeof item === "object" && "id" in item && "filePath" in item;
}
