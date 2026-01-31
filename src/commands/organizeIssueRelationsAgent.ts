import * as vscode from "vscode";
import { v4 as uuidv4 } from "uuid";
import { LLMService } from "../llm/LLMService";
import {
    findNodeById,
    getTreeNodeById,
    isAncestor,
    IssueNode,
    TreeData,
    readTree,
    removeNode,
    stripFocusedId,
    writeTree,
} from "../data/issueTreeManager";
import { getIssueMarkdownTitleFromCache } from "../data/IssueMarkdowns";

export type RelationActionType = "move" | "attach" | "disassociate";

export interface RelationOperationBase {
    action: RelationActionType;
    reason?: string;
}

export interface MoveOperation extends RelationOperationBase {
    action: "move";
    sourceId: string;
    targetParentId: string | null;
}

export interface AttachOperation extends RelationOperationBase {
    action: "attach";
    sourceId: string;
    targetParentId: string | null;
    includeChildren?: boolean;
}

export interface DisassociateOperation extends RelationOperationBase {
    action: "disassociate";
    nodeId: string;
}

export type RelationOperation = MoveOperation | AttachOperation | DisassociateOperation;

export interface IssueTreeSnapshotNode {
    id: string;
    filePath: string;
    title: string;
    parentId: string | null;
    depth: number;
    childrenIds: string[];
}

export interface IssueTreeSnapshot {
    version: string;
    lastModified: string;
    totalNodes: number;
    nodes: IssueTreeSnapshotNode[];
    duplicatesByFilePath: Array<{ filePath: string; count: number; nodeIds: string[] }>;
}

function estimateUtf8Bytes(text: string): number {
    try {
        return new TextEncoder().encode(text).length;
    } catch {
        // fallback：粗略估计（UTF-16 -> UTF-8 约 1~3 倍）
        return text.length * 2;
    }
}

function normalizeForMatch(input: string): string {
    return (input || "").toLowerCase();
}

function extractKeywordsFromInstruction(instruction: string): string[] {
    const raw = instruction || "";
    const keywords: string[] = [];

    // 引号内容优先
    const quoted = raw.match(/"([^"]{2,})"|“([^”]{2,})”|‘([^’]{2,})’/g);
    if (quoted) {
        for (const q of quoted) {
            const cleaned = q.replace(/^["“‘]|["”’]$/g, "").trim();
            if (cleaned.length >= 2) {
                keywords.push(cleaned);
            }
        }
    }

    // 英文/数字 token
    const ascii = raw.match(/[A-Za-z0-9._:\-/]{2,}/g);
    if (ascii) {
        keywords.push(...ascii);
    }

    // 中文片段（2+）
    const zh = raw.match(/[\u4e00-\u9fa5]{2,}/g);
    if (zh) {
        keywords.push(...zh);
    }

    // 去重 + 过滤过短
    const uniq = Array.from(new Set(keywords.map(k => k.trim()).filter(k => k.length >= 2)));
    // 长的优先（更精确）
    uniq.sort((a, b) => b.length - a.length);
    return uniq.slice(0, 10);
}

