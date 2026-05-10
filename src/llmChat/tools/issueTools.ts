/**
 * Issue 笔记相关工具：基础 CRUD、关联管理、删除
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { type FrontmatterData } from '../../data/IssueMarkdowns';
import {
    createIssueNodes, getFlatTree, getIssueData, getIssueNodesByUri,
    getSingleIssueNodeByUri, readTree, writeTree, moveNode, removeNode,
    findNodeById, findParentNodeById, getAncestors, type IssueNode,
} from '../../data/issueTreeManager';
import { getIssueDir } from '../../config';
import { Logger } from '../../core/utils/Logger';
import type { ToolCallResult, ToolExecContext } from './types';
import { issueLink, normalizeFileName, TYPE_FILTER_MAP, getTypeTag, formatAge } from './shared';
import { getIssueCoreServices } from '../../services/issue-core/extensionInstance';

const logger = Logger.getInstance();

// ─── 工具定义 ─────────────────────────────────────────────────

/** 基础笔记工具（所有角色均可用） */
const BASE_ISSUE_TOOLS: vscode.LanguageModelChatTool[] = [
    {
        name: 'get_library_stats',
        description: '获取笔记库的统计概览：各类型笔记数量、总数、最近修改的笔记列表。一次调用即可获取全局概况，无需多次搜索。',
        inputSchema: {
            type: 'object',
            properties: {
                recentLimit: { type: 'number', description: '最近修改的笔记返回条数，默认 15' },
            },
        },
    },
    {
        name: 'search_issues',
        description: '搜索 issueMarkdown 笔记。支持多关键词（空格分隔，全部匹配）、按类型过滤、按范围搜索。query 为空时按类型列出笔记（按修改时间倒序）。返回标题、类型标签、修改时间和关键词匹配的上下文片段。',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: '搜索关键词（多个词用空格分隔，全部匹配）。留空则按类型列出笔记' },
                limit: { type: 'number', description: '最多返回条数，默认 20' },
                type: {
                    type: 'string',
                    enum: ['note', 'role', 'conversation', 'log', 'tool_call', 'group', 'memory', 'chrome_chat', 'board'],
                    description: '按文件类型过滤（可选）：note=普通笔记、role=角色、conversation=对话、log=执行日志、tool_call=工具调用、group=群组、memory=记忆、chrome_chat=浏览器对话、board=调查板',
                },
                scope: {
                    type: 'string',
                    enum: ['all', 'title', 'body'],
                    description: '搜索范围：all（默认，标题+frontmatter+正文）、title（仅标题）、body（仅正文）',
                },
            },
        },
    },
    {
        name: 'read_issue',
        description: '读取指定 issueMarkdown 笔记的内容。支持分页读取大文件：通过 offset 和 maxChars 控制读取范围。返回值包含总长度和剩余字符数，据此判断是否需要继续读取。对于大文件，建议边读边处理（读一段、处理、写入），而非一次性读取全部内容。',
        inputSchema: {
            type: 'object',
            properties: {
                fileName: { type: 'string', description: 'issue 文件名（如 20240115-103045.md）' },
                offset: { type: 'number', description: '起始字符位置（默认 0，即从头开始）' },
                maxChars: { type: 'number', description: '本次最多读取的字符数（默认 15000）' },
            },
            required: ['fileName'],
        },
    },
    {
        name: 'create_issue',
        description: '创建一个新的 issueMarkdown 笔记文件。可以指定标题、描述和正文内容。创建成功后必须在回复中向用户提供文档链接（格式：[`标题`](IssueDir/文件名)）。',
        inputSchema: {
            type: 'object',
            properties: {
                title: { type: 'string', description: '笔记标题' },
                description: { type: 'string', description: '笔记描述（简短摘要）' },
                body: { type: 'string', description: 'Markdown 正文内容' },
            },
            required: ['title', 'body'],
        },
    },
    {
        name: 'create_issue_tree',
        description: '创建一组具有层级关系的 issueMarkdown 笔记，自动建立父子树结构。适合生成结构化的研究报告、知识体系等。',
        inputSchema: {
            type: 'object',
            properties: {
                nodes: {
                    type: 'array',
                    description: '节点列表，每个节点包含 title、body 以及可选的 children（子节点索引数组）',
                    items: {
                        type: 'object',
                        properties: {
                            title: { type: 'string', description: '节点标题' },
                            description: { type: 'string', description: '节点简要描述' },
                            body: { type: 'string', description: 'Markdown 正文' },
                            children: {
                                type: 'array',
                                items: { type: 'number' },
                                description: '子节点在 nodes 数组中的索引',
                            },
                        },
                        required: ['title', 'body'],
                    },
                },
                rootIndex: { type: 'number', description: '根节点在 nodes 数组中的索引，默认 0' },
            },
            required: ['nodes'],
        },
    },
    {
        name: 'list_issue_tree',
        description: '查看当前 issue 树的结构概览，返回各节点的标题和层级关系。',
        inputSchema: {
            type: 'object',
            properties: {
                maxDepth: { type: 'number', description: '最大展示深度，默认 3' },
            },
        },
    },
    {
        name: 'update_issue',
        description: '更新已有 issueMarkdown 笔记的标题、描述或正文内容。body 默认替换整个正文；设置 append=true 可追加到正文末尾（适合分块写入）。',
        inputSchema: {
            type: 'object',
            properties: {
                fileName: { type: 'string', description: 'issue 文件名（如 20240115-103045.md）' },
                title: { type: 'string', description: '新标题（可选）' },
                description: { type: 'string', description: '新描述（可选）' },
                body: { type: 'string', description: '新的 Markdown 正文（可选，默认替换整个正文）' },
                append: { type: 'boolean', description: '为 true 时将 body 追加到现有正文末尾而非替换（默认 false）' },
            },
            required: ['fileName'],
        },
    },
];

