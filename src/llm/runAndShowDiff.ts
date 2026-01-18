import * as vscode from "vscode";
import { LLMService } from "./LLMService";
import { copilotDocumentProvider } from "../virtual/CopilotDocumentProvider";

const TIMEOUT_SEC = 60;

export async function runTemplateAndShowDiff(
    template: string,
    original: string,
    titlePrefix = "LLM"
): Promise<string | undefined> {
    const prompt =
        template && template.includes("{{content}}")
            ? template.replace("{{content}}", original)
            : `${template}\n\n${original}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_SEC * 1000);

    try {
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `调用模型生成内容...`,
                cancellable: true,
            },
            async (progress, token) => {
                token.onCancellationRequested(() => controller.abort());
                const optimized = await LLMService.rewriteContent(prompt, {
                    signal: controller.signal,
                });

                if (!optimized || optimized.trim().length === 0) {
                    vscode.window.showErrorMessage("模型未返回结果。");
                    return undefined;
                }

                // 使用只读的虚拟文档（scheme: copilot）展示原文与生成结果，关闭时不会提示保存
                const leftName = `copilot-original-${Date.now()}.md`;
                const leftUri = vscode.Uri.parse("copilot:" + leftName);
                const rightName = `copilot-result-${Date.now()}.md`;
                const rightUri = vscode.Uri.parse("copilot:" + rightName);

                copilotDocumentProvider.setContent(leftUri, original);
                copilotDocumentProvider.setContent(rightUri, optimized);

                const leftDoc = await vscode.workspace.openTextDocument(leftUri);
                // open right doc in background to ensure both are available to diff
                await vscode.workspace.openTextDocument(rightUri);

                await vscode.commands.executeCommand(
                    "vscode.diff",
                    leftDoc.uri,
                    rightUri,
                    `${titlePrefix}: 原文 ↔ 生成结果`
                );

                return optimized;
            }
        );
    } catch (err) {
        const msg = (err as Error).message || String(err);
        if (msg.includes("Aborted") || msg.toLowerCase().includes("cancel")) {
            vscode.window.showWarningMessage("已取消模型请求");
        } else {
            vscode.window.showErrorMessage(`调用模型失败: ${msg}`);
            console.error("runTemplateAndShowDiff error", err);
        }
    } finally {
        clearTimeout(timeout);
    }

    return undefined;
}

export async function runTemplateForIssueUri(
    template: string,
    issueUri: vscode.Uri,
    titlePrefix = "LLM"
): Promise<string | undefined> {
    try {
        const doc = await vscode.workspace.openTextDocument(issueUri);
        const original = doc.getText();
        if (!original || original.trim().length === 0) {
            vscode.window.showWarningMessage('目标 Issue 文件为空，无法生成内容。');
            return undefined;
        }

        return await runTemplateAndShowDiff(template, original, titlePrefix);
    } catch (err) {
        console.error('runTemplateForIssueUri error', err);
        vscode.window.showErrorMessage('打开 Issue 文件失败');
        return undefined;
    }
}

export async function runTemplateForActiveEditor(
    template: string,
    titlePrefix = "LLM"
): Promise<string | undefined> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage("请先打开或聚焦要生成内容的编辑器（untitled 或文件）。");
        return undefined;
    }

    const original = editor.document.getText();
    if (!original || original.trim().length === 0) {
        vscode.window.showWarningMessage("当前文档为空，无法生成内容。");
        return undefined;
    }

    return await runTemplateAndShowDiff(template, original, titlePrefix);
}


