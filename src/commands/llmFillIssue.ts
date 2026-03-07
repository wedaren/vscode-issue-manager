import * as vscode from "vscode";
import { extractFrontmatterAndBody } from "../data/IssueMarkdowns";
import { LLMService } from "../llm/LLMService";
import { refreshOpenEditorsIfNeeded } from "../data/IssueMarkdowns";

const DEFAULT_SYSTEM_PROMPT =
    "根据以下 Markdown 文档的标题和已有内容，生成详细的 Markdown 回答。不要重复标题行。直接输出正文内容。";

/**
 * 判断 body（去掉 frontmatter 后的部分）是否只有标题行而无实质正文。
 */
function isBodyEmpty(body: string): boolean {
    const lines = body.split(/\r?\n/);
    // 跳过标题行（# ...）和空行，看是否还有实质内容
    const meaningful = lines.filter(
        (l) => l.trim().length > 0 && !/^#+\s/.test(l)
    );
    return meaningful.length === 0;
}

/**
 * 对当前编辑器中的 IssueMarkdown 调用 LLM 生成内容。
 * - 正文为空 → 全量替换正文区域（保留 frontmatter 和标题行）
 * - 正文非空 → 追加到文档末尾
 */
export async function llmFillIssue(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return;
    }

    const doc = editor.document;
    const fullText = doc.getText();
    const { body } = extractFrontmatterAndBody(fullText);
    const empty = isBodyEmpty(body);

    const prompt = `${DEFAULT_SYSTEM_PROMPT}\n\n${body}`;

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "LLM 生成中…",
            cancellable: true,
        },
        async (_progress, token) => {
            const controller = new AbortController();
            token.onCancellationRequested(() => controller.abort());

            const result = await LLMService.rewriteContent(prompt, {
                signal: controller.signal,
            });
            if (!result || !result.trim()) {
                vscode.window.showWarningMessage("LLM 未生成有效内容。");
                return;
            }

            // 清理可能的标题行重复（LLM 有时会再输出一次标题）
            let content = result;
            const titleMatch = body.match(/^#\s+(.*)$/m);
            if (titleMatch) {
                const lines = content.split(/\r?\n/);
                if (lines[0]?.match(/^#\s+/)) {
                    content = lines.slice(1).join("\n").trimStart();
                }
            }

            await editor.edit((editBuilder) => {
                if (empty) {
                    // 全量替换：在标题行之后插入
                    const bodyLines = body.split(/\r?\n/);
                    // 找到标题行之后的位置
                    let insertLine = 0;
                    for (let i = 0; i < bodyLines.length; i++) {
                        if (/^#+\s/.test(bodyLines[i])) {
                            insertLine = i + 1;
                            break;
                        }
                    }
                    // 换算到文档的实际行号（加上 frontmatter 行数）
                    const fmLineCount = fullText.split(/\r?\n/).length - body.split(/\r?\n/).length;
                    const docInsertLine = fmLineCount + insertLine;
                    const lastLine = doc.lineCount - 1;
                    const lastChar = doc.lineAt(lastLine).text.length;
                    const range = new vscode.Range(docInsertLine, 0, lastLine, lastChar);
                    editBuilder.replace(range, "\n" + content + "\n");
                } else {
                    // 追加到文档末尾
                    const lastLine = doc.lineCount - 1;
                    const lastChar = doc.lineAt(lastLine).text.length;
                    const endPos = new vscode.Position(lastLine, lastChar);
                    editBuilder.insert(endPos, "\n\n" + content + "\n");
                }
            });

            await doc.save();
            try {
                await refreshOpenEditorsIfNeeded(doc.uri);
            } catch {
                // ignore
            }
        }
    );
}