// CHAT_TOOLS 续：笔记关联管理工具（所有角色基础工具集）
const ISSUE_RELATION_TOOLS: vscode.LanguageModelChatTool[] = [
    // ─── 笔记关联管理工具 ─────────────────────────────────────
    {
        name: 'link_issue',
        description: '将一个笔记关联到另一个笔记下（建立父子关系）。如果源笔记不在树中，会创建节点；如果已在树中，会移动到新父节点下。',
        inputSchema: {
            type: 'object',
            properties: {
                childFileName: { type: 'string', description: '要关联的子笔记文件名（如 20240115-103045.md）' },
                parentFileName: { type: 'string', description: '目标父笔记文件名。留空则关联到树根级。' },
            },
            required: ['childFileName'],
        },
    },
    {
        name: 'unlink_issue',
        description: '解除笔记的父子关联。将笔记从当前父节点移到树根级，或从树中完全移除。',
        inputSchema: {
            type: 'object',
            properties: {
                fileName: { type: 'string', description: '要解除关联的笔记文件名' },
                removeFromTree: { type: 'boolean', description: '是否从树中完全移除（默认 false，移到根级）' },
            },
            required: ['fileName'],
        },
    },
    {
        name: 'get_issue_relations',
        description: '查询笔记的层级关系：父笔记、子笔记列表、祖先链。用于了解笔记之间的关联结构。',
        inputSchema: {
            type: 'object',
            properties: {
                fileName: { type: 'string', description: '要查询的笔记文件名' },
            },
            required: ['fileName'],
        },
    },
    {
        name: 'move_issue_node',
        description: '将笔记节点移动到指定父节点下的指定位置（精确控制顺序）。可用于调整兄弟节点排列顺序，或将节点迁移到不同父节点。',
        inputSchema: {
            type: 'object',
            properties: {
                fileName: { type: 'string', description: '要移动的笔记文件名' },
                parentFileName: { type: 'string', description: '目标父笔记文件名。留空则移到根级。' },
                index: { type: 'number', description: '在目标父节点子列表中的插入位置（从 0 开始）。默认 0（最前）。超出范围时自动调整到末尾。' },
            },
            required: ['fileName'],
        },
    },
    {
        name: 'sort_issue_children',
        description: '对指定节点的子列表（或根级节点列表）按标题、修改时间或创建时间排序。',
        inputSchema: {
            type: 'object',
            properties: {
                parentFileName: { type: 'string', description: '父笔记文件名。留空则排序根级节点列表。' },
                by: {
                    type: 'string',
                    enum: ['title', 'mtime', 'ctime'],
                    description: '排序字段：title（标题字母序）、mtime（修改时间）、ctime（创建时间）。默认 title。',
                },
                order: {
                    type: 'string',
                    enum: ['asc', 'desc'],
                    description: '排序方向：asc（升序，默认）、desc（降序）',
                },
                recursive: { type: 'boolean', description: '是否递归排序所有子孙节点。默认 false（仅排序直接子节点）。' },
            },
        },
    },
    {
        name: 'delete_issue',
        description: '删除指定的 issueMarkdown 笔记文件，并自动从 issueTree 中解除关联（移除 issueNode）。不可撤销。',
        inputSchema: {
            type: 'object',
            properties: {
                fileName: { type: 'string', description: '要删除的笔记文件名（如 20240115-103045.md 或 IssueDir/20240115-103045.md）' },
                removeChildren: { type: 'boolean', description: '是否同时递归删除该节点的所有子孙笔记文件。默认 false（子节点保留，移到根级）。' },
            },
            required: ['fileName'],
        },
    },
    {
        name: 'batch_delete_issues',
        description: '批量删除多个 issueMarkdown 笔记文件，并自动从 issueTree 中解除所有关联。不可撤销。',
        inputSchema: {
            type: 'object',
            properties: {
                fileNames: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '要删除的笔记文件名列表（支持 IssueDir/ 前缀格式）',
                },
            },
            required: ['fileNames'],
        },
    },
];

// ─── 工具实现 ─────────────────────────────────────────────────

