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
    getIssueMarkdownContent,
    createIssueMarkdown,
    extractFrontmatterAndBody,
    updateIssueMarkdownFrontmatter,
    updateIssueMarkdownBody,
    type FrontmatterData,
} from '../data/IssueMarkdowns';
import {
    createIssueNodes,
    getFlatTree,
    getIssueData,
    getIssueNodesByUri,
    getSingleIssueNodeByUri,
    readTree,
    writeTree,
    moveNode,
    removeNode,
    findNodeById,
    findParentNodeById,
    getAncestors,
    type IssueNode,
} from '../data/issueTreeManager';
import { getIssueDir } from '../config';
import { Logger } from '../core/utils/Logger';
import type { ChatRoleInfo, RoleMemoryFrontmatter } from './types';
import {
    getAllChatRoles,
    getChatRoleById,
    createChatRole as dataCreateChatRole,
    createConversation,
    appendUserMessageQueued,
    parseConversationMessages,
    getConversationsForRole,
    getRoleSystemPrompt,
    updateRoleSystemPrompt,
} from './llmChatDataManager';
import { RoleTimerManager } from './RoleTimerManager';
import { readStateMarker } from './convStateMarker';

/** 委派递归深度限制 */
const MAX_DELEGATION_DEPTH = 5;
/** 当前委派深度（递归计数器，进程级） */
let _delegationDepth = 0;

/** 单次顶层任务链中，委派（含追问）的总调用次数上限 */
const MAX_DELEGATION_TOTAL_CALLS = 20;
/** 当前任务链的总调用计数器（_delegationDepth 归零时重置） */
let _delegationTotalCalls = 0;

const logger = Logger.getInstance();

/** 生成 issueMarkdown 链接，使用约定前缀 IssueDir/，消费方按需替换为真实路径 */
function issueLink(title: string, fileName: string): string {
    return `[${title}](IssueDir/${fileName})`;
}

/**
 * 规范化文件名：IssueDir/ 是真实 issue 目录的缩写，将其剥离后得到相对于
 * issueDir 的路径。同时兼容 LLM 传入真实绝对路径的情况（取 basename）。
 */
function normalizeFileName(name: string, issueDir?: string): string {
    // IssueDir/ 是 issueDir 的约定缩写，直接剥离该前缀
    if (name.startsWith('IssueDir/')) {
        return name.slice('IssueDir/'.length);
    }
    // 兼容 LLM 传入真实绝对路径
    if (issueDir && name.startsWith(issueDir + path.sep)) {
        return path.relative(issueDir, name);
    }
    // 其余情况：可能是纯文件名或带其他前缀，取 basename 兜底
    return path.basename(name);
}

// ─── 工具定义 ─────────────────────────────────────────────────

/** 基础笔记工具（所有角色均可用） */
const BASE_ISSUE_TOOLS: vscode.LanguageModelChatTool[] = [
    {
        name: 'search_issues',
        description: '搜索 issueMarkdown 笔记。支持在标题、frontmatter 字段和正文中搜索，支持多关键词（空格分隔，全部匹配）。返回标题、文件路径、类型标签和修改时间。',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: '搜索关键词（多个词用空格分隔，全部匹配）' },
                limit: { type: 'number', description: '最多返回条数，默认 20' },
                scope: {
                    type: 'string',
                    enum: ['all', 'title', 'body'],
                    description: '搜索范围：all（默认，标题+frontmatter+正文）、title（仅标题）、body（仅正文）',
                },
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
];

/** 浏览器工具（browser 工具集，需要 Chrome 扩展连接） */
const BROWSER_TOOLS: vscode.LanguageModelChatTool[] = [
    // ─── 网络工具 ─────────────────────────────────────────────
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

// ─── 能力工具定义（按需注入） ─────────────────────────────────

/** 记忆工具（memory_enabled 时注入） */
const MEMORY_TOOLS: vscode.LanguageModelChatTool[] = [
    {
        name: 'read_memory',
        description: '读取本角色的持久记忆，包含积累的知识、历史任务摘要和反思。对话开始时应首先调用此工具。',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'write_memory',
        description: '更新本角色的持久记忆。在任务完成后调用，记录本次任务经验、新了解等。内容为 Markdown 格式，会替换现有记忆。',
        inputSchema: {
            type: 'object',
            properties: {
                content: {
                    type: 'string',
                    description: '新的记忆内容（Markdown 格式）',
                },
            },
            required: ['content'],
        },
    },
];

/** 委派工具（delegation_enabled 时注入） */
const DELEGATION_TOOLS: vscode.LanguageModelChatTool[] = [
    {
        name: 'list_chat_roles',
        description: '列出当前所有可用的聊天角色，含名称、系统提示词摘要。用于决定委派给谁。',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'delegate_to_role',
        description: '将子任务委派给指定角色（单轮）。同步模式（默认）等待角色完成后返回结果；异步模式立即返回 convoId。注意：这只是发起第一轮对话。如果任务需要多轮交互（如需要反馈、修正、确认），请在收到回复后评估结果，再用 continue_delegation 追问，循环直到满意为止。典型多轮委派流程：delegate_to_role → 评估回复 → continue_delegation → 评估 → ... → 完成。',
        inputSchema: {
            type: 'object',
            properties: {
                roleNameOrId: {
                    type: 'string',
                    description: '目标角色的名称或 ID（文件名去掉 .md）',
                },
                task: {
                    type: 'string',
                    description: '委派给该角色的具体任务描述，越详细越好',
                },
                async: {
                    type: 'boolean',
                    description: '是否异步执行。true = 立即返回 convoId，角色在后台处理；false（默认）= 同步等待角色完成',
                },
            },
            required: ['roleNameOrId', 'task'],
        },
    },
    {
        name: 'continue_delegation',
        description: '对已完成的委派对话进行多轮追问（必须配合 delegate_to_role 使用）。对话必须已完成（有 assistant 回复且无执行中状态）才能追问。每次追问相当于在同一对话中追加一条 user 消息并等待角色回复，角色可看到完整历史上下文。可多次调用形成多轮对话，直到任务完成。',
        inputSchema: {
            type: 'object',
            properties: {
                convoId: {
                    type: 'string',
                    description: '委派对话 ID（delegate_to_role 返回的 convoId）',
                },
                message: {
                    type: 'string',
                    description: '追问内容，基于上一轮回复的补充问题或进一步指令',
                },
                async: {
                    type: 'boolean',
                    description: '是否异步执行。true = 立即返回，角色在后台处理；false（默认）= 同步等待回复',
                },
            },
            required: ['convoId', 'message'],
        },
    },
    {
        name: 'get_delegation_status',
        description: '查询异步委派的执行状态和结果。用于跟进之前以 async:true 发起的委派任务或 continue_delegation 的异步追问。',
        inputSchema: {
            type: 'object',
            properties: {
                convoId: {
                    type: 'string',
                    description: '委派时返回的对话 ID（如 20240115-103045）',
                },
            },
            required: ['convoId'],
        },
    },
];

/** 角色管理工具（role_management_enabled 时注入） */
const ROLE_MANAGEMENT_TOOLS: vscode.LanguageModelChatTool[] = [
    {
        name: 'list_available_tools',
        description: '列出当前可用的内置工具包（tool_sets）和已注册的 MCP server（mcp_servers）及其工具，供创建或配置角色时参考。',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'create_chat_role',
        description: '创建一个新的聊天角色。调用前必须先调用 list_available_tools，了解可用的内置工具包和 MCP server，再按角色职责按需配置 toolSets 和 mcpServers。创建后可立即用 delegate_to_role 委派任务（需要委派能力）。',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: '角色名称（如"法律顾问"、"数学专家"）' },
                systemPrompt: { type: 'string', description: '角色的系统提示词，详细描述其职责、能力和行为准则' },
                avatar: {
                    type: 'string',
                    description: 'VS Code ThemeIcon 名称，如 scale、beaker、code、book、shield、person、globe、lightbulb 等',
                },
                modelFamily: {
                    type: 'string',
                    description: '指定使用的 AI 模型。不填则使用全局默认。',
                },
                toolSets: {
                    type: 'array',
                    items: { type: 'string', enum: ['memory', 'delegation', 'role_management', 'browser'] },
                    description: '为新角色启用的工具包列表，如 ["memory", "delegation"]，默认为空',
                },
                mcpServers: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '要注入的 MCP server 名称列表，如 ["memory", "fetch"]。请先调用 list_available_tools 确认实际可用的 server 名称，再按角色职责按需选择。避免使用 "*"（引入全部），会导致 token 上下文爆炸。默认为空',
                },
            },
            required: ['name', 'systemPrompt'],
        },
    },
    {
        name: 'update_role_config',
        description: '根据实际表现更新指定角色的系统提示词，优化其行为。',
        inputSchema: {
            type: 'object',
            properties: {
                roleNameOrId: { type: 'string', description: '要更新的角色名称或 ID' },
                newSystemPrompt: { type: 'string', description: '新的系统提示词（完整替换）' },
                reason: { type: 'string', description: '更新原因（可选，用于记录）' },
            },
            required: ['roleNameOrId', 'newSystemPrompt'],
        },
    },
    {
        name: 'evaluate_role',
        description: '记录对某个角色的绩效评估。结果会写入本角色的记忆文件（需要同时启用记忆能力）。',
        inputSchema: {
            type: 'object',
            properties: {
                roleNameOrId: { type: 'string', description: '角色名称或 ID' },
                outcome: {
                    type: 'string',
                    enum: ['success', 'partial', 'failed'],
                    description: 'success=完成良好, partial=部分完成, failed=未完成或质量差',
                },
                notes: { type: 'string', description: '详细评价：做得好的地方、不足之处、改进建议' },
            },
            required: ['roleNameOrId', 'outcome', 'notes'],
        },
    },
    {
        name: 'read_role_execution_logs',
        description: '读取指定角色的执行日志，统计工具实际调用情况、成功率、token 消耗，并与角色配置对比，找出冗余或缺失的工具配置。',
        inputSchema: {
            type: 'object',
            properties: {
                roleNameOrId: { type: 'string', description: '角色名称或 ID' },
                maxConversations: { type: 'number', description: '分析最近 N 个对话的日志，默认 5' },
            },
            required: ['roleNameOrId'],
        },
    },
];

