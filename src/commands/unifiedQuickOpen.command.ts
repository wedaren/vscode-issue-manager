import * as vscode from "vscode";
import { QuickPickItemWithId, filterItems } from "./unifiedQuickOpen.types";
import { getIssueIdFromUri } from "../utils/uriUtils";
import { getIssueNodeById } from "../data/issueTreeManager";
import { HistoryService } from "./unifiedQuickOpen.history.service";
import { getIssueMarkdown, isIssueMarkdown, extractFrontmatterAndBody } from "../data/IssueMarkdowns";
import { forceRefreshCurrentEditor } from "./forceRefreshCurrentEditor";
import { canDeleteFromEditor } from "./deleteIssue";
import { createAndOpenIssue } from "./createAndOpenIssue";
import { llmFillIssue } from "./llmFillIssue";



/**
 * 命令模式的所有命令项定义
 *
 * 分组说明：
 * - 生成: 生成项目名、分支名、标题、简明摘要等文本或元数据
 * - 复制: 复制文件名、Issue ID、IssueMarkdown 链接
 * - 创建: 创建子问题或译文
 * - 编辑: 在当前编辑器中插入 marks/terms 或为选中文本添加拼音
 * - 文件: 刷新或强制刷新当前编辑器
 * - 导航: 在问题总览或最近视图中定位
 * - 管理: 添加关注、移动或关联 IssueNode
 */