async function executeGetLibraryStats(input: Record<string, unknown>): Promise<ToolCallResult> {
    const services = getIssueCoreServices();
    if (!services) { return { success: false, content: '问题目录未配置' }; }

    const recentLimit = typeof input.recentLimit === 'number' ? Math.min(input.recentLimit, 50) : 15;
    const stats = await services.query.getStats({ recentLimit });

    const lines = [
        `笔记库统计：共 ${stats.totalFiles} 个文件`,
        '',
        '**类型分布：**',
        `- 用户笔记 (note): ${stats.typeCounts['note'] ?? 0}`,
    ];
    for (const [label] of Object.entries(TYPE_FILTER_MAP)) {
        const c = stats.typeCounts[label] ?? 0;
        if (c > 0) { lines.push(`- ${label}: ${c}`); }
    }
    const boardCount = stats.typeCounts['board'] ?? 0;
    if (boardCount > 0) {
        lines.push(`- 调查板 (board): ${boardCount}`);
    }
    lines.push('', `**最近修改的笔记（前 ${stats.recentUserNotes.length} 条）：**`);
    for (let i = 0; i < stats.recentUserNotes.length; i++) {
        const issue = stats.recentUserNotes[i];
        const age = formatAge(issue.mtime);
        lines.push(`${i + 1}. ${issueLink(issue.title, issue.fileName)} (${age})`);
    }
    return { success: true, content: lines.join('\n') };
}

async function executeSearchIssues(input: Record<string, unknown>): Promise<ToolCallResult> {
    const services = getIssueCoreServices();
    if (!services) { return { success: false, content: '问题目录未配置' }; }

    const queryRaw = String(input.query || '').trim();
    const limit = typeof input.limit === 'number' ? input.limit : 20;
    const scope = (['all', 'title', 'body'].includes(String(input.scope))
        ? String(input.scope)
        : 'all') as 'all' | 'title' | 'body';
    const typeFilter = input.type ? String(input.type) : undefined;

    // 空 query：按类型列出笔记
    if (!queryRaw) {
        if (!typeFilter) {
            return { success: false, content: '请提供搜索关键词，或指定 type 按类型列出笔记。也可使用 get_library_stats 获取全局概览。' };
        }
        const r = await services.query.listByType(typeFilter, limit);
        if (r.items.length === 0) {
            return { success: true, content: `类型 "${typeFilter}" 下没有笔记。` };
        }
        const itemLines = r.items.map((issue, i) => {
            const age = formatAge(issue.mtime);
            return `${i + 1}. ${issueLink(issue.title, issue.fileName)} (${age})`;
        });
        return {
            success: true,
            content: `类型 "${typeFilter}" 共 ${r.totalCandidates} 条，显示前 ${r.items.length} 条：\n${itemLines.join('\n')}`,
        };
    }

    const r = await services.query.searchByKeyword(queryRaw, { limit, scope, type: typeFilter });
    if (r.matches.length === 0) {
        const hint = typeFilter ? `（范围: ${typeFilter}）` : '';
        return { success: true, content: `未找到匹配「${queryRaw}」的笔记${hint}。` };
    }
    const lines = r.matches.map((m, i) => {
        const fm = m.issue.frontmatter as Record<string, unknown> | null;
        const tag = getTypeTag(fm);
        const age = formatAge(m.issue.mtime);
        let line = `${i + 1}. ${issueLink(m.issue.title, m.issue.fileName)} \`${tag}\` (${age})`;
        if (m.snippet) { line += `\n   > ${m.snippet}`; }
        return line;
    });
    const hint = typeFilter ? ` (范围: ${typeFilter})` : '';
    return { success: true, content: `找到 ${r.matches.length} 条匹配结果${hint}：\n${lines.join('\n')}` };
}

async function executeReadIssue(input: Record<string, unknown>): Promise<ToolCallResult> {
    const issueDir = getIssueDir();
    if (!issueDir) {
        return { success: false, content: '问题目录未配置' };
    }

    const services = getIssueCoreServices();
    if (!services) { return { success: false, content: '问题目录未配置' }; }

    const fileName = normalizeFileName(String(input.fileName || '').trim(), issueDir);
    if (!fileName) {
        return { success: false, content: '请提供文件名' };
    }

    const issue = await services.issues.get(fileName);
    if (!issue) {
        return { success: false, content: `未找到文件: ${fileName}` };
    }

    const content = await services.issues.getRaw(fileName);
    const offset = Math.max(0, Number(input.offset) || 0);
    const maxChars = Math.max(1, Number(input.maxChars) || 15000);
    const totalLength = content.length;

    // 如果文件小于等于 maxChars 且 offset 为 0，直接返回全部内容
    if (offset === 0 && totalLength <= maxChars) {
        return {
            success: true,
            content: `📖 ${issueLink(issue.title, fileName)} (${totalLength} 字符)\n\n${content}`,
        };
    }

    // 分页读取
    if (offset >= totalLength) {
        return { success: false, content: `offset(${offset}) 超出文件长度(${totalLength})` };
    }

    const slice = content.slice(offset, offset + maxChars);
    const end = offset + slice.length;
    const remaining = totalLength - end;

    let header = `📖 ${issueLink(issue.title, fileName)}\n`;
    header += `总长度: ${totalLength} 字符 | 本次: ${offset}-${end} | 剩余: ${remaining} 字符`;
    if (remaining > 0) {
        header += `\n如需继续读取，调用 read_issue("${fileName}", offset=${end})`;
        // 首次读取大文件时提示 LLM 边读边处理，节省工具轮次
        if (offset === 0) {
            header += `\n⚠️ 文件较大，建议先处理当前内容再读取下一段，避免工具轮次耗尽。`;
        }
    }

    return {
        success: true,
        content: `${header}\n\n---\n${slice}`,
    };
}