// ─── 对话级 Todo 工具（所有角色基础工具集） ─────────────────────
const TODO_TOOLS: vscode.LanguageModelChatTool[] = [
    {
        name: 'read_todos',
        description: '读取当前对话的 todo 列表。返回 JSON 数组，每项含 id、content（任务描述）、status（pending/in_progress/done）。建议在处理复杂任务前先读取，了解已有计划。',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'write_todos',
        description: '整体写入当前对话的 todo 列表（覆盖已有列表）。适合初始规划或大幅调整任务列表。每个 todo 需含 content 和 status 字段，id 自动分配。建议在收到复杂任务时先拆分为 todo 列表再逐项执行。',
        inputSchema: {
            type: 'object',
            properties: {
                todos: {
                    type: 'array',
                    description: 'todo 项数组',
                    items: {
                        type: 'object',
                        properties: {
                            content: { type: 'string', description: '任务描述' },
                            status: { type: 'string', enum: ['pending', 'in_progress', 'done'], description: '状态，默认 pending' },
                        },
                        required: ['content'],
                    },
                },
            },
            required: ['todos'],
        },
    },
    {
        name: 'update_todo',
        description: '更新当前对话 todo 列表中的单个 todo 项。可修改状态或内容。完成一个子任务后应立即调用此工具将对应 todo 标记为 done。',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'number', description: 'todo 的 id（从 read_todos 获取）' },
                status: { type: 'string', enum: ['pending', 'in_progress', 'done'], description: '新状态' },
                content: { type: 'string', description: '新的任务描述（可选，不传则不修改）' },
            },
            required: ['id'],
        },
    },
];

/** 聊天角色可用的基础工具集（笔记管理 + 关联管理 + todo） */
export const CHAT_TOOLS: vscode.LanguageModelChatTool[] = [
    ...BASE_ISSUE_TOOLS,
    ...ISSUE_RELATION_TOOLS,
    ...TODO_TOOLS,
];

/** 内置工具包注册表，新增工具包只需在此添加一条记录 */
const TOOL_SET_REGISTRY: Record<string, vscode.LanguageModelChatTool[]> = {
    memory:          MEMORY_TOOLS,
    delegation:      DELEGATION_TOOLS,
    role_management: ROLE_MANAGEMENT_TOOLS,
    browser:         BROWSER_TOOLS,
};

/**
 * 根据角色的工具集配置，组装该角色可用的完整工具集。
 * - toolSets: 内置工具包名称列表
 * - mcpServers / extraTools / excludedTools: 从 vscode.lm.tools 筛选 MCP 工具
 */
export function getToolsForRole(role: ChatRoleInfo): vscode.LanguageModelChatTool[] {
    const tools = [...CHAT_TOOLS];

    // 内置工具包
    for (const name of role.toolSets) {
        const bundle = TOOL_SET_REGISTRY[name];
        if (bundle) {
            tools.push(...bundle);
        } else {
            logger.warn(`[ChatTools] 未知工具包: "${name}"，已跳过`);
        }
    }

    // ─── MCP 工具注入 ────────────────────────────────────────
    const hasMcpConfig =
        (role.mcpServers && role.mcpServers.length > 0) ||
        (role.extraTools && role.extraTools.length > 0) ||
        (role.excludedTools && role.excludedTools.length > 0);

    if (hasMcpConfig) {
        const allVscodeLmTools = vscode.lm.tools;
        const mcpToolNames = new Set<string>();

        // 收集来自指定 MCP server 的所有工具（"*" 表示引入全部）
        if (role.mcpServers && role.mcpServers.length > 0) {
            const includeAll = role.mcpServers.includes('*');
            for (const t of allVscodeLmTools) {
                // VSCode MCP 工具名格式为 "mcp_<serverName>_<toolName>"，用 startsWith 匹配
                if (includeAll || role.mcpServers.some(s =>
                    t.name.startsWith(`mcp_${s}_`) || t.name.startsWith(`${s}_`)
                )) {
                    mcpToolNames.add(t.name);
                }
            }
        }

        // 额外引入的具体工具
        if (role.extraTools) {
            for (const name of role.extraTools) { mcpToolNames.add(name); }
        }

        // 排除的工具
        if (role.excludedTools) {
            for (const name of role.excludedTools) { mcpToolNames.delete(name); }
        }

        // 将筛选出的 MCP 工具转换为 LanguageModelChatTool 格式后追加
        for (const t of allVscodeLmTools) {
            if (!mcpToolNames.has(t.name)) { continue; }
            tools.push({
                name: t.name,
                description: t.description,
                inputSchema: t.inputSchema as vscode.LanguageModelChatTool['inputSchema'],
            });
        }
    }

    return tools;
}

// ─── 工具执行上下文 ─────────────────────────────────────────────

/** 工具执行时需要的角色上下文 */
export interface ToolExecContext {
    /** 当前角色信息（用于记忆/委派等能力工具） */
    role?: ChatRoleInfo;
    /** 当前对话文件 URI（用于对话级工具如 todo） */
    conversationUri?: import('vscode').Uri;
    /** 中止信号 */
    signal?: AbortSignal;
    /**
     * 心跳回调：长时间运行的工具（如同步委派等待）应定期调用此函数，
     * 通知调用方（RoleTimerManager）工具仍在活跃中，避免空闲超时误判。
     */
    onHeartbeat?: () => void;
}

// ─── 工具执行 ─────────────────────────────────────────────────

export interface ToolCallResult {
    success: boolean;
    content: string;
}

/**
 * 执行指定工具并返回结果文本。
 * 能力工具（记忆/委派/角色管理）需要传入 context 提供角色信息。
 */
