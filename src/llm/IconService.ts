import * as vscode from 'vscode';
import { LLMService } from './LLMService';
import { Logger } from '../core/utils/Logger';

export class IconService {
    /**
     * 生成 icon identifier 候选（优先使用本地文档匹配，必要时调用 LLM 补全）
     */
    public static async generateIconIdentifiers(
        text: string,
        options?: { signal?: AbortSignal }
    ): Promise<Array<{ identifier: string; label?: string; description?: string }>> {
        if (!text || text.trim().length === 0) {
            return [];
        }

        // 1) 先尝试基于本地 icon 文档做确定性匹配，通常比 LLM 更准确
        let localIds: string[] = [];
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders || [];
            for (const wf of workspaceFolders) {
                try {
                    const candidate = vscode.Uri.file(`${wf.uri.fsPath}/issue-notes/20260107-173616-700.md`);
                    const bytes = await vscode.workspace.fs.readFile(candidate);
                    const content = Buffer.from(bytes).toString('utf8');
                    const ids = new Set<string>();
                    const lines = content.split(/\r?\n/);
                    for (const ln of lines) {
                        // 表格行： | ** | identifier |
                        const m = ln.match(/\|\s*\*\*\s*\|\s*([^|\s]+)\s*\|/);
                        if (m && m[1]) { ids.add(m[1].trim()); continue; }
                        // 表格行更宽松匹配第二列
                        const m2 = ln.match(/\|\s*\*\*\s*\|\s*([^|]+)\s*\|/);
                        if (m2 && m2[1]) {
                            const id = m2[1].trim();
                            if (/^[a-z0-9\-_]+$/i.test(id)) { ids.add(id); }
                        }
                        // 另外匹配单列标识符行（如后半文档的简洁列表）
                        const m3 = ln.match(/^\|?\s*\*\*\s*\|?\s*([^|\s]+)\s*\|?$/);
                        if (m3 && m3[1]) { ids.add(m3[1].trim()); }
                        // 匹配简单表格行： | preview | identifier |
                        const m4 = ln.match(/\|[^|]*\|\s*([a-z0-9\-\_]+)\s*\|/i);
                        if (m4 && m4[1]) { ids.add(m4[1].trim()); }
                    }
                    if (ids.size > 0) {
                        localIds = Array.from(ids);
                        break;
                    }
                } catch {
                    // ignore
                }
            }
        } catch {
            // ignore
        }

        function score(id: string, q: string) {
            const a = id.toLowerCase();
            const b = q.toLowerCase();
            if (a === b) return 100;
            if (a.includes(b)) return 80;
            if (b.includes(a)) return 70;
            // token overlap
            const at = a.split(/[^a-z0-9]+/).filter(Boolean);
            const bt = b.split(/[^a-z0-9]+/).filter(Boolean);
            let overlap = 0;
            for (const t of bt) { if (at.includes(t)) overlap++; }
            if (overlap > 0) return 60 + overlap * 5;
            // prefix
            if (b.length > 0 && a.startsWith(b[0])) return 30;
            return 0;
        }

        const q = text.trim();
        const scored = localIds.map(id => ({ id, s: score(id, q) })).filter(x => x.s > 0).sort((x, y) => y.s - x.s);
        const results: Array<{ identifier: string; label?: string; description?: string }> = [];
        for (const s of scored) {
            results.push({ identifier: s.id, label: s.id, description: '' });
            if (results.length >= 12) break;
        }

        // 如果本地匹配已满足数量，直接返回；否则再调用 LLM 补全
        if (results.length >= 12) { return results.slice(0, 12); }

        // 调用 LLM 补全，要求不要返回已包含的 identifier
        const exclude = results.map(r => r.identifier).join(', ');
        const prompt = `请基于下面的中文或简要英文说明，生成 ${12 - results.length} 个适合用于 VS Code Theme Icon 的 identifier（不要包含下面已存在的 identifier: ${exclude}）。返回格式为一个 JSON 数组，数组中每个对象包含三个字段："identifier"、"label"（中文短描述）、"description"（一行中文推荐理由）。若可能，请优先从常见的 Codicon 标识符中挑选或使用类似命名。仅返回一个 Markdown 风格的 \`\`\`json\n[...]\n\`\`\` 代码块，不要添加其它说明或文本。输入：'''${text}'''`;

        try {
            const fullResp = await LLMService._request([
                vscode.LanguageModelChatMessage.User(prompt)
            ], options);
            if (fullResp !== null) {
                const full = fullResp.text;
                const jsonBlockMatch = full.match(/```json\s*([\s\S]*?)\s*```/i);
                let jsonCandidate = "";
                if (jsonBlockMatch && jsonBlockMatch[1]) {
                    jsonCandidate = jsonBlockMatch[1];
                } else {
                    const first = full.indexOf("[");
                    const last = full.lastIndexOf("]");
                    if (first !== -1 && last !== -1 && last > first) {
                        jsonCandidate = full.substring(first, last + 1);
                    }
                }

                if (jsonCandidate) {
                    try {
                        const parsed = JSON.parse(jsonCandidate);
                        if (Array.isArray(parsed)) {
                            for (const p of parsed) {
                                const id = String(p.identifier || p.id || p.name || "").trim();
                                if (!id) continue;
                                if (results.find(r => r.identifier === id)) continue;
                                results.push({ identifier: id, label: String(p.label || p.title || id), description: String(p.description || p.reason || '') });
                                if (results.length >= 12) break;
                            }
                        }
                    } catch (err) {
                        Logger.getInstance().warn("解析 IconService JSON 失败，回退到文本解析", err);
                    }
                }
            }

            // 回退：若 LLM 未返回足够结果，则使用简单文本解析补全
            if (results.length < 12) {
                try {
                    const fullText = (await LLMService._request([vscode.LanguageModelChatMessage.User(prompt)], options))?.text || '';
                    const lines = fullText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
                    for (const ln of lines) {
                        const m = ln.match(/^[-\d\.\)\s]*(?:"|')?(.*?)(?:"|')?\s*-\s*(.*?)\s*-\s*(.*)$/);
                        if (m) {
                            const id = m[1].trim();
                            if (!results.find(r => r.identifier === id)) { results.push({ identifier: id, label: m[2].trim(), description: m[3].trim() }); }
                        } else {
                            const parts = ln.split(/\s*-\s*/);
                            if (parts.length >= 1 && parts[0]) {
                                const id = parts[0].trim();
                                if (!results.find(r => r.identifier === id)) { results.push({ identifier: id, label: parts[1]?.trim() || id, description: parts[2]?.trim() || '' }); }
                            }
                        }
                        if (results.length >= 12) break;
                    }
                } catch {
                    // ignore
                }
            }

            return results.slice(0, 12);
        } catch (error) {
            if (options?.signal?.aborted) {
                return [];
            }
            Logger.getInstance().error("IconService generateIconIdentifiers error:", error);
            vscode.window.showErrorMessage("调用 Copilot 生成 Icon identifiers 失败。");
            return results.slice(0, 12);
        }
    }
}