function buildPromptSnapshot(instruction: string, snapshot: IssueTreeSnapshot): Record<string, unknown> {
    const keywords = extractKeywordsFromInstruction(instruction);
    const normalizedKeywords = keywords.map(normalizeForMatch);

    const nodesById = new Map<string, IssueTreeSnapshotNode>();
    for (const n of snapshot.nodes) {
        nodesById.set(n.id, n);
    }

    const matchedIds = new Set<string>();
    if (normalizedKeywords.length > 0) {
        for (const n of snapshot.nodes) {
            const haystack = normalizeForMatch(`${n.title} ${n.filePath}`);
            if (normalizedKeywords.some(k => haystack.includes(k))) {
                matchedIds.add(n.id);
            }
        }
    }

    // 若没有关键词命中：仅提供顶层节点（避免 token 爆炸）
    const selectedIds = new Set<string>();

    const includeWithContext = (id: string) => {
        let current: IssueTreeSnapshotNode | undefined = nodesById.get(id);
        // 向上最多 4 层祖先
        for (let i = 0; i < 4 && current; i++) {
            selectedIds.add(current.id);
            const parentId = current.parentId;
            current = parentId ? nodesById.get(parentId) : undefined;
        }

        // 向下加入一层子节点（提供最小上下文）
        const base = nodesById.get(id);
        if (base && base.childrenIds && base.childrenIds.length > 0) {
            for (const childId of base.childrenIds.slice(0, 8)) {
                selectedIds.add(childId);
            }
        }
    };

    if (matchedIds.size > 0) {
        for (const id of matchedIds) {
            includeWithContext(id);
        }
    } else {
        // 没有命中：提供 depth<=1 的节点作为可选目标（上限 120）
        const top = snapshot.nodes.filter(n => n.depth <= 1).slice(0, 120);
        for (const n of top) {
            selectedIds.add(n.id);
        }
    }

    // 生成精简节点列表（并限制数量）
    const selectedNodes = Array.from(selectedIds)
        .map(id => nodesById.get(id))
        .filter((n): n is IssueTreeSnapshotNode => !!n)
        .sort((a, b) => a.depth - b.depth)
        .slice(0, 220)
        .map(n => ({
            id: n.id,
            title: n.title,
            filePath: n.filePath,
            parentId: n.parentId,
            depth: n.depth,
            childCount: n.childrenIds.length,
            childrenIdsSample: n.childrenIds.slice(0, 6),
        }));

    // 只保留与选中节点有关的重复引用分组（再加少量 top 分组兜底）
    const selectedFilePaths = new Set(selectedNodes.map(n => n.filePath));
    const duplicateGroups = snapshot.duplicatesByFilePath
        .filter(d => selectedFilePaths.has(d.filePath))
        .slice(0, 30);

    const topDuplicateGroups = snapshot.duplicatesByFilePath
        .slice()
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

    const mergedDuplicates = Array.from(
        new Map(
            [...duplicateGroups, ...topDuplicateGroups].map(d => [d.filePath, d])
        ).values()
    );

    const payload: Record<string, unknown> = {
        meta: {
            treeVersion: snapshot.version,
            lastModified: snapshot.lastModified,
            totalNodes: snapshot.totalNodes,
            includedNodes: selectedNodes.length,
            keywords,
            note: "为避免 token 超限，本次仅提供与指令最相关的子集节点信息。若信息不足，请在指令中提供更明确的关键词/标题片段。",
        },
        nodes: selectedNodes,
        duplicatesByFilePath: mergedDuplicates,
    };

    // 再做一次硬限制：如果 JSON 仍然过大，继续降维（去掉 childrenIdsSample）
    const json = JSON.stringify(payload);
    if (estimateUtf8Bytes(json) > 18000) {
        const nodesLite = selectedNodes.map(n => ({
            id: n.id,
            title: n.title,
            filePath: n.filePath,
            parentId: n.parentId,
            depth: n.depth,
            childCount: n.childCount,
        }));
        return {
            meta: { ...payload.meta, note: "快照已进一步精简（移除 childrenIdsSample）。" },
            nodes: nodesLite,
            duplicatesByFilePath: mergedDuplicates,
        };
    }

    return payload;
}

function extractJsonFromText(text: string): Record<string, unknown> {
    const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/);
    const candidate = jsonMatch?.[1] ? jsonMatch[1] : text;

    const firstBrace = candidate.indexOf("{");
    const lastBrace = candidate.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
        throw new Error("未在响应中找到有效的 JSON 对象");
    }
    const jsonString = candidate.substring(firstBrace, lastBrace + 1);
    return JSON.parse(jsonString) as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toNullableString(value: unknown): string | null {
    if (value === null) {
        return null;
    }
    if (typeof value === "string") {
        return value;
    }
    return null;
}