export async function executeChatTool(
    toolName: string,
    input: Record<string, unknown>,
    context?: ToolExecContext,
): Promise<ToolCallResult> {
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
            case 'link_issue':
                return await executeLinkIssue(input);
            case 'unlink_issue':
                return await executeUnlinkIssue(input);
            case 'get_issue_relations':
                return await executeGetIssueRelations(input);
            case 'move_issue_node':
                return await executeMoveIssueNode(input);
            case 'sort_issue_children':
                return await executeSortIssueChildren(input);
            case 'delete_issue':
                return await executeDeleteIssue(input);
            case 'batch_delete_issues':
                return await executeBatchDeleteIssues(input);
            // ─── 基础工具：对话级 todo ───────────────────────────
            case 'read_todos':
                return await executeReadTodos(context);
            case 'write_todos':
                return await executeWriteTodos(input, context);
            case 'update_todo':
                return await executeUpdateTodo(input, context);
            // ─── 能力工具：记忆 ─────────────────────────────────
            case 'read_memory':
                return await executeReadMemory(context);
            case 'write_memory':
                return await executeWriteMemory(input, context);
            // ─── 能力工具：委派 ─────────────────────────────────
            case 'list_chat_roles':
                return await executeListChatRoles(context);
            case 'delegate_to_role':
                return await executeDelegateToRole(input, context);
            case 'continue_delegation':
                return await executeContinueDelegation(input, context);
            case 'get_delegation_status':
                return await executeGetDelegationStatus(input);
            // ─── 能力工具：角色管理 ─────────────────────────────
            case 'list_available_tools':
                return executeListAvailableTools();
            case 'create_chat_role':
                return await executeCreateChatRole(input);
            case 'update_role_config':
                return await executeUpdateRoleConfig(input);
            case 'evaluate_role':
                return await executeEvaluateRole(input, context);
            case 'read_role_execution_logs':
                return await executeReadRoleExecutionLogs(input);
            default: {
                // 尝试通过 vscode.lm.invokeTool 调用 MCP 工具
                const vscodeTool = vscode.lm.tools.find(t => t.name === toolName);
                if (!vscodeTool) {
                    return { success: false, content: `未知工具: ${toolName}` };
                }
                const tokenSource = new vscode.CancellationTokenSource();
                if (context?.signal) {
                    context.signal.addEventListener('abort', () => tokenSource.cancel());
                }
                try {
                    const result = await vscode.lm.invokeTool(
                        toolName,
                        { input, toolInvocationToken: undefined as never },
                        tokenSource.token,
                    );
                    // result 是 LanguageModelToolResult，content 为 LanguageModelTextPart[] | LanguageModelPromptTsxPart[]
                    const text = result.content
                        .map(p => (p instanceof vscode.LanguageModelTextPart ? p.value : '[non-text]'))
                        .join('');
                    return { success: true, content: text };
                } finally {
                    tokenSource.dispose();
                }
            }
        }
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.error(`[ChatTools] 执行工具 ${toolName} 失败`, e);
        return { success: false, content: `工具执行失败: ${msg}` };
    }
}

// ─── 各工具实现 ───────────────────────────────────────────────

async function executeSearchIssues(input: Record<string, unknown>): Promise<ToolCallResult> {
    const queryRaw = String(input.query || '').trim();
    const limit = typeof input.limit === 'number' ? input.limit : 20;
    const scope = String(input.scope || 'all');

    if (!queryRaw) {
        return { success: false, content: '请提供搜索关键词' };
    }

    // 多关键词：空格分隔，全部匹配
    const keywords = queryRaw.toLowerCase().split(/\s+/).filter(Boolean);

    const allIssues = await getAllIssueMarkdowns({});

    // 评分搜索：标题匹配权重高，frontmatter 次之，正文最低
    const scored: { issue: typeof allIssues[number]; score: number; bodyContent?: string }[] = [];

    for (const issue of allIssues) {
        const titleLower = issue.title.toLowerCase();
        const fmStr = issue.frontmatter ? JSON.stringify(issue.frontmatter).toLowerCase() : '';

        let score = 0;
        let allMatched = true;

        for (const kw of keywords) {
            const inTitle = titleLower.includes(kw);
            const inFm = fmStr.includes(kw);

            if (inTitle) {
                score += 10;
            } else if (inFm) {
                score += 5;
            } else if (scope !== 'title') {
                // 需要搜正文时延迟读取
                score = -1; // 标记待检查
                break;
            } else {
                allMatched = false;
                break;
            }
        }

        // 标题/frontmatter 已全部匹配
        if (allMatched && score > 0) {
            scored.push({ issue, score });
            continue;
        }

        // 需要检查正文（scope !== 'title' 且有关键词未在标题/fm 中命中）
        if (score === -1 && scope !== 'title') {
            try {
                const bodyContent = await getIssueMarkdownContent(issue.uri);
                const bodyLower = bodyContent.toLowerCase();
                let bodyScore = 0;
                let bodyAllMatched = true;

                for (const kw of keywords) {
                    const inTitle = titleLower.includes(kw);
                    const inFm = fmStr.includes(kw);
                    const inBody = bodyLower.includes(kw);

                    if (inTitle) { bodyScore += 10; }
                    else if (inFm) { bodyScore += 5; }
                    else if (inBody) { bodyScore += 1; }
                    else { bodyAllMatched = false; break; }
                }

                if (bodyAllMatched && bodyScore > 0) {
                    scored.push({ issue, score: bodyScore });
                }
            } catch { /* 读取失败跳过 */ }
        }
    }

    // 按分数降序，同分按 mtime 降序
    scored.sort((a, b) => b.score - a.score || b.issue.mtime - a.issue.mtime);

    const matches = scored.slice(0, limit);

    if (matches.length === 0) {
        return { success: true, content: `未找到匹配「${queryRaw}」的笔记。` };
    }

    const lines = matches.map((m, i) => {
        const fileName = path.basename(m.issue.uri.fsPath);
        const fm = m.issue.frontmatter as Record<string, unknown> | null;
        // 类型标签：从 frontmatter 中提取有意义的类型标记
        const tags: string[] = [];
        if (fm?.chat_role) { tags.push('角色'); }
        else if (fm?.chat_conversation) { tags.push('对话'); }
        else if (fm?.chat_execution_log) { tags.push('日志'); }
        else if (fm?.chat_tool_call) { tags.push('工具调用'); }
        else if (fm?.chat_group) { tags.push('群组'); }
        else if (fm?.assistant_memory) { tags.push('记忆'); }

        const tagStr = tags.length > 0 ? ` \`${tags.join('/')}\`` : '';
        const age = formatAge(m.issue.mtime);

        return `${i + 1}. ${issueLink(m.issue.title, fileName)}${tagStr} (${age})`;
    });

    return {
        success: true,
        content: `找到 ${matches.length} 条匹配结果：\n${lines.join('\n')}`,
    };
}

/** 将时间戳格式化为相对时间描述 */
function formatAge(mtime: number): string {
    const diff = Date.now() - mtime;
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) { return '刚刚'; }
    if (mins < 60) { return `${mins}分钟前`; }
    const hours = Math.floor(mins / 60);
    if (hours < 24) { return `${hours}小时前`; }
    const days = Math.floor(hours / 24);
    return `${days}天前`;
}

