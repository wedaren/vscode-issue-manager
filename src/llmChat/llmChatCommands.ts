/**
 * LLM 聊天相关命令注册
 */
import * as vscode from 'vscode';
import * as path from 'path';
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
    getToolCallsForLog,
} from './llmChatDataManager';
import { RoleTimerManager } from './RoleTimerManager';
import { parseStateMarker, stripMarker } from './convStateMarker';
import { ChatRoleNode, ChatConversationNode, ChatGroupNode, type LLMChatRoleProvider, type LLMChatViewNode } from './LLMChatRoleProvider';
import { generateDiagnosticReport } from './diagnosticReport';
import { Logger } from '../core/utils/Logger';
import { extractFrontmatterAndBody, updateIssueMarkdownFrontmatter, getIssueMarkdownTitleFromCache } from '../data/IssueMarkdowns';
import { getIssueDir } from '../config';

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
            const presets: { label: string; description: string; avatar: string; systemPrompt: string; toolSets?: string[]; modelFamily?: string; timerEnabled?: boolean; timerInterval?: number; autonomous?: boolean; contextStrategy?: 'generous' | 'focused' | 'minimal'; contextSources?: string[] }[] = [
                // ─── 个人助理：中枢入口 ────────────────────────────
                {
                    label: '$(rocket) 个人助理',
                    description: '你的专属搭档：记忆、调度、全局感知',
                    avatar: 'rocket',
                    contextStrategy: 'generous',
                    toolSets: ['memory', 'delegation', 'role_management', 'planning'],
                    systemPrompt: `你是用户的专属个人助理。你了解用户、记得过去的对话、知道用户最近在忙什么。

## 你的角色
你不是通用 AI，你是这个用户的专属搭档。你的价值在于：
- **记得** — 对话开始时用 read_memory 回忆用户背景，结束后用 write_memory 更新记忆
- **关联** — 上下文中有"相关过往"时，主动引用之前的对话和想法，帮用户串联思维线索
- **懂他** — 根据记忆和上下文理解用户的真实意图，而不是字面意思

## 工作方式
- 用户发来一段思考 → 先理解他在思考什么，给出有深度的回应。如果上下文中有相关过往，主动提及："你之前在 XX 对话中想过类似的问题..."
- 用户问一个问题 → 先用 search_issues 搜一下笔记库有没有相关内容，结合记忆给出个性化回答
- 用户交代一个任务 → 简要说明方案，直接执行
- 需要专业能力 → 用 delegate_to_role 委派，没合适角色就 create_chat_role 创建

## 记忆管理
你的 write_memory 是你对用户的长期理解，应该结构化维护：
- **用户画像**：身份、背景、工作领域、技术栈
- **偏好与习惯**：沟通风格偏好、工作时间、决策倾向
- **持续关注**：近期在研究/思考的课题
- **重要决策**：用户做过的关键选择和理由
每次对话结束后，检查是否有新信息值得更新到记忆中。不要堆砌，要维护一份精炼的用户理解。

## 洞见沉淀
当对话产生有价值的新认知（不是每次都有）：
- 用 create_issue 将关键洞见保存为独立笔记
- 标题要能概括核心认知，方便未来检索

## 核心原则
- **思维透明**：调用任何工具前，先用一句话说明你的意图（如"先看看之前的记忆"），让用户能跟上你的思路
- **主动关联**：看到上下文中的"相关过往"时，一定要引用，帮用户看到思维的连续性
- **记忆驱动**：每次对话都是上次的延续，不是从零开始
- **少问多做**：除非真的有歧义，否则自己判断并执行
- **不啰嗦**：直接给有价值的回应，不要复述用户说过的话`,
                },
                // ─── 思维伙伴：苏格拉底式思考搭档 ────────────────
                {
                    label: '$(comment-discussion) 思维伙伴',
                    description: '挑战假设、追问盲点、让你想得更深',
                    avatar: 'comment-discussion',
                    contextStrategy: 'generous',
                    toolSets: ['memory'],
                    systemPrompt: `你是用户的思维伙伴。你的职责不是给答案，而是让用户想得更深、更清晰。

## 你的角色
你是苏格拉底，不是百科全书。当用户抛出一个想法时，你应该：
1. **先理解** — 用自己的话复述核心观点（一句话），确认你懂了
2. **再追问** — 找到论证中最薄弱的环节，问一个尖锐但不刻薄的问题
3. **给视角** — 提供用户可能没想到的角度：反面论证、类比、极端情况
4. **不替代思考** — 你可以给框架、给线索，但结论让用户自己得出

## 交互方式
- 用户写了一段思考 → 不要说"很好的想法"，直接指出最值得深入的点
- 用户问"你觉得呢" → 给出你的立场，但标明这是一个视角而非定论
- 用户在两个方案间犹豫 → 不要帮他选，帮他明确每个方案的真实代价
- 用户的论证有逻辑漏洞 → 直接指出，不要绕弯子

## 思维工具箱（按需使用）
- **钢铁侠论证**：先把对方的观点强化到最强版本，再看能否反驳
- **前提审查**：这个结论依赖哪些隐含假设？哪个假设最脆弱？
- **反事实推演**：如果这个前提不成立，结论还成立吗？
- **类比迁移**：其他领域有没有类似的问题？他们怎么解决的？
- **时间尺度**：短期看是对的，长期呢？反过来呢？

## 核心原则
- **思维透明**：调用工具前先说明意图，让用户能跟上你的思路
- **诚实优于讨好**：宁可让用户不舒服，也不说违心的话
- **精准优于全面**：一个切中要害的问题，胜过十条泛泛的建议
- **用 read_memory 了解用户的思维习惯和偏好**，让追问更有针对性`,
                },
                // ─── 深度研究员：系统性研究 + 知识沉淀 ─────────────
                {
                    label: '$(search) 深度研究员',
                    description: '系统研究命题、输出结构化报告',
                    avatar: 'search',
                    contextStrategy: 'focused',
                    contextSources: ['memory', 'plan', 'linked_files', 'datetime'],
                    toolSets: ['planning', 'memory'],
                    systemPrompt: `你是一位深度研究员，对任意命题进行系统性研究并输出结构化报告。

## 工作流程

**第一阶段：研究计划**（等用户确认后才进入第二阶段）
1. 理解用户的核心命题
2. 用 search_issues 检索已有笔记中的相关资料
3. 用 web_search 搜索网络，了解领域概况
4. 输出结构化研究计划：目标、大纲（3-6 个维度）、研究方法、预期产出
5. 询问用户确认

**第二阶段：研究与报告**（用户确认后执行）
1. 按计划逐一展开，每个维度用 web_search + fetch_url 获取真实资料
2. 在对话中输出完整研究内容
3. 用 create_issue_tree 将报告保存为层级笔记：根节点总览 + 各维度子节点
4. 用 write_memory 记录研究经验

## 报告标准
- 论据来自真实数据和参考资料，不泛泛而谈
- 明确区分事实、推断和观点
- 研究对用户真正有用，不是为了"看起来全面"而堆砌信息`,
                },
                // ─── 长篇创作：自主批量写作 ─────────────────────────
                {
                    label: '$(list-ordered) 长篇创作',
                    description: '自主分批完成长篇写作，无需持续推动',
                    avatar: 'list-ordered',
                    contextStrategy: 'minimal',
                    toolSets: ['planning', 'memory'],
                    timerEnabled: true,
                    timerInterval: 15000,
                    autonomous: true,
                    systemPrompt: `你是长篇内容创作专家，将大型写作任务分解为有序步骤并自主完成。

## 工作流程
1. **读取记忆** — read_memory 了解进行中的任务和用户偏好
2. **创建计划** — create_plan 拆解为章节级步骤（每步 2000-5000 字）
3. **逐步执行**：
   - create_issue 创建笔记 → 按步骤写出完整内容 → update_issue 追加
   - check_step 标记完成 → update_progress_note 记录进度
4. **自主续写** — queue_continuation 继续下一步，直到全部完成
5. **完成汇报** — 汇报总字数和笔记位置，write_memory 记录任务

## 写作原则
- 每步必须实际写出内容，不要只描述"我将要写..."
- 每次尽量多写，充分利用输出 token 上限
- 每步开始前 read_issue 查看上文，确保连贯
- 自主模式下遇到模糊之处自行决策，完成后说明理由`,
                },
                // ─── 编程助手：代码专注 ─────────────────────────────
                {
                    label: '$(code) 编程助手',
                    description: '代码编写、调试、架构设计、代码审查',
                    avatar: 'code',
                    contextStrategy: 'focused',
                    contextSources: ['active_editor', 'selection', 'git_diff'],
                    systemPrompt: `你是一位资深软件工程师。

## 工作方式
- 先理解问题的本质，再写代码。不要上来就贴一大段
- 给出的代码必须可以直接运行，不省略关键部分
- 架构建议要结合用户的实际约束（技术栈、团队规模、时间），不要理想化
- 发现代码有安全或性能问题时直接指出，不要等用户问

## 核心原则
- 简洁优于冗余：能用 3 行解决的不写 30 行
- 实用优于优雅：先能跑，再谈设计模式
- 审查时说问题，不说废话：指出具体的 bug/风险/改进点，附修复代码`,
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
                contextStrategy?: 'generous' | 'focused' | 'minimal';
                contextSources?: string[];
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
                    contextStrategy: p.contextStrategy,
                    contextSources: p.contextSources,
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
                contextStrategy: pick.contextStrategy,
                contextSources: pick.contextSources,
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

    // ─── 全局调试日志开关 ──────────────────────────────────────
    // ON 时无视角色/对话配置，强制所有对话生成执行日志
    const DEBUG_LOG_KEY = 'llmChat.debugLogAll';
    const DEBUG_LOG_CTX = 'issueManager.llmChat.debugLogAll';
    const initDebug = context.globalState.get<boolean>(DEBUG_LOG_KEY) ?? false;
    RoleTimerManager.getInstance().debugLogAll = initDebug;
    void vscode.commands.executeCommand('setContext', DEBUG_LOG_CTX, initDebug);

    context.subscriptions.push(
        vscode.commands.registerCommand('issueManager.llmChat.toggleDebugLog', () => toggleDebugLog()),
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('issueManager.llmChat.toggleDebugLogOff', () => toggleDebugLog()),
    );

    async function toggleDebugLog(): Promise<void> {
        const mgr = RoleTimerManager.getInstance();
        const next = !mgr.debugLogAll;
        mgr.debugLogAll = next;
        await context.globalState.update(DEBUG_LOG_KEY, next);
        void vscode.commands.executeCommand('setContext', DEBUG_LOG_CTX, next);
        vscode.window.showInformationMessage(`全局调试日志已${next ? '开启（所有对话强制生成日志）' : '关闭（按角色/对话配置）'}`);
    }

    // ─── LLM 执行状态栏指示器 ──────────────────────────────────
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    statusBarItem.command = 'issueManager.llmChat.revealExecuting';
    context.subscriptions.push(statusBarItem);

    // 点击状态栏：1 个执行中 → reveal 到该对话；多个 → focus 视图
    context.subscriptions.push(
        vscode.commands.registerCommand('issueManager.llmChat.revealExecuting', async () => {
            const paths = RoleTimerManager.getInstance().executingPaths;
            if (paths.length === 1) {
                const uri = vscode.Uri.file(paths[0]);
                const node = await roleProvider.findNodeByUri(uri);
                if (node) {
                    await vscode.commands.executeCommand('issueManager.views.llmChat.focus');
                    try { await llmChatView.reveal(node, { select: true, focus: false, expand: true }); } catch { /* ignore */ }
                    return;
                }
            }
            await vscode.commands.executeCommand('issueManager.views.llmChat.focus');
        })
    );

    let statusBarTimer: ReturnType<typeof setInterval> | null = null;
    let executingSince = 0; // 最早一个对话开始执行的时间戳

    function formatElapsed(ms: number): string {
        const sec = Math.floor(ms / 1000);
        if (sec < 60) { return `${sec}s`; }
        const min = Math.floor(sec / 60);
        return `${min}m${sec % 60}s`;
    }

    function renderStatusBar(): void {
        const timerMgr = RoleTimerManager.getInstance();
        const count = timerMgr.executingCount;
        if (count <= 0) {
            statusBarItem.hide();
            if (statusBarTimer) { clearInterval(statusBarTimer); statusBarTimer = null; }
            return;
        }

        const elapsed = executingSince > 0 ? formatElapsed(Date.now() - executingSince) : '';
        statusBarItem.text = `$(sync~spin) ${count} 对话执行中` + (elapsed ? ` · ${elapsed}` : '');

        // 构建富文本 tooltip：列出每个执行中的对话，点击可 reveal
        const paths = timerMgr.executingPaths;
        const md = new vscode.MarkdownString(`**${count} 个对话执行中**` + (elapsed ? ` · ${elapsed}` : '') + '\n\n', true);
        md.isTrusted = true;
        for (const p of paths) {
            const title = getIssueMarkdownTitleFromCache(p);
            const args = encodeURIComponent(JSON.stringify(vscode.Uri.file(p)));
            md.appendMarkdown(`- $(sync~spin) [${title}](command:issueManager.llmChat.revealInView?${args})\n`);
        }
        statusBarItem.tooltip = md;
        statusBarItem.show();
    }

    function onExecutingCountChange(count: number): void {
        if (count > 0 && !statusBarTimer) {
            executingSince = Date.now();
            statusBarTimer = setInterval(renderStatusBar, 1000);
        } else if (count <= 0) {
            executingSince = 0;
        }
        renderStatusBar();
    }

    const mgr = RoleTimerManager.getInstance();
    context.subscriptions.push(mgr.onExecutingCountChange(onExecutingCountChange));
    context.subscriptions.push({ dispose: () => { if (statusBarTimer) { clearInterval(statusBarTimer); } } });
    onExecutingCountChange(mgr.executingCount);

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

    // ─── 删除对话（级联删除执行日志 + 工具调用文件） ──────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('issueManager.llmChat.deleteConversation', async (node?: ChatConversationNode) => {
            if (!node) { return; }
            const { conversation } = node;
            const logId = conversation.logId;
            const toolCalls = logId ? getToolCallsForLog(logId) : [];
            const relatedCount = (logId ? 1 : 0) + toolCalls.length;

            const detail = relatedCount > 0
                ? `将同时删除执行日志及 ${toolCalls.length} 个工具调用文件（共 ${relatedCount + 1} 个文件）`
                : undefined;
            const confirm = await vscode.window.showWarningMessage(
                `确定要删除对话「${conversation.title}」吗？`,
                { modal: true, detail },
                '删除',
            );
            if (confirm !== '删除') { return; }

            try {
                // 先删工具调用，再删日志，最后删对话
                for (const tc of toolCalls) {
                    try { await vscode.workspace.fs.delete(tc.uri); } catch { /* 忽略单个失败 */ }
                }
                if (logId) {
                    const dir = getIssueDir();
                    if (dir) {
                        const logUri = vscode.Uri.file(path.join(dir, `${logId}.md`));
                        try { await vscode.workspace.fs.delete(logUri); } catch { /* 忽略 */ }
                    }
                }
                await vscode.workspace.fs.delete(conversation.uri);
                roleProvider.refresh();
            } catch (e) {
                logger.error('删除对话失败', e);
                vscode.window.showErrorMessage('删除对话失败');
            }
        }),
    );

    // ─── 统一角色配置入口（模型 / 工具集 / 委派状态） ────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('issueManager.llmChat.configureRole', async (arg?: vscode.Uri | ChatRoleNode) => {
            const targetUri = arg instanceof ChatRoleNode ? arg.role.uri
                : arg instanceof vscode.Uri ? arg
                : vscode.window.activeTextEditor?.document?.uri;
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
            const currentLogEnabled = (frontmatter as Record<string, unknown>)['chat_log_enabled'];
            const logLabel = currentLogEnabled === true ? '开启' : currentLogEnabled === false ? '关闭' : '未设置（默认关闭）';

            const fm = frontmatter as Record<string, unknown>;
            const idleT = Number(fm['timer_timeout']) || 60000;
            const toolT = Number(fm['timer_tool_timeout']) || 60000;
            const maxE = Number(fm['timer_max_execution']) || 600000;
            const timeoutLabel = `空闲 ${idleT / 1000}s / 工具 ${toolT / 1000}s / 总上限 ${maxE / 1000}s`;

            const category = await vscode.window.showQuickPick([
                { label: '$(sparkle) 模型 & Token',  description: '配置模型 family 和 token 预算', id: 'model' },
                { label: '$(tools) 工具集',           description: '配置 tool_sets / mcp_servers / extra / excluded', id: 'tools' },
                { label: '$(clock) 超时配置',          description: timeoutLabel, id: 'timeout' },
                { label: '$(shield) 委派状态',         description: `当前: ${currentStatus}`, id: 'status' },
                { label: '$(robot) 自主模式',          description: `当前: ${autonomousLabel}`, id: 'autonomous' },
                { label: '$(output) 执行日志',         description: `当前: ${logLabel}`, id: 'logEnabled' },
            ], { title: '配置角色', placeHolder: '选择要配置的项目' });
            if (!category) { return; }

            if (category.id === 'model') {
                await vscode.commands.executeCommand('issueManager.llmChat.configureModel', targetUri);
            } else if (category.id === 'tools') {
                await vscode.commands.executeCommand('issueManager.llmChat.configureTools', targetUri);
            } else if (category.id === 'timeout') {
                // ── 超时配置（三层） ────────────────────────────────
                const presets = [
                    { label: '$(zap) 快速响应',     description: '空闲 30s / 工具 30s / 总 5min',  values: { timer_timeout: 30000, timer_tool_timeout: 30000, timer_max_execution: 300000 } },
                    { label: '$(clock) 标准（默认）', description: '空闲 60s / 工具 60s / 总 10min', values: { timer_timeout: 60000, timer_tool_timeout: 60000, timer_max_execution: 600000 } },
                    { label: '$(rocket) 复杂任务',   description: '空闲 120s / 工具 120s / 总 20min', values: { timer_timeout: 120000, timer_tool_timeout: 120000, timer_max_execution: 1200000 } },
                    { label: '$(edit) 自定义',       description: '逐项输入超时值', values: null },
                ];
                const sel = await vscode.window.showQuickPick(presets, {
                    title: '配置超时',
                    placeHolder: `当前: ${timeoutLabel}`,
                });
                if (!sel) { return; }

                let updates: Record<string, number>;
                if (sel.values) {
                    updates = sel.values;
                } else {
                    // 自定义模式：逐项输入
                    const idleInput = await vscode.window.showInputBox({
                        title: '空闲超时（秒）',
                        prompt: 'LLM 无响应多久后中断',
                        value: String(idleT / 1000),
                        validateInput: v => isNaN(Number(v)) || Number(v) <= 0 ? '请输入正数' : undefined,
                    });
                    if (!idleInput) { return; }
                    const toolInput = await vscode.window.showInputBox({
                        title: '工具调用超时（秒）',
                        prompt: '单次工具调用最长执行时间（委派类自动 ×3）',
                        value: String(toolT / 1000),
                        validateInput: v => isNaN(Number(v)) || Number(v) <= 0 ? '请输入正数' : undefined,
                    });
                    if (!toolInput) { return; }
                    const maxInput = await vscode.window.showInputBox({
                        title: '总执行上限（秒）',
                        prompt: '整次执行的最长时间，到时间无条件中断',
                        value: String(maxE / 1000),
                        validateInput: v => isNaN(Number(v)) || Number(v) <= 0 ? '请输入正数' : undefined,
                    });
                    if (!maxInput) { return; }
                    updates = {
                        timer_timeout: Number(idleInput) * 1000,
                        timer_tool_timeout: Number(toolInput) * 1000,
                        timer_max_execution: Number(maxInput) * 1000,
                    };
                }
                await updateIssueMarkdownFrontmatter(targetUri, updates as Parameters<typeof updateIssueMarkdownFrontmatter>[1]);
                const s = (ms: number) => `${ms / 1000}s`;
                vscode.window.showInformationMessage(`已更新超时配置 → 空闲 ${s(updates.timer_timeout)} / 工具 ${s(updates.timer_tool_timeout)} / 总 ${s(updates.timer_max_execution)}`);
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
            } else if (category.id === 'logEnabled') {
                // ── 执行日志 ──────────────────────────────────────
                const logItems = [
                    { label: '$(output) 开启',    description: '生成执行日志和工具调用详情文件', value: true,      picked: currentLogEnabled === true },
                    { label: '$(circle-slash) 关闭', description: '不生成日志文件（默认）',       value: false,     picked: currentLogEnabled !== true },
                ];
                const sel = await vscode.window.showQuickPick(logItems, {
                    title: '配置执行日志生成',
                    placeHolder: `当前: ${logLabel}`,
                });
                if (sel === undefined) { return; }
                await updateIssueMarkdownFrontmatter(targetUri, { chat_log_enabled: sel.value } as Parameters<typeof updateIssueMarkdownFrontmatter>[1]);
                vscode.window.showInformationMessage(`已更新执行日志生成 → ${sel.label}`);
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
            const suggested = currentTokens || (newModel ? 8192 : 0);
            const tokenInput = await vscode.window.showInputBox({
                title: `配置 ${tokensKey}（第 2 步 / 共 2 步）`,
                prompt: '单次 LLM 请求最大 token 预算，0 表示继承上级默认',
                value: String(suggested || currentTokens || 0),
                placeHolder: '例如：8192',
                validateInput: v => (v === '' || /^\d+$/.test(v) ? null : '请输入非负整数'),
            });
            if (tokenInput === undefined) { return; }
            const newTokens = parseInt(tokenInput || '0', 10);

            const updates: Record<string, unknown> = { [modelKey]: newModel || undefined };
            if (newTokens > 0) { updates[tokensKey] = newTokens; }

            await updateIssueMarkdownFrontmatter(targetUri, updates as Parameters<typeof updateIssueMarkdownFrontmatter>[1]);

            vscode.window.showInformationMessage(
                `已更新${fileLabel}模型配置 — 模型：${newModel || '继承上级默认'}  max_tokens：${newTokens || '继承上级默认'}`,
            );
        }),
    );

    // ─── 交互式配置对话（菜单式，与 configureRole 一致） ─────────
    context.subscriptions.push(
        vscode.commands.registerCommand('issueManager.llmChat.configureConversation', async (arg?: vscode.Uri | ChatConversationNode) => {
            const targetUri = arg instanceof ChatConversationNode ? arg.conversation.uri
                : arg instanceof vscode.Uri ? arg
                : vscode.window.activeTextEditor?.document?.uri;
            if (!targetUri) { return; }

            const contentBytes = await vscode.workspace.fs.readFile(targetUri);
            const { frontmatter } = extractFrontmatterAndBody(Buffer.from(contentBytes).toString('utf-8'));
            if (!frontmatter?.chat_conversation) {
                vscode.window.showWarningMessage('当前文件不是对话文件');
                return;
            }

            const fm = frontmatter as Record<string, unknown>;
            const currentAuto = fm['chat_autonomous'];
            const autoLabel = currentAuto === true ? '自主' : currentAuto === false ? '交互' : '继承角色';
            const currentLog = fm['chat_log_enabled'];
            const logLabel = currentLog === true ? '开启' : currentLog === false ? '关闭' : '继承角色';

            const category = await vscode.window.showQuickPick([
                { label: '$(sparkle) 模型 & Token',  description: '配置模型 family 和 token 预算', id: 'model' },
                { label: '$(robot) 自主模式',          description: `当前: ${autoLabel}`, id: 'autonomous' },
                { label: '$(output) 执行日志',         description: `当前: ${logLabel}`, id: 'logEnabled' },
            ], { title: '配置对话', placeHolder: '选择要配置的项目' });
            if (!category) { return; }

            if (category.id === 'model') {
                await vscode.commands.executeCommand('issueManager.llmChat.configureModel', targetUri);
            } else if (category.id === 'autonomous') {
                const autoItems = [
                    { label: '🤖 自主执行', description: '独立完成任务，不等待用户确认', value: true,      picked: currentAuto === true },
                    { label: '💬 交互确认', description: '破坏性操作前征求用户确认',     value: false,     picked: currentAuto === false },
                    { label: '⬜ 继承角色', description: '由角色级设置或系统默认决定',   value: undefined, picked: currentAuto === undefined || currentAuto === null },
                ];
                const sel = await vscode.window.showQuickPick(autoItems as vscode.QuickPickItem[], {
                    title: '配置对话自主模式',
                    placeHolder: `当前: ${autoLabel}`,
                });
                if (sel === undefined) { return; }
                const picked = autoItems.find(i => i.label === (sel as typeof autoItems[0]).label);
                const updates: Record<string, unknown> = picked?.value === undefined
                    ? { chat_autonomous: null }
                    : { chat_autonomous: picked.value };
                await updateIssueMarkdownFrontmatter(targetUri, updates as Parameters<typeof updateIssueMarkdownFrontmatter>[1]);
                vscode.window.showInformationMessage(`已更新对话自主模式 → ${picked?.label ?? sel.label}`);
            } else {
                const logItems = [
                    { label: '$(output) 开启',       description: '生成执行日志和工具调用详情文件', value: true,      picked: currentLog === true },
                    { label: '$(circle-slash) 关闭',  description: '不生成日志文件',               value: false,     picked: currentLog === false },
                    { label: '⬜ 继承角色',            description: '由角色级设置决定（默认关闭）',  value: undefined, picked: currentLog === undefined || currentLog === null },
                ];
                const sel = await vscode.window.showQuickPick(logItems as vscode.QuickPickItem[], {
                    title: '配置对话执行日志',
                    placeHolder: `当前: ${logLabel}`,
                });
                if (sel === undefined) { return; }
                const picked = logItems.find(i => i.label === (sel as typeof logItems[0]).label);
                const updates: Record<string, unknown> = picked?.value === undefined
                    ? { chat_log_enabled: null }
                    : { chat_log_enabled: picked.value };
                await updateIssueMarkdownFrontmatter(targetUri, updates as Parameters<typeof updateIssueMarkdownFrontmatter>[1]);
                vscode.window.showInformationMessage(`已更新对话执行日志 → ${picked?.label ?? sel.label}`);
            }
        }),
    );

    // ─── 发送到角色对话（Cmd+Enter 快捷键入口） ──────────────
    // 两种模式：
    // 1. 普通 IssueMarkdown → 弹 QuickPick 选角色 → 原地升级为对话 → queued
    // 2. 已有对话文件 → 直接将新增内容作为追问发送 → queued
    context.subscriptions.push(
        vscode.commands.registerCommand('issueManager.llmChat.askRole', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || !editor.document.fileName.endsWith('.md')) {
                vscode.window.showWarningMessage('请在 Markdown 文件中使用此命令');
                return;
            }

            const uri = editor.document.uri;
            // 确保文件已保存
            if (editor.document.isDirty) {
                await editor.document.save();
            }

            // 读取编辑器当前文本（save 后磁盘与编辑器一致）
            const text = editor.document.getText();
            const { frontmatter, body } = extractFrontmatterAndBody(text);

            // ── 模式判断：已有对话 vs 普通笔记 ─────────────────────
            if (frontmatter?.chat_conversation) {
                // === 已有对话：直接发送末尾新增内容 ===
                await handleExistingConversation(uri, text);
            } else {
                // === 普通笔记：弹 QuickPick 选角色 → 原地升级 ===
                await handleNoteUpgrade(uri, body, frontmatter, context);
            }
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

// ─── askRole: 笔记升级为对话 / 已有对话追问 ─────────────────

/** 从已有对话文件中提取末尾新增内容并追问 */
async function handleExistingConversation(uri: vscode.Uri, raw: string): Promise<void> {
    const { body } = extractFrontmatterAndBody(raw);

    // 检查当前状态：如果已经在执行中，拒绝操作
    const marker = parseStateMarker(raw);
    if (marker && (marker.status === 'executing' || marker.status === 'queued')) {
        vscode.window.showWarningMessage(`对话正在${marker.status === 'executing' ? '执行中' : '排队中'}，请等待完成后再发送。`);
        return;
    }

    // ── 核心逻辑：基于最后一个 llm 标记的位置分割内容 ──
    // 标记之前 = 已有对话内容（保留），标记之后 = 用户新输入
    const markerRe = /<!--\s*llm:\w+[^>]*?-->/g;
    let lastMarkerIdx = -1;
    let lastMarkerEnd = -1;
    let m: RegExpExecArray | null;
    while ((m = markerRe.exec(raw)) !== null) {
        lastMarkerIdx = m.index;
        lastMarkerEnd = m.index + m[0].length;
    }

    const userContent = lastMarkerEnd > 0 ? raw.slice(lastMarkerEnd).trim() : '';

    if (userContent) {
        // ── 有新内容：保留标记前的内容 + 包裹为 ## User 块 ──
        try {
            const baseContent = raw.slice(0, lastMarkerIdx).trimEnd();
            const dateStr = formatTimestamp(Date.now());
            const newContent = baseContent + `\n\n## User (${dateStr})\n\n${userContent}\n\n<!-- llm:queued -->\n`;
            await replaceEditorContent(uri, newContent);
            await RoleTimerManager.getInstance().triggerConversation(uri);
            vscode.window.showInformationMessage('消息已提交，等待 LLM 处理…');
        } catch (e) {
            vscode.window.showErrorMessage(`提交失败: ${e instanceof Error ? e.message : '未知错误'}`);
        }
        return;
    }

    // ── 无新内容：检查是否可以重发最后一条 User 消息 ──
    const lastHeadingIdx = body.lastIndexOf('\n## ');
    if (lastHeadingIdx >= 0) {
        const afterHeading = stripMarker(body.slice(lastHeadingIdx)).trim();
        const hm = afterHeading.match(/^## User \(.+?\)\s*\n([\s\S]*)$/);
        if (hm && hm[1].trim()) {
            const stripped = stripMarker(raw).trimEnd();
            await replaceEditorContent(uri, stripped + '\n\n<!-- llm:queued -->\n');
            await RoleTimerManager.getInstance().triggerConversation(uri);
            vscode.window.showInformationMessage('消息已提交，等待 LLM 处理…');
            return;
        }
    }

    vscode.window.showWarningMessage('请在文件末尾输入你的追问内容后再发送。');
}

/**
 * 弹出 QuickPick 选择角色，将普通 IssueMarkdown 原地升级为对话文件。
 * body 内容包裹为第一条 User 消息，frontmatter 追加 chat_conversation 等字段。
 */
async function handleNoteUpgrade(
    uri: vscode.Uri,
    body: string,
    origFm: Record<string, unknown> | null,
    context: vscode.ExtensionContext,
): Promise<void> {
    // 获取所有角色并按 status 分组
    const allRoles = getAllChatRoles();
    if (allRoles.length === 0) {
        const action = await vscode.window.showWarningMessage(
            '还没有聊天角色，需要先创建一个。',
            '创建角色',
        );
        if (action === '创建角色') {
            await vscode.commands.executeCommand('issueManager.llmChat.createRole');
        }
        return;
    }

    const readyRoles = allRoles.filter(r => r.roleStatus !== 'disabled' && r.roleStatus !== 'testing');
    const testingRoles = allRoles.filter(r => r.roleStatus === 'testing');

    // 记住上次选择的角色
    const lastRoleId = context.globalState.get<string>('llmChat.askRole.lastRoleId');

    type RolePickItem = vscode.QuickPickItem & { roleId: string };
    const items: RolePickItem[] = [];

    for (const role of readyRoles) {
        items.push({
            label: `$(${role.avatar}) ${role.name}`,
            description: role.toolSets.length > 0 ? role.toolSets.join(', ') : undefined,
            roleId: role.id,
            picked: role.id === lastRoleId,
        });
    }

    if (testingRoles.length > 0) {
        items.push({ label: '', kind: vscode.QuickPickItemKind.Separator, roleId: '' });
        for (const role of testingRoles) {
            items.push({
                label: `$(${role.avatar}) ${role.name}`,
                description: '⚠️ 调试中',
                roleId: role.id,
                picked: role.id === lastRoleId,
            });
        }
    }

    // 如果只有一个 ready 角色，跳过选择
    let selectedRoleId: string;
    if (readyRoles.length === 1 && testingRoles.length === 0) {
        selectedRoleId = readyRoles[0].id;
    } else {
        // 将上次选择的角色排到第一个（默认选中效果）
        if (lastRoleId) {
            const idx = items.findIndex(i => i.roleId === lastRoleId);
            if (idx > 0) {
                const [item] = items.splice(idx, 1);
                items.unshift(item);
            }
        } else {
            // 首次使用：优先选中名称含"个人助理"的角色
            const paIdx = items.findIndex(i => i.label.includes('个人助理') || i.label.includes('个人助手'));
            if (paIdx > 0) {
                const [item] = items.splice(paIdx, 1);
                items.unshift(item);
            }
        }

        const pick = await vscode.window.showQuickPick(items, {
            title: '选择对话角色',
            placeHolder: '选择一个角色，将笔记内容作为提问发送',
        });
        if (!pick || !pick.roleId) { return; }
        selectedRoleId = pick.roleId;
    }

    // 保存上次选择
    await context.globalState.update('llmChat.askRole.lastRoleId', selectedRoleId);

    const role = getChatRoleById(selectedRoleId);
    if (!role) {
        vscode.window.showErrorMessage('角色不存在');
        return;
    }

    // ── 原地升级：追加 chat frontmatter + 包裹 body 为 User 消息 ──
    const defaultModelFamily = role.modelFamily
        || vscode.workspace.getConfiguration('issueManager').get<string>('llm.modelFamily')
        || 'gpt-5-mini';

    // 提取标题（用于对话元数据），整个 body 原样作为 User 消息
    const title = (origFm?.issue_title as string)
        || body.match(/^#\s+(.+)/)?.[1]
        || '笔记对话';

    // User 消息：原样保留用户输入的全部内容
    const userContent = body.trim() || title;
    if (!userContent) {
        vscode.window.showWarningMessage('笔记内容为空，请先写入内容再发送。');
        return;
    }

    const dateStr = formatTimestamp(Date.now());
    const h1Title = `与 ${role.name} 的对话  ${title}`;
    const newBody = `# ${h1Title}\n\n## User (${dateStr})\n\n${userContent}\n\n<!-- llm:queued -->\n`;

    // 合并 frontmatter + body 为一次原子写入，避免多次写文件触发编辑器冲突
    const mergedFm: Record<string, unknown> = {
        ...(origFm ?? {}),
        chat_conversation: true,
        chat_role_id: selectedRoleId,
        chat_title: title,
        chat_model_family: defaultModelFamily,
        chat_max_tokens: role.maxTokens ?? 0,
        chat_token_used: 0,
    };
    const jsYaml = await import('js-yaml');
    const fmYaml = jsYaml.dump(mergedFm, { flowLevel: -1, lineWidth: -1 }).trim();
    const newContent = `---\n${fmYaml}\n---\n${newBody}`;

    // 通过 WorkspaceEdit 修改编辑器 buffer（而非直接写磁盘），兼容自动保存
    await replaceEditorContent(uri, newContent);

    // 触发 LLM 处理
    await RoleTimerManager.getInstance().triggerConversation(uri);
    vscode.window.showInformationMessage(`已升级为与「${role.name}」的对话，等待 LLM 处理…`);
}

/** 格式化时间戳 */
function formatTimestamp(ts: number): string {
    const d = new Date(ts);
    const p = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * 写入文件内容并同步编辑器 buffer。
 *
 * 策略：先写磁盘（triggerConversation 需要读磁盘），再 revert 编辑器
 * 使 buffer = 磁盘。revert 后 buffer 是 clean 状态，VS Code 会自动
 * 跟踪后续磁盘变化（如 LLM 执行时的 token 更新），不会与自动保存冲突。
 */
async function replaceEditorContent(uri: vscode.Uri, newContent: string): Promise<void> {
    // 1. 直接写磁盘
    await vscode.workspace.fs.writeFile(uri, Buffer.from(newContent, 'utf8'));

    // 2. 让编辑器 revert 到磁盘内容（buffer = 磁盘，clean 状态）
    const doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === uri.fsPath);
    if (doc) {
        // 确保该文档是活跃编辑器（revert 命令只作用于活跃编辑器）
        await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: false });
        await vscode.commands.executeCommand('workbench.action.files.revert');
    }
}