async function executeCreateIssue(input: Record<string, unknown>): Promise<ToolCallResult> {
    const services = getIssueCoreServices();
    if (!services) { return { success: false, content: '问题目录未配置' }; }

    const title = String(input.title || '').trim();
    const description = input.description ? String(input.description).trim() : undefined;
    const body = String(input.body || '').trim();

    if (!title) {
        return { success: false, content: '请提供笔记标题' };
    }

    const frontmatter: Partial<FrontmatterData> = { issue_title: title };
    if (description) { frontmatter.issue_description = description; }

    // 正文以一级标题开头
    const fullBody = body.startsWith('# ') ? body : `# ${title}\n\n${body}`;

    const created = await services.issues.create({ frontmatter, body: fullBody });
    // 挂载到 tree.json 根节点顶部,使笔记在问题总览视图可见。
    // 这里继续走扩展端 createIssueNodes,以便 onIssueTreeUpdateEmitter 被触发,刷新 TreeView。
    await createIssueNodes([vscode.Uri.file(created.absPath)]);

    vscode.commands.executeCommand('issueManager.refreshViews');

    return {
        success: true,
        content: `✓ 已创建 ${issueLink(title, created.fileName)}\n> 请在回复中向用户提供上述文档链接。`,
    };
}

async function executeCreateIssueTree(input: Record<string, unknown>): Promise<ToolCallResult> {
    const nodes = input.nodes as Array<{
        title: string;
        description?: string;
        body: string;
        children?: number[];
    }>;
    const rootIndex = typeof input.rootIndex === 'number' ? input.rootIndex : 0;

    if (!Array.isArray(nodes) || nodes.length === 0) {
        return { success: false, content: '请提供至少一个节点' };
    }

    const services = getIssueCoreServices();
    if (!services) { return { success: false, content: '问题目录未配置' }; }

    // 1. 创建所有 issueMarkdown 文件
    const createdUris: vscode.Uri[] = [];
    const createdFileNames: string[] = [];

    for (const node of nodes) {
        const frontmatter: Partial<FrontmatterData> = { issue_title: node.title };
        if (node.description) { frontmatter.issue_description = node.description; }

        const fullBody = node.body.startsWith('# ')
            ? node.body
            : `# ${node.title}\n\n${node.body}`;

        const created = await services.issues.create({ frontmatter, body: fullBody });
        createdUris.push(vscode.Uri.file(created.absPath));
        createdFileNames.push(created.fileName);

        // 短暂延迟确保文件名不重复（基于时间戳)
        if (nodes.length > 1) {
            await new Promise(r => setTimeout(r, 1100));
        }
    }

    // 2. 构建树结构：先创建根节点到 tree 中
    const rootUri = createdUris[rootIndex];
    const rootIssueNodes = await createIssueNodes([rootUri]);

    if (rootIssueNodes && rootIssueNodes.length > 0) {
        const rootNodeId = rootIssueNodes[0].id;

        // 递归添加子节点（按 children 索引数组）
        const addChildren = async (parentIdx: number, parentId: string) => {
            const nodeSpec = nodes[parentIdx];
            if (!nodeSpec.children || nodeSpec.children.length === 0) { return; }

            for (const childIdx of nodeSpec.children) {
                if (childIdx >= 0 && childIdx < createdUris.length && childIdx !== parentIdx) {
                    const childIssueNodes = await createIssueNodes([createdUris[childIdx]], parentId);
                    if (childIssueNodes && childIssueNodes.length > 0) {
                        await addChildren(childIdx, childIssueNodes[0].id);
                    }
                }
            }
        };

        const rootSpec = nodes[rootIndex];
        if (!rootSpec.children || rootSpec.children.length === 0) {
            // 根节点没有显式 children 时，将所有其他节点作为根的直接子节点
            const otherIndices = nodes.map((_, i) => i).filter(i => i !== rootIndex);
            for (const childIdx of otherIndices) {
                const childIssueNodes = await createIssueNodes([createdUris[childIdx]], rootNodeId);
                if (childIssueNodes && childIssueNodes.length > 0) {
                    await addChildren(childIdx, childIssueNodes[0].id);
                }
            }
        } else {
            await addChildren(rootIndex, rootNodeId);
        }
    }

    // 刷新视图
    vscode.commands.executeCommand('issueManager.refreshViews');

    const summary = nodes.map((n, i) => `${i === rootIndex ? '📁' : '  📄'} ${issueLink(n.title, createdFileNames[i])}`).join('\n');
    return {
        success: true,
        content: `✓ 已创建 ${nodes.length} 个笔记并建立层级结构：\n${summary}`,
    };
}