async function executeReadIssue(input: Record<string, unknown>): Promise<ToolCallResult> {
    const issueDir = getIssueDir();
    if (!issueDir) {
        return { success: false, content: '问题目录未配置' };
    }

    const fileName = normalizeFileName(String(input.fileName || '').trim(), issueDir);
    if (!fileName) {
        return { success: false, content: '请提供文件名' };
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
        content: `📖 ${issueLink(issue.title, fileName)}\n\n${truncated}`,
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
        content: `✅ 已创建 ${issueLink(title, fileName)}`,
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

    const fileName = normalizeFileName(String(input.fileName || '').trim(), issueDir);
    if (!fileName) {
        return { success: false, content: '请提供文件名' };
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
        content: `✅ 已更新 ${issueLink(issue.title, fileName)}`,
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
        content: `✅ 已将 ${issueLink(fileName, fileName)} 移动到 ${target} 第 ${safeIndex} 位`,
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
        content: `✅ 已对 ${target} 的子节点按「${byLabel[by]}」${order === 'asc' ? '升序' : '降序'} 排序${recursive ? '（含所有子孙节点）' : ''}`,
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
            content: `✅ 已将 ${issueLink(childFileName, childFileName)} 移动到 ${target} 下`,
        };
    } else {
        // 不在树中 → 创建节点
        await createIssueNodes([childUri], parentNodeId);

        const target = parentFileName ? issueLink(parentFileName, parentFileName) : '根级';
        return {
            success: true,
            content: `✅ 已将 ${issueLink(childFileName, childFileName)} 关联到 ${target} 下`,
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
        return { success: true, content: `✅ 已将 ${issueLink(fileName, fileName)} 从树中移除` };
    } else {
        // 移到根级
        const parent = findParentNodeById(treeData.rootNodes, node.id);
        if (!parent) {
            return { success: true, content: `${issueLink(fileName, fileName)} 已在根级，无需操作` };
        }
        moveNode(treeData, node.id, null, 0);
        await writeTree(treeData);
        return { success: true, content: `✅ 已将 ${issueLink(fileName, fileName)} 移到根级` };
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
    return { success: true, content: `✅ 已删除 ${issueLink(fileName, fileName)}${extra}，并解除树关联` };
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
        lines.push(`✅ 已删除 ${filesToDelete.size - failed.length} 个笔记并解除树关联`);
    }
    if (notFound.length > 0) { lines.push(`⚠️ 文件不存在（已跳过）: ${notFound.join(', ')}`); }
    if (failed.length > 0) { lines.push(`❌ 删除失败: ${failed.join(', ')}`); }

    return { success: failed.length === 0, content: lines.join('\n') };
}

// ─── 基础工具实现：对话级 todo ────────────────────────────────

interface TodoItem {
    id: number;
    content: string;
    status: 'pending' | 'in_progress' | 'done';
}

/** 从对话文件 frontmatter 读取 chat_todos 字段 */
async function readTodosFromConversation(uri: vscode.Uri): Promise<TodoItem[]> {
    const raw = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
    const { frontmatter } = extractFrontmatterAndBody(raw);
    const fm = frontmatter as Record<string, unknown> | null;
    const todos = fm?.chat_todos;
    if (!Array.isArray(todos)) { return []; }
    return todos.map((t: Record<string, unknown>, i: number) => ({
        id: typeof t.id === 'number' ? t.id : i + 1,
        content: String(t.content ?? ''),
        status: (['pending', 'in_progress', 'done'].includes(String(t.status)) ? String(t.status) : 'pending') as TodoItem['status'],
    }));
}

/** 将 todo 列表写回对话文件 frontmatter */
async function writeTodosToConversation(uri: vscode.Uri, todos: TodoItem[]): Promise<void> {
    // 转为纯对象数组用于 YAML 序列化
    const payload = todos.map(t => ({ id: t.id, content: t.content, status: t.status }));
    await updateIssueMarkdownFrontmatter(uri, { chat_todos: payload } as unknown as FrontmatterData);
}

async function executeReadTodos(context?: ToolExecContext): Promise<ToolCallResult> {
    if (!context?.conversationUri) {
        return { success: false, content: '无法获取当前对话文件' };
    }
    try {
        const todos = await readTodosFromConversation(context.conversationUri);
        if (todos.length === 0) {
            return { success: true, content: '当前对话暂无 todo 项。可使用 write_todos 创建任务列表。' };
        }
        return { success: true, content: JSON.stringify(todos, null, 2) };
    } catch (e) {
        return { success: false, content: `读取 todo 失败: ${e}` };
    }
}

async function executeWriteTodos(input: Record<string, unknown>, context?: ToolExecContext): Promise<ToolCallResult> {
    if (!context?.conversationUri) {
        return { success: false, content: '无法获取当前对话文件' };
    }
    const rawTodos = input.todos;
    if (!Array.isArray(rawTodos)) {
        return { success: false, content: '参数 todos 必须是数组' };
    }
    const todos: TodoItem[] = rawTodos.map((t: Record<string, unknown>, i: number) => ({
        id: i + 1,
        content: String(t.content ?? ''),
        status: (['pending', 'in_progress', 'done'].includes(String(t.status)) ? String(t.status) : 'pending') as TodoItem['status'],
    }));
    try {
        await writeTodosToConversation(context.conversationUri, todos);
        const summary = todos.map(t => {
            const icon = t.status === 'done' ? '✅' : t.status === 'in_progress' ? '🔄' : '⬚';
            return `${icon} ${t.id}. ${t.content}`;
        }).join('\n');
        return { success: true, content: `已写入 ${todos.length} 个 todo 项：\n${summary}` };
    } catch (e) {
        return { success: false, content: `写入 todo 失败: ${e}` };
    }
}

async function executeUpdateTodo(input: Record<string, unknown>, context?: ToolExecContext): Promise<ToolCallResult> {
    if (!context?.conversationUri) {
        return { success: false, content: '无法获取当前对话文件' };
    }
    const id = Number(input.id);
    if (!id || isNaN(id)) {
        return { success: false, content: '请提供有效的 todo id（数字）' };
    }
    try {
        const todos = await readTodosFromConversation(context.conversationUri);
        const target = todos.find(t => t.id === id);
        if (!target) {
            return { success: false, content: `找不到 id=${id} 的 todo 项。当前 id 列表: ${todos.map(t => t.id).join(', ') || '（空）'}` };
        }
        if (input.status && ['pending', 'in_progress', 'done'].includes(String(input.status))) {
            target.status = String(input.status) as TodoItem['status'];
        }
        if (typeof input.content === 'string' && input.content.trim()) {
            target.content = input.content.trim();
        }
        await writeTodosToConversation(context.conversationUri, todos);
        const icon = target.status === 'done' ? '✅' : target.status === 'in_progress' ? '🔄' : '⬚';
        return { success: true, content: `已更新: ${icon} ${target.id}. ${target.content} [${target.status}]` };
    } catch (e) {
        return { success: false, content: `更新 todo 失败: ${e}` };
    }
}

// ─── 能力工具实现：记忆 ──────────────────────────────────────

/** 查找或创建角色的记忆文件，返回 URI */
async function findOrCreateMemoryFile(roleId: string): Promise<vscode.Uri | null> {
    const all = await getAllIssueMarkdowns({});
    for (const md of all) {
        if (md.frontmatter?.role_memory === true
            && md.frontmatter?.role_memory_owner_id === roleId) {
            return md.uri;
        }
    }
    // 不存在 → 创建
    const fm: Partial<FrontmatterData> & RoleMemoryFrontmatter = {
        role_memory: true,
        role_memory_owner_id: roleId,
    } as Partial<FrontmatterData> & RoleMemoryFrontmatter;
    const body = `# 角色记忆\n\n（暂无，将在对话中逐步积累）\n`;
    const uri = await createIssueMarkdown({ frontmatter: fm as Partial<FrontmatterData>, markdownBody: body });
    if (uri) {
        logger.info(`[ChatTools] 已创建角色 ${roleId} 的记忆文件: ${uri.fsPath}`);
        // 挂在角色的树节点下
        const role = await getChatRoleById(roleId);
        const roleNode = role?.uri ? await getSingleIssueNodeByUri(role.uri) : undefined;
        await createIssueNodes([uri], roleNode?.id);
    }
    return uri ?? null;
}

async function executeReadMemory(context?: ToolExecContext): Promise<ToolCallResult> {
    if (!context?.role?.toolSets.includes('memory') || !context.role.id) {
        return { success: false, content: '当前角色未启用记忆能力' };
    }
    const memUri = await findOrCreateMemoryFile(context.role.id);
    if (!memUri) { return { success: false, content: '记忆文件不存在且创建失败' }; }
    try {
        const raw = Buffer.from(await vscode.workspace.fs.readFile(memUri)).toString('utf8');
        const { body } = extractFrontmatterAndBody(raw);
        return { success: true, content: `**[角色记忆]**\n\n${body.trim() || '（记忆为空）'}` };
    } catch (e) {
        logger.error('[ChatTools] 读取记忆失败', e);
        return { success: false, content: '读取记忆失败' };
    }
}

async function executeWriteMemory(input: Record<string, unknown>, context?: ToolExecContext): Promise<ToolCallResult> {
    if (!context?.role?.toolSets.includes('memory') || !context.role.id) {
        return { success: false, content: '当前角色未启用记忆能力' };
    }
    const content = String(input.content || '').trim();
    if (!content) { return { success: false, content: '请提供记忆内容' }; }
    const memUri = await findOrCreateMemoryFile(context.role.id);
    if (!memUri) { return { success: false, content: '记忆文件不存在且创建失败' }; }
    try {
        const ok = await updateIssueMarkdownBody(memUri, content);
        return ok
            ? { success: true, content: '✅ 记忆已更新' }
            : { success: false, content: '记忆更新失败' };
    } catch (e) {
        logger.error('[ChatTools] 写入记忆失败', e);
        return { success: false, content: '记忆写入失败' };
    }
}

// ─── 能力工具实现：委派 ──────────────────────────────────────

async function executeListChatRoles(context?: ToolExecContext): Promise<ToolCallResult> {
    const roles = await getAllChatRoles();
    // 排除自身
    const filtered = context?.role ? roles.filter(r => r.id !== context.role!.id) : roles;
    if (filtered.length === 0) {
        return { success: true, content: '当前没有其他可用角色。可以用 create_chat_role 创建新角色。' };
    }
    const config = vscode.workspace.getConfiguration('issueManager');
    const globalDefault = config.get<string>('llm.modelFamily') || 'gpt-5-mini';
    const prompts = await Promise.all(filtered.map(r => getRoleSystemPrompt(r.uri)));
    const lines = filtered.map((r, i) => {
        const prompt = prompts[i];
        const promptPreview = prompt
            ? prompt.slice(0, 60) + (prompt.length > 60 ? '…' : '')
            : '（无提示词）';
        const model = r.modelFamily ? r.modelFamily : `${globalDefault}（全局默认）`;
        const capStr = r.toolSets.length > 0 ? ` · 工具集: ${r.toolSets.join('/')}` : '';
        return `- **${r.name}** (ID: \`${r.id}\`) · 模型: ${model}${capStr}\n  ${promptPreview}`;
    });
    return { success: true, content: `可用角色（共 ${filtered.length} 个）：\n\n${lines.join('\n\n')}` };
}

/** 按名称或 ID 查找角色 */
async function findRole(nameOrId: string): Promise<ChatRoleInfo | undefined> {
    const roles = await getAllChatRoles();
    const lower = nameOrId.toLowerCase();
    return roles.find(r =>
        r.id === nameOrId
        || r.name === nameOrId
        || r.name.toLowerCase() === lower,
    );
}

/** 读取委派对话的 chat_log_id，返回追溯链接文本（无日志时返回空字符串） */
async function getDelegationLogTrace(convoUri: vscode.Uri, convoId: string): Promise<string> {
    try {
        const raw = Buffer.from(await vscode.workspace.fs.readFile(convoUri)).toString('utf8');
        const { frontmatter } = extractFrontmatterAndBody(raw);
        const logId = (frontmatter as Record<string, unknown> | null)?.chat_log_id as string | undefined;
        if (logId) {
            return `\n> 📋 执行日志 [${logId}](IssueDir/${logId}.md)（对话 ${convoId} 的完整执行记录）`;
        }
    } catch { /* ignore */ }
    return '';
}

async function executeDelegateToRole(input: Record<string, unknown>, context?: ToolExecContext): Promise<ToolCallResult> {
    if (!context?.role?.toolSets.includes('delegation')) {
        return { success: false, content: '当前角色未启用委派能力' };
    }
    const roleNameOrId = String(input.roleNameOrId || '').trim();
    const task = String(input.task || '').trim();
    const isAsync = input.async === true;
    if (!roleNameOrId) { return { success: false, content: '请提供角色名称或 ID' }; }
    if (!task) { return { success: false, content: '请提供委派任务描述' }; }

    // 总调用次数保护
    if (_delegationTotalCalls >= MAX_DELEGATION_TOTAL_CALLS) {
        return { success: false, content: `委派总调用次数超限（最大 ${MAX_DELEGATION_TOTAL_CALLS} 次），请简化任务链` };
    }

    // 递归深度保护（异步委派不占深度）
    if (!isAsync && _delegationDepth >= MAX_DELEGATION_DEPTH) {
        return { success: false, content: `委派深度超限（最大 ${MAX_DELEGATION_DEPTH} 层），请简化任务链` };
    }

    const role = await findRole(roleNameOrId);
    if (!role) {
        return { success: false, content: `找不到角色「${roleNameOrId}」，请先用 list_chat_roles 查看可用角色。` };
    }

    // 创建真实对话文件（委派对话默认自主模式）
    const taskPreview = task.length > 30 ? task.slice(0, 30) + '…' : task;
    const convoTitle = `[委派] ${taskPreview}`;
    const convoUri = await createConversation(role.id, convoTitle);
    if (!convoUri) {
        return { success: false, content: '创建委派对话文件失败' };
    }
    // 委派对话自动启用自主模式
    await updateIssueMarkdownFrontmatter(convoUri, { chat_autonomous: true } as Partial<FrontmatterData>);
    const convoId = path.basename(convoUri.fsPath, '.md');
    logger.info(`[ChatTools] 委派开始 → 角色「${role.name}」| 对话 ${convoId} | 模式: ${isAsync ? '异步' : '同步'}`);

    // 写入用户消息 + queued 标记
    await appendUserMessageQueued(convoUri, task);

    // 触发执行
    await RoleTimerManager.getInstance().triggerConversation(convoUri);

    // ── 异步模式：立即返回 convoId，不等待结果 ──
    if (isAsync) {
        return {
            success: true,
            content: `✅ 已异步委派给「${role.name}」，对话 ID: \`${convoId}\`\n用 get_delegation_status 查询结果。\n> 💬 [${convoId}](IssueDir/${convoId}.md)`,
        };
    }

    // ── 同步模式：等待执行完成 ──
    _delegationDepth++;
    _delegationTotalCalls++;
    try {
        const reply = await waitForDelegationResult(convoUri, role.name, context.signal, context.onHeartbeat);
        logger.info(`[ChatTools] 委派结束 → 角色「${role.name}」| 回复长度: ${reply.length}`);
        void vscode.commands.executeCommand('issueManager.llmChat.refresh');

        // 读取委派对话的执行日志 ID，用于跨对话追溯
        const logTraceInfo = await getDelegationLogTrace(convoUri, convoId);

        return {
            success: true,
            content: `**[${role.name} 的回复]** (对话: \`${convoId}\`)\n\n${reply}\n\n---\n💡 如需继续与该角色对话，请使用 \`continue_delegation(convoId="${convoId}", message="你的追问")\`。\n> 💬 委派对话 [${convoId}](IssueDir/${convoId}.md)${logTraceInfo}`,
        };
    } finally {
        _delegationDepth--;
        // 顶层委派完成时重置总调用计数器
        if (_delegationDepth === 0) { _delegationTotalCalls = 0; }
    }
}

async function executeContinueDelegation(input: Record<string, unknown>, context?: ToolExecContext): Promise<ToolCallResult> {
    if (!context?.role?.toolSets.includes('delegation')) {
        return { success: false, content: '当前角色未启用委派能力' };
    }

    const convoId = String(input.convoId || '').trim().replace(/\.md$/, '');
    const message = String(input.message || '').trim();
    const isAsync = input.async === true;
    if (!convoId) { return { success: false, content: '请提供委派对话 ID（convoId）' }; }
    if (!message) { return { success: false, content: '请提供追问内容' }; }

    // 总调用次数保护
    if (_delegationTotalCalls >= MAX_DELEGATION_TOTAL_CALLS) {
        return { success: false, content: `委派总调用次数超限（最大 ${MAX_DELEGATION_TOTAL_CALLS} 次），请简化任务链` };
    }

    // 递归深度保护（异步追问不占深度）
    if (!isAsync && _delegationDepth >= MAX_DELEGATION_DEPTH) {
        return { success: false, content: `委派深度超限（最大 ${MAX_DELEGATION_DEPTH} 层），请简化任务链` };
    }

    // 解析对话文件
    const issueDir = getIssueDir();
    if (!issueDir) { return { success: false, content: 'issue 目录未配置' }; }

    const convoUri = vscode.Uri.joinPath(vscode.Uri.file(issueDir), `${convoId}.md`);
    try { await vscode.workspace.fs.stat(convoUri); } catch {
        return { success: false, content: `找不到委派对话文件: ${convoId}` };
    }

    // ── 前置检查 ──

    // 检查并发锁：对话不能正在执行中
    const timerManager = RoleTimerManager.getInstance();
    if (timerManager.isExecuting(convoUri)) {
        return { success: false, content: '该对话正在执行中，请等待完成后再追问' };
    }

    // 检查状态标记：对话不能有 queued/executing/retrying 标记
    const marker = await readStateMarker(convoUri);
    if (marker && marker.status !== 'error') {
        return { success: false, content: `该对话当前状态为 ${marker.status}，无法追加消息。请等待当前轮次完成。` };
    }

    // 检查最后一条消息必须是 assistant（确认上轮已完成）
    const messages = await parseConversationMessages(convoUri);
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.role !== 'assistant') {
        return { success: false, content: '上一轮对话尚未收到回复，无法追问。请先等待或用 get_delegation_status 检查状态。' };
    }

    // 从对话文件获取角色信息
    const convoContent = Buffer.from(await vscode.workspace.fs.readFile(convoUri)).toString('utf8');
    const roleIdMatch = /^chat_role_id:\s*(.+)$/m.exec(convoContent);
    const roleId = roleIdMatch?.[1]?.trim();
    if (!roleId) {
        return { success: false, content: '无法从对话文件中获取角色 ID' };
    }
    const role = await getChatRoleById(roleId);
    const roleName = role?.name ?? roleId;

    logger.info(`[ChatTools] 追问委派 → 角色「${roleName}」| 对话 ${convoId} | 模式: ${isAsync ? '异步' : '同步'}`);

    // 写入追问消息 + queued 标记
    await appendUserMessageQueued(convoUri, message);

    // 触发执行
    await timerManager.triggerConversation(convoUri);

    // ── 异步模式 ──
    if (isAsync) {
        _delegationTotalCalls++;
        return {
            success: true,
            content: `✅ 已异步追问「${roleName}」，对话 ID: \`${convoId}\`\n用 get_delegation_status 查询结果。\n> 💬 [${convoId}](IssueDir/${convoId}.md)`,
        };
    }

    // ── 同步模式 ──
    _delegationDepth++;
    _delegationTotalCalls++;
    try {
        const reply = await waitForDelegationResult(convoUri, roleName, context.signal, context.onHeartbeat);
        logger.info(`[ChatTools] 追问完成 → 角色「${roleName}」| 对话 ${convoId} | 回复长度: ${reply.length}`);
        void vscode.commands.executeCommand('issueManager.llmChat.refresh');

        const logTraceInfo = await getDelegationLogTrace(convoUri, convoId);

        return {
            success: true,
            content: `**[${roleName} 的追问回复]** (对话: \`${convoId}\`)\n\n${reply}\n\n---\n💡 如需继续追问，请使用 \`continue_delegation(convoId="${convoId}", message="你的追问")\`。如果任务已完成，无需再调用。\n> 💬 委派对话 [${convoId}](IssueDir/${convoId}.md)${logTraceInfo}`,
        };
    } finally {
        _delegationDepth--;
        if (_delegationDepth === 0) { _delegationTotalCalls = 0; }
    }
}

