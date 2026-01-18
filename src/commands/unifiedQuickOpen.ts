import * as vscode from "vscode";
import { getFlatTree, FlatTreeNode, getIssueNodeById } from "../data/issueTreeManager";
import { buildIssueQuickPickItems, buildIssueActionItems, ActionQuickPickItem } from "./selectOrCreateIssue";
import { createIssueFileSilent, addIssueToTree } from "./issueFileUtils";
import { backgroundFillIssue } from "../llm/backgroundFill";
import { getIssueIdFromUri } from "../utils/uriUtils";
import { openIssueNode } from "./openIssueNode";

type QuickPickItemWithId = vscode.QuickPickItem & {
    id?: string;
    commandId?: string;
    /**
     * 可选的执行器：在用户确认该项时调用，接收当前输入值和可选上下文
     */
    execute?: (
        input?: string,
        ctx?: { quickPick?: vscode.QuickPick<QuickPickItemWithId> }
    ) => Promise<void> | void;
    /**
     * 可选的通用过滤函数，接收上下文并返回是否应展示该项。
     * ctx = { issueId?: string; uri?: vscode.Uri }
     */
    require?: (ctx: { issueId?: string; uri?: vscode.Uri }) => boolean;
};

// 支持的模式类型：command | issue | llm
type Mode = "command" | "issue" | "llm";

// 统一入口接受的初始参数类型
// 统一入口接受的初始参数类型（仅对象形式）
type InitialArg = { mode?: Mode; text?: string };

