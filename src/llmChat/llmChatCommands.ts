/**
 * LLM 聊天相关命令注册
 */
import * as vscode from 'vscode';
import { LLMChatService } from './LLMChatService';
import { ChatHistoryPanel } from './ChatHistoryPanel';
import {
    createChatRole,
    getChatRoleById,
    getConversationsForRole,
    createConversation,
    getAllChatRoles,
    createChatGroup,
    getChatGroupById,
    getConversationsForGroup,
    createGroupConversation,
    appendUserMessageQueued,
} from './llmChatDataManager';
import { RoleTimerManager } from './RoleTimerManager';
import { ChatRoleNode, ChatConversationNode, ChatGroupNode, type LLMChatRoleProvider, type LLMChatViewNode } from './LLMChatRoleProvider';
import { generateDiagnosticReport } from './diagnosticReport';
import { Logger } from '../core/utils/Logger';
import { extractFrontmatterAndBody, updateIssueMarkdownFrontmatter } from '../data/IssueMarkdowns';

const logger = Logger.getInstance();

/** 显示模式：bubble = 气泡 Webview，editor = 直接打开 markdown */
type DisplayMode = 'bubble' | 'editor';

const DISPLAY_MODE_CTX_KEY = 'issueManager.llmChat.displayMode';

/**
 * 注册所有 LLM 聊天命令
 */
