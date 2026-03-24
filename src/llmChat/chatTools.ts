/**
 * LLM 聊天工具定义与执行
 *
 * 为聊天角色提供 issueMarkdown 相关的工具能力：
 * - 检索 issueMarkdown
 * - 读取 issue 内容
 * - 新建 issueNode
 * - 创建层级结构的研究报告
 * - 查看 issue 树结构
 * - 网络搜索（通过 Chrome 扩展）
 * - URL 内容抓取（通过 Chrome 扩展）
 */
import * as vscode from 'vscode';
import * as path from 'path';
import {
    getAllIssueMarkdowns,
    getIssueMarkdown,
    createIssueMarkdown,
    updateIssueMarkdownFrontmatter,
    updateIssueMarkdownBody,
    type FrontmatterData,
} from '../data/IssueMarkdowns';
import {
    createIssueNodes,
    getFlatTree,
    getIssueData,
} from '../data/issueTreeManager';
import { getIssueDir } from '../config';
import { Logger } from '../core/utils/Logger';

const logger = Logger.getInstance();

// ─── 工具定义 ─────────────────────────────────────────────────

/** 聊天角色可用的所有工具 */
export const CHAT_TOOLS: vscode.LanguageModelChatTool[] = [
    {
        name: 'search_issues',
        description: '搜索 issueMarkdown 笔记。根据关键词在所有笔记标题中搜索匹配项，返回标题和文件路径。',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: '搜索关键词（支持模糊匹配）' },
                limit: { type: 'number', description: '最多返回条数，默认 20' },
            },
            required: ['query'],
        },
    },
    {
        name: 'read_issue',
        description: '读取指定 issueMarkdown 笔记的完整内容，包括 frontmatter 元数据和正文。通过文件名（如 20240115-103045.md）定位。',
        inputSchema: {
            type: 'object',
            properties: {
                fileName: { type: 'string', description: 'issue 文件名（如 20240115-103045.md）' },
            },
            required: ['fileName'],
        },
    },
    {
        name: 'create_issue',
        description: '创建一个新的 issueMarkdown 笔记文件。可以指定标题、描述和正文内容。返回创建的文件名。',
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
        description: '更新已有 issueMarkdown 笔记的标题、描述或正文内容。',
        inputSchema: {
            type: 'object',
            properties: {
                fileName: { type: 'string', description: 'issue 文件名（如 20240115-103045.md）' },
                title: { type: 'string', description: '新标题（可选）' },
                description: { type: 'string', description: '新描述（可选）' },
                body: { type: 'string', description: '新的 Markdown 正文（可选，会替换整个正文）' },
            },
            required: ['fileName'],
        },
    },
    {
        name: 'web_search',
        description: '通过 Chrome 浏览器进行网络搜索，返回搜索结果页面的文本内容。需要已连接 Chrome 扩展。',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: '搜索关键词' },
                engine: { type: 'string', description: '搜索引擎：google（默认）、bing、baidu' },
            },
            required: ['query'],
        },
    },
    {
        name: 'fetch_url',
        description: '通过 Chrome 浏览器访问指定 URL 并提取页面文本内容。需要已连接 Chrome 扩展。适合获取参考资料、文档等。',
        inputSchema: {
            type: 'object',
            properties: {
                url: { type: 'string', description: '要访问的网页 URL' },
            },
            required: ['url'],
        },
    },
    // ─── Chrome Tab 管理工具 ─────────────────────────────────
    {
        name: 'list_tabs',
        description: '列出 Chrome 浏览器当前所有打开的标签页，返回标题、URL、分组等信息。用于了解用户当前浏览状态。',
        inputSchema: {
            type: 'object',
            properties: {},
        },
    },
    {
        name: 'organize_tabs',
        description: '将 Chrome 标签页按分组整理。根据提供的分组定义，将指定标签页归入命名的 Tab Group 中，支持设定颜色。',
        inputSchema: {
            type: 'object',
            properties: {
                groups: {
                    type: 'array',
                    description: '分组定义列表',
                    items: {
                        type: 'object',
                        properties: {
                            name: { type: 'string', description: '分组名称' },
                            color: { type: 'string', description: '分组颜色：blue、red、yellow、green、pink、purple、cyan、orange' },
                            tabIds: {
                                type: 'array',
                                items: { type: 'number' },
                                description: '属于该分组的标签页 ID 列表',
                            },
                        },
                        required: ['name', 'tabIds'],
                    },
                },
            },
            required: ['groups'],
        },
    },
    {
        name: 'close_tabs',
        description: '关闭指定的 Chrome 标签页。请先用 list_tabs 获取标签页信息后再操作。',
        inputSchema: {
            type: 'object',
            properties: {
                tabIds: {
                    type: 'array',
                    items: { type: 'number' },
                    description: '要关闭的标签页 ID 列表',
                },
            },
            required: ['tabIds'],
        },
    },
    {
        name: 'open_tab',
        description: '在 Chrome 中打开一个新标签页并导航到指定 URL。标签页会保持打开，可后续用 get_tab_content 获取内容或用 activate_tab 切换到该标签。返回新标签页的 ID、标题和 URL。',
        inputSchema: {
            type: 'object',
            properties: {
                url: { type: 'string', description: '要打开的网页 URL' },
                active: { type: 'boolean', description: '是否将新标签设为当前活动标签，默认 true' },
            },
            required: ['url'],
        },
    },
    {
        name: 'get_tab_content',
        description: '获取指定 Chrome 标签页的页面文本内容。通过标签页 ID 定位（可先用 list_tabs 查看所有标签页）。适合分析已打开页面的内容。',
        inputSchema: {
            type: 'object',
            properties: {
                tabId: { type: 'number', description: '要获取内容的标签页 ID' },
            },
            required: ['tabId'],
        },
    },
    {
        name: 'activate_tab',
        description: '切换到指定的 Chrome 标签页，使其成为当前活动标签。',
        inputSchema: {
            type: 'object',
            properties: {
                tabId: { type: 'number', description: '要激活的标签页 ID' },
            },
            required: ['tabId'],
        },
    },
    // ─── 页面交互工具 ─────────────────────────────────────────────
    {
        name: 'get_page_elements',
        description: '获取指定标签页上的可交互元素（输入框、按钮、链接、下拉框等）。用于了解页面结构，获取表单字段信息，以便后续使用 fill_input / click_element 等工具操作。返回每个元素的标签、类型、选择器、占位符、当前值等。',
        inputSchema: {
            type: 'object',
            properties: {
                tabId: { type: 'number', description: '标签页 ID' },
                selector: { type: 'string', description: '可选 CSS 选择器，仅返回匹配的元素。不填则返回页面所有可交互元素。' },
            },
            required: ['tabId'],
        },
    },
    {
        name: 'click_element',
        description: '点击指定标签页上的元素。可通过 CSS 选择器或元素文本内容定位。适合点击按钮、链接、提交表单等操作。',
        inputSchema: {
            type: 'object',
            properties: {
                tabId: { type: 'number', description: '标签页 ID' },
                selector: { type: 'string', description: 'CSS 选择器（如 "button[type=submit]"、"#login-btn"、".next-page"）' },
                text: { type: 'string', description: '通过可见文本匹配元素（如 "登录"、"下一步"）。如果同时提供 selector 和 text，优先使用 selector。' },
            },
            required: ['tabId'],
        },
    },
    {
        name: 'fill_input',
        description: '填写指定标签页上的表单输入框。通过 CSS 选择器、name 属性或 placeholder 定位输入框，然后填入指定值。支持 input、textarea 等可输入元素。',
        inputSchema: {
            type: 'object',
            properties: {
                tabId: { type: 'number', description: '标签页 ID' },
                selector: { type: 'string', description: 'CSS 选择器（如 "input[name=username]"、"#password"、"textarea.comment"）' },
                name: { type: 'string', description: '通过 name 属性定位（如 "username"、"email"）。selector 优先。' },
                placeholder: { type: 'string', description: '通过 placeholder 文本模糊匹配。selector 和 name 优先。' },
                value: { type: 'string', description: '要填入的值' },
            },
            required: ['tabId', 'value'],
        },
    },
    {
        name: 'select_option',
        description: '在指定标签页的下拉选择框（<select>）中选择一个选项。通过 CSS 选择器定位 select 元素，通过 value 或可见文本选择选项。',
        inputSchema: {
            type: 'object',
            properties: {
                tabId: { type: 'number', description: '标签页 ID' },
                selector: { type: 'string', description: 'select 元素的 CSS 选择器' },
                value: { type: 'string', description: '要选择的 option 的 value 属性值' },
                text: { type: 'string', description: '要选择的 option 的可见文本（value 优先）' },
            },
            required: ['tabId', 'selector'],
        },
    },
    {
        name: 'press_key',
        description: '在指定标签页上模拟按键操作。可指定目标元素，默认对当前焦点元素发送。支持 Enter、Tab、Escape、ArrowDown、ArrowUp 等按键。',
        inputSchema: {
            type: 'object',
            properties: {
                tabId: { type: 'number', description: '标签页 ID' },
                key: { type: 'string', description: '按键名称（如 "Enter"、"Tab"、"Escape"、"ArrowDown"）' },
                selector: { type: 'string', description: '可选，目标元素的 CSS 选择器。不填则对当前焦点元素发送按键。' },
            },
            required: ['tabId', 'key'],
        },
    },
];