const COMMAND_ITEMS: QuickPickItemWithId[] = [
    // --- 优先: 文件 - 刷新当前活动编辑器 ---
    {
        label: "刷新当前活动编辑器",
        group: "文件",
        hint: "refresh",
        description: "从磁盘重新加载当前活动编辑器的内容（刷新）",
        require: async ctx => !!ctx.uri && isIssueMarkdown(await getIssueMarkdown(ctx.uri)),
        execute: () => {
            vscode.commands.executeCommand("workbench.action.files.revert");
        },
    },

    // --- 生成 (生成项目名 / 分支 / 标题 / 摘要) ---
    {
        label: "生成项目名",
        group: "生成",
        hint: "project",
        description: "基于活动编辑器内容生成项目名并复制",
        execute: () => {
            vscode.commands.executeCommand(
                "issueManager.generateProjectName"
            );
        },
    },
    {
        label: "生成 Git 分支名",
        group: "生成",
        hint: "branch",
        description: "基于活动编辑器内容生成 git 分支名并复制",
        execute: () => {
            vscode.commands.executeCommand(
                "issueManager.generateGitBranchName"
            );
        },
    },
    {
        label: "生成标题",
        group: "生成",
        hint: "title",
        description: "为当前编辑器的 IssueMarkdown 生成 IssueTitle",
        require: async ctx => !!ctx.uri && isIssueMarkdown(await getIssueMarkdown(ctx.uri)),
        execute: () => {
            vscode.commands.executeCommand(
                "issueManager.generateTitleCommand"
            );
        },
    },
    {
        label: "生成简明摘要",
        group: "生成",
        hint: "summary",
        description: "为当前编辑器的 IssueMarkdown 生成简明摘要",
        require: async ctx => !!ctx.uri && isIssueMarkdown(await getIssueMarkdown(ctx.uri)),
        execute: () => {
            vscode.commands.executeCommand(
                "issueManager.generateBriefSummaryCommand"
            );
        },
    },
    {
        label: "LLM 回答问题",
        group: "生成",
        hint: "llm fill answer",
        description: "根据标题和已有内容，用 LLM 生成回答并填充（空文档替换正文，非空追加到末尾）",
        require: async ctx => !!ctx.uri && isIssueMarkdown(await getIssueMarkdown(ctx.uri)),
        execute: async () => {
            await llmFillIssue();
        },
    },

    // --- 复制 (文件名 / 问题 ID / IssueMarkdown 链接) ---
    {
        label: "复制文件名",
        group: "复制",
        hint: "filename",
        description: "复制当前编辑器的 IssueMarkdown 真实文件名到剪贴板",
        require: ctx => !!ctx.issueId,
        execute: () => {
            vscode.commands.executeCommand("issueManager.copyFilename");
        },
    },
    {
        label: "复制问题 ID",
        group: "复制",
        hint: "id",
        description: "复制当前编辑器中的 IssueNode ID 到剪贴板",
        require: ctx => !!ctx.issueId,
        execute: () => {
            vscode.commands.executeCommand("issueManager.copyIssueId");
        },
    },
    {
        label: "复制 IssueMarkdown 链接",
        group: "复制",
        hint: "link",
        description: "将当前编辑器对应的 IssueMarkdown 文件以 Markdown 链接格式复制到剪贴板（格式: [标题](IssueDir/相对路径)）",
        require: async ctx => !!ctx.uri && isIssueMarkdown(await getIssueMarkdown(ctx.uri)),
        execute: () => {
            vscode.commands.executeCommand("issueManager.copyIssueMarkdownLink");
        },
    },

    // --- 创建 (新建问题 / 子问题 / 译文) ---
    {
        label: "新建问题",
        group: "创建",
        hint: "create",
        description: "直接创建一个新问题并在编辑器中打开",
        execute: async () => {
            await createAndOpenIssue();
        },
    },
    {
        label: "新建子问题",
        group: "创建",
        hint: "sub-issue",
        description: "从当前编辑器对应的 IssueNode 下创建子问题",
        require: ctx => !!ctx.issueId,
        execute: () => {
            vscode.commands.executeCommand(
                "issueManager.createSubIssueFromEditor"
            );
        },
    },
    {
        label: "新建译文",
        group: "创建",
        hint: "translation",
        description: "为当前 IssueMarkdown 创建译文文件并打开",
        require: async ctx => !!ctx.uri && isIssueMarkdown(await getIssueMarkdown(ctx.uri)),
        execute: async () => {
            await vscode.commands.executeCommand(
                "issueManager.createTranslationFromEditor"
            );
        },
    },
    {
        label: "从选中文本创建 Wiki",
        group: "创建",
        hint: "wiki",
        description: "基于当前编辑器的选中文本生成 Wiki 文档并替换为 [[Title]] 链接",
        require: async ctx => {
            try {
                const ed = vscode.window.activeTextEditor;
                return !!ed && !ed.selection.isEmpty;
            } catch {
                return false;
            }
        },
        execute: async () => {
            await vscode.commands.executeCommand("issueManager.createWikiFromSelection");
        },
    },

    // --- 编辑 (插入 marks / 插入 terms / 拼音注释) ---
    {
        label: "插入 marks 到当前编辑器",
        group: "编辑",
        hint: "marks",
        description: "将当前任务的 marks 插入到当前活动编辑器",
        execute: () => {
            vscode.commands.executeCommand(
                "issueManager.marker.insertMarksToActiveEditor"
            );
        },
    },
    {
        label: "插入 terms_reference 到当前编辑器",
        group: "编辑",
        hint: "terms",
        description: "从包含术语的 Issue 文件中选择并插入到当前文件的 frontmatter.terms_references",
        execute: () => {
            vscode.commands.executeCommand(
                "issueManager.marker.insertTermsReferencesToActiveEditor"
            );
        },
    },
    {
        label: "为选中文本添加拼音",
        group: "编辑",
        hint: "pinyin",
        description: "在选中文本后追加拼音注释（仅在 IssueMarkdown 文档中可用）",
        require: async ctx => {
            try {
                if (!ctx.uri) return false;
                if (!isIssueMarkdown(await getIssueMarkdown(ctx.uri))) return false;
                const ed = vscode.window.activeTextEditor;
                return !!ed && !ed.selection.isEmpty;
            } catch {
                return false;
            }
        },
        execute: () => {
            vscode.commands.executeCommand('issueManager.annotatePinyinWithLLM');
        },
    },
    {
        label: "移除选区中的 Wiki 链接",
        group: "编辑",
        hint: "remove-wiki",
        description: "在当前选区内或包裹选中文本的 [[...]] 中移除 wiki 方括号，仅保留内部文本",
        require: async ctx => {
            try {
                const ed = vscode.window.activeTextEditor;
                return !!ed && !ed.selection.isEmpty;
            } catch {
                return false;
            }
        },
        execute: async () => {
            await vscode.commands.executeCommand('issueManager.removeWikiLinksFromSelection');
        },
    },

    // --- 文件 (刷新 / 强制刷新 / 编辑器组管理) ---
    {
        label: "编辑器组总览",
        group: "文件",
        hint: "group overview",
        description: "查看所有编辑器组并快速切换聚焦",
        execute: async () => {
            await vscode.commands.executeCommand("issueManager.editorGroupOverview");
        },
    },
    {
        label: "移动编辑器到组",
        group: "文件",
        hint: "move group",
        description: "将当前编辑器移动到指定的编辑器组或新组",
        execute: async () => {
            await vscode.commands.executeCommand("issueManager.moveEditorToGroup");
        },
    },
    {
        label: "关闭编辑器组",
        group: "文件",
        hint: "close group",
        description: "选择并关闭指定的编辑器组（支持多选）",
        execute: async () => {
            await vscode.commands.executeCommand("issueManager.closeEditorGroups");
        },
    },
    {
        label: "LLM 智能整理编辑器组",
        group: "文件",
        hint: "llm organize group",
        description: "使用 Copilot LLM 分析标签页并自动按主题分组",
        execute: async () => {
            await vscode.commands.executeCommand("issueManager.organizeEditorGroupsWithLLM");
        },
    },
    {
        label: "强制刷新当前编辑器",
        group: "文件",
        hint: "force-refresh",
        description: "关闭并重新打开当前活动编辑器，解决接口改写后未正确展示的问题（需先保存）",
        require: ctx => !!ctx.uri,
        execute: async () => {
            await forceRefreshCurrentEditor();
        },
    },

    // --- 导航 (总览 / 最近) ---
    {
        label: "在问题总览中查看",
        group: "导航",
        hint: "overview",
        description: "在问题总览中定位当前编辑器对应的 IssueNode",
        require: ctx => !!ctx.issueId,
        execute: () => {
            vscode.commands.executeCommand(
                "issueManager.revealInOverviewFromEditor"
            );
        },
    },
    {
        label: "在最近视图中查看",
        group: "导航",
        hint: "recent",
        description: "在最近问题视图中定位当前编辑器对应的文件（若存在）",
        require: ctx => !!ctx.uri,
        execute: () => {
            vscode.commands.executeCommand("issueManager.revealInRecentFromEditor");
        },
    },

    // --- 管理 (关注 / 移动 / 关联) ---
    {
        label: "添加到关注",
        group: "管理",
        hint: "follow",
        description: "将当前 IssueNode 加入关注列表",
        require: ctx => !!ctx.issueId,
        execute: () => {
            vscode.commands.executeCommand(
                "issueManager.addToFocusedViewFromEditor"
            );
        },
    },
    {
        label: "移动到...",
        group: "管理",
        hint: "move",
        description: "将当前 IssueNode 移动到其他 IssueNode 下",
        require: ctx => !!ctx.issueId,
        execute: async () => {
            await vscode.commands.executeCommand("issueManager.moveToFromEditor");
        },
    },
    {
        label: "关联到...",
        group: "管理",
        hint: "attach",
        description: "将当前 IssueNode 关联到其他 IssueNode 下",
        require: ctx => !!ctx.issueId,
        execute: async () => {
            await vscode.commands.executeCommand("issueManager.attachToFromEditor");
        },
    },
    {
        label: "配置模型",
        group: "管理",
        hint: "model tokens",
        description: "交互式配置当前角色或对话的模型和 max_tokens",
        require: async ctx => {
            if (!ctx.uri) { return false; }
            try {
                const bytes = await vscode.workspace.fs.readFile(ctx.uri);
                const { frontmatter } = extractFrontmatterAndBody(Buffer.from(bytes).toString('utf-8'));
                return !!frontmatter?.chat_role || !!frontmatter?.chat_conversation;
            } catch {
                return false;
            }
        },
        execute: async () => {
            await vscode.commands.executeCommand('issueManager.llmChat.configureModel', vscode.window.activeTextEditor?.document?.uri);
        },
    },
    {
        label: "配置工具集",
        group: "管理",
        hint: "tools configure",
        description: "交互式配置当前角色的 tool_sets / mcp_servers / extra_tools / excluded_tools",
        require: async ctx => {
            if (!ctx.uri) { return false; }
            try {
                const bytes = await vscode.workspace.fs.readFile(ctx.uri);
                const { frontmatter } = extractFrontmatterAndBody(Buffer.from(bytes).toString('utf-8'));
                return !!frontmatter?.chat_role;
            } catch {
                return false;
            }
        },
        execute: async () => {
            await vscode.commands.executeCommand('issueManager.llmChat.configureTools', vscode.window.activeTextEditor?.document?.uri);
        },
    },
    {
        label: "删除当前问题",
        group: "管理",
        hint: "delete",
        description: "永久删除当前编辑器对应的 IssueMarkdown 或 IssueNode 文件",
        require: async ctx => !!ctx.uri && !!(await canDeleteFromEditor(ctx.uri)),
        execute: async () => {
            await vscode.commands.executeCommand("issueManager.deleteIssueFromEditor");
        },
    },
];

