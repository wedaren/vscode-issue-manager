import * as vscode from "vscode";
import { QuickPickItemWithId, Mode, InitialArg, filterItems } from "./unifiedQuickOpen.types";
import { 
    enterCommandMode, 
    handleCommandModeValueChange, 
    handleCommandModeAccept 
} from "./unifiedQuickOpen.command";
import { 
    enterIssueMode, 
    handleIssueModeValueChange, 
    handleIssueModeAccept,
} from "./unifiedQuickOpen.issue";
import { 
    enterLLMMode, 
    handleLLMModeAccept 
} from "./unifiedQuickOpen.llm";
import { 
    enterTimeMode,
    handleTimeModeValueChange,
    handleTimeModeAccept,
} from "./unifiedQuickOpen.time";
import {
    enterCreateMode,
    handleCreateModeValueChange,
    handleCreateModeAccept,
} from "./unifiedQuickOpen.create";
import { getIssueNodesByUri } from "../data/issueTreeManager";

/**
 * 模式配置：集中管理所有模式的信息
 */
const MODE_CONFIG = {
    command: {
        mode: 'command' as Mode,
        prefix: '>',
        label: '命令模式',
        description: '输入关键词过滤并执行命令（支持空格多词匹配）',
        icon: 'terminal',
        tooltip: '切换到命令模式',
    },
    issue: {
        mode: 'issue' as Mode,
        prefix: ';',
        label: '问题搜索',
        description: '搜索并定位问题节点（用于导航/打开问题）',
        icon: 'list-tree',
        tooltip: '切换到问题搜索',
    },
    llm: {
        mode: 'llm' as Mode,
        prefix: 'llm',
        label: 'LLM 模式',
        description: '使用 LLM 辅助搜索/模糊匹配（示例模式）',
        icon: 'sparkle',
        tooltip: '切换到 LLM 模式',
    },
    create: {
        mode: 'create' as Mode,
        prefix: 'new',
        label: '新建问题',
        description: '创建新问题（支持后台填充和使用 prompts）',
        icon: 'add',
        tooltip: '切换到新建问题模式',
    },
    mtime: {
        mode: 'mtime' as Mode,
        prefix: 'mtime',
        label: '按修改时间 (mtime)',
        description: '按照文件修改时间列出问题 Markdown（最近更新在前）',
        icon: 'history',
        tooltip: '按 mtime 列出问题',
    },
    ctime: {
        mode: 'ctime' as Mode,
        prefix: 'ctime',
        label: '按创建时间 (ctime)',
        description: '按照文件创建时间或文件名时间戳列出问题',
        icon: 'history',
        tooltip: '按 ctime 列出问题',
    },
    vtime: {
        mode: 'vtime' as Mode,
        prefix: 'vtime',
        label: '按访问时间 (vtime)',
        description: '按照文件最后查看时间列出问题（最近打开在前）',
        icon: 'eye',
        tooltip: '按 vtime 列出问题',
    },
} as const;

/**
 * 帮助按钮配置
 */
const HELP_BUTTON_CONFIG = {
    icon: 'question',
    tooltip: '各模式说明',
} as const;

/**
 * 帮助模式的项定义
 */
function createHelpItems(enterMode: (mode: Mode, text?: string) => Promise<void>): QuickPickItemWithId[] {
    return Object.values(MODE_CONFIG).map(config => ({
        label: config.label,
        description: `${config.description} · 快捷前缀：${config.prefix}`,
        execute: async () => await enterMode(config.mode),
    }));
}