async function executeListIssueTree(input: Record<string, unknown>): Promise<ToolCallResult> {
    const maxDepth = typeof input.maxDepth === 'number' ? input.maxDepth : 3;

    const flatTree = await getFlatTree();
    if (flatTree.length === 0) {
        return { success: true, content: '当前没有任何 issue 树节点。' };
    }

    // 从 flatTree 重建层级展示
    const { treeData } = await getIssueData();
    const lines: string[] = [];

    const renderNodes = (nodesList: typeof treeData.rootNodes, depth: number) => {
        for (const node of nodesList) {
            if (depth > maxDepth) {
                lines.push(`${'  '.repeat(depth)}...`);
                break;
            }
            const flat = flatTree.find(f => f.id === node.id);
            const title = flat?.title || path.basename(node.filePath, '.md');
            const fileName = path.basename(node.filePath);
            lines.push(`${'  '.repeat(depth)}${depth === 0 ? '📁' : '📄'} ${issueLink(title, fileName)}`);
            if (node.children && node.children.length > 0) {
                renderNodes(node.children, depth + 1);
            }
        }
    };

    renderNodes(treeData.rootNodes, 0);

    return {
        success: true,
        content: `Issue 树结构（共 ${flatTree.length} 个节点）：\n${lines.join('\n')}`,
    };
}

async function executeUpdateIssue(input: Record<string, unknown>): Promise<ToolCallResult> {
    const issueDir = getIssueDir();
    if (!issueDir) {
        return { success: false, content: '问题目录未配置' };
    }

    const services = getIssueCoreServices();
    if (!services) { return { success: false, content: '问题目录未配置' }; }

    const fileName = normalizeFileName(String(input.fileName || '').trim(), issueDir);
    if (!fileName) {
        return { success: false, content: '请提供文件名' };
    }

    const issue = await services.issues.get(fileName);
    if (!issue) {
        return { success: false, content: `未找到文件: ${fileName}` };
    }

    const updates: Partial<FrontmatterData> = {};
    if (input.title) { updates.issue_title = String(input.title); }
    if (input.description) { updates.issue_description = String(input.description); }
    if (Object.keys(updates).length > 0) {
        await services.issues.updateFrontmatter(fileName, updates);
    }
    if (input.body) {
        await services.issues.updateBody(fileName, String(input.body), {
            append: input.append === true,
        });
    }

    vscode.commands.executeCommand('issueManager.refreshViews');

    return {
        success: true,
        content: `✓ 已更新 ${issueLink(issue.title, fileName)}`,
    };
}

// ─── 笔记关联管理实现 ─────────────────────────────────────────

async function executeMoveIssueNode(input: Record<string, unknown>): Promise<ToolCallResult> {
    const issueDir = getIssueDir();
    if (!issueDir) {
        return { success: false, content: 'issue 目录未配置' };
    }

    const fileName = normalizeFileName(String(input.fileName || '').trim(), issueDir);
    const parentFileName = input.parentFileName ? normalizeFileName(String(input.parentFileName).trim(), issueDir) : '';
    const index = typeof input.index === 'number' ? Math.floor(input.index) : 0;

    if (!fileName) {
        return { success: false, content: '请提供文件名（fileName）' };
    }

    const uri = vscode.Uri.joinPath(vscode.Uri.file(issueDir), fileName);
    try {
        await vscode.workspace.fs.stat(uri);
    } catch {
        return { success: false, content: `笔记文件不存在: ${fileName}` };
    }

    // 确保节点在树中
    let node = await getSingleIssueNodeByUri(uri);
    if (!node) {
        const created = await createIssueNodes([uri]);
        if (!created?.length) {
            return { success: false, content: `无法在树中创建节点: ${fileName}` };
        }
        node = created[0];
    }

    // 确定目标父节点 ID
    let parentNodeId: string | null = null;
    if (parentFileName) {
        const parentUri = vscode.Uri.joinPath(vscode.Uri.file(issueDir), parentFileName);
        const parentNode = await getSingleIssueNodeByUri(parentUri);
        if (!parentNode) {
            const created = await createIssueNodes([parentUri]);
            if (!created?.length) {
                return { success: false, content: `无法在树中找到或创建父节点: ${parentFileName}` };
            }
            parentNodeId = created[0].id;
        } else {
            parentNodeId = parentNode.id;
        }
    }

    const treeData = await readTree();

    // 计算目标列表长度，将超出范围的 index 夹住
    const targetList = parentNodeId
        ? (findNodeById(treeData.rootNodes, parentNodeId)?.node.children ?? [])
        : treeData.rootNodes;
    // 移除源节点后列表会缩短 1（若在同一列表），保守地限制到 targetList.length
    const safeIndex = Math.max(0, Math.min(index, targetList.length));

    moveNode(treeData, node.id, parentNodeId, safeIndex);
    await writeTree(treeData);

    const target = parentFileName ? issueLink(parentFileName, parentFileName) : '根级';
    return {
        success: true,
        content: `✓ 已将 ${issueLink(fileName, fileName)} 移动到 ${target} 第 ${safeIndex} 位`,
    };
}