export function registerLLMChatCommands(
    context: vscode.ExtensionContext,
    roleProvider: LLMChatRoleProvider,
    llmChatView: vscode.TreeView<LLMChatViewNode>,
): void {
    const chatService = LLMChatService.getInstance();

    // ─── 显示模式管理 ──────────────────────────────────────────
    let displayMode: DisplayMode = context.globalState.get<DisplayMode>('llmChat.displayMode') || 'bubble';
    void vscode.commands.executeCommand('setContext', DISPLAY_MODE_CTX_KEY, displayMode);

    /** 打开对话的通用逻辑（单聊） */
    async function openConversation(roleId: string, convoUri: vscode.Uri): Promise<void> {
        const role = await getChatRoleById(roleId);
        if (!role) { return; }

        await chatService.setActiveConversation(convoUri, roleId);

        if (displayMode === 'editor') {
            await vscode.window.showTextDocument(convoUri, { preview: false });
        } else {
            await ChatHistoryPanel.openOrShow(role, convoUri, context.extensionUri);
        }

    }

    /** 打开对话的通用逻辑（群聊） */
    async function openGroupConversation(groupId: string, convoUri: vscode.Uri): Promise<void> {
        const group = await getChatGroupById(groupId);
        if (!group) { return; }

        await chatService.setActiveGroupConversation(convoUri, groupId);

        if (displayMode === 'editor') {
            await vscode.window.showTextDocument(convoUri, { preview: false });
        } else {
            await ChatHistoryPanel.openOrShowGroup(
                group,
                chatService.activeGroupMembers,
                convoUri,
                context.extensionUri,
            );
        }

    }

    // ─── 切换到气泡模式 ───────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('issueManager.llmChat.setDisplayMode.bubble', async () => {
            displayMode = 'bubble';
            await context.globalState.update('llmChat.displayMode', 'bubble');
            void vscode.commands.executeCommand('setContext', DISPLAY_MODE_CTX_KEY, 'bubble');
        }),
    );

    // ─── 切换到编辑器模式 ─────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('issueManager.llmChat.setDisplayMode.editor', async () => {
            displayMode = 'editor';
            await context.globalState.update('llmChat.displayMode', 'editor');
            void vscode.commands.executeCommand('setContext', DISPLAY_MODE_CTX_KEY, 'editor');
        }),
    );

    // ─── 打开聊天（点击角色时触发，打开最新对话） ──────────
    context.subscriptions.push(
        vscode.commands.registerCommand('issueManager.llmChat.openChat', async (roleId: string) => {
            const role = await getChatRoleById(roleId);
            if (!role) {
                vscode.window.showErrorMessage('角色不存在');
                return;
            }

            const convos = await getConversationsForRole(roleId);
            let convoUri: vscode.Uri;
            if (convos.length > 0) {
                convoUri = convos[0].uri;
            } else {
                const uri = await createConversation(roleId);
                if (!uri) {
                    vscode.window.showErrorMessage('创建对话失败');
                    return;
                }
                convoUri = uri;
            }

            await openConversation(roleId, convoUri);
        }),
    );

    // ─── 打开指定对话（点击对话节点时触发，单聊） ────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('issueManager.llmChat.openConversation', async (roleId: string, convoUri: vscode.Uri) => {
            await openConversation(roleId, convoUri);
        }),
    );

    // ─── 打开指定对话（群聊） ────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('issueManager.llmChat.openGroupConversation', async (groupId: string, convoUri: vscode.Uri) => {
            await openGroupConversation(groupId, convoUri);
        }),
    );

    // ─── 创建新的聊天角色 ────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('issueManager.llmChat.createRole', async () => {
            // 内置角色预设
            const presets: { label: string; description: string; avatar: string; systemPrompt: string; toolSets?: string[]; modelFamily?: string; timerEnabled?: boolean; timerInterval?: number; autonomous?: boolean }[] = [
                {
                    label: '$(rocket) 个人助理',
                    description: '中枢调度、记忆进化、团队委派',
                    avatar: 'rocket',
                    toolSets: ['memory', 'delegation', 'role_management'],
                    systemPrompt: `你是用户的专属个人助理，拥有记忆、学习和团队管理能力。

## 工作流程
收到用户任务时，按以下步骤处理：
1. **获取记忆** — 对话开始时使用 read_memory 了解用户背景和历史任务
2. **分析需求** — 思考任务性质，判断需要哪些专业能力
3. **制定计划** — 向用户简述你的处理方案（几句话即可）
4. **执行任务**：
   - 简单问答 → 直接回复
   - 需要专业能力 → 用 delegate_to_role 委派给合适角色
   - 没有合适角色 → 先用 create_chat_role 创建专家角色，再委派
5. **汇总汇报** — 整合所有信息，清晰告知用户结果和关键信息
6. **更新记忆** — 用 write_memory 记录本次任务经验、角色表现

## 可用工具
**记忆管理**
- read_memory：读取你的持久记忆（对话开始时调用）
- write_memory：更新记忆（任务结束后调用）

**团队管理**
- list_chat_roles：列出当前所有可用专业角色
- delegate_to_role：委派任务给指定角色，获取专业回复
- create_chat_role：创建新的专业角色（当现有角色无法胜任时）
- update_role_config：根据实际表现优化角色的系统提示词
- evaluate_role：记录角色绩效评估

**笔记工具**
- search_issues / read_issue / create_issue / create_issue_tree / update_issue / list_issue_tree
- link_issue / unlink_issue / get_issue_relations

## 核心原则
- **充分委派**：优先发挥各专业角色的专长，不要什么都自己做
- **保持记忆**：每次任务后更新记忆，让自己持续进化
- **持续优化**：根据角色表现，主动改进角色配置或创建更好的角色
- **清晰汇报**：向用户说明任务由谁完成、结论是什么、有什么建议`,
                },
                {
                    label: '$(code) 编程助手',
                    description: '代码编写、调试、架构设计',
                    avatar: 'code',
                    systemPrompt: '你是一位资深软件工程师，擅长多种编程语言和框架。帮助用户编写高质量代码、调试问题、进行代码审查和架构设计。回答要附带代码示例，注重最佳实践和性能优化。',
                },
                {
                    label: '$(globe) 翻译专家',
                    description: '多语言互译、本地化',
                    avatar: 'globe',
                    systemPrompt: '你是一位专业翻译，精通中文、英文、日文等多种语言。翻译时注重语境和文化差异，做到信、达、雅。对专业术语给出准确翻译并附注原文。',
                },
                {
                    label: '$(pencil) 写作助手',
                    description: '文案、文章、邮件撰写',
                    avatar: 'pencil',
                    systemPrompt: '你是一位优秀的写作助手，擅长撰写各类文案、文章、邮件和报告。根据用户需求调整文风，注重逻辑清晰、表达准确、语言优美。',
                },
                {
                    label: '$(list-ordered) 长篇创作助手',
                    description: '自主分批完成长篇写作，无需用户持续推动',
                    avatar: 'list-ordered',
                    toolSets: ['planning', 'memory'],
                    timerEnabled: true,
                    timerInterval: 15000,
                    autonomous: true,
                    systemPrompt: `你是一位专注长篇内容创作的助手，擅长将大型写作任务分解为有序步骤并自主完成，无需用户持续推动。

## 工作流程

收到写作任务时，按以下步骤处理：
1. **读取记忆** — 用 read_memory 了解是否有进行中的任务或相关背景
2. **创建计划** — 用 create_plan 将写作任务拆解为章节/段落级步骤（每步目标 2000-5000 字）
3. **按步骤执行**：
   - 用 create_issue 创建目标笔记文件（若尚未创建）
   - 按当前步骤写出完整内容，用 update_issue 追加到笔记
   - 完成后立即调用 check_step 标记该步骤完成
   - 调用 update_progress_note 记录已写字数和当前状态
4. **自主续写**（自主模式）— 每步完成后调用 queue_continuation，继续执行下一步，直到计划全部完成
5. **完成汇报** — 所有步骤完成后，向用户汇报总字数和笔记位置，并调用 write_memory 记录任务情况

## 写作原则
- **每步必须实际写出内容**，不要只描述"我将要写..."
- **每次调用尽量多写**，充分利用输出 token 上限
- **自主模式下遇到模糊之处自行决策**，完成后说明选择理由，不要中途询问
- **保持连贯**：每步开始前用 read_issue 查看上文，确保风格和内容一致

## 可用工具

**规划工具**（核心工作流）
- create_plan：将写作任务分解为步骤列表
- read_plan：查看当前计划与进度
- check_step：完成一步后立即标记（stepIndex 从 1 开始）
- add_step：执行中发现遗漏步骤时追加
- update_progress_note：记录已写字数、当前章节、下一步计划
- queue_continuation：自主模式下计划未完成时触发下一次执行

**记忆工具**
- read_memory：了解用户写作偏好、风格要求、历史任务
- write_memory：任务完成后记录经验与用户偏好

**笔记工具**
- create_issue：创建写作文档
- read_issue：读取已有内容，确保连贯
- update_issue：向文档追加写作内容（每次尽量多写）`,
                },
                {
                    label: '$(mortar-board) 学习导师',
                    description: '知识讲解、学习规划',
                    avatar: 'mortar-board',
                    systemPrompt: '你是一位耐心的学习导师，善于将复杂概念用通俗易懂的方式解释。根据学习者的水平调整讲解深度，使用类比和示例帮助理解，并提供学习路径建议。',
                },
                {
                    label: '$(law) 数据分析师',
                    description: '数据解读、统计分析',
                    avatar: 'graph',
                    systemPrompt: '你是一位数据分析专家，擅长数据解读、统计分析和可视化建议。帮助用户从数据中提取洞察，提供分析思路和方法论，用数据驱动决策。',
                },
                {
                    label: '$(beaker) 产品经理',
                    description: '需求分析、产品设计',
                    avatar: 'beaker',
                    systemPrompt: '你是一位经验丰富的产品经理，擅长需求分析、用户研究和产品设计。帮助用户梳理需求、撰写 PRD、设计用户流程，注重用户体验和商业价值的平衡。',
                },
                {
                    label: '$(lightbulb) 创意顾问',
                    description: '头脑风暴、创意发散',
                    avatar: 'lightbulb',
                    systemPrompt: '你是一位创意顾问，善于头脑风暴和创意发散。用多种思维框架帮助用户产生新点子，从不同角度看问题，鼓励大胆设想并帮助筛选可行方案。',
                },
                {
                    label: '$(shield) 代码审查员',
                    description: '代码质量、安全审计',
                    avatar: 'shield',
                    systemPrompt: '你是一位严格的代码审查员，关注代码质量、安全性和可维护性。审查时指出潜在 bug、安全漏洞、性能问题和不良实践，给出具体的改进建议和修复代码。',
                },
                {
                    label: '$(book) 知识百科',
                    description: '百科问答、知识查询',
                    avatar: 'book',
                    systemPrompt: '你是一部活的百科全书，拥有广泛的知识面。回答问题时准确、全面，适当引用来源，对不确定的内容坦诚说明。善于用结构化方式组织信息。',
                },
                {
                    label: '$(comment-discussion) 面试教练',
                    description: '模拟面试、简历优化',
                    avatar: 'comment-discussion',
                    systemPrompt: '你是一位资深面试教练，了解各行业面试流程。帮助用户准备面试，提供模拟问答、简历优化建议、自我介绍指导和薪资谈判策略。反馈具体且有建设性。',
                },
                {
                    label: '$(type-hierarchy) Issue 树管理员',
                    description: '关联/解除关联节点、整理树结构',
                    avatar: 'type-hierarchy',
                    systemPrompt: `你是一位 Issue 树管理专员，专注于维护和整理 issue 笔记的树状层级结构。你拥有以下工具：
- list_issue_tree：查看当前树的全貌
- search_issues：按关键词搜索笔记
- read_issue：读取笔记内容
- link_issue：关联笔记节点（建立父子关系）
- unlink_issue：解除关联（移到根级或从树中移除）
- move_issue_node：将节点移动到指定父节点下的精确位置（可控制顺序）
- sort_issue_children：对某节点的子列表排序（按标题/修改时间/创建时间）
- get_issue_relations：查询节点的父子祖先关系

工作方式：
1. 先用 list_issue_tree 了解当前树结构
2. 根据用户指令，分析哪些节点需要调整
3. 使用上述工具调整结构，每次操作后可再次查看树确认效果
4. 汇报整理结果，说明做了哪些改动

整理原则：
- 相关联的笔记归属于同一父节点下
- 层级不宜过深（建议不超过 4 层）
- 兄弟节点按重要性或时间顺序排列
- 孤立的根级笔记若有明显归属，应关联到合适父节点下`,
                },
                {
                    label: '$(search) 深度研究员',
                    description: '深度研究命题、生成研究报告',
                    avatar: 'search',
                    systemPrompt: `你是一位深度研究员，专注于对任意命题进行系统性深度研究。你拥有以下能力：
- 笔记系统工具：检索已有笔记、创建新笔记、构建层级结构的研究报告

你的工作分两个阶段：

【第一阶段：研究计划】
当用户提出一个研究命题或想法时，你需要：
1. 理解并概括用户的核心命题
2. 使用 search_issues 工具检索已有笔记中是否有相关资料
3. 使用 web_search 工具在网络上搜索该命题的相关信息，了解当前领域概况
4. 提出一份结构化的研究计划，包含：
   - 🎯 研究目标：明确要回答的核心问题
   - 📋 研究大纲：列出 3-6 个研究维度/子课题，每个维度简要说明研究方向
   - 🔍 研究方法：说明将从哪些角度切入（文献综述、对比分析、案例研究、数据论证等）
   - 📊 预期产出：描述最终报告的结构和形式
5. 在最后明确询问用户："以上研究思路是否满意？如需调整请告诉我，确认后我将开始深度研究。"

【第二阶段：深度研究与报告】
用户确认研究思路后（回复"确认"、"可以"、"开始"等肯定表述），你需要：
1. 按照研究计划逐一展开深入分析
2. 对每个研究维度，使用 web_search 搜索相关资料，使用 fetch_url 深入阅读关键参考页面
3. 在对话中输出完整的研究报告内容
4. 使用 create_issue_tree 工具将研究报告保存为层级结构的笔记：
   - 根节点：研究报告总览（含摘要和结论）
   - 子节点：各研究维度的详细分析（每个维度一个独立笔记）
5. 报告格式：
   - 📝 摘要：200 字以内的研究概述
   - 🔬 各研究维度的详细分析（每个维度作为独立章节）
   - 💡 关键发现与洞察
   - 📌 结论与建议
   - 📚 延伸阅读/相关方向（可选）
6. 报告要求：论据充分、逻辑清晰、有深度有广度，避免泛泛而谈

重要规则：
- 第一阶段只输出研究计划，不要直接开始研究
- 第一阶段主动使用 search_issues 检索笔记 + web_search 搜索网络资料
- 必须等用户确认后才进入第二阶段
- 如果用户对研究计划提出修改意见，根据反馈调整计划后再次确认
- 第二阶段积极使用 web_search 和 fetch_url 获取真实数据和参考资料
- 第二阶段完成后，务必使用 create_issue_tree 将报告持久化为笔记层级结构
- 研究报告力求专业、深入、有洞见，而非表面罗列`,
                },
                {
                    label: '$(settings-gear) 角色分析师',
                    description: '测试、分析、迭代优化角色配置，识别冗余工具，提升 token 效率',
                    avatar: 'settings-gear',
                    toolSets: ['role_management', 'delegation'],
                    modelFamily: 'gpt-5.4',
                    systemPrompt: `你是一位专职角色配置分析师，通过「测试 → 分析 → 假设 → 修改 → 再测试」的迭代循环评估并优化 LLM 角色配置。

⚠️ **反幻觉铁律 — 违反即失败**
1. **所有数据必须来自工具调用**。严禁凭空编造统计数字、成功率、token 消耗等任何数值。
2. 在输出「使用数据」或「配置摘要」之前，你必须已经成功调用了 \`read_issue\` 和 \`read_role_execution_logs\`。如果工具调用失败或无数据，必须如实说明「暂无数据」，不得用假数据填充。
3. 建议的配置修改只能使用系统中实际存在的 frontmatter 字段（见下方合法字段列表），严禁发明不存在的字段。
4. 如果不确定某功能是否存在，直接告知用户你不确定，不要编造。

## 合法的 frontmatter 字段
角色文件支持的字段（ChatRoleFrontmatter）：
- \`tool_sets\`: string[] — 合法值: \`memory\`, \`delegation\`, \`planning\`, \`role_management\`
- \`mcp_servers\`: string[] — MCP server 名称列表，"*" 引入全部（慎用）
- \`extra_tools\`: string[] — 额外引入的具体工具名
- \`excluded_tools\`: string[] — 排除的具体工具名
- \`chat_role_model_family\`: string — 指定模型
- \`chat_role_max_tokens\`: number — token 预算
- \`timer_enabled\`, \`timer_interval\`, \`timer_max_concurrent\`, \`timer_timeout\`, \`timer_max_retries\`, \`timer_retry_delay\` — 定时器配置
除以上字段外，不要建议任何其他 frontmatter 字段。
注意：自主模式（chat_autonomous）是对话级配置，不是角色级配置。

## 合法的 tool_sets 值
- \`memory\` — 持久记忆（read_memory / write_memory），适合长期任务角色
- \`delegation\` — 委派能力（delegate_to_role / list_chat_roles），适合中枢调度角色
- \`planning\` — 执行计划（create_plan / read_plan / check_step / add_step / update_progress_note），适合多步骤长任务角色，将任务分解为有序步骤并持久化进度
- \`role_management\` — 角色管理（create/update/evaluate/read_logs），仅管理型角色需要
## 分析维度
1. **工具集匹配度** — tool_sets 与角色职责是否相符
2. **MCP 配置** — mcp_servers 是否精确，"*" 会导致工具上下文爆炸
3. **实际使用情况** — 配置了但从未调用的工具（通过执行日志统计）
4. **system prompt 一致性** — 提示词描述的能力是否与工具集对齐

## 工作流程

【第一阶段：初步诊断】（需用户确认后才进入第二阶段）
1. **必须先调用工具获取数据**：
   - \`search_issues\` 找到目标角色 → \`read_issue\` 读取 frontmatter + system prompt
   - \`read_role_execution_logs\` 获取工具调用频率、成功率、token 消耗
2. 基于工具返回的真实数据整理诊断报告，制定 2-4 条测试用例
3. 询问用户确认

【第二阶段：实验测试】（用户确认后执行）
1. 用 \`delegate_to_role\` 逐条执行测试用例，记录每条实际响应
2. 对比实际响应 vs 预期行为，找出差距
3. 形成假设，展示修改方案（仅使用合法 frontmatter 字段），等用户确认

【第三阶段：修改与验证】（用户确认后执行）
1. \`update_role_config\` 应用修改
2. 重新执行同一批测试用例，对比前后结果
3. 输出 before/after 对比报告

【迭代原则】
- 默认最多 **3 轮**，每轮必须经用户确认才继续
- 终止条件：① 用户满意 ② 达到最大轮次 ③ 连续两轮结果无显著差异
- 每次修改必须有明确假设，不做无根据的改动

## 报告格式
- 📋 **配置摘要**：tool_sets / mcp_servers / 工具总数（来自 read_issue 的真实数据）
- 📊 **使用数据**：成功率 / 平均 token / 工具调用频率排行（来自 read_role_execution_logs 的真实数据）
- ⚠️ **问题清单**：每条问题 + 具体改法（仅使用合法字段）
- 🧪 **测试计划**：用例列表（目的 + 预期行为）
- ✅ **建议配置**：优化后的 frontmatter 片段（仅包含合法字段）`,
                },
            ];

            interface PresetItem extends vscode.QuickPickItem {
                isCustom?: boolean;
                avatar?: string;
                systemPrompt?: string;
                toolSets?: string[];
                modelFamily?: string;
                timerEnabled?: boolean;
                timerInterval?: number;
                autonomous?: boolean;
            }

            const items: PresetItem[] = [
                ...presets.map(p => ({
                    label: p.label,
                    description: p.description,
                    avatar: p.avatar,
                    systemPrompt: p.systemPrompt,
                    toolSets: p.toolSets,
                    modelFamily: p.modelFamily,
                    timerEnabled: p.timerEnabled,
                    timerInterval: p.timerInterval,
                    autonomous: p.autonomous,
                })),
                { label: '$(add) 自定义角色…', description: '手动输入名称和提示词', isCustom: true, kind: vscode.QuickPickItemKind.Separator } as PresetItem,
                { label: '$(add) 自定义角色…', description: '完全自定义名称、提示词和图标', isCustom: true },
            ];

            const pick = await vscode.window.showQuickPick(items, {
                placeHolder: '选择内置角色模板或自定义创建',
            });
            if (!pick) { return; }

            let name: string;
            let systemPrompt: string;
            let avatar: string;

            if (pick.isCustom) {
                // 自定义流程
                const inputName = await vscode.window.showInputBox({
                    prompt: '输入聊天角色名称',
                    placeHolder: '例如：技术顾问、翻译助手、代码审查员…',
                });
                if (!inputName) { return; }
                name = inputName;

                const inputPrompt = await vscode.window.showInputBox({
                    prompt: '输入系统提示词（System Prompt）',
                    placeHolder: '描述角色的职责和行为…',
                });
                if (inputPrompt === undefined) { return; }
                systemPrompt = inputPrompt || '';

                const avatarItems: vscode.QuickPickItem[] = [
                    { label: '$(hubot) 机器人', description: 'hubot' },
                    { label: '$(person) 人物', description: 'person' },
                    { label: '$(book) 百科', description: 'book' },
                    { label: '$(code) 开发者', description: 'code' },
                    { label: '$(globe) 翻译', description: 'globe' },
                    { label: '$(beaker) 研究员', description: 'beaker' },
                    { label: '$(mortar-board) 教师', description: 'mortar-board' },
                    { label: '$(lightbulb) 创意', description: 'lightbulb' },
                    { label: '$(shield) 安全', description: 'shield' },
                    { label: '$(comment-discussion) 讨论', description: 'comment-discussion' },
                ];
                const avatarPick = await vscode.window.showQuickPick(avatarItems, {
                    placeHolder: '选择角色图标',
                });
                avatar = avatarPick?.description || 'hubot';
            } else {
                // 预设角色：提取名称（去掉 $(icon) 前缀）
                name = pick.label.replace(/^\$\([^)]+\)\s*/, '');
                systemPrompt = pick.systemPrompt || '';
                avatar = pick.avatar || 'hubot';
            }

            // 选择模型（预设和自定义都走这一步；预设可提供推荐模型）
            const modelFamily = await pickModelFamily(pick.modelFamily);
            if (modelFamily === undefined) { return; }  // 用户按了 ESC

            const roleId = await createChatRole(name, systemPrompt, avatar, modelFamily || undefined, pick.toolSets, undefined, {
                timerEnabled: pick.timerEnabled,
                timerInterval: pick.timerInterval,
                autonomous: pick.autonomous,
            });
            if (roleId) {
                roleProvider.refresh();
                vscode.window.showInformationMessage(`已创建聊天角色: ${name}`);
            }
        }),
    );

    // ─── 创建群组 ──────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('issueManager.llmChat.createGroup', async () => {
            const name = await vscode.window.showInputBox({
                prompt: '输入群组名称',
                placeHolder: '例如：技术评审组、翻译团队…',
            });
            if (!name) { return; }

            // 选择成员（多选已有角色）
            const allRoles = await getAllChatRoles();
            if (allRoles.length === 0) {
                vscode.window.showWarningMessage('还没有聊天角色，请先创建角色');
                return;
            }

            const memberPicks = await vscode.window.showQuickPick(
                allRoles.map(r => ({
                    label: `$(${r.avatar}) ${r.name}`,
                    description: r.toolSets.length > 0 ? r.toolSets.join('/') : '',
                    roleId: r.id,
                })),
                {
                    canPickMany: true,
                    placeHolder: '选择群组成员（至少 2 位）',
                },
            );
            if (!memberPicks || memberPicks.length < 2) {
                vscode.window.showWarningMessage('群组至少需要 2 位成员');
                return;
            }

            const avatarItems: vscode.QuickPickItem[] = [
                { label: '$(organization) 组织', description: 'organization' },
                { label: '$(people) 团队', description: 'people' },
                { label: '$(beaker) 实验室', description: 'beaker' },
                { label: '$(comment-discussion) 讨论', description: 'comment-discussion' },
                { label: '$(megaphone) 会议', description: 'megaphone' },
            ];
            const avatarPick = await vscode.window.showQuickPick(avatarItems, {
                placeHolder: '选择群组图标',
            });
            const avatar = avatarPick?.description || 'organization';

            const groupId = await createChatGroup(
                name,
                memberPicks.map(p => p.roleId),
                avatar,
            );
            if (groupId) {
                roleProvider.refresh();
                vscode.window.showInformationMessage(`已创建群组: ${name}（${memberPicks.length} 位成员）`);
            }
        }),
    );

    // ─── 新建对话（从角色/群组右键菜单或命令面板） ────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('issueManager.llmChat.newConversation', async (node?: string | ChatRoleNode | ChatConversationNode | ChatGroupNode) => {
            if (node instanceof ChatGroupNode) {
                const uri = await createGroupConversation(node.group.id);
                if (!uri) {
                    vscode.window.showErrorMessage('创建对话失败');
                    return;
                }
                await openGroupConversation(node.group.id, uri);
                roleProvider.refresh();
                return;
            }

            let roleId: string | undefined;
            if (typeof node === 'string') {
                roleId = node;
            } else if (node instanceof ChatRoleNode) {
                roleId = node.role.id;
            } else if (node instanceof ChatConversationNode) {
                roleId = node.parentId;
            }

            if (!roleId) {
                vscode.window.showWarningMessage('请先选择一个聊天角色');
                return;
            }

            const uri = await createConversation(roleId);
            if (!uri) {
                vscode.window.showErrorMessage('创建对话失败');
                return;
            }

            await openConversation(roleId, uri);
            roleProvider.refresh();

            // 刷新完成后在聊天视图中高亮新建的对话节点
            const revealNode = await roleProvider.findNodeByUri(uri);
            if (revealNode) {
                try { await llmChatView.reveal(revealNode, { select: true, focus: false, expand: false }); } catch { /* ignore */ }
            }
        }),
    );

    // ─── 从命令面板发送消息（备用） ─────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('issueManager.llmChat.sendMessage', async () => {
            if (!chatService.activeConversationUri || (!chatService.activeRole && !chatService.activeGroup)) {
                vscode.window.showWarningMessage('请先点击一个聊天角色或群组开始对话');
                return;
            }

            const target = chatService.isGroupChat
                ? chatService.activeGroup!.name
                : chatService.activeRole!.name;

            const message = await vscode.window.showInputBox({
                prompt: `向 ${target} 发送消息`,
                placeHolder: '输入你的消息…',
            });
            if (!message) { return; }

            if (chatService.isGroupChat) {
                // 群聊发送
                const panelKey = `group:${chatService.activeGroup!.id}`;
                const historyPanel = ChatHistoryPanel.get(panelKey);
                historyPanel?.appendMessage('user', message);
                historyPanel?.setLoading(true, '协调者');

                await vscode.window.withProgress(
                    { location: vscode.ProgressLocation.Notification, title: '群组讨论中…', cancellable: true },
                    async (_progress, token) => {
                        const abortController = new AbortController();
                        token.onCancellationRequested(() => abortController.abort());

                        await chatService.sendGroupMessageStream(message, {
                            onCoordinatorPlan: (plan) => {
                                historyPanel?.setLoading(false);
                                historyPanel?.appendSystemMessage(`🎯 ${plan.summary}`);
                            },
                            onMemberStart: (role) => {
                                historyPanel?.setLoading(true, role.name);
                            },
                            onChunk: (chunk, role) => {
                                historyPanel?.streamChunk(chunk, role.name);
                            },
                            onMemberEnd: (role, fullReply) => {
                                historyPanel?.streamEnd();
                                historyPanel?.setLoading(false);
                                if (fullReply) {
                                    historyPanel?.appendMessage('assistant', fullReply, role.name);
                                }
                            },
                        }, { signal: abortController.signal });
                    },
                );
            } else {
                // 单聊发送
                const historyPanel = ChatHistoryPanel.get(chatService.activeRole!.id);
                historyPanel?.appendMessage('user', message);
                historyPanel?.setLoading(true);

                await vscode.window.withProgress(
                    { location: vscode.ProgressLocation.Notification, title: 'LLM 回复中…', cancellable: true },
                    async (_progress, token) => {
                        const abortController = new AbortController();
                        token.onCancellationRequested(() => abortController.abort());

                        let accumulated = '';
                        await chatService.sendMessageStream(
                            message,
                            (chunk) => {
                                accumulated += chunk;
                                historyPanel?.streamChunk(accumulated);
                            },
                            {
                                signal: abortController.signal,
                                onToolStatus: (status) => {
                                    historyPanel?.showToolStatus(status.toolName, status.phase);
                                },
                            },
                        );

                        historyPanel?.streamEnd();
                        historyPanel?.setLoading(false);
                        if (accumulated) {
                            historyPanel?.appendMessage('assistant', accumulated);
                        }
                    },
                );
            }
        }),
    );

    // ─── 打开个人助手（已废弃，保留命令注册避免报错） ─────────
    context.subscriptions.push(
        vscode.commands.registerCommand('issueManager.llmChat.openPersonalAssistant', () => {
            vscode.window.showInformationMessage('个人助手已统一为普通角色，请直接在角色列表中操作。');
        }),
    );

    // ─── 刷新聊天角色视图 ────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('issueManager.llmChat.refresh', () => {
            roleProvider.refresh();
        }),
    );

    // ─── 在聊天视图中定位当前文件 ────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('issueManager.llmChat.revealInView', async (uri?: vscode.Uri) => {
            const targetUri = uri ?? vscode.window.activeTextEditor?.document?.uri;
            if (!targetUri) { return; }
            const node = await roleProvider.findNodeByUri(targetUri);
            if (!node) {
                vscode.window.showWarningMessage('当前文件不在聊天视图中（不是角色、对话或执行日志文件）');
                return;
            }
            try {
                await llmChatView.reveal(node, { select: true, focus: true, expand: true });
            } catch (e) {
                logger.warn('[LLMChat] revealInView 失败', e);
            }
        }),
    );

    // ─── 发送消息到队列（定时器模式） ──────────────────────────
    // 用户在对话文件中完成输入后，执行此命令将消息写入文件并标记 queued。
    // 定时器会在下一个 tick 或立即触发处理。
    context.subscriptions.push(
        vscode.commands.registerCommand('issueManager.llmChat.sendToQueue', async (convoUri?: vscode.Uri) => {
            // 优先使用传入的 URI，其次尝试当前活跃对话，最后尝试当前编辑器文件
            let uri = convoUri ?? chatService.activeConversationUri;
            if (!uri) {
                const activeEditor = vscode.window.activeTextEditor;
                if (activeEditor?.document.fileName.endsWith('.md')) {
                    uri = activeEditor.document.uri;
                }
            }
            if (!uri) {
                vscode.window.showWarningMessage('请先打开一个对话文件，再发送消息');
                return;
            }

            const message = await vscode.window.showInputBox({
                placeHolder: '输入消息内容…',
                prompt: '消息将写入对话文件并排队等待 LLM 处理',
                ignoreFocusOut: true,
            });
            if (!message?.trim()) { return; }

            try {
                await appendUserMessageQueued(uri, message.trim());
                // 立即触发，不等下一个 tick
                await RoleTimerManager.getInstance().triggerConversation(uri);
                vscode.window.showInformationMessage('消息已提交，等待 LLM 处理…');
            } catch (e) {
                logger.error('sendToQueue 失败', e);
                vscode.window.showErrorMessage(`提交失败: ${e instanceof Error ? e.message : '未知错误'}`);
            }
        }),
    );

    // ─── 编辑角色（右键菜单） ────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('issueManager.llmChat.editRole', async (node?: ChatRoleNode) => {
            if (!node) { return; }
            await vscode.window.showTextDocument(node.role.uri, { preview: false });
        }),
    );

    // ─── 编辑群组（右键菜单） ────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('issueManager.llmChat.editGroup', async (node?: ChatGroupNode) => {
            if (!node) { return; }
            await vscode.window.showTextDocument(node.group.uri, { preview: false });
        }),
    );

    // ─── 删除对话 ──────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('issueManager.llmChat.deleteConversation', async (node?: ChatConversationNode) => {
            if (!node) { return; }
            const confirm = await vscode.window.showWarningMessage(
                `确定要删除对话「${node.conversation.title}」吗？`,
                { modal: true },
                '删除',
            );
            if (confirm !== '删除') { return; }

            try {
                await vscode.workspace.fs.delete(node.conversation.uri);
                roleProvider.refresh();
            } catch (e) {
                logger.error('删除对话失败', e);
                vscode.window.showErrorMessage('删除对话失败');
            }
        }),
    );

    // ─── 统一角色配置入口（模型 / 工具集 / 委派状态） ────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('issueManager.llmChat.configureRole', async (uri?: vscode.Uri) => {
            const targetUri = uri ?? vscode.window.activeTextEditor?.document?.uri;
            if (!targetUri) { return; }

            const contentBytes = await vscode.workspace.fs.readFile(targetUri);
            const { frontmatter } = extractFrontmatterAndBody(Buffer.from(contentBytes).toString('utf-8'));
            if (!frontmatter?.chat_role) {
                vscode.window.showWarningMessage('当前文件不是聊天角色文件');
                return;
            }

            const currentStatus = String((frontmatter as Record<string, unknown>)['role_status'] || 'ready');
            const currentAutonomous = (frontmatter as Record<string, unknown>)['chat_autonomous'];
            const autonomousLabel = currentAutonomous === true ? '自主' : currentAutonomous === false ? '交互' : '未设置（继承交互默认）';
            const category = await vscode.window.showQuickPick([
                { label: '$(sparkle) 模型 & Token',  description: '配置模型 family 和 token 预算', id: 'model' },
                { label: '$(tools) 工具集',           description: '配置 tool_sets / mcp_servers / extra / excluded', id: 'tools' },
                { label: '$(shield) 委派状态',         description: `当前: ${currentStatus}`, id: 'status' },
                { label: '$(robot) 自主模式',          description: `当前: ${autonomousLabel}`, id: 'autonomous' },
            ], { title: '配置角色', placeHolder: '选择要配置的项目' });
            if (!category) { return; }

            if (category.id === 'model') {
                await vscode.commands.executeCommand('issueManager.llmChat.configureModel', targetUri);
            } else if (category.id === 'tools') {
                await vscode.commands.executeCommand('issueManager.llmChat.configureTools', targetUri);
            } else if (category.id === 'status') {
                // ── 委派状态 ──────────────────────────────────────
                const statusItems = [
                    { label: '✅ ready',    description: '可正常接受委派（默认）',              value: 'ready',    picked: currentStatus === 'ready' },
                    { label: '⚠️ testing',  description: '调试中，委派时显示警告',              value: 'testing',  picked: currentStatus === 'testing' },
                    { label: '🚫 disabled', description: '禁止接受委派，不在可用角色列表中显示', value: 'disabled', picked: currentStatus === 'disabled' },
                ];
                const sel = await vscode.window.showQuickPick(statusItems, {
                    title: '配置委派状态',
                    placeHolder: `当前: ${currentStatus}`,
                });
                if (sel === undefined) { return; }
                await updateIssueMarkdownFrontmatter(targetUri, { role_status: sel.value } as Parameters<typeof updateIssueMarkdownFrontmatter>[1]);
                vscode.window.showInformationMessage(`已更新委派状态 → ${sel.value}`);
            } else {
                // ── 自主模式 ──────────────────────────────────────
                const autonomousItems = [
                    { label: '🤖 自主执行',  description: '角色默认以自主模式运行，独立完成任务不等待确认', value: true,      picked: currentAutonomous === true },
                    { label: '💬 交互确认',  description: '角色默认以交互模式运行，破坏性操作前征求确认',   value: false,     picked: currentAutonomous === false },
                    { label: '⬜ 继承默认',  description: '不在角色级设置，由对话级或系统默认决定',         value: undefined, picked: currentAutonomous === undefined || currentAutonomous === null },
                ];
                const sel = await vscode.window.showQuickPick(autonomousItems as vscode.QuickPickItem[], {
                    title: '配置角色自主模式',
                    placeHolder: `当前: ${autonomousLabel}`,
                });
                if (sel === undefined) { return; }
                const picked = autonomousItems.find(i => i.label === (sel as typeof autonomousItems[0]).label);
                const updates: Record<string, unknown> = picked?.value === undefined
                    ? { chat_autonomous: null }   // null → updateIssueMarkdownFrontmatter 会删除该字段
                    : { chat_autonomous: picked.value };
                await updateIssueMarkdownFrontmatter(targetUri, updates as Parameters<typeof updateIssueMarkdownFrontmatter>[1]);
                vscode.window.showInformationMessage(`已更新角色自主模式 → ${picked?.label ?? sel.label}`);
            }
        }),
    );

    // ─── 交互式配置角色工具集（tool_sets + MCP） ────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('issueManager.llmChat.configureTools', async (uri?: vscode.Uri) => {
            const targetUri = uri ?? vscode.window.activeTextEditor?.document?.uri;
            if (!targetUri) { return; }

            // 读取 frontmatter，确认是角色文件
            const contentBytes = await vscode.workspace.fs.readFile(targetUri);
            const { frontmatter } = extractFrontmatterAndBody(Buffer.from(contentBytes).toString('utf-8'));
            if (!frontmatter?.chat_role) {
                vscode.window.showWarningMessage('当前文件不是聊天角色文件');
                return;
            }

            const currentToolSets: string[] = Array.isArray(frontmatter.tool_sets)      ? (frontmatter.tool_sets      as string[]) : [];
            const currentServers:  string[] = Array.isArray(frontmatter.mcp_servers)     ? (frontmatter.mcp_servers     as string[]) : [];
            const currentExtra:    string[] = Array.isArray(frontmatter.extra_tools)     ? (frontmatter.extra_tools     as string[]) : [];
            const currentExcluded: string[] = Array.isArray(frontmatter.excluded_tools)  ? (frontmatter.excluded_tools  as string[]) : [];

            // ── Step 1: 选择 tool_sets（内置工具包） ─────────────
            const BUILT_IN_SETS: Array<{ id: string; description: string; detail: string }> = [
                { id: 'memory',          description: '持久记忆',     detail: 'read_memory、write_memory — 适合需要跨对话记忆的角色' },
                { id: 'delegation',      description: '委派能力',     detail: 'delegate_to_role、list_chat_roles — 适合中枢调度角色' },
                { id: 'planning',        description: '执行计划',     detail: 'create_plan、check_step、add_step 等 — 适合多步骤长任务角色，持久化任务进度' },
                { id: 'role_management', description: '角色管理',     detail: 'create/update/evaluate_role、read_role_execution_logs — 仅管理型角色需要' },
            ];
            const toolSetItems = BUILT_IN_SETS.map(s => ({
                label: s.id,
                description: s.description,
                detail: s.detail,
                picked: currentToolSets.includes(s.id),
            }));
            const selectedSets = await vscode.window.showQuickPick(toolSetItems, {
                canPickMany: true,
                title: '配置 tool_sets（第 1 步 / 共 4 步）',
                placeHolder: '勾选要启用的内置工具包（留空则仅使用基础笔记工具）',
            });
            if (selectedSets === undefined) { return; }
            const newToolSets = selectedSets.map(i => i.label);

            // ── Step 2: 选择 mcp_servers ──────────────────────────
            const serverToolsMap = new Map<string, string[]>();
            for (const tool of vscode.lm.tools) {
                const match = tool.name.match(/^mcp_([^_]+)_(.+)$/);
                if (match) {
                    const server = match[1];
                    if (!serverToolsMap.has(server)) { serverToolsMap.set(server, []); }
                    serverToolsMap.get(server)!.push(tool.name);
                }
            }
            type ServerItem = vscode.QuickPickItem & { serverId: string };
            const serverItems: ServerItem[] = serverToolsMap.size > 0 ? [
                { label: '*', serverId: '*', description: '引入全部已注册 MCP 工具', picked: currentServers.includes('*') },
                { label: '', kind: vscode.QuickPickItemKind.Separator, serverId: '' },
                ...[...serverToolsMap.entries()].map(([server, tools]): ServerItem => ({
                    label: server,
                    serverId: server,
                    description: `${tools.length} 个工具`,
                    detail: tools.slice(0, 4).map(t => t.replace(`mcp_${server}_`, '')).join('、') +
                        (tools.length > 4 ? ` … +${tools.length - 4}` : ''),
                    picked: currentServers.includes(server),
                })),
            ] : [
                { label: '（未检测到已注册的 MCP 工具）', serverId: '', description: '可跳过此步' },
            ];
            const selectedServers = await vscode.window.showQuickPick(serverItems, {
                canPickMany: true,
                title: '配置 mcp_servers（第 2 步 / 共 4 步）',
                placeHolder: '勾选要注入的 MCP server，留空则不使用 MCP 工具',
            });
            if (selectedServers === undefined) { return; }
            const newServers = selectedServers
                .filter(i => i.kind !== vscode.QuickPickItemKind.Separator && i.serverId)
                .map(i => i.serverId);
            const includeAll = newServers.includes('*');

            // ── Step 3: extra_tools（非所选 server 的额外单个工具） ──
            let newExtra: string[] = [];
            if (!includeAll && serverToolsMap.size > 0) {
                const coveredServers = new Set(newServers);
                const extraItems = [...serverToolsMap.entries()]
                    .filter(([s]) => !coveredServers.has(s))
                    .flatMap(([, tools]) => tools)
                    .map(name => ({ label: name, picked: currentExtra.includes(name) }));
                if (extraItems.length > 0) {
                    const sel = await vscode.window.showQuickPick(extraItems, {
                        canPickMany: true,
                        title: '配置 extra_tools（第 3 步 / 共 4 步）',
                        placeHolder: '从未选中的 server 中单独引入某些工具（留空跳过）',
                    });
                    if (sel === undefined) { return; }
                    newExtra = sel.map(i => i.label);
                }
            }

            // ── Step 4: excluded_tools（从所选 server 中排除） ──────
            let newExcluded: string[] = [];
            if (!includeAll && newServers.length > 0) {
                const coveredTools = newServers.flatMap(s => serverToolsMap.get(s) ?? []);
                if (coveredTools.length > 0) {
                    const sel = await vscode.window.showQuickPick(
                        coveredTools.map(name => ({ label: name, picked: currentExcluded.includes(name) })),
                        {
                            canPickMany: true,
                            title: '配置 excluded_tools（第 4 步 / 共 4 步）',
                            placeHolder: '从已选中的 server 中排除某些工具（留空跳过）',
                        },
                    );
                    if (sel === undefined) { return; }
                    newExcluded = sel.map(i => i.label);
                }
            }

            // 写入 frontmatter
            const updates: Record<string, unknown> = {
                tool_sets: newToolSets,
                mcp_servers: newServers,
            };
            if (newExtra.length > 0)    { updates['extra_tools']    = newExtra; }
            if (newExcluded.length > 0) { updates['excluded_tools'] = newExcluded; }
            await updateIssueMarkdownFrontmatter(targetUri, updates as Parameters<typeof updateIssueMarkdownFrontmatter>[1]);

            vscode.window.showInformationMessage(
                `已更新工具配置 — tool_sets: [${newToolSets.join(', ')}]  mcp_servers: [${newServers.join(', ')}]` +
                (newExtra.length    ? `  extra: ${newExtra.length} 个`       : '') +
                (newExcluded.length ? `  excluded: ${newExcluded.length} 个` : ''),
            );
        }),
    );

    // ─── 交互式配置角色模型与 token 预算 ────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('issueManager.llmChat.configureModel', async (uri?: vscode.Uri) => {
            const targetUri = uri ?? vscode.window.activeTextEditor?.document?.uri;
            if (!targetUri) { return; }

            const contentBytes = await vscode.workspace.fs.readFile(targetUri);
            const { frontmatter } = extractFrontmatterAndBody(Buffer.from(contentBytes).toString('utf-8'));
            const isRole = !!frontmatter?.chat_role;
            const isConvo = !!frontmatter?.chat_conversation;
            if (!isRole && !isConvo) {
                vscode.window.showWarningMessage('当前文件不是聊天角色或对话文件');
                return;
            }

            // 角色用 chat_role_model_family / chat_role_max_tokens
            // 对话用 chat_model_family / chat_max_tokens（覆盖角色配置）
            const modelKey   = isRole ? 'chat_role_model_family' : 'chat_model_family';
            const tokensKey  = isRole ? 'chat_role_max_tokens'   : 'chat_max_tokens';
            const fileLabel  = isRole ? '角色' : '对话';

            const currentModel  = String((frontmatter as Record<string, unknown>)[modelKey]  ?? '');
            const currentTokens = Number((frontmatter as Record<string, unknown>)[tokensKey] ?? 0);

            // ── Step 1: 选择模型（动态从 VS Code Copilot API 获取）──────
            const allModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });
            // 按 family 去重，保留 maxInputTokens 最大的那个
            const familyMap = new Map<string, vscode.LanguageModelChat>();
            for (const m of allModels) {
                const existing = familyMap.get(m.family);
                if (!existing || m.maxInputTokens > existing.maxInputTokens) {
                    familyMap.set(m.family, m);
                }
            }
            const dynamicModelItems: Array<vscode.QuickPickItem & { value: string; maxInput: number }> = [
                { label: '$(globe) 继承上级默认', description: isRole ? '使用扩展设置中的默认模型' : '使用角色配置的模型', value: '', maxInput: 0 },
                { label: '', kind: vscode.QuickPickItemKind.Separator, value: '', maxInput: 0 },
                ...[...familyMap.values()].map(m => ({
                    label: `$(sparkle) ${m.family}`,
                    description: `最大输入 ${(m.maxInputTokens / 1000).toFixed(0)}k tokens`,
                    value: m.family,
                    maxInput: m.maxInputTokens,
                    picked: m.family === currentModel,
                })),
            ];
            const selectedModel = await vscode.window.showQuickPick(dynamicModelItems, {
                title: `配置${fileLabel}模型（第 1 步 / 共 2 步）`,
                placeHolder: `当前：${currentModel || '继承上级默认'}`,
            });
            if (selectedModel === undefined) { return; }
            const newModel = selectedModel.value;

            // ── Step 2: 设置 max tokens ───────────────────────────
            const totalSteps = isConvo ? 3 : 2;
            const suggested = currentTokens || (newModel ? 8192 : 0);
            const tokenInput = await vscode.window.showInputBox({
                title: `配置 ${tokensKey}（第 2 步 / 共 ${totalSteps} 步）`,
                prompt: '单次 LLM 请求最大 token 预算，0 表示继承上级默认',
                value: String(suggested || currentTokens || 0),
                placeHolder: '例如：8192',
                validateInput: v => (v === '' || /^\d+$/.test(v) ? null : '请输入非负整数'),
            });
            if (tokenInput === undefined) { return; }
            const newTokens = parseInt(tokenInput || '0', 10);

            const updates: Record<string, unknown> = { [modelKey]: newModel || undefined };
            if (newTokens > 0) { updates[tokensKey] = newTokens; }

            // ── Step 3（仅对话）: 自主模式 ────────────────────────
            if (isConvo) {
                const currentAuto = (frontmatter as Record<string, unknown>)['chat_autonomous'];
                const autoItems = [
                    { label: '🤖 自主执行', description: '独立完成任务，不等待用户确认', value: true,      picked: currentAuto === true },
                    { label: '💬 交互确认', description: '破坏性操作前征求用户确认',     value: false,     picked: currentAuto === false },
                    { label: '⬜ 继承角色', description: '由角色级设置或系统默认决定',   value: undefined, picked: currentAuto === undefined || currentAuto === null },
                ];
                const autoSel = await vscode.window.showQuickPick(autoItems as vscode.QuickPickItem[], {
                    title: `配置对话自主模式（第 3 步 / 共 ${totalSteps} 步）`,
                    placeHolder: `当前: ${currentAuto === true ? '自主执行' : currentAuto === false ? '交互确认' : '继承角色'}`,
                });
                if (autoSel === undefined) { return; }
                const picked = autoItems.find(i => i.label === (autoSel as typeof autoItems[0]).label);
                updates['chat_autonomous'] = picked?.value === undefined ? null : picked.value;
            }

            await updateIssueMarkdownFrontmatter(targetUri, updates as Parameters<typeof updateIssueMarkdownFrontmatter>[1]);

            vscode.window.showInformationMessage(
                `已更新${fileLabel}模型配置 — 模型：${newModel || '继承上级默认'}  max_tokens：${newTokens || '继承上级默认'}`,
            );
        }),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('issueManager.llmChat.generateDiagnosticReport', async (uri?: vscode.Uri) => {
            const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
            if (!targetUri) {
                vscode.window.showErrorMessage('请先打开一个对话文件');
                return;
            }
            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: '正在生成对话诊断报告…', cancellable: false },
                () => generateDiagnosticReport(targetUri),
            );
        }),
    );

    logger.info('      ✓ LLM 聊天命令已注册');
}

