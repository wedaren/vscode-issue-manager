import * as vscode from "vscode";
import * as path from "path";
import { getIssueDir } from "../config";
import {
    getAllIssueMarkdowns,
    getIssueMarkdown,
    updateIssueMarkdownFrontmatter,
    extractIssueTitleFromFrontmatter,
} from "../data/IssueMarkdowns";
import { Logger } from "../core/utils/Logger";

/**
 * 注册“插入 terms_references 到当前活动编辑器”的命令。
 */
export function registerInsertTermsReferenceCommand(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "issueManager.marker.insertTermsReferencesToActiveEditor",
            async () => {
                try {
                    const activeEditor = vscode.window.activeTextEditor;
                    if (!activeEditor) {
                        vscode.window.showWarningMessage("当前没有活动的编辑器，无法插入 terms_references");
                        return;
                    }

                    const uri = activeEditor.document.uri;

                    // 确保目标是 IssueMarkdown 文件并获取其 frontmatter
                    const targetMd = await getIssueMarkdown(uri);
                    if (!targetMd) {
                        vscode.window.showWarningMessage("当前文件不是有效的 Issue Markdown，无法插入 terms_references");
                        return;
                    }

                    const all = await getAllIssueMarkdowns({ sortBy: "mtime" });

                    // 仅支持并生成 `[label](IssueDir/relative.md)` 格式：要求文件在 issueDir 内
                    const issueDir = getIssueDir();
                    if (!issueDir) {
                        vscode.window.showWarningMessage('未配置 issueDir，无法生成 IssueDir 链接');
                        return;
                    }

                    // 解析当前文件已有的 terms_references（只考虑 Markdown 链接并以 IssueDir/ 开头）
                    const existingRefsRaw: string[] = (targetMd.frontmatter?.terms_references ?? []).filter(Boolean) as string[];
                    const existingFsPaths = new Set<string>();
                    for (const r of existingRefsRaw) {
                        const m = String(r).match(/^\[[^\]]+\]\((IssueDir\/(.+?\.md))\)$/);
                        if (m && m[1]) {
                            const rel = m[1].substring('IssueDir/'.length);
                            existingFsPaths.add(path.normalize(path.join(issueDir, rel)));
                        }
                    }

                    const candidates = all.filter(i => {
                        if (!Array.isArray(i.frontmatter?.terms) || (i.frontmatter?.terms?.length ?? 0) === 0) return false;
                        if (i.uri.fsPath === uri.fsPath) return false;
                        const rel = path.relative(issueDir, i.uri.fsPath).replace(/\\/g, '/');
                        if (rel.startsWith('..') || path.isAbsolute(rel)) return false;
                        if (existingFsPaths.has(path.normalize(i.uri.fsPath))) return false;
                        return true;
                    });

                    if (candidates.length === 0) {
                        vscode.window.showInformationMessage("未发现包含术语定义（terms）的 Issue 文件");
                        return;
                    }

                    const items: vscode.QuickPickItem[] = candidates.map(i => ({
                        label: extractIssueTitleFromFrontmatter(i.frontmatter) ?? i.title,
                        description: path.basename(i.uri.fsPath),
                        detail: i.uri.fsPath,
                    }));

                    const picks = await vscode.window.showQuickPick(items, {
                        canPickMany: true,
                        placeHolder: "选择要作为 terms_references 的文件（可多选）",
                    });

                    if (!picks || picks.length === 0) return;

                    // 将所选项转换为 Markdown 链接形式：`[label](IssueDir/relative/path.md)`（已保证候选项在 issueDir 内）
                    const selectedFs = new Set<string>();
                    for (const p of picks) {
                        if (!p.detail) continue;
                        const fullPath = p.detail;
                        const rel = path.relative(issueDir, fullPath).replace(/\\/g, '/');
                        if (rel.startsWith('..') || path.isAbsolute(rel)) continue; // 额外保险
                        const linkPath = `IssueDir/${rel}`;
                        const title = p.label ?? path.basename(fullPath, '.md');
                        const v = `[${title}](${linkPath})`;
                        selectedFs.add(v);
                    }

                    const selectedArray = Array.from(selectedFs);

                    // 合并到目标文件的 frontmatter.terms_references（去重）
                    const existing = targetMd.frontmatter?.terms_references ?? [];
                    const merged = Array.from(new Set([...existing, ...selectedArray]));

                    const ok = await updateIssueMarkdownFrontmatter(uri, { terms_references: merged });
                    if (ok) {
                        vscode.window.showInformationMessage("已更新 terms_references");
                    } else {
                        vscode.window.showErrorMessage("更新 terms_references 失败");
                    }
                } catch (err) {
                    Logger.getInstance().error("insertTermsReferencesToActiveEditor 执行失败", err);
                    vscode.window.showErrorMessage("插入 terms_references 失败");
                }
            }
        )
    );
}

export default registerInsertTermsReferenceCommand;