function parseOperations(payload: unknown): RelationOperation[] {
    if (!isRecord(payload)) {
        return [];
    }
    const opsRaw = payload.operations;
    if (!Array.isArray(opsRaw)) {
        return [];
    }

    const operations: RelationOperation[] = [];

    for (const item of opsRaw) {
        if (!isRecord(item)) {
            continue;
        }
        const action = item.action;
        const reason = typeof item.reason === "string" ? item.reason : undefined;

        if (action === "move") {
            const sourceId = typeof item.sourceId === "string" ? item.sourceId : "";
            const targetParentId = toNullableString(item.targetParentId);
            if (sourceId) {
                operations.push({ action, sourceId, targetParentId, reason });
            }
            continue;
        }

        if (action === "attach") {
            const sourceId = typeof item.sourceId === "string" ? item.sourceId : "";
            const targetParentId = toNullableString(item.targetParentId);
            const includeChildren = typeof item.includeChildren === "boolean" ? item.includeChildren : undefined;
            if (sourceId) {
                operations.push({ action, sourceId, targetParentId, includeChildren, reason });
            }
            continue;
        }

        if (action === "disassociate") {
            const nodeId = typeof item.nodeId === "string" ? item.nodeId : "";
            if (nodeId) {
                operations.push({ action, nodeId, reason });
            }
            continue;
        }
    }

    return operations;
}

function cloneNodeWithNewIds(node: IssueNode, includeChildren: boolean): IssueNode {
    return {
        id: uuidv4(),
        filePath: node.filePath,
        resourceUri: node.resourceUri,
        children: includeChildren && node.children ? node.children.map(c => cloneNodeWithNewIds(c, true)) : [],
    };
}

function insertUnderParent(tree: TreeData, parentId: string | null, nodes: IssueNode[]): void {
    if (!parentId) {
        tree.rootNodes.unshift(...nodes);
        return;
    }

    const parent = getTreeNodeById(tree, parentId);
    if (!parent) {
        tree.rootNodes.unshift(...nodes);
        return;
    }
    parent.children = parent.children || [];
    parent.children.unshift(...nodes);
}

export function buildTreeSnapshot(rootNodes: IssueNode[], treeMeta: { version: string; lastModified: string }): IssueTreeSnapshot {
    const nodes: IssueTreeSnapshotNode[] = [];
    const filePathToNodeIds = new Map<string, string[]>();

    const walk = (node: IssueNode, parentId: string | null, depth: number) => {
        const id = stripFocusedId(node.id);
        const title = node.filePath ? getIssueMarkdownTitleFromCache(node.filePath) : "(无文件路径)";
        const childrenIds = (node.children || []).map(c => stripFocusedId(c.id));

        nodes.push({
            id,
            filePath: node.filePath,
            title,
            parentId,
            depth,
            childrenIds,
        });

        if (node.filePath) {
            const list = filePathToNodeIds.get(node.filePath) ?? [];
            list.push(id);
            filePathToNodeIds.set(node.filePath, list);
        }

        if (node.children && node.children.length > 0) {
            for (const child of node.children) {
                walk(child, id, depth + 1);
            }
        }
    };

    for (const root of rootNodes) {
        walk(root, null, 0);
    }

    const duplicatesByFilePath = Array.from(filePathToNodeIds.entries())
        .filter(([, ids]) => ids.length > 1)
        .map(([filePath, ids]) => ({ filePath, count: ids.length, nodeIds: ids }));

    return {
        version: treeMeta.version,
        lastModified: treeMeta.lastModified,
        totalNodes: nodes.length,
        nodes,
        duplicatesByFilePath,
    };
}