// NOTE: 分组信息已合并到 `COMMAND_ITEMS` 的 `group` 字段，避免分散配置。

/**
 * 将 items 按 `group` 分组，并在每组前插入不可选的分隔项（Separator）。
 * 保持组出现顺序与原数组一致；没有 group 的项归到 "其他"。
 */
function groupItems(items: QuickPickItemWithId[]): QuickPickItemWithId[] {
    const groups = new Map<string, QuickPickItemWithId[]>();
    for (const it of items) {
        const g = it.group ?? "其他";
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g)!.push(it);
    }
    const out: QuickPickItemWithId[] = [];
    for (const [g, list] of groups) {
        // 插入分组分隔（不可选）
        out.push({ label: g, kind: vscode.QuickPickItemKind.Separator } as QuickPickItemWithId);
        out.push(...list);
    }
    return out;
}

/**
 * 在 description 前添加简短可记的 hint（优先使用 hint，否则使用 group），便于通过输入快速过滤。
 */
function applyDescriptionHints(items: QuickPickItemWithId[]): QuickPickItemWithId[] {
    return items.map(it => {
        const token = it.hint ?? it.group ?? "other";
        const desc = it.description ?? "";
        const prefix = `${token} · `;
        if (!desc.startsWith(prefix)) {
            return { ...it, description: prefix + desc };
        }
        return it;
    });
}

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
        
        // 使用 Promise.all 并发处理所有 require 检查
        const results = await Promise.all(
            COMMAND_ITEMS.map(async (item) => {
                if (!item.require) {
                    return { item, shouldInclude: true };
                }
                try {
                    const result = await item.require(ctx);
                    return { item, shouldInclude: !!result };
                } catch (e) {
                    return { item, shouldInclude: false };
                }
            })
        );
        
        return results.filter(r => r.shouldInclude).map(r => r.item);
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
    const hinted = applyDescriptionHints(activeCommandItems);
    quickPick.items = groupItems(hinted);
    quickPick.placeholder = "命令模式：输入关键词（支持空格多词匹配），点击按钮切换到问题列表";
    if (activeCommandItems.length > 0) {
        const grouped = groupItems(hinted);
        const first = grouped.find(i => i.kind !== vscode.QuickPickItemKind.Separator);
        if (first) quickPick.activeItems = [first];
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
    const hintedAll = applyDescriptionHints(activeCommandItems);
    const filtered = filterItems(hintedAll, value);
    const grouped = groupItems(filtered);
    quickPick.items = grouped;
    const first = grouped.find(i => i.kind !== vscode.QuickPickItemKind.Separator);
    if (first) quickPick.activeItems = [first];
}

/**
 * 处理命令模式的选择确认
 */
export async function handleCommandModeAccept(
    selected: QuickPickItemWithId,
    value: string,
    historyService?: HistoryService
): Promise<boolean> {
    // 忽略分隔项
    if (selected.kind === vscode.QuickPickItemKind.Separator) return false;
    if (selected.execute) {
        await selected.execute(value);
        // 记录历史
        if (historyService && value) {
            await historyService.addHistory('command', value);
        }
        return true;
    }
    return false;
}
