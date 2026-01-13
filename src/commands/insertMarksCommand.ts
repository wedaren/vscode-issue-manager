import * as vscode from "vscode";
import * as path from "path";
import { getIssueDir } from "../config";
import { getIssueNodeById } from "../data/issueTreeManager";
import { MarkerItem, MarkerManager } from "../marker/MarkerManager";


/**  
 * 注册“插入 marks 到关联问题”的命令。  
 * @param context 扩展上下文  
 * @param markerManager Marker 管理器实例  
 */  
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
                // 兼容如下几种形式：
                // ```markdown marks\n...\n```  或者 ```markdown marks\n```（空块）等
                const fencedRegex = /```\s*markdown\s+marks[\s\S]*?```/i;
                let newBody: string;
                if (fencedRegex.test(body)) {
                    // 使用完整的 fencedBlock 替换，保持块的格式一致
                    newBody = body.replace(fencedRegex, fencedBlock);
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

                // 确保在编辑器中展示更新的文档并定位到末尾（便于查看插入的 marks）
                try {
                    const editor = await vscode.window.showTextDocument(savedDoc, { preview: false });
                    const lastLine = Math.max(0, savedDoc.lineCount - 1);
                    const revealRange = new vscode.Range(lastLine, 0, lastLine, 0);
                    editor.revealRange(revealRange, vscode.TextEditorRevealType.InCenter);
                } catch (e) {
                    // 忽略展示失败，仍然继续流程
                }

                vscode.window.showInformationMessage('已将当前任务的 marks 插入到关联问题');
            } catch (err) {
                console.error(err);
                vscode.window.showErrorMessage('插入 marks 失败');
            }
        })
    );
}