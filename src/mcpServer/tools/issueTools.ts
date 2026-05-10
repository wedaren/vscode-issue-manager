import * as path from "node:path";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { IssueCoreServices } from "../../services/issue-core";
import type { FrontmatterData, PersistedIssueNode } from "../../services/issue-core";
import {
    findNodeById,
    moveNode as moveNodeInTree,
} from "../../services/issue-core/IssueTreeRepository";
import { TYPE_FILTER_MAP, formatAge, getTypeTag } from "../../services/issue-core/searchUtils";
import { issueLink, renderIssueList } from "./render";

export interface IssueToolContext {
    services: IssueCoreServices;
    issueDir: string;
}

export type IssueToolHandler = (
    args: Record<string, unknown>,
    ctx: IssueToolContext,
) => Promise<string>;

/** 规范化文件名:剥离 IssueDir/ 前缀或绝对路径,只保留 basename。 */
function normalizeFileName(name: string, issueDir: string): string {
    if (!name) { return ""; }
    if (name.startsWith("IssueDir/")) { return name.slice("IssueDir/".length); }
    if (name.startsWith(issueDir + path.sep)) { return path.relative(issueDir, name); }
    return path.basename(name);
}

// ─── Schemas ──────────────────────────────────────────────────

export const ISSUE_TOOLS: Tool[] = [
    {
        name: "get_library_stats",
        description: "获取笔记库的统计概览:各类型笔记数量、总数、最近修改的笔记列表。一次调用即可获取全局概况。",
        inputSchema: {
            type: "object",
            properties: {
                recentLimit: { type: "number", description: "最近修改的笔记返回条数,默认 15" },
            },
        },
    },
    {
        name: "search_issues",
        description: "搜索 issueMarkdown 笔记。支持多关键词(空格分隔,全部匹配)、按类型过滤、按范围搜索。query 为空时按类型列出笔记(按修改时间倒序)。",
        inputSchema: {
            type: "object",
            properties: {
                query: { type: "string", description: "搜索关键词。留空则按类型列出笔记" },
                limit: { type: "number", description: "最多返回条数,默认 20" },
                type: {
                    type: "string",
                    enum: ["note", "role", "conversation", "log", "tool_call", "group", "memory", "chrome_chat"],
                    description: "按文件类型过滤(可选)",
                },
                scope: {
                    type: "string",
                    enum: ["all", "title", "body"],
                    description: "搜索范围:all(默认,标题+frontmatter+正文)、title(仅标题)、body(仅正文)",
                },
            },
        },
    },
    {
        name: "read_issue",
        description: "读取指定 issueMarkdown 笔记的内容。支持分页:offset 和 maxChars 控制读取范围。",
        inputSchema: {
            type: "object",
            properties: {
                fileName: { type: "string", description: "issue 文件名" },
                offset: { type: "number", description: "起始字符位置,默认 0" },
                maxChars: { type: "number", description: "本次最多读取的字符数,默认 15000" },
            },
            required: ["fileName"],
        },
    },
    {
        name: "create_issue",
        description: "创建一个新的 issueMarkdown 笔记文件。创建成功后必须在回复中提供文档链接(格式 [`标题`](IssueDir/文件名))。",
        inputSchema: {
            type: "object",
            properties: {
                title: { type: "string", description: "笔记标题" },
                description: { type: "string", description: "笔记描述" },
                body: { type: "string", description: "Markdown 正文" },
            },
            required: ["title", "body"],
        },
    },
    {
        name: "create_issue_tree",
        description: "创建一组具有层级关系的 issueMarkdown 笔记,自动建立父子树结构。注意:为避免文件名冲突,nodes 数量上限为 8。",
        inputSchema: {
            type: "object",
            properties: {
                nodes: {
                    type: "array",
                    description: "节点列表",
                    items: {
                        type: "object",
                        properties: {
                            title: { type: "string", description: "节点标题" },
                            description: { type: "string", description: "节点简要描述" },
                            body: { type: "string", description: "Markdown 正文" },
                            children: {
                                type: "array",
                                items: { type: "number" },
                                description: "子节点在 nodes 数组中的索引",
                            },
                        },
                        required: ["title", "body"],
                    },
                },
                rootIndex: { type: "number", description: "根节点索引,默认 0" },
            },
            required: ["nodes"],
        },
    },
    {
        name: "list_issue_tree",
        description: "查看当前 issue 树的结构概览。",
        inputSchema: {
            type: "object",
            properties: {
                maxDepth: { type: "number", description: "最大展示深度,默认 3" },
            },
        },
    },
    {
        name: "update_issue",
        description: "更新已有 issueMarkdown 笔记的标题、描述或正文。body 默认替换正文;append=true 则追加。",
        inputSchema: {
            type: "object",
            properties: {
                fileName: { type: "string", description: "issue 文件名" },
                title: { type: "string", description: "新标题(可选)" },
                description: { type: "string", description: "新描述(可选)" },
                body: { type: "string", description: "新的 Markdown 正文(可选)" },
                append: { type: "boolean", description: "为 true 时追加而非替换" },
            },
            required: ["fileName"],
        },
    },
    {
        name: "link_issue",
        description: "将一个笔记关联到另一个笔记下(建立父子关系)。",
        inputSchema: {
            type: "object",
            properties: {
                childFileName: { type: "string", description: "子笔记文件名" },
                parentFileName: { type: "string", description: "父笔记文件名。留空关联到根级。" },
            },
            required: ["childFileName"],
        },
    },
    {
        name: "unlink_issue",
        description: "解除笔记的父子关联。移到根级或从树中完全移除。",
        inputSchema: {
            type: "object",
            properties: {
                fileName: { type: "string", description: "笔记文件名" },
                removeFromTree: { type: "boolean", description: "是否从树中完全移除,默认 false(移到根级)" },
            },
            required: ["fileName"],
        },
    },
    {
        name: "get_issue_relations",
        description: "查询笔记的层级关系:父笔记、子笔记列表、祖先链。",
        inputSchema: {
            type: "object",
            properties: {
                fileName: { type: "string", description: "笔记文件名" },
            },
            required: ["fileName"],
        },
    },
    {
        name: "move_issue_node",
        description: "将笔记节点移动到指定父节点下的指定位置。",
        inputSchema: {
            type: "object",
            properties: {
                fileName: { type: "string", description: "要移动的笔记文件名" },
                parentFileName: { type: "string", description: "目标父笔记文件名。留空则移到根级。" },
                index: { type: "number", description: "在目标父节点子列表中的插入位置,默认 0" },
            },
            required: ["fileName"],
        },
    },
    {
        name: "sort_issue_children",
        description: "对指定节点的子列表(或根级节点列表)按标题、修改时间或创建时间排序。",
        inputSchema: {
            type: "object",
            properties: {
                parentFileName: { type: "string", description: "父笔记文件名。留空则排序根级。" },
                by: { type: "string", enum: ["title", "mtime", "ctime"], description: "排序字段,默认 title" },
                order: { type: "string", enum: ["asc", "desc"], description: "排序方向,默认 asc" },
                recursive: { type: "boolean", description: "是否递归排序所有子孙,默认 false" },
            },
        },
    },
    {
        name: "delete_issue",
        description: "删除指定的 issueMarkdown 笔记文件,并自动从 issueTree 中解除关联。不可撤销。",
        inputSchema: {
            type: "object",
            properties: {
                fileName: { type: "string", description: "要删除的笔记文件名" },
                removeChildren: { type: "boolean", description: "是否同时递归删除该节点的所有子孙笔记,默认 false" },
            },
            required: ["fileName"],
        },
    },
    {
        name: "batch_delete_issues",
        description: "批量删除多个 issueMarkdown 笔记文件。不可撤销。",
        inputSchema: {
            type: "object",
            properties: {
                fileNames: {
                    type: "array",
                    items: { type: "string" },
                    description: "要删除的笔记文件名列表",
                },
            },
            required: ["fileNames"],
        },
    },
];

