import * as vscode from 'vscode';
import { LLMService } from '../llm/LLMService';
import { loadPrompts, savePrompt } from '../prompts/PromptManager';
import { copilotDocumentProvider } from '../virtual/CopilotDocumentProvider';

const timeoutSec =  60;

export async function copilotDiffSend(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('请先打开或聚焦要改写的编辑器（untitled 或文件）。');
        return;
    }

    const original = editor.document.getText();
    if (!original || original.trim().length === 0) {
        vscode.window.showWarningMessage('当前文档为空，无法发送给 Copilot。');
        return;
    }

    const config = vscode.workspace.getConfiguration('issueManager');
    const defaultTemplate = config.get<string>('copilotDiff.promptTemplate');

    // 候选 prompt 列表：从工作区持久化的 markdown 文件加载，同时包含内置模板与自定义入口
    const promptsFromFiles = await loadPrompts();

    const builtin = [
        { label: '标准：清晰简洁（默认）', template: defaultTemplate, description: '仅返回改写内容 + 一句结论' },
        { label: '技术文档风格', template: '请将下列文本改写为更专业、结构化的技术文档风格，保留技术细节：\n\n{{content}}', description: '适用于技术说明、Wiki' },
        { label: '更口语化/适合邮件', template: '请将下列文本改写为更口语化、友好的中文，适合用作邮件正文：\n\n{{content}}', description: '适合对外沟通' },
        { label: '压缩为摘要（3句）', template: '请把下列文本压缩为最多三句的简短摘要，并在最后给出一句结论：\n\n{{content}}', description: '快速概要' },
        { label: '委婉措辞（客户用）', template: '请将下列文本用更委婉、礼貌的措辞改写，适用于客户沟通：\n\n{{content}}', description: '客户/外部沟通' }
    ];

    const picks: Array<{ label: string; description?: string; template?: string; fileUri?: vscode.Uri; systemPrompt?: string; isCustom?: boolean }> = [];

    // add prompts from files first
    for (const p of promptsFromFiles) {
        picks.push({ label: p.label, description: p.description, template: p.template, fileUri: p.uri, systemPrompt: p.systemPrompt });
    }

    // then builtins
    for (const b of builtin) {
        picks.push({ label: b.label, description: b.description, template: b.template });
    }

    // custom entry
    picks.push({ label: '自定义 Prompt...', description: '输入自定义的 prompt 模板（使用 {{content}} 占位）', isCustom: true });

    const pickItems: (typeof picks[0] & vscode.QuickPickItem)[] = picks.map(x => ({
        ...x,
        label: x.label,
        description: x.description,
        detail: x.fileUri ? `来自：${x.fileUri.path.split('/').pop()}` : undefined
    }));

    const sel = await vscode.window.showQuickPick(pickItems, { placeHolder: '选择用于改写的 prompt 模板' }) as (typeof pickItems[0]) | undefined;
    if (!sel) { return; }

    let template = sel.template;
    if (sel.isCustom) {
        const custom = await vscode.window.showInputBox({ prompt: '输入自定义 prompt（使用 {{content}} 占位要替换为文本）', value: defaultTemplate });
        if (!custom) { return; }
        template = custom;

        const save = await vscode.window.showQuickPick(['否，临时使用', '是，保存为模板'], { placeHolder: '是否将此自定义 prompt 保存为 Markdown 模板？' });
        if (save === '是，保存为模板') {
            const label = await vscode.window.showInputBox({ prompt: '为模板输入一个短名称（将作为 label 存储）' });
            if (label) {
                const description = await vscode.window.showInputBox({ prompt: '（可选）为模板输入 description（简短说明）' });
                const systemPromptInput = await vscode.window.showInputBox({ prompt: '（可选）为该模板指定 systemPrompt（用于设置模型角色/约束），留空则使用本地默认', value: '' });
                try {
                    const uri = await savePrompt(label, description, template, systemPromptInput || undefined);
                    vscode.window.showInformationMessage(`已保存 prompt 到 ${uri.fsPath}`);
                } catch (err) {
                    console.error('保存 prompt 失败', err);
                    vscode.window.showErrorMessage('保存 prompt 失败，请检查文件权限。');
                }
            }
        }
    }

    const prompt = template && template.includes('{{content}}') ? template.replace('{{content}}', original) : `${template}\n\n${original}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutSec * 1000);

    try {
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: '调用模型生成改写...', cancellable: true }, async (progress, token) => {
            token.onCancellationRequested(() => controller.abort());
            // pass through systemPrompt from selected prompt file if present
            const optimized = await LLMService.rewriteContent(prompt, { signal: controller.signal, systemPrompt: sel.systemPrompt });

            if (!optimized || optimized.trim().length === 0) {
                vscode.window.showErrorMessage('模型未返回改写结果。');
                return;
            }

            // 使用只读的虚拟文档（scheme: copilot）展示原文与改写结果，关闭时不会提示保存
            const leftName = `copilot-original-${Date.now()}.md`;
            const leftUri = vscode.Uri.parse('copilot:' + leftName);
            const rightName = `copilot-result-${Date.now()}.md`;
            const rightUri = vscode.Uri.parse('copilot:' + rightName);

            copilotDocumentProvider.setContent(leftUri, original);
            copilotDocumentProvider.setContent(rightUri, optimized);

            const leftDoc = await vscode.workspace.openTextDocument(leftUri);
            // open right doc in background to ensure both are available to diff
            await vscode.workspace.openTextDocument(rightUri);

            await vscode.commands.executeCommand('vscode.diff', leftDoc.uri, rightUri, 'Copilot: 原文 ↔ 改写结果');
        });
    } catch (err) {
        const msg = (err as Error).message || String(err);
        if (msg.includes('Aborted') || msg.toLowerCase().includes('cancel')) {
            vscode.window.showWarningMessage('已取消模型请求');
        } else {
            vscode.window.showErrorMessage(`调用模型失败: ${msg}`);
            console.error('copilotDiffSend error', err);
        }
    } finally {
        clearTimeout(timeout);
    }
}


export async function copilotDiffCopyResult(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('请先聚焦要复制的编辑器（在 Diff 视图中选中右侧结果并激活）。');
        return;
    }
    const text = editor.document.getText();
    if (!text) {
        vscode.window.showWarningMessage('当前编辑器为空，无法复制。');
        return;
    }
    await vscode.env.clipboard.writeText(text);
    vscode.window.showInformationMessage('已将当前编辑器内容复制到剪贴板。');
}

