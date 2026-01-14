import * as vscode from "vscode";
import { getFlatTree, FlatTreeNode, getIssueNodeById } from "../data/issueTreeManager";
import { getIssueIdFromUri } from "../utils/uriUtils";

type QuickPickItemWithId = vscode.QuickPickItem & {
    id?: string;
    commandId?: string;
    /**
     * 可选的通用过滤函数，接收上下文并返回是否应展示该项。
     * ctx = { issueId?: string; issueValid?: boolean; uri?: vscode.Uri }
     */
    require?: (ctx: { issueId?: string; issueValid?: boolean; uri?: vscode.Uri }) => boolean;
};

export function registerUnifiedQuickOpenCommand(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand("issueManager.unifiedQuickOpen", async (initialArg?: string | { mode?: string; text?: string }) => {
            const quickPick = vscode.window.createQuickPick<QuickPickItemWithId>();
            quickPick.matchOnDescription = true;
            quickPick.matchOnDetail = false;
            const cmdButton: vscode.QuickInputButton = {
                iconPath: new vscode.ThemeIcon("terminal"),
                tooltip: "切换到命令模式",
            };
            const issueButton: vscode.QuickInputButton = {
                iconPath: new vscode.ThemeIcon("list-tree"),
                tooltip: "切换到问题模式",
            };
            const ampButton: vscode.QuickInputButton = {
                iconPath: new vscode.ThemeIcon("search"),
                tooltip: "切换到 & 模式",
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
                },
                {
                    label: "插入 marks 到关联问题",
                    description: "将当前任务的 marks 写入到关联的问题 Markdown 中",
                    commandId: "issueManager.marker.insertMarksToAssociatedIssue",
                },
                {
                    label: "生成 Git 分支名",
                    description: "基于活动编辑器内容生成 git 分支名并复制",
                    commandId: "issueManager.generateGitBranchName",
                },
                {
                    label: "新建子问题",
                    description: "从当前编辑器对应的 IssueNode 下创建子问题",
                    commandId: "issueManager.createSubIssueFromEditor",
                    require: ctx => !!ctx.issueValid,
                },
                {
                    label: "生成标题",
                    description: "为当前编辑器的 IssueMarkdown 生成 IssueTitle",
                    commandId: "issueManager.generateTitleCommand",
                    require: ctx => !!ctx.issueValid,
                },
                {
                    label: "复制文件名",
                    description: "复制当前编辑器的 IssueMarkdown 真实文件名到剪贴板",
                    commandId: "issueManager.copyFilename",
                    require: ctx => !!ctx.issueValid,
                },
                {
                    label: "复制问题 ID",
                    description: "复制当前编辑器中的 IssueNode ID 到剪贴板",
                    commandId: "issueManager.copyIssueId",
                    require: ctx => !!ctx.issueValid,
                },
                {
                    label: "在问题总览中查看",
                    description: "在问题总览中定位当前编辑器对应的 IssueNode",
                    commandId: "issueManager.revealInOverviewFromEditor",
                    require: ctx => !!ctx.issueValid,
                },
                {
                    label: "添加到关注",
                    description: "将当前 IssueNode 加入关注列表",
                    commandId: "issueManager.addToFocusedViewFromEditor",
                    require: ctx => !!ctx.issueValid,
                },
                {
                    label: "移动到...",
                    description: "将当前 IssueNode 移动到其他 IssueNode 下",
                    commandId: "issueManager.moveToFromEditor",
                    require: ctx => !!ctx.issueValid,
                },
                {
                    label: "关联到...",
                    description: "将当前 IssueNode 关联到其他 IssueNode 下",
                    commandId: "issueManager.attachToFromEditor",
                    require: ctx => !!ctx.issueValid,
                },
            ];

            // 显示所有模式按钮与帮助按钮，便于快速切换（可按需调整显示策略）
            quickPick.buttons = [cmdButton, issueButton, ampButton, helpButton];
            let inCommandMode = true; // 默认进入命令模式
            let suppressChange = false; // 忽略程序性 value 变更

            // 仅在当前活动编辑器的 URI 包含有效 issueId 时展示依赖编辑器的命令
            let activeCommandItems = COMMAND_ITEMS.slice();
            try {
                const activeUri = vscode.window.activeTextEditor?.document?.uri;
                const maybeIssueId = getIssueIdFromUri(activeUri);
                let activeIssueValid = await getIssueNodeById(maybeIssueId||'')  
                        .then(() => true)  
                        .catch(() => false);  

                const ctx = { issueId: maybeIssueId, issueValid: activeIssueValid, uri: activeUri };
                activeCommandItems = COMMAND_ITEMS.filter(i => {
                    if (!i.require) { return true; }
                    try { return !!i.require(ctx); } catch (e) { return false; }
                });
            } catch (e) {
                // 如果发生异常，保守地只返回无 require 的项
                activeCommandItems = COMMAND_ITEMS.filter(i => !i.require);
            }

            // 默认显示命令项
            quickPick.items = activeCommandItems;
            quickPick.placeholder =
                "命令模式：输入关键词（支持空格多词匹配），点击按钮切换到问题列表";
            quickPick.value = "";
            quickPick.busy = false;

            quickPick.show();
            // 解析 initialArg（可以是字符串或 {mode,text}）
            const initialRequest = (() => {
                if (!initialArg) { return undefined; }
                if (typeof initialArg === "string") { return { mode: initialArg, text: "" }; }
                if (typeof initialArg === "object") { return { mode: initialArg.mode, text: initialArg.text || "" }; }
                return undefined;
            })();

            // 加载扁平化树并展示为默认项（与 searchIssues 行为一致）
            try {
                if (activeCommandItems.length > 0) { quickPick.activeItems = [activeCommandItems[0]]; }

                const flatNodes = await getFlatTree();

                const issueItems: QuickPickItemWithId[] = flatNodes.map(node => {
                    let description = "";
                    if (node.parentPath && node.parentPath.length > 0) {
                        const parentTitles = node.parentPath.map(n => n.title);
                        description = ["", ...parentTitles].join(" / ");
                    }
                    return { label: node.title, description, id: node.id } as QuickPickItemWithId;
                });

                // 多词过滤函数：支持空格分词，每个词都要匹配（对中文友好）
                const filterItems = (
                    items: QuickPickItemWithId[],
                    searchText: string
                ): QuickPickItemWithId[] => {
                    if (!searchText || !searchText.trim()) { return items; }
                    const keywords = searchText.trim().toLowerCase().split(/\s+/);
                    return items.filter(item => {
                        const hay = [item.label, item.description || ""].join(" ").toLowerCase();
                        return keywords.every(k => hay.includes(k));
                    });
                };

                // 帮助项与模式切换复用逻辑
                const HELP_ITEMS = [
                    { label: '命令模式', description: "输入关键词过滤并执行命令（支持空格多词匹配）" },
                    { label: '问题模式', description: "搜索并定位问题节点（用于导航/打开问题）" },
                    { label: '& 模式', description: "同时在命令和问题中搜索，方便模糊查找" },
                    { label: 'LLM 模式', description: "使用 LLM 辅助搜索/模糊匹配（示例模式）" },
                    { label: '; 前缀', description: "在输入前加 ';' 快速进入问题模式" },
                    { label: "> 前缀", description: "在输入前加 '>' 快速进入命令模式" }
                ];

                const switchToMode = (label: string, text = "") => {
                    if (label === '命令模式') {
                        inCommandMode = true;
                        suppressChange = true;
                        quickPick.items = activeCommandItems;
                        quickPick.placeholder =
                            "命令模式：输入关键词（支持空格多词匹配），点击按钮切换到问题列表";
                        quickPick.buttons = [cmdButton, issueButton, ampButton, helpButton];
                        quickPick.value = text;
                        if (activeCommandItems.length > 0) { quickPick.activeItems = [activeCommandItems[0]]; }
                    } else if (label === '问题模式') {
                        inCommandMode = false;
                        suppressChange = true;
                        quickPick.items = issueItems;
                        quickPick.placeholder =
                            "问题模式：输入关键词搜索问题，或点击按钮返回命令模式";
                        quickPick.buttons = [cmdButton, issueButton, ampButton, helpButton];
                        quickPick.value = text;
                        quickPick.activeItems = [];
                    } else if (label === '& 模式') {
                        inCommandMode = false;
                        suppressChange = true;
                        const combined = activeCommandItems.concat(issueItems);
                        quickPick.items = filterItems(combined, text);
                        quickPick.placeholder = "& 模式：同时搜索命令与问题";
                        quickPick.buttons = [cmdButton, issueButton, ampButton, helpButton];
                        quickPick.value = text;
                        quickPick.activeItems = [];
                    } else if (label === 'LLM 模式') {
                        // 示例性的 LLM 模式：目前表现为合并搜索，可以扩展为调用实际 LLM
                        inCommandMode = false;
                        suppressChange = true;
                        const combined = activeCommandItems.concat(issueItems);
                        quickPick.items = filterItems(combined, text);
                        quickPick.placeholder = "LLM 模式：使用 LLM 辅助搜索（示例）";
                        quickPick.buttons = [cmdButton, issueButton, ampButton, helpButton];
                        quickPick.value = text;
                        quickPick.activeItems = [];
                    } else if (label === '; 前缀') {
                        inCommandMode = false;
                        suppressChange = true;
                        quickPick.value = text;
                        quickPick.items = issueItems;
                        quickPick.buttons = [cmdButton, issueButton, ampButton, helpButton];
                        quickPick.activeItems = [];
                    } else if (label === "> 前缀") {
                        inCommandMode = true;
                        suppressChange = true;
                        quickPick.value = text;
                        quickPick.items = filterItems(activeCommandItems, text);
                        if (quickPick.items.length > 0) { quickPick.activeItems = [quickPick.items[0]]; }
                        quickPick.buttons = [cmdButton, issueButton, ampButton, helpButton];
                    }
                };

                // 统一模式入口，便于在多处调用以保持 placeholder/按钮/items 一致
                const enterMode = (mode: 'command' | 'issue' | 'amp' | 'semicolon' | 'greater' | 'llm', text = '') => {
                    const label =
                        mode === 'command'
                            ? '命令模式'
                            : mode === 'issue'
                            ? '问题模式'
                            : mode === 'amp'
                            ? '& 模式'
                            : mode === 'llm'
                            ? 'LLM 模式'
                            : mode === 'semicolon'
                            ? '; 前缀'
                            : '> 前缀';
                    switchToMode(label, text);
                };

                // 如果调用时传入初始模式，则在初始化后切换到该模式
                if (initialRequest && initialRequest.mode) {
                    // 支持多种写法：'command'|'issue'|'amp'|'llm' 等，或标签形式
                    const m = (initialRequest.mode || "").toString().toLowerCase();
                    if (m === 'command' || m === 'cmd' || m === '>' ) { enterMode('command', initialRequest.text); }
                    else if (m === 'issue' || m === 'list' || m === ';') { enterMode('issue', initialRequest.text); }
                    else if (m === 'amp' || m === '&') { enterMode('amp', initialRequest.text); }
                    else if (m === 'llm') { enterMode('llm', initialRequest.text); }
                    else if (m === 'greater' || m === '>') { enterMode('greater', initialRequest.text); }
                    else if (m === 'semicolon' || m === ';') { enterMode('semicolon', initialRequest.text); }
                }

                // 是否处于 help 模式（使用当前 quickPick 展示帮助项）
                let inHelpMode = false;

                // 打开 help 模式，复用当前 quickPick
                const openHelpInQuickPick = (text = "") => {
                    inHelpMode = true;
                    suppressChange = true;
                    quickPick.items = HELP_ITEMS as QuickPickItemWithId[];
                    quickPick.placeholder = '选择查看模式说明（输入搜索或按 Esc 关闭）';
                    quickPick.buttons = [cmdButton, issueButton, ampButton, helpButton];
                    quickPick.value = text;
                    quickPick.activeItems = [];
                };

                // 前缀处理映射：便于扩展新模式（例如 '&')
                const prefixHandlers: Record<string, (text: string) => void> = {
                    // 命令模式：'>' 前缀
                    ">": (text: string) => {
                        enterMode('greater', text);
                    },
                    // 问题列表模式：';' 前缀
                    ";": (text: string) => {
                        enterMode('semicolon', text);
                    }
                    ,
                    // '&' 模式示例：当前将命令与问题合并，按关键词过滤
                    "&": (text: string) => {
                        enterMode('amp', text);
                    },
                    // 'llm' 模式示例：示例性的 LLM 搜索模式（目前为合并搜索+不同占位提示）
                    "llm": (text: string) => {
                        enterMode('llm', text);
                    },
                    // '?' 前缀：显示帮助并切换到对应模式，同时保留后续输入作为搜索关键词
                    "?": (text: string) => {
                        openHelpInQuickPick(text);
                    }
                };

                quickPick.onDidTriggerButton(async btn => {
                    // 按钮切换：根据按钮切换到对应模式
                    if (btn === cmdButton) {
                        enterMode('command', "");
                    } else if (btn === issueButton) {
                        enterMode('issue', "");
                    } else if (btn === ampButton) {
                        enterMode('amp', "");
                    } else if (btn === helpButton) {
                        openHelpInQuickPick("");
                    }
                });

                quickPick.onDidChangeValue(value => {
                    if (suppressChange) {
                        suppressChange = false;
                        return;
                    }
                    const v = value || "";

                    // 如果处于 help 模式：优先检测前缀切换模式（支持 '>', ';', '&' 等），否则对 helpItems 进行过滤并展示
                    if (inHelpMode) {
                        if (v && v.length > 0) {
                            const p = v[0];
                            const handler = prefixHandlers[p];
                            if (handler) {
                                // 退出 help 模式并触发对应前缀处理
                                inHelpMode = false;
                                handler(v.slice(1));
                                return;
                            }
                        }
                        const filtered = filterItems(HELP_ITEMS as QuickPickItemWithId[], v);
                        quickPick.items = filtered;
                        if (filtered.length > 0) { quickPick.activeItems = [filtered[0]]; }
                        return;
                    }

                    // 支持可扩展的前缀处理：按最长前缀匹配（多字母前缀如 'llm' 要求后接空白或结束）
                    if (v && v.length > 0) {
                        const keys = Object.keys(prefixHandlers).sort((a, b) => b.length - a.length);
                        for (const key of keys) {
                            if (!v.startsWith(key)) { continue; }
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
                            if (handler) { handler(v.slice(key.length).trim()); return; }
                        }
                    }

                    if (inCommandMode) {
                        const filtered = filterItems(activeCommandItems, v);
                        quickPick.items = filtered;
                        if (filtered.length > 0) { quickPick.activeItems = [filtered[0]]; }
                    } else {
                        quickPick.items = issueItems;
                        quickPick.activeItems = [];
                    }
                });

                const handleAccept = async (selected?: QuickPickItemWithId) => {
                    if (!selected) { return; }

                    if (inCommandMode) {
                        const cmd = selected.commandId;
                        if (cmd) { await vscode.commands.executeCommand(cmd); }
                        return;
                    }

                    if (selected.id) {
                        try {
                            const node = await getIssueNodeById(selected.id);
                            await vscode.commands.executeCommand(
                                "issueManager.openAndRevealIssue",
                                node,
                                "overview"
                            );
                            return;
                        } catch (e) {
                            await vscode.commands.executeCommand("issueManager.searchIssues", "overview");
                            return;
                        }
                    }

                    await vscode.commands.executeCommand("issueManager.searchIssues", "overview");
                };

                quickPick.onDidAccept(async () => {
                    const selected = quickPick.selectedItems[0];
                    if (!selected) {
                        quickPick.hide();
                        return;
                    }

                    if (inHelpMode) {
                        // help 模式：选择后切换到对应模式并继续展示 quickPick
                        switchToMode(selected.label, quickPick.value);
                        inHelpMode = false;
                        return;
                    }

                    await handleAccept(selected);
                    quickPick.hide();
                });

                quickPick.onDidHide(() => quickPick.dispose());
            } catch (err) {
                quickPick.busy = false;
                quickPick.hide();
                vscode.window.showErrorMessage("加载问题列表失败。");
            }
        })
    );
}