// ─── Handlers ─────────────────────────────────────────────────

const handlers: Record<string, IssueToolHandler> = {
    async get_library_stats(args, ctx) {
        const recentLimit = typeof args.recentLimit === "number" ? Math.min(args.recentLimit, 50) : 15;
        const stats = await ctx.services.query.getStats({ recentLimit });
        const lines: string[] = [
            `笔记库统计:共 ${stats.totalFiles} 个文件`,
            "",
            "**类型分布:**",
            `- 用户笔记 (note): ${stats.typeCounts["note"] ?? 0}`,
        ];
        for (const [label] of Object.entries(TYPE_FILTER_MAP)) {
            const c = stats.typeCounts[label] ?? 0;
            if (c > 0) { lines.push(`- ${label}: ${c}`); }
        }
        lines.push("", `**最近修改的笔记(前 ${stats.recentUserNotes.length} 条):**`);
        lines.push(renderIssueList(stats.recentUserNotes));
        return lines.join("\n");
    },

    async search_issues(args, ctx) {
        const query = String(args.query ?? "").trim();
        const limit = typeof args.limit === "number" ? args.limit : 20;
        const scope = (["all", "title", "body"].includes(String(args.scope))
            ? String(args.scope)
            : "all") as "all" | "title" | "body";
        const typeFilter = args.type ? String(args.type) : undefined;

        if (!query) {
            if (!typeFilter) {
                return "请提供搜索关键词,或指定 type 按类型列出笔记。也可使用 get_library_stats 获取全局概览。";
            }
            const r = await ctx.services.query.listByType(typeFilter, limit);
            if (r.items.length === 0) {
                return `类型 "${typeFilter}" 下没有笔记。`;
            }
            return `类型 "${typeFilter}" 共 ${r.totalCandidates} 条,显示前 ${r.items.length} 条:\n${renderIssueList(r.items)}`;
        }

        const r = await ctx.services.query.searchByKeyword(query, { limit, scope, type: typeFilter });
        if (r.matches.length === 0) {
            const hint = typeFilter ? `(范围: ${typeFilter})` : "";
            return `未找到匹配「${query}」的笔记${hint}。`;
        }
        const lines = r.matches.map((m, i) => {
            const tag = getTypeTag(m.issue.frontmatter as Record<string, unknown> | null);
            const age = formatAge(m.issue.mtime);
            let line = `${i + 1}. ${issueLink(m.issue.title, m.issue.fileName)} \`${tag}\` (${age})`;
            if (m.snippet) { line += `\n   > ${m.snippet}`; }
            return line;
        });
        const hint = typeFilter ? ` (范围: ${typeFilter})` : "";
        return `找到 ${r.matches.length} 条匹配结果${hint}:\n${lines.join("\n")}`;
    },

    async read_issue(args, ctx) {
        const fileName = normalizeFileName(String(args.fileName ?? "").trim(), ctx.issueDir);
        if (!fileName) { return "请提供文件名"; }
        const issue = await ctx.services.issues.get(fileName);
        if (!issue) { return `未找到文件: ${fileName}`; }

        const content = await ctx.services.issues.getRaw(fileName);
        const offset = Math.max(0, Number(args.offset) || 0);
        const maxChars = Math.max(1, Number(args.maxChars) || 15000);
        const totalLength = content.length;

        if (offset === 0 && totalLength <= maxChars) {
            return `📖 ${issueLink(issue.title, fileName)} (${totalLength} 字符)\n\n${content}`;
        }
        if (offset >= totalLength) {
            return `offset(${offset}) 超出文件长度(${totalLength})`;
        }
        const slice = content.slice(offset, offset + maxChars);
        const end = offset + slice.length;
        const remaining = totalLength - end;
        let header = `📖 ${issueLink(issue.title, fileName)}\n`;
        header += `总长度: ${totalLength} 字符 | 本次: ${offset}-${end} | 剩余: ${remaining} 字符`;
        if (remaining > 0) {
            header += `\n如需继续读取,调用 read_issue("${fileName}", offset=${end})`;
        }
        return `${header}\n\n---\n${slice}`;
    },

    async create_issue(args, ctx) {
        const title = String(args.title ?? "").trim();
        const description = args.description ? String(args.description).trim() : undefined;
        const body = String(args.body ?? "").trim();
        if (!title) { return "请提供笔记标题"; }
        const fm: Partial<FrontmatterData> = { issue_title: title };
        if (description) { fm.issue_description = description; }
        const fullBody = body.startsWith("# ") ? body : `# ${title}\n\n${body}`;
        const { fileName } = await ctx.services.issues.create({ frontmatter: fm, body: fullBody });
        await ctx.services.tree.createNodes([fileName]);
        return `✓ 已创建 ${issueLink(title, fileName)}\n> 请在回复中向用户提供上述文档链接。`;
    },

    async create_issue_tree(args, ctx) {
        const nodes = args.nodes as Array<{
            title: string;
            description?: string;
            body: string;
            children?: number[];
        }>;
        const rootIndex = typeof args.rootIndex === "number" ? args.rootIndex : 0;
        if (!Array.isArray(nodes) || nodes.length === 0) {
            return "请提供至少一个节点";
        }
        if (nodes.length > 8) {
            return `nodes 数量(${nodes.length})超过上限 8。请减少节点数量,或拆成多次调用。`;
        }

        const createdFileNames: string[] = [];
        for (const node of nodes) {
            const fm: Partial<FrontmatterData> = { issue_title: node.title };
            if (node.description) { fm.issue_description = node.description; }
            const fullBody = node.body.startsWith("# ") ? node.body : `# ${node.title}\n\n${node.body}`;
            const { fileName } = await ctx.services.issues.create({ frontmatter: fm, body: fullBody });
            createdFileNames.push(fileName);
            if (nodes.length > 1) {
                await new Promise(r => setTimeout(r, 1100));
            }
        }

        // 建树:先 root,再按 children 索引递归挂子节点
        const rootFileName = createdFileNames[rootIndex];
        const rootCreated = await ctx.services.tree.createNodes([rootFileName]);
        if (rootCreated.length > 0) {
            const addChildren = async (parentIdx: number, parentNodeId: string): Promise<void> => {
                const spec = nodes[parentIdx];
                if (!spec.children || spec.children.length === 0) { return; }
                for (const childIdx of spec.children) {
                    if (childIdx >= 0 && childIdx < nodes.length && childIdx !== parentIdx) {
                        const created = await ctx.services.tree.createNodes(
                            [createdFileNames[childIdx]],
                            parentNodeId,
                        );
                        if (created.length > 0) {
                            await addChildren(childIdx, created[0].id);
                        }
                    }
                }
            };
            const rootSpec = nodes[rootIndex];
            if (!rootSpec.children || rootSpec.children.length === 0) {
                const otherIndices = nodes.map((_, i) => i).filter(i => i !== rootIndex);
                for (const childIdx of otherIndices) {
                    const created = await ctx.services.tree.createNodes(
                        [createdFileNames[childIdx]],
                        rootCreated[0].id,
                    );
                    if (created.length > 0) {
                        await addChildren(childIdx, created[0].id);
                    }
                }
            } else {
                await addChildren(rootIndex, rootCreated[0].id);
            }
        }

        const summary = nodes
            .map((n, i) => `${i === rootIndex ? "📁" : "  📄"} ${issueLink(n.title, createdFileNames[i])}`)
            .join("\n");
        return `✓ 已创建 ${nodes.length} 个笔记并建立层级结构:\n${summary}`;
    },

    async list_issue_tree(args, ctx) {
        const maxDepth = typeof args.maxDepth === "number" ? args.maxDepth : 3;
        const tree = await ctx.services.tree.read();
        if (tree.rootNodes.length === 0) { return "当前没有任何 issue 树节点。"; }

        const lines: string[] = [];
        let nodeCount = 0;

        const renderNodes = async (
            nodesList: PersistedIssueNode[],
            depth: number,
        ): Promise<void> => {
            for (const node of nodesList) {
                if (depth > maxDepth) {
                    lines.push(`${"  ".repeat(depth)}...`);
                    break;
                }
                nodeCount++;
                const issue = await ctx.services.issues.get(node.filePath);
                const title = issue?.title ?? path.basename(node.filePath, ".md");
                lines.push(`${"  ".repeat(depth)}${depth === 0 ? "📁" : "📄"} ${issueLink(title, node.filePath)}`);
                if (node.children && node.children.length > 0) {
                    await renderNodes(node.children, depth + 1);
                }
            }
        };
        await renderNodes(tree.rootNodes, 0);

        return `Issue 树结构(共 ${nodeCount} 个节点):\n${lines.join("\n")}`;
    },

    async update_issue(args, ctx) {
        const fileName = normalizeFileName(String(args.fileName ?? "").trim(), ctx.issueDir);
        if (!fileName) { return "请提供文件名"; }
        const issue = await ctx.services.issues.get(fileName);
        if (!issue) { return `未找到文件: ${fileName}`; }

        const updates: Partial<FrontmatterData> = {};
        if (args.title) { updates.issue_title = String(args.title); }
        if (args.description) { updates.issue_description = String(args.description); }
        if (Object.keys(updates).length > 0) {
            await ctx.services.issues.updateFrontmatter(fileName, updates);
        }
        if (args.body) {
            await ctx.services.issues.updateBody(fileName, String(args.body), {
                append: args.append === true,
            });
        }
        return `✓ 已更新 ${issueLink(issue.title, fileName)}`;
    },

    async link_issue(args, ctx) {
        const childFileName = normalizeFileName(String(args.childFileName ?? "").trim(), ctx.issueDir);
        const parentFileName = args.parentFileName
            ? normalizeFileName(String(args.parentFileName).trim(), ctx.issueDir)
            : "";
        if (!childFileName) { return "请提供子笔记文件名(childFileName)"; }
        if (!(await ctx.services.issues.get(childFileName))) {
            return `子笔记文件不存在: ${childFileName}`;
        }

        const tree = await ctx.services.tree.read();
        // 查找子节点(可能多份)。Phase 1 方案:取第一个,或新建
        let childNodeId: string | undefined;
        const visit = (nodes: PersistedIssueNode[]): void => {
            for (const n of nodes) {
                if (n.filePath === childFileName) { childNodeId = n.id; return; }
                if (n.children) { visit(n.children); }
            }
        };
        visit(tree.rootNodes);

        let parentNodeId: string | null = null;
        if (parentFileName) {
            if (!(await ctx.services.issues.get(parentFileName))) {
                return `父笔记文件不存在: ${parentFileName}`;
            }
            const visitP = (nodes: PersistedIssueNode[]): void => {
                for (const n of nodes) {
                    if (n.filePath === parentFileName) { parentNodeId = n.id; return; }
                    if (n.children) { visitP(n.children); }
                }
            };
            visitP(tree.rootNodes);
            if (parentNodeId === null) {
                const created = await ctx.services.tree.createNodes([parentFileName]);
                parentNodeId = created[0].id;
            }
        }

        if (!childNodeId) {
            await ctx.services.tree.createNodes(
                [childFileName],
                parentNodeId ?? undefined,
            );
        } else {
            await ctx.services.tree.moveNode(childNodeId, parentNodeId, 0);
        }

        const target = parentFileName ? issueLink(parentFileName, parentFileName) : "根级";
        return `✓ 已将 ${issueLink(childFileName, childFileName)} 关联到 ${target}`;
    },

    async unlink_issue(args, ctx) {
        const fileName = normalizeFileName(String(args.fileName ?? "").trim(), ctx.issueDir);
        const removeFromTree = args.removeFromTree === true;
        if (!fileName) { return "请提供文件名"; }

        const tree = await ctx.services.tree.read();
        let nodeId: string | undefined;
        const visit = (nodes: PersistedIssueNode[]): void => {
            for (const n of nodes) {
                if (n.filePath === fileName) { nodeId = n.id; return; }
                if (n.children) { visit(n.children); }
            }
        };
        visit(tree.rootNodes);
        if (!nodeId) { return `未在树中找到 ${fileName}`; }

        if (removeFromTree) {
            await ctx.services.tree.removeNode(nodeId);
            return `✓ 已从树中完全移除 ${issueLink(fileName, fileName)}`;
        }
        await ctx.services.tree.moveNode(nodeId, null, 0);
        return `✓ 已将 ${issueLink(fileName, fileName)} 移到根级`;
    },

    async get_issue_relations(args, ctx) {
        const fileName = normalizeFileName(String(args.fileName ?? "").trim(), ctx.issueDir);
        if (!fileName) { return "请提供文件名"; }
        if (!(await ctx.services.issues.get(fileName))) {
            return `文件不存在: ${fileName}`;
        }

        const relations = await ctx.services.tree.getRelations(fileName);
        if (relations.length === 0) {
            return `${issueLink(fileName, fileName)} 不在树中。`;
        }

        const lines: string[] = [`## ${issueLink(fileName, fileName)} 的层级关系`];
        for (let i = 0; i < relations.length; i++) {
            const r = relations[i];
            lines.push("", `### 位置 ${i + 1}`);
            if (r.ancestors.length > 0) {
                const chain = r.ancestors.map(a => issueLink(a.filePath, a.filePath)).join(" → ");
                lines.push(`- 祖先链: ${chain}`);
            } else {
                lines.push(`- 位于根级`);
            }
            if (r.parent) {
                lines.push(`- 父节点: ${issueLink(r.parent.filePath, r.parent.filePath)}`);
            }
            if (r.children.length > 0) {
                lines.push(`- 子节点(${r.children.length}):`);
                for (const c of r.children) {
                    lines.push(`  - ${issueLink(c.filePath, c.filePath)}`);
                }
            }
            if (r.siblings.length > 0) {
                lines.push(`- 兄弟节点(${r.siblings.length}):`);
                for (const s of r.siblings) {
                    lines.push(`  - ${issueLink(s.filePath, s.filePath)}`);
                }
            }
        }
        return lines.join("\n");
    },

    async move_issue_node(args, ctx) {
        const fileName = normalizeFileName(String(args.fileName ?? "").trim(), ctx.issueDir);
        const parentFileName = args.parentFileName
            ? normalizeFileName(String(args.parentFileName).trim(), ctx.issueDir)
            : "";
        const index = typeof args.index === "number" ? Math.floor(args.index) : 0;
        if (!fileName) { return "请提供文件名"; }
        if (!(await ctx.services.issues.get(fileName))) {
            return `笔记文件不存在: ${fileName}`;
        }

        const tree = await ctx.services.tree.read();
        let nodeId: string | undefined;
        const visit = (nodes: PersistedIssueNode[]): void => {
            for (const n of nodes) {
                if (n.filePath === fileName) { nodeId = n.id; return; }
                if (n.children) { visit(n.children); }
            }
        };
        visit(tree.rootNodes);
        if (!nodeId) {
            const created = await ctx.services.tree.createNodes([fileName]);
            nodeId = created[0].id;
        }

        let parentNodeId: string | null = null;
        if (parentFileName) {
            const visitP = (nodes: PersistedIssueNode[]): void => {
                for (const n of nodes) {
                    if (n.filePath === parentFileName) { parentNodeId = n.id; return; }
                    if (n.children) { visitP(n.children); }
                }
            };
            visitP(tree.rootNodes);
            if (parentNodeId === null) {
                const created = await ctx.services.tree.createNodes([parentFileName]);
                parentNodeId = created[0].id;
            }
        }

        const ok = await ctx.services.tree.moveNode(nodeId, parentNodeId, index);
        if (!ok) { return `移动失败`; }
        const target = parentFileName ? issueLink(parentFileName, parentFileName) : "根级";
        return `✓ 已将 ${issueLink(fileName, fileName)} 移动到 ${target} 第 ${index} 位`;
    },

    async sort_issue_children(args, ctx) {
        const by = (["title", "mtime", "ctime"].includes(String(args.by))
            ? String(args.by) : "title") as "title" | "mtime" | "ctime";
        const order = args.order === "desc" ? "desc" : "asc";
        const recursive = args.recursive === true;
        const parentFileName = args.parentFileName
            ? normalizeFileName(String(args.parentFileName).trim(), ctx.issueDir)
            : "";

        const tree = await ctx.services.tree.read();
        // 预取所有 issue 元数据用于排序
        const issues = await ctx.services.issues.getAll();
        const issueByFile = new Map(issues.map(i => [i.fileName, i]));

        const sortNodes = (nodes: PersistedIssueNode[]): void => {
            nodes.sort((a, b) => {
                const ia = issueByFile.get(a.filePath);
                const ib = issueByFile.get(b.filePath);
                if (by === "title") {
                    const ka = (ia?.title ?? a.filePath).toLowerCase();
                    const kb = (ib?.title ?? b.filePath).toLowerCase();
                    return order === "asc" ? ka.localeCompare(kb, "zh") : kb.localeCompare(ka, "zh");
                }
                const ka = (ia ? (by === "mtime" ? ia.mtime : ia.ctime) : 0);
                const kb = (ib ? (by === "mtime" ? ib.mtime : ib.ctime) : 0);
                const diff = ka - kb;
                return order === "asc" ? diff : -diff;
            });
            if (recursive) {
                for (const n of nodes) {
                    if (n.children?.length > 0) { sortNodes(n.children); }
                }
            }
        };

        if (!parentFileName) {
            sortNodes(tree.rootNodes);
        } else {
            let parentNodeId: string | undefined;
            const visit = (nodes: PersistedIssueNode[]): void => {
                for (const n of nodes) {
                    if (n.filePath === parentFileName) { parentNodeId = n.id; return; }
                    if (n.children) { visit(n.children); }
                }
            };
            visit(tree.rootNodes);
            if (!parentNodeId) { return `未在树中找到父节点: ${parentFileName}`; }
            const found = findNodeById(tree.rootNodes, parentNodeId);
            if (!found) { return `树中未找到节点: ${parentFileName}`; }
            sortNodes(found.node.children);
        }

        await ctx.services.tree.write(tree);
        const target = parentFileName ? issueLink(parentFileName, parentFileName) : "根级";
        const byLabel: Record<string, string> = { title: "标题", mtime: "修改时间", ctime: "创建时间" };
        return `✓ 已对 ${target} 的子节点按「${byLabel[by]}」${order === "asc" ? "升序" : "降序"} 排序${recursive ? "(含所有子孙)" : ""}`;
    },

    async delete_issue(args, ctx) {
        const fileName = normalizeFileName(String(args.fileName ?? "").trim(), ctx.issueDir);
        const removeChildren = args.removeChildren === true;
        if (!fileName) { return "请提供文件名"; }
        if (!(await ctx.services.issues.get(fileName))) {
            return `文件不存在: ${fileName}`;
        }

        // 在树中找到所有该文件对应的节点
        const tree = await ctx.services.tree.read();
        const nodeIds: string[] = [];
        const visit = (nodes: PersistedIssueNode[]): void => {
            for (const n of nodes) {
                if (n.filePath === fileName) { nodeIds.push(n.id); }
                if (n.children) { visit(n.children); }
            }
        };
        visit(tree.rootNodes);

        const filesToDelete = new Set<string>([fileName]);
        if (removeChildren) {
            for (const id of nodeIds) {
                const r = await ctx.services.tree.removeNode(id);
                for (const fp of r.removedFilePaths) { filesToDelete.add(fp); }
            }
        } else {
            // 移到根级,然后只删自身
            for (const id of nodeIds) {
                await ctx.services.tree.removeNode(id);
            }
        }

        // 删除文件
        let deletedCount = 0;
        for (const fp of filesToDelete) {
            await ctx.services.issues.delete(fp);
            deletedCount++;
        }

        return `✓ 已删除 ${deletedCount} 个文件${removeChildren ? "(含子孙)" : ""}: ${[...filesToDelete].join(", ")}`;
    },

    async batch_delete_issues(args, ctx) {
        const fileNames = (args.fileNames as string[] | undefined ?? [])
            .map(n => normalizeFileName(String(n).trim(), ctx.issueDir))
            .filter(Boolean);
        if (fileNames.length === 0) { return "请提供至少一个文件名"; }

        const tree = await ctx.services.tree.read();
        const results: string[] = [];
        let okCount = 0;
        for (const fn of fileNames) {
            const exists = await ctx.services.issues.get(fn);
            if (!exists) {
                results.push(`✗ ${fn}: 文件不存在`);
                continue;
            }
            // 移除树中所有节点
            const nodeIds: string[] = [];
            const visit = (nodes: PersistedIssueNode[]): void => {
                for (const n of nodes) {
                    if (n.filePath === fn) { nodeIds.push(n.id); }
                    if (n.children) { visit(n.children); }
                }
            };
            visit(tree.rootNodes);
            for (const id of nodeIds) {
                await ctx.services.tree.removeNode(id);
            }
            await ctx.services.issues.delete(fn);
            results.push(`✓ ${fn}`);
            okCount++;
        }
        return `批量删除完成: ${okCount}/${fileNames.length} 成功\n${results.join("\n")}`;
    },
};

// 编译期声明:确保每个 schema 都有对应的 handler
type ToolName = typeof ISSUE_TOOLS[number]["name"];
const _check: Record<ToolName, IssueToolHandler> = handlers;
void _check;
// 防止 moveNodeInTree 未使用警告(暂未使用,保留以便后续扩展)
void moveNodeInTree;

export const ISSUE_TOOL_HANDLERS = handlers;