// ─── 工具执行 ─────────────────────────────────────────────────

export interface ToolCallResult {
    success: boolean;
    content: string;
}

/**
 * 执行指定工具并返回结果文本
 */
export async function executeChatTool(toolName: string, input: Record<string, unknown>): Promise<ToolCallResult> {
    try {
        switch (toolName) {
            case 'search_issues':
                return await executeSearchIssues(input);
            case 'read_issue':
                return await executeReadIssue(input);
            case 'create_issue':
                return await executeCreateIssue(input);
            case 'create_issue_tree':
                return await executeCreateIssueTree(input);
            case 'list_issue_tree':
                return await executeListIssueTree(input);
            case 'update_issue':
                return await executeUpdateIssue(input);
            case 'web_search':
                return await executeWebSearch(input);
            case 'fetch_url':
                return await executeFetchUrl(input);
            case 'list_tabs':
                return await executeListTabs();
            case 'organize_tabs':
                return await executeOrganizeTabs(input);
            case 'close_tabs':
                return await executeCloseTabs(input);
            case 'open_tab':
                return await executeOpenTab(input);
            case 'get_tab_content':
                return await executeGetTabContent(input);
            case 'activate_tab':
                return await executeActivateTab(input);
            case 'get_page_elements':
                return await executeGetPageElements(input);
            case 'click_element':
                return await executeClickElement(input);
            case 'fill_input':
                return await executeFillInput(input);
            case 'select_option':
                return await executeSelectOption(input);
            case 'press_key':
                return await executePressKey(input);
            default:
                return { success: false, content: `未知工具: ${toolName}` };
        }
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.error(`[ChatTools] 执行工具 ${toolName} 失败`, e);
        return { success: false, content: `工具执行失败: ${msg}` };
    }
}