export async function proposeOperationsWithLlm(instruction: string, snapshot: IssueTreeSnapshot): Promise<RelationOperation[]> {
    const promptSnapshot = buildPromptSnapshot(instruction, snapshot);
    const promptSnapshotJson = JSON.stringify(promptSnapshot, null, 2);

    const prompt = `
你是 VS Code 插件“问题管理器”的关系整理 Agent。

目标：根据用户指令，整理 IssueNode 之间的结构关系（tree.json 的树结构）。
你只能输出以下三类操作：
1) move：把一个节点从原位置“移动”到新的父节点下（会从原处移除）。
2) attach：把一个节点“关联”到新的父节点下（保留原位置；在新位置创建克隆节点，新节点会生成新 id）。
3) disassociate：从树中移除某个节点引用（只移除该 id 对应的那一个引用）。

重要约束：
- 不能把节点 move/attach 到它自己或它的后代节点下面（避免形成循环）。
- tree.json 结构是真正的树：每个节点有 children。
- 允许同一个 filePath 在树中出现多个节点（表示“关联”）。
- 如果你不确定，不要执行破坏性操作（优先输出空 operations）。

用户指令：
"""${instruction}"""

当前问题树快照（已自动裁剪为相关子集）：
${promptSnapshotJson}

请输出 JSON：
{
  "operations": [
    {
      "action": "move" | "attach" | "disassociate",
      "sourceId": "...",           // move/attach 必需
      "targetParentId": "..."|null, // move/attach 必需；null 表示移动到根
      "includeChildren": true|false, // attach 可选（默认 false）
      "nodeId": "...",             // disassociate 必需
      "reason": "一句话说明原因"
    }
  ]
}
`;

    // 最后一道防线：如果 prompt 依然过大，直接返回空并提示用户收敛指令
    if (estimateUtf8Bytes(prompt) > 26000) {
        return [];
    }

    let response: { text: string } | null;
    try {
        response = await LLMService._request([
            vscode.LanguageModelChatMessage.User(prompt),
        ]);
    } catch {
        return [];
    }

    if (!response) {
        return [];
    }

    let json: Record<string, unknown>;
    try {
        json = extractJsonFromText(response.text);
    } catch {
        return [];
    }

    return parseOperations(json);
}

export function summarizeOperations(ops: RelationOperation[], snapshot: IssueTreeSnapshot): string {
    const titleById = new Map<string, string>();
    for (const n of snapshot.nodes) {
        titleById.set(n.id, n.title);
    }

    const lines: string[] = [];
    for (const op of ops) {
        if (op.action === "move") {
            const title = titleById.get(stripFocusedId(op.sourceId)) ?? op.sourceId;
            const target = op.targetParentId ? (titleById.get(stripFocusedId(op.targetParentId)) ?? op.targetParentId) : "<根节点>";
            lines.push(`- move: ${title} -> ${target}${op.reason ? `（${op.reason}）` : ""}`);
        } else if (op.action === "attach") {
            const title = titleById.get(stripFocusedId(op.sourceId)) ?? op.sourceId;
            const target = op.targetParentId ? (titleById.get(stripFocusedId(op.targetParentId)) ?? op.targetParentId) : "<根节点>";
            const childrenHint = op.includeChildren ? "（含子节点）" : "（不含子节点）";
            lines.push(`- attach: ${title} -> ${target} ${childrenHint}${op.reason ? `（${op.reason}）` : ""}`);
        } else {
            const title = titleById.get(stripFocusedId(op.nodeId)) ?? op.nodeId;
            lines.push(`- disassociate: ${title}${op.reason ? `（${op.reason}）` : ""}`);
        }
    }
    return lines.join("\n");
}

