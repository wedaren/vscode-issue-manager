import * as vscode from "vscode";
import { LLMService } from "../llm/LLMService";
import { getAllPrompts } from "../data/IssueMarkdowns";
import { copilotDocumentProvider } from "../virtual/CopilotDocumentProvider";

const TIMEOUT_SEC = 60;

export async function copilotDiffSend(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage(
      "请先打开或聚焦要改写的编辑器（untitled 或文件）。"
    );
    return;
  }

  const original = editor.document.getText();
  if (!original || original.trim().length === 0) {
    vscode.window.showWarningMessage("当前文档为空，无法发送给 Copilot。");
    return;
  }

  const builtin = [
    {
      label: "压缩为摘要（3句）",
      template:
        "你是一个文本改写助手。任务：将下面的文本改写为更清晰、简洁的中文，保留原意。\n\n要求：\n\n1) 仅输出改写后的文本内容（不要添加说明、示例、编号或元信息）。\n\n2) 在最后单独一行输出一句结论，格式以“结论：”开头，结论一句话。\n\n3) 不要使用多余的 Markdown 标记或代码块。\n\n请把下列文本压缩为最多三句的简短摘要，并在最后给出一句结论：\n\n{{content}}",
      description: "快速概要",
    },
  ];

  // 创建 QuickPick 并立即显示（先展示加载状态），随后异步加载自定义 prompts 并更新 items
  const qp = vscode.window.createQuickPick<
    vscode.QuickPickItem & {
      template?: string;
      fileUri?: vscode.Uri;
      systemPrompt?: string;
      isCustom?: boolean;
    }
  >();
  qp.placeholder = "选择用于改写的 prompt 模板";
  qp.items = builtin.map((b) => ({
    label: b.label,
    description: b.description,
    template: b.template,
  }));
  qp.items = qp.items.concat([
    {
      label: "自定义 Prompt...",
      description: "输入自定义的 prompt 模板（使用 {{content}} 占位）",
      isCustom: true,
    },
  ]);
  qp.show();
  qp.busy = true;

  // 异步加载并更新 items
  (async () => {
    try {
      const promptsFromFiles = await getAllPrompts();
      const picks: Array<{
        label: string;
        description?: string;
        template?: string;
        fileUri?: vscode.Uri;
        systemPrompt?: string;
      }> = [];
      for (const p of promptsFromFiles) {
        picks.push({
          label: p.label,
          description: p.description,
          template: p.template,
          fileUri: p.uri,
          systemPrompt: p.systemPrompt,
        });
      }
      for (const b of builtin) {
        picks.push({
          label: b.label,
          description: b.description,
          template: b.template,
        });
      }
      picks.push({
        label: "自定义 Prompt...",
        description: "输入自定义的 prompt 模板（使用 {{content}} 占位）",
      });

      qp.items = picks;
      qp.busy = false;
    } catch (err) {
      qp.placeholder = "选择用于改写的 prompt 模板";
      qp.busy = false;
      console.error("加载自定义 prompts 失败", err);
      vscode.window.showWarningMessage("加载自定义模板失败，已使用内置模板。");
    }
  })();

  const sel = await new Promise<(typeof qp.items)[0] | undefined>((resolve) => {
    const disposables: vscode.Disposable[] = [];
    disposables.push(
      qp.onDidAccept(() => {
        const v = qp.selectedItems[0];
        qp.hide();
        resolve(v as (typeof qp.items)[0]);
      })
    );
    disposables.push(
      qp.onDidHide(() => {
        resolve(undefined);
      })
    );
    // ensure disposables cleaned
    qp.onDidHide(() => disposables.forEach((d) => d.dispose()));
  });
  if (!sel) {
    qp.dispose();
    return;
  }
  qp.dispose();

  let template = sel.template;
  if (sel.isCustom) {
    const custom = await vscode.window.showInputBox({
      prompt: "输入自定义 prompt（使用 {{content}} 占位要替换为文本）",
      value: `{{content}}`,
    });
    if (!custom) {
      return;
    }
    template = custom;
  }

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
        title: "调用模型生成改写...",
        cancellable: true,
      },
      async (progress, token) => {
        token.onCancellationRequested(() => controller.abort());
        const optimized = await LLMService.rewriteContent(prompt, {
          signal: controller.signal,
        });

        if (!optimized || optimized.trim().length === 0) {
          vscode.window.showErrorMessage("模型未返回改写结果。");
          return;
        }

        // 使用只读的虚拟文档（scheme: copilot）展示原文与改写结果，关闭时不会提示保存
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
          "Copilot: 原文 ↔ 改写结果"
        );
      }
    );
  } catch (err) {
    const msg = (err as Error).message || String(err);
    if (msg.includes("Aborted") || msg.toLowerCase().includes("cancel")) {
      vscode.window.showWarningMessage("已取消模型请求");
    } else {
      vscode.window.showErrorMessage(`调用模型失败: ${msg}`);
      console.error("copilotDiffSend error", err);
    }
  } finally {
    clearTimeout(timeout);
  }
}

export async function copilotDiffCopyResult(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage(
      "请先聚焦要复制的编辑器（在 Diff 视图中选中右侧结果并激活）。"
    );
    return;
  }
  const text = editor.document.getText();
  if (!text) {
    vscode.window.showWarningMessage("当前编辑器为空，无法复制。");
    return;
  }
  await vscode.env.clipboard.writeText(text);
  vscode.window.showInformationMessage("已将当前编辑器内容复制到剪贴板。");
}
