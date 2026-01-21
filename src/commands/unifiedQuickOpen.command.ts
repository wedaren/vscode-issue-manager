import * as vscode from "vscode";
import { QuickPickItemWithId, filterItems } from "./unifiedQuickOpen.types";
import { getIssueIdFromUri } from "../utils/uriUtils";
import { getIssueNodeById } from "../data/issueTreeManager";

/**
 * 命令模式的所有命令项定义
 */
const COMMAND_ITEMS: QuickPickItemWithId[] = [
    {
        label: "生成项目名",
        description: "基于活动编辑器内容生成项目名并复制",
        execute: async () => {
            await vscode.commands.executeCommand(
                "issueManager.generateProjectName"
            );
        },
    },
    {
        label: "插入 marks 到当前编辑器",
        description: "将当前任务的 marks 插入到当前活动编辑器",
        execute: async () => {
            await vscode.commands.executeCommand(
                "issueManager.marker.insertMarksToActivedEditor"
            );
        },
    },
    {
        label: "生成 Git 分支名",
        description: "基于活动编辑器内容生成 git 分支名并复制",
        execute: async () => {
            await vscode.commands.executeCommand(
                "issueManager.generateGitBranchName"
            );
        },
    },
    {
        label: "新建子问题",
        description: "从当前编辑器对应的 IssueNode 下创建子问题",
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
        require: ctx => !!ctx.issueId,
        execute: async () => {
            await vscode.commands.executeCommand("issueManager.copyFilename");
        },
    },
    {
        label: "复制问题 ID",
        description: "复制当前编辑器中的 IssueNode ID 到剪贴板",
        require: ctx => !!ctx.issueId,
        execute: async () => {
            await vscode.commands.executeCommand("issueManager.copyIssueId");
        },
    },
    {
        label: "在问题总览中查看",
        description: "在问题总览中定位当前编辑器对应的 IssueNode",
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
        require: ctx => !!ctx.issueId,
        execute: async () => {
            await vscode.commands.executeCommand("issueManager.moveToFromEditor");
        },
    },
    {
        label: "关联到...",
        description: "将当前 IssueNode 关联到其他 IssueNode 下",
        require: ctx => !!ctx.issueId,
        execute: async () => {
            await vscode.commands.executeCommand("issueManager.attachToFromEditor");
        },
    },
];

/**
 * 获取当前编辑器上下文中的有效命令项
 */
export async function getActiveCommandItems(): Promise<QuickPickItemWithId[]> {
    let currentEditorIssueId: string | undefined;
    try {
        const activeUri = vscode.window.activeTextEditor?.document?.uri;
        currentEditorIssueId = getIssueIdFromUri(activeUri);
        let activeIssueValid = !!(await getIssueNodeById(currentEditorIssueId || ""));
        currentEditorIssueId = activeIssueValid ? currentEditorIssueId : undefined;
        const ctx = { issueId: currentEditorIssueId, uri: activeUri };
        return COMMAND_ITEMS.filter(i => {
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
        return COMMAND_ITEMS.filter(i => !i.require);
    }
}

/**
 * 进入命令模式，设置 QuickPick 的状态
 */
export async function enterCommandMode(
    quickPick: vscode.QuickPick<QuickPickItemWithId>
): Promise<void> {
    const activeCommandItems = await getActiveCommandItems();
    quickPick.items = activeCommandItems;
    quickPick.placeholder = "命令模式：输入关键词（支持空格多词匹配），点击按钮切换到问题列表";
    if (activeCommandItems.length > 0) {
        quickPick.activeItems = [activeCommandItems[0]];
    }
}

/**
 * 处理命令模式的值变化
 */
export async function handleCommandModeValueChange(
    quickPick: vscode.QuickPick<QuickPickItemWithId>,
    value: string
): Promise<void> {
    const activeCommandItems = await getActiveCommandItems();
    const filtered = filterItems(activeCommandItems, value);
    quickPick.items = filtered;
    if (filtered.length > 0) {
        quickPick.activeItems = [filtered[0]];
    }
}

/**
 * 处理命令模式的选择确认
 */
export async function handleCommandModeAccept(
    selected: QuickPickItemWithId,
    value: string
): Promise<boolean> {
    if (selected.execute) {
        selected.execute(value);
        return true;
    }
    return false;
}
