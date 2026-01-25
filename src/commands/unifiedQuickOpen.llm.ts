import * as vscode from "vscode";
import { QuickPickItemWithId } from "./unifiedQuickOpen.types";
import { getAllPrompts } from "../data/IssueMarkdowns";
import { getIssueNodeById } from "../data/issueTreeManager";
import { getCurrentEditorIssueId } from "./unifiedQuickOpen.issue";
import { runTemplateAndShowDiff, runTemplateForIssueUri } from "../llm/runAndShowDiff";
import { HistoryService } from "./unifiedQuickOpen.history.service";

/**
 * 创建 LLM 模板列表项
 */
async function createLLMTemplateItems(): Promise<QuickPickItemWithId[]> {
    // 内置模板
    const builtin: QuickPickItemWithId[] = [
        {
            label: "压缩为摘要（3句）",
            template: `你是一个文本改写助手。任务：将下面的文本改写为更清晰、简洁的中文，保留原意。

要求：

1) 仅输出改写后的文本内容（不要添加说明、示例、编号或元信息）。

2) 在最后单独一行输出一句结论，格式以"结论："开头，结论一句话。

3) 不要使用多余的 Markdown 标记或代码块。

请把下列文本压缩为最多三句的简短摘要，并在最后给出一句结论：

{{content}}`,
            description: "快速概要",
        },
    ];

    const customItem: QuickPickItemWithId = {
        label: "自定义 Prompt...",
        description: "输入自定义的 prompt 模板（使用 {{content}} 占位）",
        isCustom: true,
    };

    // 异步加载用户定义的 prompts
    try {
        const promptsFromFiles = await getAllPrompts();
        const userPrompts: QuickPickItemWithId[] = promptsFromFiles.map(p => ({
            label: p.label,
            description: p.description,
            template: p.template,
            fileUri: p.uri,
            systemPrompt: p.systemPrompt,
            buttons: [
                {
                    iconPath: new vscode.ThemeIcon("go-to-file"),
                    tooltip: "在问题总览中查看",
                },
            ],
        }));
        
        return [...userPrompts, ...builtin, customItem];
    } catch (err) {
        console.error("Failed to load user prompts:", err);
        return [...builtin, customItem];
    }
}

/**
 * 进入 LLM 模式，设置 QuickPick 的状态
 */
export async function enterLLMMode(
    quickPick: vscode.QuickPick<QuickPickItemWithId>,
    text = ""
): Promise<void> {
    quickPick.placeholder = "选择 LLM 模板（支持自定义）";
    quickPick.value = text;
    quickPick.busy = true;

    try {
        const items = await createLLMTemplateItems();
        quickPick.items = items;
    } catch (err) {
        console.error("Failed to create LLM items:", err);
        quickPick.items = [];
    } finally {
        quickPick.busy = false;
    }
}

/**
 * 处理 LLM 模式的选择确认
 */
export async function handleLLMModeAccept(
    selected: QuickPickItemWithId,
    value: string,
    historyService?: HistoryService
): Promise<boolean> {
    // 必须是模板或自定义项
    if (!selected.template && !selected.isCustom) {
        return false;
    }

    let template = selected.template;

    // 如果是自定义项，弹出输入框
    if (selected.isCustom) {
        const custom = await vscode.window.showInputBox({
            prompt: "输入自定义 prompt（使用 {{content}} 占位要替换为文本）",
            value: `{{content}}`,
        });
        if (!custom) {
            return true; // 用户取消，但返回 true 表示已处理
        }
        template = custom;
    }

    if (!template) {
        vscode.window.showWarningMessage('未指定模板');
        return true;
    }

    // 获取当前聚焦的 Issue 文件
    const currentEditorIssueId = await getCurrentEditorIssueId();
    if (!currentEditorIssueId) {
        vscode.window.showWarningMessage('请在编辑器中聚焦要填充的 Issue 文件后再使用 LLM 模板。');
        return true;
    }

    try {
        const node = await getIssueNodeById(currentEditorIssueId || '');
        if (!node || !node.resourceUri) {
            vscode.window.showWarningMessage('未找到目标 Issue 文件。');
            return true;
        }

        // 在后台启动模型调用并展示 diff，避免阻塞 QuickPick 的关闭与 UI 交互
        runTemplateForIssueUri(template, node.resourceUri, "LLM").catch((err) => {
            console.error('LLM 模板执行失败 (后台任务)', err);
            vscode.window.showErrorMessage('LLM 模板执行失败');
        });
        
        // 记录历史（使用模板的 label）
        if (historyService && selected.label) {
            await historyService.addHistory('llm', selected.label);
        }
    } catch (e) {
        console.error('LLM 模板执行失败', e);
        vscode.window.showErrorMessage('LLM 模板执行失败');
    }

    return true;
}