// ─── 各工具实现 ───────────────────────────────────────────────

async function executeSearchIssues(input: Record<string, unknown>): Promise<ToolCallResult> {
    const query = String(input.query || '').trim().toLowerCase();
    const limit = typeof input.limit === 'number' ? input.limit : 20;

    if (!query) {
        return { success: false, content: '请提供搜索关键词' };
    }

    const allIssues = await getAllIssueMarkdowns({});
    const matches = allIssues
        .filter(issue => issue.title.toLowerCase().includes(query))
        .slice(0, limit)
        .map(issue => ({
            fileName: path.basename(issue.uri.fsPath),
            title: issue.title,
        }));

    if (matches.length === 0) {
        return { success: true, content: `未找到包含「${query}」的笔记。` };
    }

    const lines = matches.map((m, i) => `${i + 1}. **${m.title}** (${m.fileName})`);
    return {
        success: true,
        content: `找到 ${matches.length} 条匹配结果：\n${lines.join('\n')}`,
    };
}

async function executeReadIssue(input: Record<string, unknown>): Promise<ToolCallResult> {
    const fileName = String(input.fileName || '').trim();
    if (!fileName) {
        return { success: false, content: '请提供文件名' };
    }

    const issueDir = getIssueDir();
    if (!issueDir) {
        return { success: false, content: '问题目录未配置' };
    }

    const filePath = path.join(issueDir, fileName);
    const issue = await getIssueMarkdown(filePath);
    if (!issue) {
        return { success: false, content: `未找到文件: ${fileName}` };
    }

    // 读取完整内容
    const contentBytes = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
    const content = Buffer.from(contentBytes).toString('utf8');

    // 截断过长内容
    const maxLen = 8000;
    const truncated = content.length > maxLen
        ? content.slice(0, maxLen) + `\n\n... (内容过长，已截断，共 ${content.length} 字符)`
        : content;

    return {
        success: true,
        content: `**${issue.title}** (${fileName})\n\n${truncated}`,
    };
}