async function executeSortIssueChildren(input: Record<string, unknown>): Promise<ToolCallResult> {
    const by = (['title', 'mtime', 'ctime'].includes(String(input.by)) ? String(input.by) : 'title') as 'title' | 'mtime' | 'ctime';
    const order = input.order === 'desc' ? 'desc' : 'asc';
    const recursive = input.recursive === true;

    const issueDir = getIssueDir();
    if (!issueDir) {
        return { success: false, content: 'issue 目录未配置' };
    }

    const parentFileName = input.parentFileName ? normalizeFileName(String(input.parentFileName).trim(), issueDir) : '';

    const treeData = await readTree();
    const flatTree = await getFlatTree();

    type AnyNode = { id: string; children: AnyNode[] };

    const getSortKey = (node: AnyNode): string | number => {
        const flat = flatTree.find(f => f.id === node.id);
        if (by === 'title') { return flat?.title?.toLowerCase() ?? ''; }
        if (by === 'mtime') { return flat?.mtime ?? 0; }
        return flat?.ctime ?? 0;
    };

    const sortNodes = (nodes: AnyNode[]) => {
        nodes.sort((a, b) => {
            const ka = getSortKey(a);
            const kb = getSortKey(b);
            if (typeof ka === 'string' && typeof kb === 'string') {
                return order === 'asc' ? ka.localeCompare(kb, 'zh') : kb.localeCompare(ka, 'zh');
            }
            const diff = (ka as number) - (kb as number);
            return order === 'asc' ? diff : -diff;
        });
        if (recursive) {
            for (const node of nodes) {
                if (node.children?.length > 0) {
                    sortNodes(node.children);
                }
            }
        }
    };

    if (!parentFileName) {
        sortNodes(treeData.rootNodes as unknown as AnyNode[]);
    } else {
        const parentUri = vscode.Uri.joinPath(vscode.Uri.file(issueDir), parentFileName);
        const parentNode = await getSingleIssueNodeByUri(parentUri);
        if (!parentNode) {
            return { success: false, content: `未在树中找到父节点: ${parentFileName}` };
        }
        const found = findNodeById(treeData.rootNodes, parentNode.id);
        if (!found) {
            return { success: false, content: `树中未找到节点: ${parentFileName}` };
        }
        sortNodes(found.node.children as unknown as AnyNode[]);
    }

    await writeTree(treeData);

    const target = parentFileName ? issueLink(parentFileName, parentFileName) : '根级';
    const byLabel: Record<string, string> = { title: '标题', mtime: '修改时间', ctime: '创建时间' };
    return {
        success: true,
        content: `✓ 已对 ${target} 的子节点按「${byLabel[by]}」${order === 'asc' ? '升序' : '降序'} 排序${recursive ? '（含所有子孙节点）' : ''}`,
    };
}

async function executeLinkIssue(input: Record<string, unknown>): Promise<ToolCallResult> {
    const issueDir = getIssueDir();
    if (!issueDir) {
        return { success: false, content: 'issue 目录未配置' };
    }

    const childFileName = normalizeFileName(String(input.childFileName || '').trim(), issueDir);
    const parentFileName = normalizeFileName(String(input.parentFileName || '').trim(), issueDir);

    if (!childFileName) {
        return { success: false, content: '请提供子笔记文件名（childFileName）' };
    }

    const childUri = vscode.Uri.joinPath(vscode.Uri.file(issueDir), childFileName);

    // 检查子笔记文件是否存在
    try {
        await vscode.workspace.fs.stat(childUri);
    } catch {
        return { success: false, content: `笔记文件不存在: ${childFileName}` };
    }

    // 确定父节点
    let parentNodeId: string | undefined;
    if (parentFileName) {
        const parentUri = vscode.Uri.joinPath(vscode.Uri.file(issueDir), parentFileName);
        const parentNode = await getSingleIssueNodeByUri(parentUri);
        if (!parentNode) {
            // 父笔记不在树中，先创建
            const created = await createIssueNodes([parentUri]);
            if (created && created.length > 0) {
                parentNodeId = created[0].id;
            } else {
                return { success: false, content: `无法在树中找到或创建父笔记: ${parentFileName}` };
            }
        } else {
            parentNodeId = parentNode.id;
        }
    }

    // 检查子笔记是否已在树中
    const existingNode = await getSingleIssueNodeByUri(childUri);

    if (existingNode) {
        // 已在树中 → 移动
        const treeData = await readTree();
        moveNode(treeData, existingNode.id, parentNodeId ?? null, 0);
        await writeTree(treeData);

        const target = parentFileName ? issueLink(parentFileName, parentFileName) : '根级';
        return {
            success: true,
            content: `✓ 已将 ${issueLink(childFileName, childFileName)} 移动到 ${target} 下`,
        };
    } else {
        // 不在树中 → 创建节点
        await createIssueNodes([childUri], parentNodeId);

        const target = parentFileName ? issueLink(parentFileName, parentFileName) : '根级';
        return {
            success: true,
            content: `✓ 已将 ${issueLink(childFileName, childFileName)} 关联到 ${target} 下`,
        };
    }
}