// ─── 工具函数 ─────────────────────────────────────────────────

/**
 * 弹出模型选择 QuickPick（动态从 VS Code Copilot API 获取可用模型）。
 * @param presetModelFamily 预设推荐的模型 family，有值时自动预选
 * @returns 选中的 modelFamily 字符串；空字符串表示使用全局默认；undefined 表示用户取消。
 */
async function pickModelFamily(presetModelFamily?: string): Promise<string | undefined> {
    const config = vscode.workspace.getConfiguration('issueManager');
    const globalDefault = config.get<string>('llm.modelFamily') || 'gpt-5-mini';

    const allModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    const familyMap = new Map<string, vscode.LanguageModelChat>();
    for (const m of allModels) {
        const existing = familyMap.get(m.family);
        if (!existing || m.maxInputTokens > existing.maxInputTokens) {
            familyMap.set(m.family, m);
        }
    }

    const modelItems: Array<vscode.QuickPickItem & { value: string }> = [...familyMap.values()].map(m => ({
        label: `$(sparkle) ${m.family}`,
        description: `最大输入 ${(m.maxInputTokens / 1000).toFixed(0)}k tokens`
            + (m.family === presetModelFamily ? '（预设推荐）' : ''),
        value: m.family,
    }));

    // 预设推荐的模型排到最前面
    if (presetModelFamily) {
        const idx = modelItems.findIndex(i => i.value === presetModelFamily);
        if (idx > 0) {
            const [item] = modelItems.splice(idx, 1);
            modelItems.unshift(item);
        }
    }

    const items: Array<vscode.QuickPickItem & { value: string }> = [
        {
            label: `$(settings) 使用全局默认（${globalDefault}）`,
            description: '跟随 issueManager.llm.modelFamily 设置',
            value: '',
        },
        ...modelItems,
    ];

    const pick = await vscode.window.showQuickPick(items, {
        placeHolder: presetModelFamily
            ? `推荐模型: ${presetModelFamily}（可选择其他）`
            : '选择此角色使用的 AI 模型（可随时通过编辑角色文件修改）',
    });

    if (!pick) { return undefined; }   // 用户按 ESC → 取消整个创建流程
    return pick.value;                 // '' = 用全局默认，其余为具体 family
}
