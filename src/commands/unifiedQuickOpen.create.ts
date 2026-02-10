import * as vscode from "vscode";
import { QuickPickItemWithId } from "./unifiedQuickOpen.types";
import {
    createIssueMarkdown,
    getAllPrompts,
    getIssueMarkdown,
    updateIssueMarkdownFrontmatter,
} from "../data/IssueMarkdowns";
import { getCurrentEditorIssueId } from "./unifiedQuickOpen.issue";
import { applyGeneratedIssueContent } from "../llm/backgroundFill";
import { LLMService } from "../llm/LLMService";
import { openIssueNodeBeside } from "./openIssueNode";
import { createIssueNodes } from "../data/issueTreeManager";
import { HistoryService } from "./unifiedQuickOpen.history.service";

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
        label: [issue, 'LLM 新建问题'].filter(Boolean).join(' '),  
        description: currentEditorIssueId
            ? `基于当前 ${currentIssueTitle} 下创建子问题`
            : "基于当前编辑器内容创建新问题",
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
                (async () => {
                    try {
                        const text = await LLMService.rewriteContent(prompt);
                        if (!text || !text.trim()) {
                            console.error("create-mode rewrite returned empty content");
                            return;
                        }
                        const lines = text.split(/\r?\n/);
                        let genTitle: string | undefined;
                        let content = text;
                        const m = lines[0]?.match(/^#\s+(.*)/);
                        if (m) {
                            genTitle = m[1].trim();
                            content = lines.slice(1).join('\n').trim();
                        }
                        const finalContent = content && content.length > 0 ? content : `# ${genTitle || issue}\n\n`;
                        if (genTitle) {
                            await updateIssueMarkdownFrontmatter(uri, { issue_title: genTitle });
                        }
                        await applyGeneratedIssueContent(uri, finalContent, nodes[0].id);
                    } catch (e) {
                        console.error("create-mode background fill failed", e);
                    }
                })();
            }
        },
    };


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
                        (async () => {
                            try {
                                const text = await LLMService.rewriteContent(buildPromptWithContent(currentEditorContent, p.template));
                                if (!text || !text.trim()) {
                                    console.error("create-mode prompt rewrite returned empty content");
                                    return;
                                }
                                const lines = text.split(/\r?\n/);
                                let genTitle: string | undefined;
                                let content = text;
                                const m = lines[0]?.match(/^#\s+(.*)/);
                                if (m) {
                                    genTitle = m[1].trim();
                                    content = lines.slice(1).join('\n').trim();
                                }
                                const finalContent = content && content.length > 0 ? content : `# ${genTitle || title}\n\n`;
                                if (genTitle) {
                                    await updateIssueMarkdownFrontmatter(uri, { issue_title: genTitle });
                                }
                                await applyGeneratedIssueContent(uri, finalContent, nodes && nodes[0] ? nodes[0].id : undefined);
                            } catch (e) {
                                console.error("create-mode prompt background fill failed", e);
                            }
                        })();
                    } catch (e) {
                        console.error("create-mode prompt update frontmatter failed", e);
                    }
            },
        }));

        return [titleItem, ...promptItems];
    } catch (e) {
        console.error("failed to load prompts in create mode", e);
        return [];
    }
}

function buildCreateInitialItems(value: string): QuickPickItemWithId[] {
    const currentEditor = vscode.window.activeTextEditor;
    const currentEditorContent = currentEditor?.document?.getText() || "";

    const direct: QuickPickItemWithId = {
        label: [value, '新建问题'].filter(Boolean).join(' '),
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
        label: [value, 'LLM 新建问题'].filter(Boolean).join(' '),
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
            const nodes = await createIssueNodes([uri]);
            vscode.commands.executeCommand("issueManager.refreshAllViews");
            const prompt = title;
            (async () => {
                try {
                    const text = await LLMService.rewriteContent(prompt);
                    if (!text || !text.trim()) {
                        console.error("create-mode rewrite returned empty content");
                        return;
                    }
                    const lines = text.split(/\r?\n/);
                    let genTitle: string | undefined;
                    let content = text;
                    const m = lines[0]?.match(/^#\s+(.*)/);
                    if (m) {
                        genTitle = m[1].trim();
                        content = lines.slice(1).join('\n').trim();
                    }
                    const finalContent = content && content.length > 0 ? content : `# ${genTitle || title}\n\n`;
                    if (genTitle) {
                        await updateIssueMarkdownFrontmatter(uri, { issue_title: genTitle });
                    }
                    await applyGeneratedIssueContent(uri, finalContent, nodes && nodes[0] ? nodes[0].id : undefined);
                } catch (e) {
                    console.error("create-mode background fill failed", e);
                }
            })();
        },
    };

    return [direct, llm];
}

async function updateCreateModeItems(
    quickPick: vscode.QuickPick<QuickPickItemWithId>,
    value: string
): Promise<void> {
    const initial = buildCreateInitialItems(value || "");
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
    value: string,
    historyService?: HistoryService
): Promise<boolean> {
    if (selected.execute) {
        await selected.execute(value);
        // 记录历史
        if (historyService && value) {
            await historyService.addHistory('create', value);
        }
        return true;
    }
    return false;
}