export function registerUnifiedQuickOpenCommand(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "issueManager.unifiedQuickOpen",
            async (initialArg?: InitialArg) => {
                const quickPick = vscode.window.createQuickPick<QuickPickItemWithId>();
                quickPick.matchOnDescription = true;

                // 创建模式切换按钮
                const modeButtons = Object.fromEntries(
                    Object.entries(MODE_CONFIG).map(([key, config]) => [
                        key,
                        {
                            iconPath: new vscode.ThemeIcon(config.icon),
                            tooltip: config.tooltip,
                        } as vscode.QuickInputButton
                    ])
                );
                
                const helpButton: vscode.QuickInputButton = {
                    iconPath: new vscode.ThemeIcon(HELP_BUTTON_CONFIG.icon),
                    tooltip: HELP_BUTTON_CONFIG.tooltip,
                };

                quickPick.buttons = [
                    modeButtons.command,
                    modeButtons.issue,
                    modeButtons.create,
                    modeButtons.mtime,
                    modeButtons.ctime,
                    modeButtons.vtime,
                    helpButton
                ];

                // 当前模式状态
                let currentMode: Mode = 'command';
                let suppressChange = false;
                let inHelpMode = false;

                // 不在主文件维护 currentEditorIssueId，交由各模式按需获取
                // 解析初始请求
                const initialRequest: InitialArg | undefined = initialArg;
                const wantsInlineMode = !!(initialRequest && ["issue", "llm", "create", "mtime", "ctime", "vtime"].includes(initialRequest.mode || ''));

                // 模式切换函数（不再接受 text 参数，调用处需在调用前设置 quickPick.value）
                const enterMode = async (mode: Mode) => {
                    currentMode = mode;
                    suppressChange = true;
                    quickPick.activeItems = [];
                    quickPick.buttons = [
                        modeButtons.command,
                        modeButtons.issue,
                        modeButtons.create,
                        modeButtons.mtime,
                        modeButtons.ctime,
                        modeButtons.vtime,
                        helpButton
                    ];

                    if (mode === 'command') {
                        await enterCommandMode(quickPick);
                    } else if (mode === 'issue') {
                        await enterIssueMode(quickPick);
                    } else if (mode === 'llm') {
                        await enterLLMMode(quickPick);
                    } else if (mode === 'create') {
                        await enterCreateMode(quickPick);
                    } else if (mode === 'mtime') {
                        await enterTimeMode(quickPick, "", "mtime");
                    } else if (mode === 'ctime') {
                        await enterTimeMode(quickPick, "", "ctime");
                    } else if (mode === 'vtime') {
                        await enterTimeMode(quickPick, "", "vtime");
                    }
                    
                    suppressChange = false;
                };

                // 帮助模式
                const HELP_ITEMS = createHelpItems(enterMode);
                
                const openHelpInQuickPick = (text = "") => {
                    inHelpMode = true;
                    suppressChange = true;
                    quickPick.items = HELP_ITEMS;
                    quickPick.placeholder = "选择查看模式说明（输入搜索或按 Esc 关闭）";
                    quickPick.buttons = [
                        modeButtons.command,
                        modeButtons.issue,
                        modeButtons.create,
                        modeButtons.mtime,
                        modeButtons.ctime,
                        modeButtons.vtime,
                        helpButton
                    ];
                    quickPick.value = text;
                    quickPick.activeItems = [];
                };

                // 前缀处理映射（调用方需将剩余文本传入；handler 会设置 quickPick.value 后进入模式）
                const prefixHandlers: Record<string, (text: string) => Promise<void> | void> = {
                    [MODE_CONFIG.command.prefix]: async (text: string) => {
                        quickPick.value = text;
                        await enterMode("command");
                    },
                    [MODE_CONFIG.issue.prefix]: async (text: string) => {
                        quickPick.value = text;
                        await enterMode("issue");
                    },
                    [MODE_CONFIG.llm.prefix]: async (text: string) => {
                        quickPick.value = text;
                        await enterMode("llm");
                    },
                    [MODE_CONFIG.create.prefix]: async (text: string) => {
                        quickPick.value = text;
                        await enterMode("create");
                    },
                    [MODE_CONFIG.mtime.prefix]: async (text: string) => {
                        quickPick.value = text;
                        await enterMode("mtime");
                    },
                    [MODE_CONFIG.ctime.prefix]: async (text: string) => {
                        quickPick.value = text;
                        await enterMode("ctime");
                    },
                    [MODE_CONFIG.vtime.prefix]: async (text: string) => {
                        quickPick.value = text;
                        await enterMode("vtime");
                    },
                    "?": async (text: string) => openHelpInQuickPick(text),
                };

                // 初始化显示
                if (!wantsInlineMode) {
                    quickPick.value = "";
                    await enterMode('command');
                } else {
                    currentMode = initialRequest.mode as Mode;
                    quickPick.value = initialRequest?.text || "";
                    quickPick.busy = true;
                    quickPick.items = [];
                    quickPick.placeholder = "搜索或新建问题（正在加载...）";
                }

                quickPick.show();

                // 如果是内联模式，延迟加载内容
                if (wantsInlineMode) {
                    if (currentMode === 'issue') {
                        await enterIssueMode(quickPick, initialRequest?.text || "");
                    } else if (currentMode === 'llm') {
                        await enterLLMMode(quickPick, initialRequest?.text || "");
                    } else if (currentMode === 'create') {
                        await enterCreateMode(quickPick, initialRequest?.text || "");
                    } else if (currentMode === 'mtime') {
                        await enterTimeMode(quickPick, initialRequest?.text || "", "mtime");
                    } else if (currentMode === 'ctime') {
                        await enterTimeMode(quickPick, initialRequest?.text || "", "ctime");
                    } else if (currentMode === 'vtime') {
                        await enterTimeMode(quickPick, initialRequest?.text || "", "vtime");
                    }
                    suppressChange = false;
                } else {
                    // 处理初始请求的模式切换
                    if (initialRequest && initialRequest.mode) {
                        const m = (initialRequest.mode || "").toString().toLowerCase();
                        // 检查是否匹配任何模式或前缀
                        for (const config of Object.values(MODE_CONFIG)) {
                            if (m === config.mode || m === config.prefix) {
                                    quickPick.value = initialRequest.text || "";
                                    await enterMode(config.mode);
                                break;
                            }
                        }
                    }
                }

                // 按钮点击处理
                quickPick.onDidTriggerButton(async btn => {
                    inHelpMode = false;
                    if (btn === modeButtons.command) {
                        quickPick.value = "";
                        await enterMode("command");
                    } else if (btn === modeButtons.issue) {
                        quickPick.value = "";
                        await enterMode("issue");
                    } else if (btn === modeButtons.create) {
                        quickPick.value = "";
                        await enterMode("create");
                    } else if (btn === modeButtons.mtime) {
                        quickPick.value = "";
                        await enterMode("mtime");
                    } else if (btn === modeButtons.ctime) {
                        quickPick.value = "";
                        await enterMode("ctime");
                    } else if (btn === modeButtons.vtime) {
                        quickPick.value = "";
                        await enterMode("vtime");
                    } else if (btn === helpButton) {
                        openHelpInQuickPick("");
                    }
                });

                // 处理 item 上的按钮（例如在 LLM 模板项上可能包含打开文件的按钮）
                quickPick.onDidTriggerItemButton && quickPick.onDidTriggerItemButton(async e => {
                    const fileUri = (e.item as QuickPickItemWithId).fileUri;
                    if (!fileUri) {
                        return;
                    }
                    try {
                        const nodes = await getIssueNodesByUri(fileUri);
                        if (nodes?.[0]) {
                            await vscode.commands.executeCommand('issueManager.openAndRevealIssue', nodes[0], 'overview');
                        } else {
                            const doc = await vscode.workspace.openTextDocument(fileUri);
                            await vscode.window.showTextDocument(doc, { preview: true });
                        }
                    } catch (err) {
                        try {
                            const doc = await vscode.workspace.openTextDocument(fileUri);
                            await vscode.window.showTextDocument(doc, { preview: true });
                        } catch (e) {
                            vscode.window.showErrorMessage('打开问题文件失败：' + String(e));
                        }
                    }
                });

                // 输入值变化处理
                quickPick.onDidChangeValue(async value => {
                    if (suppressChange) {
                        suppressChange = false;
                        return;
                    }

                    const v = value || "";

                    // 帮助模式下的处理
                    if (inHelpMode) {
                        if (v && v.length > 0) {
                            const p = v[0];
                            const handler = prefixHandlers[p];
                            if (handler) {
                                inHelpMode = false;
                                await handler(v.slice(1));
                                return;
                            }
                        }
                        const filtered = filterItems(HELP_ITEMS, v);
                        quickPick.items = filtered;
                        if (filtered.length > 0) {
                            quickPick.activeItems = [filtered[0]];
                        }
                        return;
                    }

                    // 前缀处理
                    if (v && v.length > 0) {
                        const keys = Object.keys(prefixHandlers).sort(
                            (a, b) => b.length - a.length
                        );
                        for (const key of keys) {
                            if (!v.startsWith(key)) {
                                continue;
                            }
                            // 如果前缀是多字母（如 'llm'），要求后续字符为空白或字符串结束
                            const isAlphaKey = /^[A-Za-z]+$/.test(key);
                            if (isAlphaKey && key.length > 1) {
                                const nextChar = v.charAt(key.length);
                                if (!nextChar || !/\s/.test(nextChar)) {
                                    continue;
                                }
                            }
                            const handler = prefixHandlers[key];
                            if (handler) {
                                // handler 会负责设置 quickPick.value 再调用 enterMode
                                await handler(v.slice(key.length).trim());
                                return;
                            }
                        }
                    }

                    // 根据当前模式处理值变化
                    if (currentMode === 'command') {
                        await handleCommandModeValueChange(quickPick, v);
                    } else if (currentMode === 'issue') {
                        await handleIssueModeValueChange(quickPick, v);
                    } else if (currentMode === 'create') {
                        await handleCreateModeValueChange(quickPick, v);
                    } else if (currentMode === 'mtime') {
                        await handleTimeModeValueChange(quickPick, v, 'mtime');
                    } else if (currentMode === 'ctime') {
                        await handleTimeModeValueChange(quickPick, v, 'ctime');
                    } else if (currentMode === 'vtime') {
                        await handleTimeModeValueChange(quickPick, v, 'vtime');
                    }
                    // LLM 模式下不需要处理值变化
                });

                // 选择确认处理
                quickPick.onDidAccept(async () => {
                    const selected = quickPick.selectedItems[0];
                    if (!selected) {
                        quickPick.hide();
                        return;
                    }

                    // 帮助模式处理
                    if (inHelpMode) {
                        try {
                            if (selected.execute) {
                                await Promise.resolve(
                                    selected.execute(quickPick.value, { quickPick })
                                );
                            }
                        } catch (e) {
                            console.error("help item execute error:", e);
                        }
                        inHelpMode = false;
                        return;
                    }

                    // 根据当前模式处理确认
                    let handled = false;
                    
                    if (currentMode === 'command') {
                        handled = await handleCommandModeAccept(selected, quickPick.value);
                    } else if (currentMode === 'issue') {
                        handled = await handleIssueModeAccept(selected, quickPick.value);
                    } else if (currentMode === 'llm') {
                        handled = await handleLLMModeAccept(selected, quickPick.value);
                    } else if (currentMode === 'create') {
                        handled = await handleCreateModeAccept(selected, quickPick.value);
                    } else if (currentMode === 'mtime') {
                        handled = await handleTimeModeAccept(selected, quickPick.value, 'mtime');
                    } else if (currentMode === 'ctime') {
                        handled = await handleTimeModeAccept(selected, quickPick.value, 'ctime');
                    } else if (currentMode === 'vtime') {
                        handled = await handleTimeModeAccept(selected, quickPick.value, 'vtime');
                    }

                    if (handled) {
                        quickPick.hide();
                        return;
                    }

                    // 如果未处理，默认行为
                    await vscode.commands.executeCommand(
                        "issueManager.searchIssues",
                        "overview"
                    );
                    quickPick.hide();
                });

                quickPick.onDidHide(() => quickPick.dispose());
            }
        )
    );
}
