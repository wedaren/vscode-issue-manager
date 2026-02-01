import * as vscode from "vscode";
import type { ResearchOutputKind, ResearchSourceMode } from "../types/deepResearch";

export async function promptTopic(): Promise<string | null> {
    const topic = (
        await vscode.window.showInputBox({
            prompt: "请输入要“深度调研”的问题/主题（取消将中止）",
            placeHolder: "例如：如何为最近问题视图做更稳定的树渲染与性能优化？",
        })
    )?.trim();

    return topic && topic.length > 0 ? topic : null;
}

export async function promptKind(): Promise<ResearchOutputKind | null> {
    const kindItems: Array<vscode.QuickPickItem & { value: ResearchOutputKind }> = [
        { label: "调研报告", value: "调研报告" },
        { label: "技术方案", value: "技术方案" },
        { label: "对比分析", value: "对比分析" },
        { label: "学习笔记", value: "学习笔记" },
    ];

    const pickedKind = await vscode.window.showQuickPick(kindItems, {
        title: "选择输出类型",
        canPickMany: false,
    });

    return pickedKind ? pickedKind.value : null;
}

export async function promptSourceMode(): Promise<ResearchSourceMode | null> {
    const modeItems: Array<vscode.QuickPickItem & { value: ResearchSourceMode }> = [
        {
            label: "本地笔记 + LLM（推荐）",
            description: "会检索本地 issue 笔记并基于摘录写作（带 [来源N] 标注）",
            value: "local",
        },
        {
            label: "纯 LLM 深度思考（不检索本地）",
            description: "完全基于多步骤推理与整合（不联网，不伪造引用）",
            value: "llmOnly",
        },
    ];

    const pickedMode = await vscode.window.showQuickPick(modeItems, {
        title: "选择资料来源模式",
        canPickMany: false,
    });

    return pickedMode ? pickedMode.value : null;
}

export async function promptIncludeEditor(): Promise<boolean | null> {
    const includeEditorItems: Array<vscode.QuickPickItem & { value: boolean }> = [
        { label: "包含", description: "将当前编辑器（或选中文本）作为调研上下文", value: true },
        { label: "不包含", description: "不读取当前编辑器内容", value: false },
    ];

    const includeEditor = await vscode.window.showQuickPick(includeEditorItems, {
        title: "是否包含当前编辑器上下文？",
        canPickMany: false,
    });

    return includeEditor ? includeEditor.value : null;
}