async function executeUnlinkIssue(input: Record<string, unknown>): Promise<ToolCallResult> {
    const removeFromTree = input.removeFromTree === true;

    const issueDir = getIssueDir();
    if (!issueDir) {
        return { success: false, content: 'issue 目录未配置' };
    }

    const fileName = normalizeFileName(String(input.fileName || '').trim(), issueDir);
    if (!fileName) {
        return { success: false, content: '请提供笔记文件名（fileName）' };
    }

    const uri = vscode.Uri.joinPath(vscode.Uri.file(issueDir), fileName);
    const node = await getSingleIssueNodeByUri(uri);

    if (!node) {
        return { success: false, content: `笔记不在树中: ${fileName}` };
    }

    const treeData = await readTree();

    if (removeFromTree) {
        // 完全移除
        const { success } = removeNode(treeData, node.id);
        if (!success) {
            return { success: false, content: `移除失败: ${fileName}` };
        }
        await writeTree(treeData);
        return { success: true, content: `✓ 已将 ${issueLink(fileName, fileName)} 从树中移除` };
    } else {
        // 移到根级
        const parent = findParentNodeById(treeData.rootNodes, node.id);
        if (!parent) {
            return { success: true, content: `${issueLink(fileName, fileName)} 已在根级，无需操作` };
        }
        moveNode(treeData, node.id, null, 0);
        await writeTree(treeData);
        return { success: true, content: `✓ 已将 ${issueLink(fileName, fileName)} 移到根级` };
    }
}

async function executeGetIssueRelations(input: Record<string, unknown>): Promise<ToolCallResult> {
    const issueDir = getIssueDir();
    if (!issueDir) {
        return { success: false, content: 'issue 目录未配置' };
    }

    const fileName = normalizeFileName(String(input.fileName || '').trim(), issueDir);
    if (!fileName) {
        return { success: false, content: '请提供笔记文件名（fileName）' };
    }

    const uri = vscode.Uri.joinPath(vscode.Uri.file(issueDir), fileName);
    const nodes = await getIssueNodesByUri(uri);

    if (nodes.length === 0) {
        return { success: true, content: `${issueLink(fileName, fileName)} 不在树中，无层级关系。` };
    }

    const node = nodes[0];
    const treeData = await readTree();
    const flatTree = await getFlatTree();
    const lines: string[] = [];

    // 祖先链
    const ancestors = getAncestors(node.id, treeData);
    if (ancestors.length > 0) {
        const chain = ancestors.map(a => {
            const flat = flatTree.find(f => f.id === a.id);
            const name = flat?.title || path.basename(a.filePath, '.md');
            return issueLink(name, path.basename(a.filePath));
        });
        lines.push(`📍 **祖先链**: ${chain.join(' → ')} → **${fileName}**`);
    }

    // 父节点
    const parent = findParentNodeById(treeData.rootNodes, node.id);
    if (parent) {
        const flat = flatTree.find(f => f.id === parent.id);
        const parentName = flat?.title || path.basename(parent.filePath, '.md');
        lines.push(`⬆️ **父笔记**: ${issueLink(parentName, path.basename(parent.filePath))}`);
    } else {
        lines.push('⬆️ **父笔记**: （根级节点）');
    }

    // 子节点
    if (node.children && node.children.length > 0) {
        lines.push(`⬇️ **子笔记** (${node.children.length} 个):`);
        for (const child of node.children) {
            const flat = flatTree.find(f => f.id === child.id);
            const childName = flat?.title || path.basename(child.filePath, '.md');
            const childFile = path.basename(child.filePath);
            const grandCount = child.children?.length || 0;
            const suffix = grandCount > 0 ? ` (含 ${grandCount} 个子节点)` : '';
            lines.push(`  - ${issueLink(childName, childFile)}${suffix}`);
        }
    } else {
        lines.push('⬇️ **子笔记**: 无');
    }

    // 兄弟节点
    if (parent) {
        const siblings = parent.children.filter(c => c.id !== node.id);
        if (siblings.length > 0) {
            lines.push(`↔️ **兄弟笔记** (${siblings.length} 个):`);
            for (const sib of siblings.slice(0, 10)) {
                const flat = flatTree.find(f => f.id === sib.id);
                const sibName = flat?.title || path.basename(sib.filePath, '.md');
                lines.push(`  - ${issueLink(sibName, path.basename(sib.filePath))}`);
            }
            if (siblings.length > 10) {
                lines.push(`  - …还有 ${siblings.length - 10} 个`);
            }
        }
    }

    return { success: true, content: lines.join('\n') };
}

// ─── 笔记删除实现 ────────────────────────────────────────────

/**
 * 递归收集节点及其所有子孙的文件路径。
 */