async function executeGetDelegationStatus(input: Record<string, unknown>): Promise<ToolCallResult> {
    const convoId = String(input.convoId || '').trim().replace(/\.md$/, '');
    if (!convoId) { return { success: false, content: '请提供委派对话 ID（convoId）' }; }

    const issueDir = getIssueDir();
    if (!issueDir) { return { success: false, content: 'issue 目录未配置' }; }

    const convoUri = vscode.Uri.joinPath(vscode.Uri.file(issueDir), `${convoId}.md`);
    try { await vscode.workspace.fs.stat(convoUri); } catch {
        return { success: false, content: `找不到委派对话文件: ${convoId}` };
    }

    const marker = await readStateMarker(convoUri);

    // 无 marker = 执行成功（RoleTimerManager 成功后会移除标记）
    if (!marker) {
        const messages = await parseConversationMessages(convoUri);
        const last = messages.filter(m => m.role === 'assistant').pop();
        const reply = last?.content?.trim() || '（角色未返回任何内容）';
        return {
            success: true,
            content: `✅ **委派已完成** | 对话: [${convoId}](IssueDir/${convoId}.md)\n\n${reply}`,
        };
    }

    switch (marker.status) {
        case 'queued':
            return { success: true, content: `⏳ **等待执行中** | 对话: [${convoId}](IssueDir/${convoId}.md)` };
        case 'executing':
            return { success: true, content: `🔄 **执行中** | 对话: [${convoId}](IssueDir/${convoId}.md)` };
        case 'retrying': {
            const retryAt = marker.retryAt
                ? new Date(marker.retryAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                : '未知';
            return { success: true, content: `⚠️ **重试中（第 ${marker.retryCount} 次）** | 预计 ${retryAt} 重试 | 对话: [${convoId}](IssueDir/${convoId}.md)` };
        }
        case 'error':
            return { success: false, content: `❌ **委派失败** | ${marker.message || '未知错误'} | 对话: [${convoId}](IssueDir/${convoId}.md)` };
        default:
            return { success: true, content: `❓ 未知状态 | 对话: [${convoId}](IssueDir/${convoId}.md)` };
    }
}

/** 等待委派对话被 RoleTimerManager 处理完成 */
function waitForDelegationResult(
    convoUri: vscode.Uri,
    roleName: string,
    signal?: AbortSignal,
    onHeartbeat?: () => void,
): Promise<string> {
    return new Promise<string>(resolve => {
        const timerManager = RoleTimerManager.getInstance();

        // 心跳定时器：每 10s 通知调用方工具仍在活跃，防止空闲超时误判
        const heartbeatId = onHeartbeat
            ? setInterval(() => onHeartbeat(), 10_000)
            : undefined;

        const cleanup = () => {
            disposable.dispose();
            clearTimeout(timeout);
            if (heartbeatId !== undefined) { clearInterval(heartbeatId); }
            signal?.removeEventListener('abort', onAbort);
        };
        const disposable = timerManager.onDidChange(async (e) => {
            if (e.uri.fsPath !== convoUri.fsPath) { return; }
            if (e.success) {
                cleanup();
                const messages = await parseConversationMessages(convoUri);
                const last = messages.filter(m => m.role === 'assistant').pop();
                resolve(last?.content?.trim() || '（角色未返回任何内容）');
            } else {
                const marker = await readStateMarker(convoUri);
                if (marker?.status === 'retrying') {
                    logger.info(`[ChatTools] 委派给「${roleName}」重试中（${marker.retryCount}次）`);
                    return;
                }
                cleanup();
                const errMsg = marker?.message || '未知错误';
                resolve(`委派给「${roleName}」时出错: ${errMsg}`);
            }
        });
        const timeout = setTimeout(() => {
            cleanup();
            resolve(`委派给「${roleName}」超时，请查看对话文件了解进度`);
        }, 120_000);
        const onAbort = () => { cleanup(); resolve('（已取消）'); };
        signal?.addEventListener('abort', onAbort);
    });
}

// ─── 能力工具实现：角色管理 ──────────────────────────────────

function executeListAvailableTools(): ToolCallResult {
    const BUILT_IN = [
        { id: '(基础)',          tools: 'read_todos、write_todos、update_todo',               desc: '对话级 todo 管理，所有角色默认可用，无需配置' },
        { id: 'memory',          tools: 'read_memory、write_memory',                          desc: '持久记忆，适合长期任务角色' },
        { id: 'delegation',      tools: 'delegate_to_role、continue_delegation、list_chat_roles、get_delegation_status', desc: '委派能力（delegate_to_role 发起 → continue_delegation 多轮追问直到完成），适合中枢调度角色' },
        { id: 'role_management', tools: 'list_available_tools、create_chat_role、update_role_config 等', desc: '角色管理，仅管理型角色需要' },
        { id: 'browser',         tools: 'web_search、fetch_url、list_tabs、click_element 等', desc: 'Chrome 浏览器工具，需要扩展连接' },
    ];

    const builtInSection = [
        '## 内置工具包（tool_sets）',
        ...BUILT_IN.map(s => `- ${s.id}: ${s.tools} — ${s.desc}`),
    ].join('\n');

    // 从 vscode.lm.tools 解析 MCP server
    const serverToolsMap = new Map<string, string[]>();
    for (const tool of vscode.lm.tools) {
        const match = tool.name.match(/^mcp_([^_]+)_(.+)$/);
        if (match) {
            const server = match[1];
            if (!serverToolsMap.has(server)) { serverToolsMap.set(server, []); }
            serverToolsMap.get(server)!.push(match[2]);
        }
    }

    let mcpSection: string;
    if (serverToolsMap.size === 0) {
        mcpSection = '## 已注册 MCP Server（mcp_servers）\n（当前未注册任何 MCP 工具）';
    } else {
        const lines = [...serverToolsMap.entries()].map(([server, tools]) =>
            `- ${server} (${tools.length} 个工具): ${tools.join('、')}`
        );
        mcpSection = ['## 已注册 MCP Server（mcp_servers）', '> 按角色职责按需选择 server，避免使用 "*"（会将全部工具注入上下文，消耗大量 token）', ...lines].join('\n');
    }

    return { success: true, content: `${builtInSection}\n\n${mcpSection}` };
}

async function executeCreateChatRole(input: Record<string, unknown>): Promise<ToolCallResult> {
    const name = String(input.name || '').trim();
    const systemPrompt = String(input.systemPrompt || '').trim();
    const avatar = String(input.avatar || 'hubot').trim();
    const modelFamily = input.modelFamily ? String(input.modelFamily).trim() : undefined;
    const toolSets: string[] = Array.isArray(input.toolSets)
        ? (input.toolSets as unknown[]).map(String)
        : [];
    const mcpServers: string[] = Array.isArray(input.mcpServers)
        ? (input.mcpServers as unknown[]).map(String)
        : [];

    if (!name) { return { success: false, content: '请提供角色名称' }; }
    if (!systemPrompt) { return { success: false, content: '请提供系统提示词' }; }

    const roleId = await dataCreateChatRole(name, systemPrompt, avatar, modelFamily, toolSets, mcpServers);
    if (!roleId) {
        return { success: false, content: '创建角色失败' };
    }
    void vscode.commands.executeCommand('issueManager.llmChat.refresh');

    const capStr = toolSets.length > 0 ? `，工具集：${toolSets.join('/')}` : '';
    const mcpStr = mcpServers.length > 0 ? `，MCP：${mcpServers.join('/')}` : '';
    const modelNote = modelFamily ? `，模型：${modelFamily}` : '';
    return {
        success: true,
        content: `✅ 已创建角色「${name}」(ID: \`${roleId}\`${modelNote}${capStr}${mcpStr})。`,
    };
}

async function executeUpdateRoleConfig(input: Record<string, unknown>): Promise<ToolCallResult> {
    const roleNameOrId = String(input.roleNameOrId || '').trim();
    const newSystemPrompt = String(input.newSystemPrompt || '').trim();
    const reason = input.reason ? String(input.reason) : undefined;

    if (!roleNameOrId) { return { success: false, content: '请提供角色名称或 ID' }; }
    if (!newSystemPrompt) { return { success: false, content: '请提供新的系统提示词' }; }

    const role = await findRole(roleNameOrId);
    if (!role) { return { success: false, content: `未找到角色「${roleNameOrId}」` }; }

    try {
        const ok = await updateRoleSystemPrompt(role.uri, newSystemPrompt);
        if (!ok) { return { success: false, content: '更新失败' }; }
        void vscode.commands.executeCommand('issueManager.llmChat.refresh');
        const reasonStr = reason ? `\n更新原因：${reason}` : '';
        return { success: true, content: `✅ 已更新角色「${role.name}」的系统提示词${reasonStr}` };
    } catch (e) {
        logger.error('[ChatTools] 更新角色配置失败', e);
        return { success: false, content: '更新角色配置失败' };
    }
}

async function executeEvaluateRole(input: Record<string, unknown>, context?: ToolExecContext): Promise<ToolCallResult> {
    const roleNameOrId = String(input.roleNameOrId || '').trim();
    const outcome = String(input.outcome || 'partial') as 'success' | 'partial' | 'failed';
    const notes = String(input.notes || '').trim();

    if (!roleNameOrId) { return { success: false, content: '请提供角色名称或 ID' }; }
    if (!notes) { return { success: false, content: '请提供评估说明' }; }

    const outcomeLabel = outcome === 'success' ? '✅ 良好' : outcome === 'partial' ? '⚠️ 部分完成' : '❌ 未完成';

    // 如果当前角色有记忆能力，将评估写入记忆
    if (context?.role?.toolSets.includes('memory') && context.role.id) {
        const memUri = await findOrCreateMemoryFile(context.role.id);
        if (memUri) {
            try {
                const raw = Buffer.from(await vscode.workspace.fs.readFile(memUri)).toString('utf8');
                const { body } = extractFrontmatterAndBody(raw);
                const timestamp = new Date().toISOString().slice(0, 10);
                const entry = `\n### ${roleNameOrId} — ${timestamp} ${outcomeLabel}\n${notes}\n`;
                let newBody: string;
                if (body.includes('## 角色绩效')) {
                    newBody = body.replace('## 角色绩效', `## 角色绩效${entry}`);
                } else {
                    newBody = body + `\n## 角色绩效${entry}`;
                }
                await updateIssueMarkdownBody(memUri, newBody);
            } catch (e) {
                logger.error('[ChatTools] 写入评估到记忆失败', e);
            }
        }
    }

    return { success: true, content: `✅ 已记录角色「${roleNameOrId}」的绩效评估：${outcomeLabel}` };
}

async function executeReadRoleExecutionLogs(input: Record<string, unknown>): Promise<ToolCallResult> {
    const roleNameOrId = String(input.roleNameOrId || '').trim();
    const maxConversations = typeof input.maxConversations === 'number' ? Math.max(1, input.maxConversations) : 5;

    if (!roleNameOrId) { return { success: false, content: '请提供角色名称或 ID' }; }

    const role = await findRole(roleNameOrId);
    if (!role) { return { success: false, content: `未找到角色: ${roleNameOrId}` }; }

    const issueDir = getIssueDir();
    if (!issueDir) { return { success: false, content: '未找到 issueDir' }; }

    const conversations = await getConversationsForRole(role.id);
    const recentConvos = conversations.sort((a, b) => b.mtime - a.mtime).slice(0, maxConversations);

    if (recentConvos.length === 0) {
        return { success: true, content: `角色「${role.name}」没有对话记录。` };
    }

    // ─── 聚合统计 ────────────────────────────────────────────
    const toolCallCounts: Record<string, number> = {};
    let totalRuns = 0;
    let successRuns = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    const recentErrors: string[] = [];
    /** 失败原因分类计数 */
    const failureCategories: Record<string, number> = {};
    let analyzedLogs = 0;

    for (const convo of recentConvos) {
        if (!convo.logId) { continue; }
        const logUri = vscode.Uri.file(path.join(issueDir, `${convo.logId}.md`));
        try {
            const raw = Buffer.from(await vscode.workspace.fs.readFile(logUri)).toString('utf8');
            analyzedLogs++;

            // Run 数量
            const runMatches = [...raw.matchAll(/## Run #(\d+)/g)];
            totalRuns += runMatches.length;

            // 成功数：匹配 "✅ **成功**"
            const successMatches = raw.match(/✅ \*\*成功\*\*/g);
            successRuns += successMatches?.length ?? 0;

            // 工具调用：匹配 backtick 包裹的工具名 + 括号内的耗时
            // 覆盖多种日志格式：
            //   Timer:  ✅ [`tool_name`](link) (1.2s)  或  ✅ `tool_name` (250ms)
            //   Direct: 🔧 `tool_name` (250ms) → result
            //   委派:   📥✅ **委派结果** [`delegate_to_role`](link) (3.2s)
            for (const m of raw.matchAll(/`([^`]+)`[^\n]*?\((\d+(?:\.\d+)?(?:ms|s))\)/g)) {
                const t = m[1];
                // 排除非工具调用行（如 LLM 轮次摘要中的工具名列表）
                // 工具调用行包含状态图标 ✅❌🔧📥 或 ⏳
                const lineStart = raw.lastIndexOf('\n', m.index!) + 1;
                const linePrefix = raw.slice(lineStart, m.index!);
                if (/[✅❌🔧📥]/.test(linePrefix)) {
                    toolCallCounts[t] = (toolCallCounts[t] ?? 0) + 1;
                }
            }

            // Token 消耗
            for (const m of raw.matchAll(/input (\d+) \+ output (\d+)/g)) {
                totalInputTokens += parseInt(m[1], 10);
                totalOutputTokens += parseInt(m[2], 10);
            }

            // 错误信息：匹配 "❌ **失败...** | 耗时 ... | 错误详情"
            for (const m of raw.matchAll(/❌ \*\*失败[^|]*\|[^|]*\| (.+)/g)) {
                const errMsg = m[1];
                recentErrors.push(errMsg);
                // 归类失败原因
                const cat = /空响应/.test(errMsg) ? '空响应'
                    : /超时|timeout/i.test(errMsg) ? '超时'
                    : /abort|中止/i.test(errMsg) ? '用户中止'
                    : '其他错误';
                failureCategories[cat] = (failureCategories[cat] ?? 0) + 1;
            }

            // 空闲超时（单独的日志格式）
            const idleTimeouts = raw.match(/⏰ \*\*空闲超时\*\*/g);
            if (idleTimeouts) {
                failureCategories['空闲超时'] = (failureCategories['空闲超时'] ?? 0) + idleTimeouts.length;
            }
        } catch {
            // 日志文件不可读，跳过
        }
    }

    if (analyzedLogs === 0) {
        return { success: true, content: `角色「${role.name}」有 ${recentConvos.length} 个对话，但均无执行日志。` };
    }

    // ─── 与配置对比 ──────────────────────────────────────────
    const configuredTools = getToolsForRole(role).map(t => t.name);
    const usedTools = Object.keys(toolCallCounts);
    const neverUsed = configuredTools.filter(t => !usedTools.includes(t));

    // ─── 读取 system prompt 长度 ─────────────────────────────
    let promptLength = 0;
    try {
        const fullPrompt = await getRoleSystemPrompt(role.uri);
        promptLength = fullPrompt.length;
    } catch { /* 读取失败不影响报告 */ }

    // ─── 组装报告 ────────────────────────────────────────────
    let report = `## 角色「${role.name}」执行日志分析\n\n`;
    report += `**分析范围**: 最近 ${recentConvos.length} 个对话 / ${analyzedLogs} 份日志 / ${totalRuns} 次执行\n\n`;

    report += `### 当前配置\n`;
    report += `- 工具集 (tool_sets): ${role.toolSets.length > 0 ? role.toolSets.join(', ') : '（无）'}\n`;
    report += `- MCP servers: ${role.mcpServers?.length ? role.mcpServers.join(', ') : '（无）'}\n`;
    report += `- 配置工具总数: **${configuredTools.length}**\n`;
    if (promptLength > 0) {
        report += `- System prompt 长度: ${promptLength} 字（需查看全文请调用 read_issue）\n`;
    }
    report += '\n';

    if (totalRuns > 0) {
        const successRate = Math.round(successRuns / totalRuns * 100);
        const totalTokens = totalInputTokens + totalOutputTokens;
        report += `### 执行指标\n`;
        report += `- 成功率: ${successRuns}/${totalRuns} (**${successRate}%**)\n`;
        report += `- 累计 token: input ${totalInputTokens} + output ${totalOutputTokens} = **${totalTokens}**\n`;
        report += `- 平均 token/次: ${Math.round(totalTokens / totalRuns)}\n\n`;

        const totalCalls = Object.values(toolCallCounts).reduce((a, b) => a + b, 0);
        if (usedTools.length > 0) {
            report += `### 实际工具调用（共 ${totalCalls} 次）\n`;
            for (const [tool, count] of Object.entries(toolCallCounts).sort((a, b) => b[1] - a[1])) {
                const pct = Math.round(count / totalCalls * 100);
                report += `- \`${tool}\`: ${count} 次 (${pct}%)\n`;
            }
            report += '\n';
        } else {
            report += `### 实际工具调用\n无任何工具调用记录。\n\n`;
        }

        if (neverUsed.length > 0) {
            // 按来源分组：内置工具 vs MCP 工具，避免冗长的逐个列举
            const neverUsedBuiltin = neverUsed.filter(t => !t.startsWith('mcp_'));
            const neverUsedMcp = neverUsed.filter(t => t.startsWith('mcp_'));
            report += `### ⚠️ 配置但从未调用的工具（${neverUsed.length}/${configuredTools.length}）\n`;
            report += `> 这些工具占用了 LLM 上下文 token，但从未被使用，可考虑移除。\n\n`;
            if (neverUsedBuiltin.length > 0) {
                report += `**内置工具** (${neverUsedBuiltin.length})：${neverUsedBuiltin.map(t => `\`${t}\``).join(', ')}\n`;
            }
            if (neverUsedMcp.length > 0) {
                // MCP 工具按 server 前缀分组汇总，不逐个列出
                const mcpGroups: Record<string, number> = {};
                for (const t of neverUsedMcp) {
                    const parts = t.split('_');
                    const server = parts.length >= 3 ? `${parts[0]}_${parts[1]}` : t;
                    mcpGroups[server] = (mcpGroups[server] ?? 0) + 1;
                }
                const groupSummary = Object.entries(mcpGroups).map(([s, n]) => `${s} (${n})`).join(', ');
                report += `**MCP 工具** (${neverUsedMcp.length})：${groupSummary}\n`;
            }
            report += '\n';
        }

        // 失败原因分布
        const failureCats = Object.entries(failureCategories);
        if (failureCats.length > 0) {
            report += `### 失败原因分布\n`;
            for (const [cat, count] of failureCats.sort((a, b) => b[1] - a[1])) {
                report += `- ${cat}: ${count} 次\n`;
            }
            report += '\n';
        }

        if (recentErrors.length > 0) {
            const uniqueErrors = [...new Set(recentErrors)].slice(0, 3);
            report += `### 近期错误样例（取 ${uniqueErrors.length} 条去重）\n`;
            for (const e of uniqueErrors) { report += `- ${e}\n`; }
            report += '\n';
        }
    }

    return { success: true, content: report };
}