export function registerUnifiedQuickOpenCommand(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "issueManager.unifiedQuickOpen",
                    async (initialArg?: InitialArg) => {
                const quickPick = vscode.window.createQuickPick<QuickPickItemWithId>();
                quickPick.matchOnDescription = true;
                // quickPick.matchOnDetail = false;

                const cmdButton: vscode.QuickInputButton = {
                    iconPath: new vscode.ThemeIcon("terminal"),
                    tooltip: "切换到命令模式",
                };
                const issueButton: vscode.QuickInputButton = {
                    iconPath: new vscode.ThemeIcon("list-tree"),
                    tooltip: "切换到问题搜索",
                };

                const helpButton: vscode.QuickInputButton = {
                    iconPath: new vscode.ThemeIcon("question"),
                    tooltip: "各模式说明",
                };
                // 命令模式项
                const COMMAND_ITEMS: QuickPickItemWithId[] = [
                    {
                        label: "生成项目名",
                        description: "基于活动编辑器内容生成项目名并复制",
                        commandId: "issueManager.generateProjectName",
                        execute: async () => {
                            await vscode.commands.executeCommand(
                                "issueManager.generateProjectName"
                            );
                        },
                    },
                    {
                        label: "插入 marks 到关联问题",
                        description: "将当前任务的 marks 写入到关联的问题 Markdown 中",
                        commandId: "issueManager.marker.insertMarksToAssociatedIssue",
                        execute: async () => {
                            await vscode.commands.executeCommand(
                                "issueManager.marker.insertMarksToAssociatedIssue"
                            );
                        },
                    },
                    {
                        label: "生成 Git 分支名",
                        description: "基于活动编辑器内容生成 git 分支名并复制",
                        commandId: "issueManager.generateGitBranchName",
                        execute: async () => {
                            await vscode.commands.executeCommand(
                                "issueManager.generateGitBranchName"
                            );
                        },
                    },
                    {
                        label: "新建子问题",
                        description: "从当前编辑器对应的 IssueNode 下创建子问题",
                        commandId: "issueManager.createSubIssueFromEditor",
                        require: ctx => !!ctx.issueId,
                        execute: async () => {
                            await vscode.commands.executeCommand(
                                "issueManager.createSubIssueFromEditor"
                            );
                        },
                    },
                    {
                        label: "生成标题",
                        description: "为当前编辑器的 IssueMarkdown 生成 IssueTitle",
                        commandId: "issueManager.generateTitleCommand",
                        require: ctx => !!ctx.issueId,
                        execute: async () => {
                            await vscode.commands.executeCommand(
                                "issueManager.generateTitleCommand"
                            );
                        },
                    },
                    {
                        label: "复制文件名",
                        description: "复制当前编辑器的 IssueMarkdown 真实文件名到剪贴板",
                        commandId: "issueManager.copyFilename",
                        require: ctx => !!ctx.issueId,
                        execute: async () => {
                            await vscode.commands.executeCommand("issueManager.copyFilename");
                        },
                    },
                    {
                        label: "复制问题 ID",
                        description: "复制当前编辑器中的 IssueNode ID 到剪贴板",
                        commandId: "issueManager.copyIssueId",
                        require: ctx => !!ctx.issueId,
                        execute: async () => {
                            await vscode.commands.executeCommand("issueManager.copyIssueId");
                        },
                    },
                    {
                        label: "在问题总览中查看",
                        description: "在问题总览中定位当前编辑器对应的 IssueNode",
                        commandId: "issueManager.revealInOverviewFromEditor",
                        require: ctx => !!ctx.issueId,
                        execute: async () => {
                            await vscode.commands.executeCommand(
                                "issueManager.revealInOverviewFromEditor"
                            );
                        },
                    },
                    {
                        label: "添加到关注",
                        description: "将当前 IssueNode 加入关注列表",
                        commandId: "issueManager.addToFocusedViewFromEditor",
                        require: ctx => !!ctx.issueId,
                        execute: async () => {
                            await vscode.commands.executeCommand(
                                "issueManager.addToFocusedViewFromEditor"
                            );
                        },
                    },
                    {
                        label: "移动到...",
                        description: "将当前 IssueNode 移动到其他 IssueNode 下",
                        commandId: "issueManager.moveToFromEditor",
                        require: ctx => !!ctx.issueId,
                        execute: async () => {
                            await vscode.commands.executeCommand("issueManager.moveToFromEditor");
                        },
                    },
                    {
                        label: "关联到...",
                        description: "将当前 IssueNode 关联到其他 IssueNode 下",
                        commandId: "issueManager.attachToFromEditor",
                        require: ctx => !!ctx.issueId,
                        execute: async () => {
                            await vscode.commands.executeCommand("issueManager.attachToFromEditor");
                        },
                    },
                ];

                // 显示所有模式按钮与帮助按钮，便于快速切换（可按需调整显示策略）
                quickPick.buttons = [cmdButton, issueButton, helpButton];
                // 当前模式：'command' | 'issue' | 'llm'
                let currentMode: 'command' | 'issue' | 'llm' = 'command'; // 默认进入命令模式
                let suppressChange = false; // 忽略程序性 value 变更

                // 仅在当前活动编辑器的 URI 包含有效 issueId 时展示依赖编辑器的命令
                let activeCommandItems = COMMAND_ITEMS.slice();
                let currentEditorIssueId: string | undefined;
                try {
                    const activeUri = vscode.window.activeTextEditor?.document?.uri;
                    currentEditorIssueId = getIssueIdFromUri(activeUri);
                    let activeIssueValid = !!(await getIssueNodeById(currentEditorIssueId || ""));
                    currentEditorIssueId = activeIssueValid ? currentEditorIssueId : undefined;
                    const ctx = { issueId: currentEditorIssueId, uri: activeUri };
                    activeCommandItems = COMMAND_ITEMS.filter(i => {
                        if (!i.require) {
                            return true;
                        }
                        try {
                            return !!i.require(ctx);
                        } catch (e) {
                            return false;
                        }
                    });
                } catch (e) {
                    // 如果发生异常，保守地只返回无 require 的项
                    activeCommandItems = COMMAND_ITEMS.filter(i => !i.require);
                }

                // 解析 initialArg（仅对象形式），并决定是否提前处理以避免闪烁
                const initialRequest: { mode?: Mode; text?: string } | undefined = (() => {
                    if (!initialArg) {
                        return undefined;
                    }
                    return { mode: initialArg.mode, text: initialArg.text || "" };
                })();

                // 如果初始请求要求进入 issue/llm 模式，先设置为 busy 状态并延迟填充项，避免先展示 command 再切换造成闪烁
                let handledInitialRequest = false;
                const wantsInlineIssue = !!(initialRequest && (initialRequest.mode === "issue" || initialRequest.mode === ";" || initialRequest.mode === "list" || initialRequest.mode === "semicolon"));

                // 默认显示命令项（除非初始请求要求进入 issue/llm 模式）
                if (!wantsInlineIssue) {
                    quickPick.items = activeCommandItems;
                    quickPick.placeholder =
                        "命令模式：输入关键词（支持空格多词匹配），点击按钮切换到问题列表";
                    quickPick.value = "";
                    quickPick.busy = false;
                } else {
                    // 进入等待状态：不展示命令项，显示加载提示
                    currentMode = 'issue';
                    suppressChange = true;
                    quickPick.items = [];
                    quickPick.placeholder = "搜索或新建问题（正在加载...）";
                    quickPick.value = initialRequest?.text || "";
                    quickPick.busy = true;
                    handledInitialRequest = true;
                }

                quickPick.show();

                // 加载扁平化树并展示为默认项（与 searchIssues 行为一致）
                try {
                    if (activeCommandItems.length > 0) {
                        quickPick.activeItems = [activeCommandItems[0]];
                    }

                    const flatNodes = await getFlatTree();

                    const issueItems: QuickPickItemWithId[] = flatNodes.map(node => {
                        let description = "";
                        if (node.parentPath && node.parentPath.length > 0) {
                            const parentTitles = node.parentPath.map(n => n.title);
                            description = ["", ...parentTitles].join(" / ");
                        }
                        const id = node.id;
                        return {
                            label: node.title,
                            description,
                            id,
                            execute: async () => {
                                try {
                                    const n = await getIssueNodeById(id || "");
                                    await vscode.commands.executeCommand(
                                        "issueManager.openAndRevealIssue",
                                        n,
                                        "overview"
                                    );
                                } catch (e) {
                                    await vscode.commands.executeCommand(
                                        "issueManager.searchIssues",
                                        "overview"
                                    );
                                }
                            },
                        } as QuickPickItemWithId;
                    });

                    // 多词过滤函数：支持空格分词，每个词都要匹配（对中文友好）
                    const filterItems = (
                        items: QuickPickItemWithId[],
                        searchText: string
                    ): QuickPickItemWithId[] => {
                        if (!searchText || !searchText.trim()) {
                            return items;
                        }
                        const keywords = searchText.trim().toLowerCase().split(/\s+/);
                        return items.filter(item => {
                            const hay = [item.label, item.description || ""]
                                .join(" ")
                                .toLowerCase();
                            return keywords.every(k => hay.includes(k));
                        });
                    };

                    // helper: 将 selectOrCreateIssue 返回的 actionItems 转换为 QuickPickItemWithId
                    const convertActionItems = (items: Array<ActionQuickPickItem>): QuickPickItemWithId[] =>
                        items.map(ai =>
                            ({
                                label: ai.label,
                                description: ai.description,
                                alwaysShow: ai.alwaysShow,
                                execute: async (input?: string) => {
                                    try {
                                        const id = await ai.execute(input || "", { parentId: currentEditorIssueId });
                                        // 对于后台创建项（create-background）保持不自动打开
                                        if (id && ai.action !== 'create-background') {
                                            openIssueNode(id || "");
                                        }
                                    } catch (e) {
                                        console.error("action item execute failed:", e);
                                    }
                                },
                            } as QuickPickItemWithId)
                        );

                    // 帮助项与模式切换复用逻辑
                    const HELP_ITEMS: QuickPickItemWithId[] = [
                        {
                            label: "命令模式",
                            description: "输入关键词过滤并执行命令（支持空格多词匹配）",
                            execute: async () => await enterMode("command"),
                        },
                        {
                            label: "问题搜索",
                            description: "搜索并定位问题节点（用于导航/打开问题）",
                            execute: async () => await enterMode("issue"),
                        },
                        {
                            label: "LLM 模式",
                            description: "使用 LLM 辅助搜索/模糊匹配（示例模式）",
                            execute: async () => await enterMode("llm"),
                        },
                        {
                            label: "; 前缀",
                            description: "在输入前加 ';' 快速进入问题搜索",
                            execute: async () => await enterMode("issue"),
                        },
                        {
                            label: "> 前缀",
                            description: "在输入前加 '>' 快速进入命令模式",
                            execute: async () => await enterMode("command"),
                        },
                    ];

                    const switchToMode = async (label: string, text = "") => {
                        // 默认离开 inline 问题搜索
                        quickPick.activeItems = [];
                        if (label === "命令模式") {
                            currentMode = 'command';
                            suppressChange = true;
                            quickPick.items = activeCommandItems;
                            quickPick.placeholder =
                                "命令模式：输入关键词（支持空格多词匹配），点击按钮切换到问题列表";
                            quickPick.buttons = [cmdButton, issueButton, helpButton];
                            quickPick.value = text;
                            if (activeCommandItems.length > 0) {
                                quickPick.activeItems = [activeCommandItems[0]];
                            }
                        } else if (label === "问题搜索") {
                            // 进入 inline 问题搜索：在当前 quickPick 中展示与 selectOrCreateIssue 相同的文案与行为
                            currentMode = 'issue';
                            suppressChange = true;
                            quickPick.placeholder = "搜索或新建问题";
                            quickPick.buttons = [cmdButton, issueButton, helpButton];
                            quickPick.value = text;
                            // 异步构建初始项，不阻塞 UI

                                    const actionItems = await buildIssueQuickPickItems(text || "");
                                    quickPick.items = convertActionItems(actionItems);

                        } else if (label === "LLM 模式") {
                            // 示例性的 LLM 模式：目前表现为合并搜索，可以扩展为调用实际 LLM
                            currentMode = 'llm';
                            suppressChange = true;
                            const combined = activeCommandItems.concat(issueItems);
                            quickPick.items = filterItems(combined, text);
                            quickPick.placeholder = "LLM 模式：使用 LLM 辅助搜索（示例）";
                            quickPick.buttons = [cmdButton, issueButton, helpButton];
                            quickPick.value = text;
                            quickPick.activeItems = [];
                        }
                    };

                    // 统一模式入口，便于在多处调用以保持 placeholder/按钮/items 一致
                    // 简化为仅接受主要模式：'command'、'issue'、'llm'
                        const enterMode = async (mode: Mode, text = "") => {
                            const label =
                                mode === "command"
                                    ? "命令模式"
                                    : mode === "issue"
                                    ? "问题搜索"
                                    : "LLM 模式";
                            await switchToMode(label, text);
                        };

                    // 如果调用时传入初始模式，则在初始化后切换到该模式（如果尚未处理）
                    if (!handledInitialRequest && initialRequest && initialRequest.mode) {
                        // 支持多种写法：'command'|'issue'|'amp'|'llm' 等，或标签形式
                        const m = (initialRequest.mode || "").toString().toLowerCase();
                        if (m === "command" || m === "cmd" || m === ">" || m === "greater") {
                            await enterMode("command", initialRequest.text);
                        } else if (m === "issue" || m === "list" || m === ";" || m === "semicolon") {
                            await enterMode("issue", initialRequest.text);
                        } else if (m === "llm") {
                            await enterMode("llm", initialRequest.text);
                        }
                    }

                    // 如果之前为 inline issue 模式预先设置为 busy，则现在填充实际的 issue 项并结束 busy
                    if (handledInitialRequest && currentMode === 'issue') {
                        try {
                            const actionItems = await buildIssueQuickPickItems(initialRequest?.text || "");
                            quickPick.items = convertActionItems(actionItems);
                            quickPick.placeholder = "搜索或新建问题";
                        } catch (e) {
                            quickPick.items = issueItems;
                        } finally {
                            quickPick.busy = false;
                            suppressChange = false;
                        }
                    }

                    // 是否处于 help 模式（使用当前 quickPick 展示帮助项）
                    let inHelpMode = false;

                    // 打开 help 模式，复用当前 quickPick
                    const openHelpInQuickPick = (text = "") => {
                        inHelpMode = true;
                        suppressChange = true;
                        quickPick.items = HELP_ITEMS as QuickPickItemWithId[];
                        quickPick.placeholder = "选择查看模式说明（输入搜索或按 Esc 关闭）";
                        quickPick.buttons = [cmdButton, issueButton, helpButton];
                        quickPick.value = text;
                        quickPick.activeItems = [];
                    };

                    // 前缀处理映射：便于扩展新模式（说明：';' 为“问题搜索”的缩写，'>' 为“命令模式”的缩写）
                    const prefixHandlers: Record<string, (text: string) => Promise<void> | void> = {
                        // 命令模式：'>' 前缀
                        ">": async (text: string) => {
                            // 将 '>' 视为命令模式的快捷前缀
                            await enterMode("command", text);
                        },
                        // 问题列表模式：';' 前缀
                        ";": async (text: string) => {
                            // 将 ';' 视为问题搜索的快捷前缀
                            await enterMode("issue", text);
                        },
                        // 'llm' 模式示例：示例性的 LLM 搜索模式（目前为合并搜索+不同占位提示）
                        llm: async (text: string) => {
                            await enterMode("llm", text);
                        },
                        // '?' 前缀：显示帮助并切换到对应模式，同时保留后续输入作为搜索关键词
                        "?": async (text: string) => {
                            openHelpInQuickPick(text);
                        },
                    };

                    quickPick.onDidTriggerButton(async btn => {
                        // 按钮切换：根据按钮切换到对应模式
                        if (btn === cmdButton) {
                            await enterMode("command", "");
                        } else if (btn === issueButton) {
                            await enterMode("issue", "");
                        } else if (btn === helpButton) {
                            openHelpInQuickPick("");
                        }
                    });

                    quickPick.onDidChangeValue(async value => {
                        if (suppressChange) {
                            suppressChange = false;
                            return;
                        }
                        const v = value || "";

                        // 如果处于 help 模式：优先检测前缀切换模式（支持 '>'、';' 等），
                        // 说明：';' 为“问题搜索”的缩写，'>' 为“命令模式”的缩写
                        // 否则对 helpItems 进行过滤并展示
                        if (inHelpMode) {
                            if (v && v.length > 0) {
                                const p = v[0];
                                const handler = prefixHandlers[p];
                                if (handler) {
                                    // 退出 help 模式并触发对应前缀处理
                                    inHelpMode = false;
                                    await handler(v.slice(1));
                                    return;
                                }
                            }
                            const filtered = filterItems(HELP_ITEMS as QuickPickItemWithId[], v);
                            quickPick.items = filtered;
                            if (filtered.length > 0) {
                                quickPick.activeItems = [filtered[0]];
                            }
                            return;
                        }

                        // 支持可扩展的前缀处理：按最长前缀匹配（多字母前缀如 'llm' 要求后接空白或结束）
                        if (v && v.length > 0) {
                            const keys = Object.keys(prefixHandlers).sort(
                                (a, b) => b.length - a.length
                            );
                                for (const key of keys) {
                                if (!v.startsWith(key)) {
                                    continue;
                                }
                                // 如果前缀是多字母（如 'llm'），要求后续字符为空白或字符串结束，避免误触
                                const isAlphaKey = /^[A-Za-z]+$/.test(key);
                                if (isAlphaKey && key.length > 1) {
                                    const nextChar = v.charAt(key.length);
                                    // 要求多字母前缀后必须有显式空白（不接受字符串结尾），以避免误触
                                    if (!nextChar || !/\s/.test(nextChar)) {
                                        continue;
                                    }
                                }
                                const handler = prefixHandlers[key];
                                if (handler) {
                                    await handler(v.slice(key.length).trim());
                                    return;
                                }
                            }
                        }

                        if (currentMode === 'command') {
                            const filtered = filterItems(activeCommandItems, v);
                            quickPick.items = filtered;
                            if (filtered.length > 0) {
                                quickPick.activeItems = [filtered[0]];
                            }
                        } else if (currentMode === 'issue') {
                            // 与 selectOrCreateIssue 保持一致的行为：当输入为空时显示按最近访问排序的已有项，
                            // 当有输入时在最前面插入直接创建与后台创建项
                            try {
                                const actionItems = await buildIssueActionItems(v, currentEditorIssueId);
                                const converted = convertActionItems(actionItems);
                                quickPick.items = converted;
                            } catch (e) {
                                console.error("issue mode build items failed:", e);
                                quickPick.items = issueItems;
                            }
                        } else {
                            quickPick.items = issueItems;
                            quickPick.activeItems = [];
                        }
                    });

                    quickPick.onDidAccept(async () => {
                        const selected = quickPick.selectedItems[0];
                        if (!selected) {
                            quickPick.hide();
                            return;
                        }

                        // help 模式：选择后切换到对应模式并继续展示 quickPick
                        if (inHelpMode) {
                            try {
                                if (selected.execute) {
                                    await Promise.resolve(
                                        selected.execute(quickPick.value, { quickPick })
                                    );
                                } else {
                                    await switchToMode(selected.label, quickPick.value);
                                }
                            } catch (e) {
                                console.error("help item execute error:", e);
                            }
                            inHelpMode = false;
                            return;
                        }

                        // 优先使用项的 execute 回调统一处理行为
                        if (selected.execute) {
                            Promise.resolve(selected.execute(quickPick.value, { quickPick })).catch(
                                e => console.error("quickPick item execute error:", e)
                            );
                            quickPick.hide();
                            return;
                        }

                        // 兼容老字段：命令项
                        if (currentMode === 'command' && selected.commandId) {
                            await vscode.commands.executeCommand(selected.commandId);
                            quickPick.hide();
                            return;
                        }

                        // 兼容老字段：问题项
                        if (selected.id) {
                            try {
                                const node = await getIssueNodeById(selected.id);
                                await vscode.commands.executeCommand(
                                    "issueManager.openAndRevealIssue",
                                    node,
                                    "overview"
                                );
                                quickPick.hide();
                                return;
                            } catch (e) {
                                await vscode.commands.executeCommand(
                                    "issueManager.searchIssues",
                                    "overview"
                                );
                                quickPick.hide();
                                return;
                            }
                        }

                        await vscode.commands.executeCommand(
                            "issueManager.searchIssues",
                            "overview"
                        );
                        quickPick.hide();
                    });

                    quickPick.onDidHide(() => quickPick.dispose());
                } catch (err) {
                    quickPick.busy = false;
                    quickPick.hide();
                    vscode.window.showErrorMessage("加载问题列表失败。");
                }
            }
        )
    );
}
