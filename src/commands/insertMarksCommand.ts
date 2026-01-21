import * as vscode from "vscode";
import * as path from "path";
import { getIssueDir } from "../config";
import { MarkerItem, MarkerManager } from "../marker/MarkerManager";


/**
 * 注册“插入 marks 到当前活动编辑器”的命令。
 * @param context 扩展上下文
 * @param markerManager Marker 管理器实例
 */
export function registerInsertMarksCommand(context: vscode.ExtensionContext, markerManager?: MarkerManager) {
    context.subscriptions.push(
        vscode.commands.registerCommand('issueManager.marker.insertMarksToActivedEditor', async () => {
            try {
                if (!markerManager) {
                    vscode.window.showWarningMessage('无法获取 MarkerManager 实例，命令未能运行');
                    return;
                }

                const current = markerManager.getCurrentTask();
                if (!current) {
                    vscode.window.showWarningMessage('当前任务不存在或没有标记');
                    return;
                }

                // 将 marks 插入到当前活动编辑器；如果没有活动编辑器则提示并终止（不做回退）
                const activeEditor = vscode.window.activeTextEditor;

                const issueDir = getIssueDir();
                const markers: Array<MarkerItem> = Array.isArray(current.markers) ? current.markers : [];

                const lines: string[] = [];
                for (const m of markers) {
                    const name = (m.message || '').toString().trim();
                    let link = '';
                    if (m.filePath) {
                        try {
                            if (issueDir) {
                                const rel = path.relative(issueDir, m.filePath);
                                if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
                                    link = `[[file:${rel}${m.line !== undefined ? `#L${m.line + 1}` : ''}]]`;
                                } else {
                                    link = `[[file:${m.filePath}${m.line !== undefined ? `#L${m.line + 1}` : ''}]]`;
                                }
                            } else {
                                link = `[[file:${m.filePath}${m.line !== undefined ? `#L${m.line + 1}` : ''}]]`;
                            }
                        } catch {
                            link = `[[file:${m.filePath}]]`;
                        }
                    }

                    if (link) {
                        lines.push(`${name} ${link}`);
                    } else if (name) {
                        lines.push(name);
                    }
                }

                const inner = lines.join('\n');
                const fencedBlock = '\n```markdown marks\n' + inner + '\n```\n';

                // Helper to insert/replace fenced block in a document
                const applyToDocument = async (doc: vscode.TextDocument, uri: vscode.Uri, showAfter = true) => {
                    const original = doc.getText();
                    let front = '';
                    let body = original;
                    if (original.startsWith('---')) {
                        const m = original.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
                        if (m) {
                            front = m[0];
                            body = original.slice(front.length);
                        }
                    }

                    const fencedRegex = /```\s*markdown\s+marks[\s\S]*?```/i;
                    let newBody: string;
                    if (fencedRegex.test(body)) {
                        newBody = body.replace(fencedRegex, fencedBlock);
                    } else {
                        newBody = body;
                        if (newBody.length > 0 && !/\n$/.test(newBody)) {
                            newBody += '\n';
                        }
                        newBody += fencedBlock;
                    }

                    const newContent = `${front}${newBody}`;

                    if (newContent === original) {
                        vscode.window.showInformationMessage('marks 未变化，无需更新');
                        return;
                    }

                    const edit = new vscode.WorkspaceEdit();
                    const fullRange = new vscode.Range(0, 0, doc.lineCount, 0);
                    edit.replace(uri, fullRange, newContent);
                    const applied = await vscode.workspace.applyEdit(edit);
                    if (!applied) {
                        vscode.window.showErrorMessage('更新文档失败');
                        return;
                    }

                    const savedDoc = await vscode.workspace.openTextDocument(uri);
                    if (savedDoc.isDirty) {
                        await savedDoc.save();
                    }

                    if (showAfter) {
                        try {
                            const editor = await vscode.window.showTextDocument(savedDoc, { preview: false });
                            const lastLine = Math.max(0, savedDoc.lineCount - 1);
                            const revealRange = new vscode.Range(lastLine, 0, lastLine, 0);
                            editor.revealRange(revealRange, vscode.TextEditorRevealType.InCenter);
                        } catch (e) {}
                    }
                };

                if (activeEditor && ['file', 'untitled'].includes(activeEditor.document.uri.scheme)) {
                    await applyToDocument(activeEditor.document, activeEditor.document.uri, true);
                    vscode.window.showInformationMessage('已将当前任务的 marks 插入到当前活动编辑器');
                    return;
                }

                vscode.window.showWarningMessage('当前没有活动的可编辑文档，无法插入 marks');
            } catch (err) {
                console.error(err);
                vscode.window.showErrorMessage('插入 marks 失败');
            }
        })
    );
}