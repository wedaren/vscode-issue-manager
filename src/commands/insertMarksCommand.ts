import * as vscode from "vscode";
import * as path from "path";
import { getIssueDir } from "../config";
import { getIssueNodeById } from "../data/issueTreeManager";
import { MarkerManager } from "../marker/MarkerManager";

export function registerInsertMarksCommand(context: vscode.ExtensionContext, markerManager?: MarkerManager) {
    context.subscriptions.push(
        vscode.commands.registerCommand('issueManager.marker.insertMarksToAssociatedIssue', async () => {
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

                const issueId: string | undefined = current.associatedIssueId;
                if (!issueId) {
                    vscode.window.showWarningMessage('当前任务没有关联的问题');
                    return;
                }

                const node = await getIssueNodeById(issueId);
                if (!node || !node.resourceUri) {
                    vscode.window.showWarningMessage('未找到关联的问题文件');
                    return;
                }

                const issueDir = getIssueDir();
                const markers: Array<any> = Array.isArray(current.markers) ? current.markers : [];

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

                // 使用 fenced code block 格式：```markdown marks ... ```
                const inner = lines.join('\n');
                const fencedBlock = '\n```markdown marks\n' + inner + '\n```\n';

                const doc = await vscode.workspace.openTextDocument(node.resourceUri);
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

                // 优先匹配已有的 fenced marks 块并替换
                const fencedRegex = /```\s*markdown\s+marks\r?\n[\s\S]*?\r?\n```/i;
                let newBody: string;
                if (fencedRegex.test(body)) {
                    newBody = body.replace(fencedRegex, fencedBlock.trimStart());
                } else {
                    // 末尾追加 fenced block，保持一个空行分隔
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
                edit.replace(node.resourceUri, fullRange, newContent);
                const applied = await vscode.workspace.applyEdit(edit);
                if (!applied) {
                    vscode.window.showErrorMessage('更新问题文件失败');
                    return;
                }

                const savedDoc = await vscode.workspace.openTextDocument(node.resourceUri);
                if (savedDoc.isDirty) {
                    await savedDoc.save();
                }

                vscode.window.showInformationMessage('已将当前任务的 marks 插入到关联问题');
            } catch (err) {
                console.error(err);
                vscode.window.showErrorMessage('插入 marks 失败');
            }
        })
    );
}