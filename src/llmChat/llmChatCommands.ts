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
import { ChatRoleNode, ChatConversationNode, ChatGroupNode, type LLMChatRoleProvider } from './LLMChatRoleProvider';
import { Logger } from '../core/utils/Logger';

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
            const presets: { label: string; description: string; avatar: string; systemPrompt: string }[] = [
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
                    label: '$(search) 深度研究员',
                    description: '深度研究命题、生成研究报告',
                    avatar: 'search',
                    systemPrompt: `你是一位深度研究员，专注于对任意命题进行系统性深度研究。你拥有以下能力：
- 笔记系统工具：检索已有笔记、创建新笔记、构建层级结构的研究报告
- 网络搜索工具：通过 Chrome 浏览器进行网络搜索和网页内容抓取

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
            ];

            interface PresetItem extends vscode.QuickPickItem {
                isCustom?: boolean;
                avatar?: string;
                systemPrompt?: string;
            }

            const items: PresetItem[] = [
                ...presets.map(p => ({
                    label: p.label,
                    description: p.description,
                    avatar: p.avatar,
                    systemPrompt: p.systemPrompt,
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

            const roleId = await createChatRole(name, systemPrompt, avatar);
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
                    description: r.systemPrompt?.slice(0, 30) || '',
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

    // ─── 刷新聊天角色视图 ────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('issueManager.llmChat.refresh', () => {
            roleProvider.refresh();
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

    logger.info('      ✓ LLM 聊天命令已注册');
}