async function executeCreateIssue(input: Record<string, unknown>): Promise<ToolCallResult> {
    const title = String(input.title || '').trim();
    const description = input.description ? String(input.description).trim() : undefined;
    const body = String(input.body || '').trim();

    if (!title) {
        return { success: false, content: '请提供笔记标题' };
    }

    const frontmatter: Partial<FrontmatterData> = {
        issue_title: title,
    };
    if (description) {
        frontmatter.issue_description = description;
    }

    // 正文以一级标题开头
    const fullBody = body.startsWith('# ') ? body : `# ${title}\n\n${body}`;

    const uri = await createIssueMarkdown({ frontmatter, markdownBody: fullBody });
    if (!uri) {
        return { success: false, content: '创建笔记失败' };
    }

    const fileName = path.basename(uri.fsPath);

    // 刷新视图
    vscode.commands.executeCommand('issueManager.refreshViews');

    return {
        success: true,
        content: `✅ 已创建笔记「${title}」(${fileName})`,
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

    // 1. 创建所有 issueMarkdown 文件
    const createdUris: vscode.Uri[] = [];
    const createdFileNames: string[] = [];

    for (const node of nodes) {
        const frontmatter: Partial<FrontmatterData> = {
            issue_title: node.title,
        };
        if (node.description) {
            frontmatter.issue_description = node.description;
        }

        const fullBody = node.body.startsWith('# ')
            ? node.body
            : `# ${node.title}\n\n${node.body}`;

        const uri = await createIssueMarkdown({ frontmatter, markdownBody: fullBody });
        if (!uri) {
            return {
                success: false,
                content: `创建节点「${node.title}」失败，已创建 ${createdUris.length} 个节点`,
            };
        }

        createdUris.push(uri);
        createdFileNames.push(path.basename(uri.fsPath));

        // 短暂延迟确保文件名不重复（基于时间戳）
        if (nodes.length > 1) {
            await new Promise(r => setTimeout(r, 1100));
        }
    }

    // 2. 构建树结构：先创建根节点到 tree 中
    const rootUri = createdUris[rootIndex];
    const rootNodes = await createIssueNodes([rootUri]);

    if (rootNodes && rootNodes.length > 0) {
        const rootNodeId = rootNodes[0].id;

        // 递归添加子节点
        const addChildren = async (parentIdx: number, parentId: string) => {
            const nodeSpec = nodes[parentIdx];
            if (!nodeSpec.children || nodeSpec.children.length === 0) { return; }

            for (const childIdx of nodeSpec.children) {
                if (childIdx >= 0 && childIdx < createdUris.length && childIdx !== parentIdx) {
                    const childNodes = await createIssueNodes([createdUris[childIdx]], parentId);
                    if (childNodes && childNodes.length > 0) {
                        await addChildren(childIdx, childNodes[0].id);
                    }
                }
            }
        };

        await addChildren(rootIndex, rootNodeId);
    }

    // 刷新视图
    vscode.commands.executeCommand('issueManager.refreshViews');

    const summary = nodes.map((n, i) => `${i === rootIndex ? '📁' : '  📄'} ${n.title} (${createdFileNames[i]})`).join('\n');
    return {
        success: true,
        content: `✅ 已创建 ${nodes.length} 个笔记并建立层级结构：\n${summary}`,
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
            lines.push(`${'  '.repeat(depth)}${depth === 0 ? '📁' : '📄'} ${title} (${fileName})`);
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
    const fileName = String(input.fileName || '').trim();
    if (!fileName) {
        return { success: false, content: '请提供文件名' };
    }

    const issueDir = getIssueDir();
    if (!issueDir) {
        return { success: false, content: '问题目录未配置' };
    }

    const filePath = path.join(issueDir, fileName);
    const issue = await getIssueMarkdown(filePath);
    if (!issue) {
        return { success: false, content: `未找到文件: ${fileName}` };
    }

    const uri = vscode.Uri.file(filePath);
    const updates: Partial<FrontmatterData> = {};
    let hasUpdate = false;

    if (input.title) {
        updates.issue_title = String(input.title);
        hasUpdate = true;
    }
    if (input.description) {
        updates.issue_description = String(input.description);
        hasUpdate = true;
    }

    if (hasUpdate) {
        const ok = await updateIssueMarkdownFrontmatter(uri, updates);
        if (!ok) {
            return { success: false, content: '更新 frontmatter 失败' };
        }
    }

    if (input.body) {
        const newBody = String(input.body);
        const ok = await updateIssueMarkdownBody(uri, newBody);
        if (!ok) {
            return { success: false, content: '更新正文失败' };
        }
    }

    // 刷新视图
    vscode.commands.executeCommand('issueManager.refreshViews');

    return {
        success: true,
        content: `✅ 已更新笔记「${issue.title}」(${fileName})`,
    };
}

// ─── 网络搜索与 URL 抓取 ─────────────────────────────────────

/** 获取 ChromeIntegrationServer 实例（延迟导入避免循环依赖） */
async function getChromeServer() {
    // @ts-ignore webpack resolves .ts directly
    const mod = await import('../integration/ChromeIntegrationServer');
    return mod.ChromeIntegrationServer.getInstance();
}

async function executeWebSearch(input: Record<string, unknown>): Promise<ToolCallResult> {
    const query = String(input.query || '').trim();
    const engine = String(input.engine || 'google').trim();

    if (!query) {
        return { success: false, content: '请提供搜索关键词' };
    }

    const server = await getChromeServer();
    if (!server.hasConnectedClient()) {
        return { success: false, content: '未连接 Chrome 扩展，无法进行网络搜索。请确保已安装并启用 Chrome 扩展。' };
    }

    try {
        const result = await server.sendRequest(
            'web-search',
            { query, engine },
            30000,
        ) as { query: string; url: string; title: string; content: string };

        if (!result || !result.content) {
            return { success: false, content: '搜索未返回结果' };
        }

        return {
            success: true,
            content: `**搜索结果**：${result.title || query}\n来源：${result.url}\n\n${result.content}`,
        };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.error('[ChatTools] 网络搜索失败', e);
        return { success: false, content: `网络搜索失败: ${msg}` };
    }
}

async function executeFetchUrl(input: Record<string, unknown>): Promise<ToolCallResult> {
    const url = String(input.url || '').trim();

    if (!url) {
        return { success: false, content: '请提供 URL' };
    }

    const server = await getChromeServer();
    if (!server.hasConnectedClient()) {
        return { success: false, content: '未连接 Chrome 扩展，无法抓取网页。请确保已安装并启用 Chrome 扩展。' };
    }

    try {
        const result = await server.sendRequest(
            'fetch-url',
            { url },
            30000,
        ) as { url: string; title: string; content: string };

        if (!result || !result.content) {
            return { success: false, content: '网页未返回内容' };
        }

        return {
            success: true,
            content: `**${result.title || url}**\n来源：${result.url}\n\n${result.content}`,
        };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.error('[ChatTools] URL 抓取失败', e);
        return { success: false, content: `URL 抓取失败: ${msg}` };
    }
}

// ─── Chrome Tab 管理 ──────────────────────────────────────────

async function executeListTabs(): Promise<ToolCallResult> {
    const server = await getChromeServer();
    if (!server.hasConnectedClient()) {
        return { success: false, content: '未连接 Chrome 扩展，无法获取标签页信息。' };
    }

    try {
        const result = await server.sendRequest(
            'list-tabs',
            {},
            10000,
        ) as { tabs: Array<{ id: number; title: string; url: string; groupId: number; active: boolean; pinned: boolean }>; groups: Array<{ id: number; title: string; color: string }> };

        if (!result || !result.tabs) {
            return { success: false, content: '未获取到标签页信息' };
        }

        const groupMap = new Map<number, string>();
        for (const g of (result.groups || [])) {
            groupMap.set(g.id, `${g.title} (${g.color})`);
        }

        const lines: string[] = [`共 ${result.tabs.length} 个标签页：\n`];
        for (const tab of result.tabs) {
            const flags: string[] = [];
            if (tab.active) flags.push('当前');
            if (tab.pinned) flags.push('固定');
            if (tab.groupId >= 0) {
                const gName = groupMap.get(tab.groupId) || `分组${tab.groupId}`;
                flags.push(`分组: ${gName}`);
            }
            const flagStr = flags.length ? ` [${flags.join(', ')}]` : '';
            lines.push(`- ID:${tab.id} | ${tab.title}${flagStr}\n  ${tab.url}`);
        }

        return { success: true, content: lines.join('\n') };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.error('[ChatTools] 列出标签页失败', e);
        return { success: false, content: `获取标签列表失败: ${msg}` };
    }
}

async function executeOrganizeTabs(input: Record<string, unknown>): Promise<ToolCallResult> {
    const groups = input.groups as Array<{ name: string; color?: string; tabIds: number[] }> | undefined;

    if (!groups || !Array.isArray(groups) || groups.length === 0) {
        return { success: false, content: '请提供分组定义（groups 数组）' };
    }

    const server = await getChromeServer();
    if (!server.hasConnectedClient()) {
        return { success: false, content: '未连接 Chrome 扩展，无法整理标签页。' };
    }

    try {
        const result = await server.sendRequest(
            'organize-tabs',
            { groups },
            15000,
        ) as { groups: Array<{ name: string; groupId: number; tabCount: number }>; totalGroups: number };

        if (!result || !result.groups) {
            return { success: false, content: '整理标签失败' };
        }

        const summary = result.groups
            .map(g => `「${g.name}」${g.tabCount} 个标签`)
            .join('、');

        return {
            success: true,
            content: `✅ 已创建 ${result.totalGroups} 个分组：${summary}`,
        };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.error('[ChatTools] 整理标签失败', e);
        return { success: false, content: `整理标签失败: ${msg}` };
    }
}

async function executeOpenTab(input: Record<string, unknown>): Promise<ToolCallResult> {
    const url = String(input.url || '').trim();
    if (!url) {
        return { success: false, content: '请提供 URL' };
    }

    const server = await getChromeServer();
    if (!server.hasConnectedClient()) {
        return { success: false, content: '未连接 Chrome 扩展，无法打开标签页。' };
    }

    try {
        const active = input.active !== false; // 默认 true
        const result = await server.sendRequest(
            'open-tab',
            { url, active },
            20000,
        ) as { tabId: number; title: string; url: string };

        return {
            success: true,
            content: `已打开新标签页：\n- ID: ${result.tabId}\n- 标题: ${result.title || '(加载中)'}\n- URL: ${result.url}`,
        };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.error('[ChatTools] 打开标签页失败', e);
        return { success: false, content: `打开标签页失败: ${msg}` };
    }
}

async function executeGetTabContent(input: Record<string, unknown>): Promise<ToolCallResult> {
    const tabId = typeof input.tabId === 'number' ? input.tabId : undefined;
    if (tabId === undefined) {
        return { success: false, content: '请提供标签页 ID（数字）' };
    }

    const server = await getChromeServer();
    if (!server.hasConnectedClient()) {
        return { success: false, content: '未连接 Chrome 扩展，无法获取页面内容。' };
    }

    try {
        const result = await server.sendRequest(
            'get-tab-content',
            { tabId },
            20000,
        ) as { tabId: number; title: string; url: string; content: string };

        if (!result || !result.content) {
            return { success: false, content: '未能获取页面内容（页面可能尚未加载完成或为空白页）' };
        }

        return {
            success: true,
            content: `**${result.title || '(无标题)'}**\nURL: ${result.url}\n\n${result.content}`,
        };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.error('[ChatTools] 获取标签页内容失败', e);
        return { success: false, content: `获取页面内容失败: ${msg}` };
    }
}

async function executeActivateTab(input: Record<string, unknown>): Promise<ToolCallResult> {
    const tabId = typeof input.tabId === 'number' ? input.tabId : undefined;
    if (tabId === undefined) {
        return { success: false, content: '请提供标签页 ID（数字）' };
    }

    const server = await getChromeServer();
    if (!server.hasConnectedClient()) {
        return { success: false, content: '未连接 Chrome 扩展，无法切换标签页。' };
    }

    try {
        const result = await server.sendRequest(
            'activate-tab',
            { tabId },
            10000,
        ) as { tabId: number; title: string; url: string };

        return {
            success: true,
            content: `已切换到标签页：${result.title || '(无标题)'} (ID: ${result.tabId})`,
        };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.error('[ChatTools] 切换标签页失败', e);
        return { success: false, content: `切换标签页失败: ${msg}` };
    }
}

async function executeCloseTabs(input: Record<string, unknown>): Promise<ToolCallResult> {
    const tabIds = input.tabIds as number[] | undefined;

    if (!tabIds || !Array.isArray(tabIds) || tabIds.length === 0) {
        return { success: false, content: '请提供要关闭的标签页 ID 列表' };
    }

    const server = await getChromeServer();
    if (!server.hasConnectedClient()) {
        return { success: false, content: '未连接 Chrome 扩展，无法关闭标签页。' };
    }

    try {
        const result = await server.sendRequest(
            'close-tabs',
            { tabIds },
            10000,
        ) as { closed: number };

        return {
            success: true,
            content: `✅ 已关闭 ${result.closed} 个标签页`,
        };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.error('[ChatTools] 关闭标签失败', e);
        return { success: false, content: `关闭标签失败: ${msg}` };
    }
}

// ─── 页面交互工具实现 ─────────────────────────────────────────

async function executeGetPageElements(input: Record<string, unknown>): Promise<ToolCallResult> {
    const tabId = typeof input.tabId === 'number' ? input.tabId : undefined;
    if (tabId === undefined) {
        return { success: false, content: '请提供标签页 ID（数字）' };
    }

    const server = await getChromeServer();
    if (!server.hasConnectedClient()) {
        return { success: false, content: '未连接 Chrome 扩展。' };
    }

    try {
        const selector = typeof input.selector === 'string' ? input.selector : undefined;
        const result = await server.sendRequest(
            'get-page-elements',
            { tabId, selector },
            15000,
        ) as { elements: Array<{ tag: string; type?: string; name?: string; id?: string; placeholder?: string; value?: string; text?: string; selector: string; visible: boolean }> };

        if (!result || !result.elements || result.elements.length === 0) {
            return { success: true, content: '页面上未找到可交互元素。' };
        }

        const lines = result.elements.map((el, i) => {
            const parts = [`${i + 1}. <${el.tag}>`];
            if (el.type) parts.push(`type="${el.type}"`);
            if (el.name) parts.push(`name="${el.name}"`);
            if (el.id) parts.push(`id="${el.id}"`);
            if (el.placeholder) parts.push(`placeholder="${el.placeholder}"`);
            if (el.value) parts.push(`value="${el.value}"`);
            if (el.text) parts.push(`"${el.text.slice(0, 50)}"`);
            parts.push(`→ ${el.selector}`);
            if (!el.visible) parts.push('(隐藏)');
            return parts.join(' ');
        });

        return {
            success: true,
            content: `找到 ${result.elements.length} 个可交互元素：\n${lines.join('\n')}`,
        };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.error('[ChatTools] 获取页面元素失败', e);
        return { success: false, content: `获取页面元素失败: ${msg}` };
    }
}

async function executeClickElement(input: Record<string, unknown>): Promise<ToolCallResult> {
    const tabId = typeof input.tabId === 'number' ? input.tabId : undefined;
    if (tabId === undefined) {
        return { success: false, content: '请提供标签页 ID（数字）' };
    }

    const selector = typeof input.selector === 'string' ? input.selector.trim() : '';
    const text = typeof input.text === 'string' ? input.text.trim() : '';
    if (!selector && !text) {
        return { success: false, content: '请提供 selector 或 text 来定位要点击的元素' };
    }

    const server = await getChromeServer();
    if (!server.hasConnectedClient()) {
        return { success: false, content: '未连接 Chrome 扩展。' };
    }

    try {
        const result = await server.sendRequest(
            'click-element',
            { tabId, selector, text },
            15000,
        ) as { success: boolean; tag?: string; text?: string; error?: string };

        if (!result.success) {
            return { success: false, content: result.error || '点击失败' };
        }

        return {
            success: true,
            content: `已点击 <${result.tag || '元素'}>${result.text ? ` "${result.text.slice(0, 30)}"` : ''}`,
        };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.error('[ChatTools] 点击元素失败', e);
        return { success: false, content: `点击元素失败: ${msg}` };
    }
}

async function executeFillInput(input: Record<string, unknown>): Promise<ToolCallResult> {
    const tabId = typeof input.tabId === 'number' ? input.tabId : undefined;
    if (tabId === undefined) {
        return { success: false, content: '请提供标签页 ID（数字）' };
    }

    const value = typeof input.value === 'string' ? input.value : String(input.value ?? '');
    const selector = typeof input.selector === 'string' ? input.selector.trim() : '';
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    const placeholder = typeof input.placeholder === 'string' ? input.placeholder.trim() : '';

    if (!selector && !name && !placeholder) {
        return { success: false, content: '请提供 selector、name 或 placeholder 来定位输入框' };
    }

    const server = await getChromeServer();
    if (!server.hasConnectedClient()) {
        return { success: false, content: '未连接 Chrome 扩展。' };
    }

    try {
        const result = await server.sendRequest(
            'fill-input',
            { tabId, selector, name, placeholder, value },
            15000,
        ) as { success: boolean; tag?: string; name?: string; error?: string };

        if (!result.success) {
            return { success: false, content: result.error || '填写失败' };
        }

        const desc = result.name ? `[name="${result.name}"]` : (result.tag || 'input');
        return {
            success: true,
            content: `已填写 ${desc}，值为 "${value.slice(0, 50)}"`,
        };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.error('[ChatTools] 填写输入框失败', e);
        return { success: false, content: `填写输入框失败: ${msg}` };
    }
}

async function executeSelectOption(input: Record<string, unknown>): Promise<ToolCallResult> {
    const tabId = typeof input.tabId === 'number' ? input.tabId : undefined;
    if (tabId === undefined) {
        return { success: false, content: '请提供标签页 ID（数字）' };
    }

    const selector = typeof input.selector === 'string' ? input.selector.trim() : '';
    if (!selector) {
        return { success: false, content: '请提供 select 元素的 CSS 选择器' };
    }

    const value = typeof input.value === 'string' ? input.value : undefined;
    const text = typeof input.text === 'string' ? input.text : undefined;
    if (!value && !text) {
        return { success: false, content: '请提供 value 或 text 来指定要选择的选项' };
    }

    const server = await getChromeServer();
    if (!server.hasConnectedClient()) {
        return { success: false, content: '未连接 Chrome 扩展。' };
    }

    try {
        const result = await server.sendRequest(
            'select-option',
            { tabId, selector, value, text },
            10000,
        ) as { success: boolean; selectedText?: string; selectedValue?: string; error?: string };

        if (!result.success) {
            return { success: false, content: result.error || '选择失败' };
        }

        return {
            success: true,
            content: `已选择 "${result.selectedText || result.selectedValue || '(未知)'}"`,
        };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.error('[ChatTools] 选择下拉选项失败', e);
        return { success: false, content: `选择失败: ${msg}` };
    }
}

async function executePressKey(input: Record<string, unknown>): Promise<ToolCallResult> {
    const tabId = typeof input.tabId === 'number' ? input.tabId : undefined;
    if (tabId === undefined) {
        return { success: false, content: '请提供标签页 ID（数字）' };
    }

    const key = typeof input.key === 'string' ? input.key.trim() : '';
    if (!key) {
        return { success: false, content: '请提供按键名称（如 "Enter"、"Tab"）' };
    }

    const selector = typeof input.selector === 'string' ? input.selector.trim() : '';

    const server = await getChromeServer();
    if (!server.hasConnectedClient()) {
        return { success: false, content: '未连接 Chrome 扩展。' };
    }

    try {
        const result = await server.sendRequest(
            'press-key',
            { tabId, key, selector },
            10000,
        ) as { success: boolean; error?: string };

        if (!result.success) {
            return { success: false, content: result.error || '按键失败' };
        }

        return {
            success: true,
            content: `已按下 ${key}${selector ? ` (目标: ${selector})` : ''}`,
        };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.error('[ChatTools] 按键失败', e);
        return { success: false, content: `按键失败: ${msg}` };
    }
}