function collectSubtreeFilePaths(node: IssueNode, out: Set<string>): void {
    out.add(node.resourceUri.fsPath);
    for (const child of node.children ?? []) {
        collectSubtreeFilePaths(child, out);
    }
}

async function executeDeleteIssue(input: Record<string, unknown>): Promise<ToolCallResult> {
    const issueDir = getIssueDir();
    if (!issueDir) { return { success: false, content: 'issue 目录未配置' }; }

    const fileName = normalizeFileName(String(input.fileName || '').trim(), issueDir);
    if (!fileName) { return { success: false, content: '请提供文件名（fileName）' }; }

    const removeChildren = input.removeChildren === true;
    const uri = vscode.Uri.joinPath(vscode.Uri.file(issueDir), fileName);

    // 确认文件存在
    try { await vscode.workspace.fs.stat(uri); } catch {
        return { success: false, content: `文件不存在: ${fileName}` };
    }

    const filesToDelete = new Set<string>([uri.fsPath]);
    const treeData = await readTree();
    const nodes = await getIssueNodesByUri(uri);

    // 从树中处理节点
    for (const node of nodes) {
        if (removeChildren) {
            // 收集子树所有文件，一并删除
            collectSubtreeFilePaths(node, filesToDelete);
        } else {
            // 子节点提升：将直接子节点移到根级
            for (const child of node.children ?? []) {
                moveNode(treeData, child.id, null, treeData.rootNodes.length);
            }
        }
        removeNode(treeData, node.id);
    }

    if (nodes.length > 0) { await writeTree(treeData); }

    // 删除文件
    const failed: string[] = [];
    for (const fp of filesToDelete) {
        try { await vscode.workspace.fs.delete(vscode.Uri.file(fp)); }
        catch { failed.push(path.basename(fp)); }
    }

    if (failed.length > 0) {
        return { success: false, content: `部分文件删除失败: ${failed.join(', ')}` };
    }

    const childCount = filesToDelete.size - 1;
    const extra = childCount > 0 ? `，连同 ${childCount} 个子孙笔记` : '';
    return { success: true, content: `✓ 已删除 ${issueLink(fileName, fileName)}${extra}，并解除树关联` };
}

async function executeBatchDeleteIssues(input: Record<string, unknown>): Promise<ToolCallResult> {
    const issueDir = getIssueDir();
    if (!issueDir) { return { success: false, content: 'issue 目录未配置' }; }

    const raw = Array.isArray(input.fileNames) ? input.fileNames : [];
    const fileNames = raw.map((n: unknown) => normalizeFileName(String(n).trim(), issueDir)).filter(Boolean);
    if (fileNames.length === 0) { return { success: false, content: '请提供至少一个文件名（fileNames）' }; }

    const treeData = await readTree();
    const filesToDelete = new Set<string>();
    const notFound: string[] = [];

    for (const fileName of fileNames) {
        const uri = vscode.Uri.joinPath(vscode.Uri.file(issueDir), fileName);
        try { await vscode.workspace.fs.stat(uri); } catch {
            notFound.push(fileName);
            continue;
        }
        filesToDelete.add(uri.fsPath);
        const nodes = await getIssueNodesByUri(uri);
        for (const node of nodes) { removeNode(treeData, node.id); }
    }

    if (filesToDelete.size > 0) { await writeTree(treeData); }

    const failed: string[] = [];
    for (const fp of filesToDelete) {
        try { await vscode.workspace.fs.delete(vscode.Uri.file(fp)); }
        catch { failed.push(path.basename(fp)); }
    }

    const lines: string[] = [];
    if (filesToDelete.size - failed.length > 0) {
        lines.push(`✓ 已删除 ${filesToDelete.size - failed.length} 个笔记并解除树关联`);
    }
    if (notFound.length > 0) { lines.push(`⚠️ 文件不存在（已跳过）: ${notFound.join(', ')}`); }
    if (failed.length > 0) { lines.push(`❌ 删除失败: ${failed.join(', ')}`); }

    return { success: failed.length === 0, content: lines.join('\n') };
}

// ─── 导出 ─────────────────────────────────────────────────────

export { BASE_ISSUE_TOOLS, ISSUE_RELATION_TOOLS };

export const ISSUE_HANDLERS: Record<string, (input: Record<string, unknown>, ctx?: ToolExecContext) => Promise<ToolCallResult>> = {
    'get_library_stats': executeGetLibraryStats,
    'search_issues': executeSearchIssues,
    'read_issue': executeReadIssue,
    'create_issue': executeCreateIssue,
    'create_issue_tree': executeCreateIssueTree,
    'list_issue_tree': executeListIssueTree,
    'update_issue': executeUpdateIssue,
    'link_issue': executeLinkIssue,
    'unlink_issue': executeUnlinkIssue,
    'get_issue_relations': executeGetIssueRelations,
    'move_issue_node': executeMoveIssueNode,
    'sort_issue_children': executeSortIssueChildren,
    'delete_issue': executeDeleteIssue,
    'batch_delete_issues': executeBatchDeleteIssues,
};
