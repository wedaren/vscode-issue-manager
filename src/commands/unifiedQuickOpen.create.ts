import * as vscode from "vscode";
import { QuickPickItemWithId } from "./unifiedQuickOpen.types";
import {
    createIssueMarkdown,
    getAllPrompts,
    getIssueMarkdown,
    updateIssueMarkdownFrontmatter,
} from "../data/IssueMarkdowns";
import { getCurrentEditorIssueId } from "./unifiedQuickOpen.issue";
import { backgroundFillIssue } from "../llm/backgroundFill";
import { openIssueNodeBeside } from "./openIssueNode";
import { createIssueNodes } from "../data/issueTreeManager";

function buildPromptWithContent(currentEditorContent: string, template?: string) {
    if (!template) {
        return currentEditorContent;
    }
    return template.includes("{{content}}")
        ? template.replace("{{content}}", currentEditorContent)
        : `${template}\n\n${currentEditorContent}`;
}

async function createCreateModeItems(value: string): Promise<QuickPickItemWithId[]> {
    const issue = value || "";
    const currentEditor = vscode.window.activeTextEditor;
    const currentSelectedText = currentEditor?.document?.getText(currentEditor.selection) || "";
    const currentSelection = currentEditor?.selection;
    const currentEditorContent = currentEditor?.document?.getText() || "";
    const currentEditorIssueId = await getCurrentEditorIssueId();
    const currentIssueTitle = (await getIssueMarkdown(currentEditorIssueId || ""))?.title || "问题";
    const titleItem: QuickPickItemWithId = {
        label: issue,
        description: currentEditorIssueId
            ? `在当前 ${currentIssueTitle} 下创建子问题`
            : "创建新问题（使用当前输入作为标题）",
        execute: async (input?: string) => {
            const title = input?.trim();
            if (!title) {
                return;
            }
            const uri = await createIssueMarkdown({ markdownBody: `# ${title}\n\n` });
            if (!uri) {
                return;
            }
            const nodes = await createIssueNodes([uri], currentEditorIssueId);
            vscode.commands.executeCommand("issueManager.refreshAllViews");
            if (nodes && nodes[0] && nodes[0].id) {
                await updateIssueMarkdownFrontmatter(uri, { issue_title: title });
                const prompt = `用户向你提了： ${issue}。
可能有用的上下文:
当前编辑器内容是：${currentEditorContent}。
当前选中的文本是：${currentSelectedText}。
当前选中的范围是：${currentSelection}。
请根据这些信息生成 Markdown（包含标题和详细描述）`;
                await backgroundFillIssue(uri, prompt);
            }
        },
    };

    // 使用公共的 buildPromptWithContent 来构建提示

    try {
        const promptsFromFiles = await getAllPrompts();
        const promptItems: QuickPickItemWithId[] = promptsFromFiles.map(p => ({
            label: p.label,
            description: p.description,
            template: p.template,
            fileUri: p.uri,
            systemPrompt: p.systemPrompt,
            execute: async (input?: string) => {
                const title = p.label;
                const uri = await createIssueMarkdown({ markdownBody: `# ${title}\n\n` });
                if (!uri) {
                    return;
                }
                const nodes = await createIssueNodes([uri], currentEditorIssueId);
                try {
                    await updateIssueMarkdownFrontmatter(uri, { issue_title: title });
                    await backgroundFillIssue(
                        uri,
                        buildPromptWithContent(currentEditorContent, p.template)
                    );
                } catch (e) {
                    console.error("create-mode prompt fill failed", e);
                }
            },
        }));

        return [titleItem, ...promptItems];
    } catch (e) {
        console.error("failed to load prompts in create mode", e);
        return [];
    }
}

function buildCreateInitialItems(): QuickPickItemWithId[] {
    const currentEditor = vscode.window.activeTextEditor;
    const currentEditorContent = currentEditor?.document?.getText() || "";

    const direct: QuickPickItemWithId = {
        label: "新建问题",
        description: "直接创建并打开",
        alwaysShow: true,
        execute: async (input?: string) => {
            const title = input && input.trim();
            const uri = await createIssueMarkdown({ markdownBody: `# ${title || ""}\n\n` });
            if (uri) {
                const nodes = await createIssueNodes([uri], undefined);
                vscode.commands.executeCommand("issueManager.refreshAllViews");
                if (nodes && nodes[0] && nodes[0].id) {
                    openIssueNodeBeside(nodes[0].id).catch(() => {});
                }
            }
        },
    };

    const llm: QuickPickItemWithId = {
        label: "LLM 新建问题",
        description: "后台创建不打开",
        alwaysShow: true,
        execute: async (input?: string) => {
            const title = input && input.trim();
            if (!title) {
                return;
            }
            const uri = await createIssueMarkdown({ markdownBody: `# ${title}\n\n` });
            if (!uri) {
                return;
            }
            await createIssueNodes([uri]);
            vscode.commands.executeCommand("issueManager.refreshAllViews");
            try {
                const prompt = title;
                backgroundFillIssue(uri, prompt);
            } catch (e) {
                console.error("create-mode background fill failed", e);
            }
        },
    };
    const background: QuickPickItemWithId = {
        label: "LLM 新建问题基于当前编辑器内容",
        description: "后台创建不打开",
        alwaysShow: true,
        execute: async (input?: string) => {
            const title = input && input.trim();
            if (!title) {
                return;
            }
            const uri = await createIssueMarkdown({ markdownBody: `# ${title}\n\n` });
            if (!uri) {
                return;
            }
            await createIssueNodes([uri]);
            vscode.commands.executeCommand("issueManager.refreshAllViews");
            try {
                const prompt = buildPromptWithContent(
                    currentEditorContent,
                    "请根据以下内容生成 Markdown（包含标题和详细描述）：\n\n{{content}}"
                );
                backgroundFillIssue(uri, prompt);
            } catch (e) {
                console.error("create-mode background fill failed", e);
            }
        },
    };

    return [direct, llm, background];
}

async function updateCreateModeItems(
    quickPick: vscode.QuickPick<QuickPickItemWithId>,
    value: string
): Promise<void> {
    const initial = buildCreateInitialItems();
    const resolvedPrompts = await createCreateModeItems(value || "");
    quickPick.items = [...initial, ...resolvedPrompts];
}

export async function enterCreateMode(
    quickPick: vscode.QuickPick<QuickPickItemWithId>,
    text = ""
): Promise<void> {
    quickPick.placeholder = "新建问题模式：输入标题或选择 Prompt";
    quickPick.value = text;
    quickPick.busy = true;
    await updateCreateModeItems(quickPick, text || "");
    quickPick.busy = false;
}

export async function handleCreateModeValueChange(
    quickPick: vscode.QuickPick<QuickPickItemWithId>,
    value: string
): Promise<void> {
    await updateCreateModeItems(quickPick, value || "");
}

export async function handleCreateModeAccept(
    selected: QuickPickItemWithId,
    value: string
): Promise<boolean> {
    if (selected.execute) {
        selected.execute(value);
        return true;
    }
    return false;
}
