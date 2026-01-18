import * as vscode from "vscode";
import { QuickPickItemWithId } from "./unifiedQuickOpen.types";
import { getAllPrompts, getIssueMarkdown, updateIssueMarkdownFrontmatter } from "../data/IssueMarkdowns";
import { getCurrentEditorIssueId } from "./unifiedQuickOpen.issue";
import { createIssueFile, createIssueFileSilent, addIssueToTree } from "./issueFileUtils";
import { backgroundFillIssue } from "../llm/backgroundFill";
import { openIssueNodeBeside } from "./openIssueNode";

async function createCreateModeItems(value: string): Promise<QuickPickItemWithId[]> {
    const v = value || "";
    const currentEditor = vscode.window.activeTextEditor;
    const currentEditorContent = currentEditor?.document?.getText() || "";
    const currentEditorIssueId = await getCurrentEditorIssueId();
    const currentIssueTitle  = (await getIssueMarkdown(currentEditorIssueId||''))?.title || '问题';
    const titleItem: QuickPickItemWithId = {
        label: v,
        description: currentEditorIssueId
            ? `在当前 ${currentIssueTitle} 下创建子问题`
            : "创建新问题（使用当前输入作为标题）",
        execute: ()=>{},
    };


    const buildPrompt = (template: string) => {
        if (!template) {
            return currentEditorContent;
        }
        return template.includes("{{content}}")
            ? template.replace("{{content}}", currentEditorContent)
            : `${template}\n\n${currentEditorContent}`;
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
                const uri = await createIssueFile(title);
                if (!uri) {
                    return;
                }
                const nodes = await addIssueToTree([uri], currentEditorIssueId, false);
                // if (nodes && nodes[0] && nodes[0].id) {
                //     openIssueNodeBeside(nodes[0].id).catch(() => {});
                // }
                
                try {
                    await backgroundFillIssue(uri, buildPrompt(p.template));
                    await updateIssueMarkdownFrontmatter(uri, { issue_title: title });
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

function buildCreateInitialItems(
    value: string,
    currentEditorContent: string,
    currentEditorIssueId?: string
): QuickPickItemWithId[] {
    const v = value || "";

    const buildPrompt = (template: string) => {
        if (!template) {
            return currentEditorContent;
        }
        return template.includes("{{content}}")
            ? template.replace("{{content}}", currentEditorContent)
            : `${template}\n\n${currentEditorContent}`;
    };

    const direct: QuickPickItemWithId = {
        label: v || "新建问题",
        description: '创建并打开新问题',
        alwaysShow: true,
        execute: async (input?: string) => {
            const title = input && input.trim();
            const uri = await createIssueFileSilent(title || "");
            if (uri) {
                const nodes = await addIssueToTree([uri], undefined, false);
                if (nodes && nodes[0] && nodes[0].id) {
                    openIssueNodeBeside(nodes[0].id).catch(() => {});
                }
            }
        },
    };

    const background: QuickPickItemWithId = {
        label: v ? `${v}（后台）` : "新建问题（后台）",
        description: '创建并打开新问题 AI 填充',
        alwaysShow: true,
        execute: async (input?: string) => {
            const title = input && input.trim();
            if (!title) {
                return;
            }
            const uri = await createIssueFileSilent(title);
            if (!uri) {
                return;
            }
            const nodes = await addIssueToTree([uri], currentEditorIssueId, false);
            if (nodes && nodes[0] && nodes[0].id) {
                openIssueNodeBeside(nodes[0].id).catch(() => {});
            }
            try {
                const prompt = buildPrompt(
                    "请根据以下内容生成 Markdown（包含标题和详细描述）：\n\n{{content}}"
                );
                backgroundFillIssue(uri, prompt).catch(err =>
                    console.error("create-mode background fill failed", err)
                );
            } catch (e) {
                console.error("create-mode background fill failed", e);
            }
        },
    };

    return [direct, background];
}

export async function enterCreateMode(
    quickPick: vscode.QuickPick<QuickPickItemWithId>,
    text = ""
): Promise<void> {
    quickPick.placeholder = "新建问题模式：输入标题或选择 Prompt";
    quickPick.value = text;
    quickPick.busy = true;
    // 立即显示初始项以避免卡顿
    const currentEditor = vscode.window.activeTextEditor;
    const currentEditorContent = currentEditor?.document?.getText() || "";
    const currentEditorIssueId = await getCurrentEditorIssueId();
    const initial = buildCreateInitialItems(text || "", currentEditorContent, currentEditorIssueId);
    quickPick.items = initial;
    const resolvedPrompts = await createCreateModeItems(text || "");
    quickPick.items = [...initial, ...resolvedPrompts];
    quickPick.busy = false;
}

export async function handleCreateModeValueChange(
    quickPick: vscode.QuickPick<QuickPickItemWithId>,
    value: string
): Promise<void> {
    // 立即渲染初始项，异步加载 prompts
    const currentEditor = vscode.window.activeTextEditor;
    const currentEditorContent = currentEditor?.document?.getText() || "";
    const currentEditorIssueId = await getCurrentEditorIssueId();
    const initial = buildCreateInitialItems(
        value || "",
        currentEditorContent,
        currentEditorIssueId
    );
    const resolvedPrompts = await createCreateModeItems(value || "");
    quickPick.items = [...initial, ...resolvedPrompts];
}

export async function handleCreateModeAccept(
    selected: QuickPickItemWithId,
    value: string
): Promise<boolean> {
    if (selected.execute) {
        try {
            await Promise.resolve(selected.execute(value));
        } catch (e) {
            console.error("create mode accept execute failed", e);
            vscode.window.showErrorMessage("创建操作失败");
        }
        return true;
    }
    return false;
}