export async function applyOperations(ops: RelationOperation[]): Promise<{ applied: number; skipped: number; warnings: string[] }> {
    const warnings: string[] = [];
    const tree = await readTree();
    let applied = 0;
    let skipped = 0;

    for (const op of ops) {
        if (op.action === "move") {
            const sourceId = stripFocusedId(op.sourceId);
            const targetParentId = op.targetParentId ? stripFocusedId(op.targetParentId) : null;

            if (targetParentId && (sourceId === targetParentId || isAncestor(tree, sourceId, targetParentId))) {
                skipped++;
                warnings.push(`跳过 move：不能移动到自身或子节点下（source=${sourceId}, target=${targetParentId}）`);
                continue;
            }

            const { removedNode, success } = removeNode(tree, sourceId);
            if (!success || !removedNode) {
                skipped++;
                warnings.push(`跳过 move：未找到 source 节点（${sourceId}）`);
                continue;
            }

            insertUnderParent(tree, targetParentId, [removedNode]);
            applied++;
            continue;
        }

        if (op.action === "attach") {
            const sourceId = stripFocusedId(op.sourceId);
            const targetParentId = op.targetParentId ? stripFocusedId(op.targetParentId) : null;
            const includeChildren = op.includeChildren === true;

            if (targetParentId && (sourceId === targetParentId || isAncestor(tree, sourceId, targetParentId))) {
                skipped++;
                warnings.push(`跳过 attach：不能关联到自身或子节点下（source=${sourceId}, target=${targetParentId}）`);
                continue;
            }

            const found = findNodeById(tree.rootNodes, sourceId);
            if (!found) {
                skipped++;
                warnings.push(`跳过 attach：未找到 source 节点（${sourceId}）`);
                continue;
            }

            const cloned = cloneNodeWithNewIds(found.node, includeChildren);
            insertUnderParent(tree, targetParentId, [cloned]);
            applied++;
            continue;
        }

        if (op.action === "disassociate") {
            const nodeId = stripFocusedId(op.nodeId);
            const { success } = removeNode(tree, nodeId);
            if (!success) {
                skipped++;
                warnings.push(`跳过 disassociate：未找到节点（${nodeId}）`);
                continue;
            }
            applied++;
            continue;
        }

        skipped++;
    }

    if (applied > 0) {
        await writeTree(tree);
        await vscode.commands.executeCommand("issueManager.refreshAllViews");
    }

    return { applied, skipped, warnings };
}

export function registerOrganizeIssueRelationsAgentCommand(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand("issueManager.organizeIssueRelationsAgent", async () => {
            const instruction = await vscode.window.showInputBox({
                title: "整理 IssueNode 关系（Agent）",
                prompt: "请输入你希望整理的关系目标（例如：把 X 相关问题移动到项目 A 下；把 Y 关联到多个项目但不复制子树）",
                placeHolder: "例如：把所有标题含“登录”的问题移动到“认证”下面；把‘接口规范’关联到各项目但不携带子节点",
                ignoreFocusOut: true,
            });

            if (!instruction || !instruction.trim()) {
                return;
            }

            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: "Issue Manager：关系整理 Agent",
                    cancellable: true,
                },
                async (progress, token) => {
                    progress.report({ message: "读取问题树..." });
                    const tree = await readTree();
                    const snapshot = buildTreeSnapshot(tree.rootNodes, {
                        version: tree.version,
                        lastModified: tree.lastModified,
                    });

                    if (token.isCancellationRequested) {
                        return;
                    }

                    progress.report({ message: "生成整理方案（LLM）..." });
                    const ops = await proposeOperationsWithLlm(instruction.trim(), snapshot);

                    if (token.isCancellationRequested) {
                        return;
                    }

                    if (ops.length === 0) {
                        vscode.window.showInformationMessage(
                            "Agent 未生成可执行的关系调整操作（可能是指令不够明确、或树结构过大已自动裁剪导致信息不足）。\n建议：指令里加入更具体的标题关键词/文件名片段。"
                        );
                        return;
                    }

                    const summary = summarizeOperations(ops, snapshot);
                    const confirm = await vscode.window.showWarningMessage(
                        `Agent 生成了 ${ops.length} 条关系调整操作，是否应用？\n\n${summary}`,
                        { modal: true },
                        "应用",
                        "取消"
                    );

                    if (confirm !== "应用") {
                        return;
                    }

                    progress.report({ message: "应用关系调整..." });
                    const result = await applyOperations(ops);

                    if (result.warnings.length > 0) {
                        vscode.window.showWarningMessage(
                            `已应用 ${result.applied} 条操作，跳过 ${result.skipped} 条。\n` +
                                `部分操作被跳过/告警：\n- ${result.warnings.join("\n- ")}`
                        );
                        return;
                    }

                    vscode.window.showInformationMessage(`✅ 关系整理完成：已应用 ${result.applied} 条操作。`);
                }
            );
        })
    );
}
