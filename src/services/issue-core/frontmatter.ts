/**
 * frontmatter 解析与术语定位的纯函数集合。
 * **不依赖 vscode 模块**,扩展端和 MCP server 共用。
 */

import * as jsYaml from "js-yaml";
import { isMap, isScalar, isSeq, parseDocument } from "yaml";
import type { FrontmatterData } from "./types";
import { AGENT_FILE_TYPE_KEYS } from "./types";

/**
 * 从 Markdown 文件内容中提取第一个一级标题。
 * @param content 文件内容。
 * @returns 第一个一级标题的文本,如果找不到则返回 undefined。
 */
export function extractTitleFromContent(content: string): string | undefined {
    const match = content.match(/^#\s+(.*)/m);
    return match ? match[1].trim() : undefined;
}

export function isValidObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * 提取 frontmatter 的行(不包括起始/结束的 '---'),以及 frontmatter 在文件中的起始行号
 */
export function extractFrontmatterLines(content: string): { lines: string[]; startLineNumber: number } | null {
    if (!content.startsWith("---")) {
        return null;
    }

    const lines = content.split(/\r?\n/);
    let endIndex = -1;
    for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === "---") {
            endIndex = i;
            break;
        }
    }

    if (endIndex === -1) {
        return null;
    }

    const frontmatterLines = lines.slice(1, endIndex);
    const startLineNumber = 2;
    return { lines: frontmatterLines, startLineNumber };
}

export function normalizeYamlScalar(value: string): string {
    let result = value.trim();
    if ((result.startsWith('"') && result.endsWith('"')) || (result.startsWith("'") && result.endsWith("'"))) {
        result = result.slice(1, -1).trim();
    }
    return result;
}

function offsetToLineColumn(text: string, offset: number): { line: number; column: number } {
    const safeOffset = Math.max(0, Math.min(offset, text.length));
    let line = 1;
    let lastLineStart = 0;
    for (let i = 0; i < safeOffset; i++) {
        if (text.charCodeAt(i) === 10) {
            line += 1;
            lastLineStart = i + 1;
        }
    }
    const column = safeOffset - lastLineStart + 1;
    return { line, column };
}

function buildTermLocationMapFromYaml(
    frontmatterText: string,
    startLineNumber: number,
): Map<string, { line: number; column: number }> {
    const map = new Map<string, { line: number; column: number }>();
    if (!frontmatterText.trim()) {
        return map;
    }

    let doc;
    try {
        doc = parseDocument(frontmatterText);
    } catch {
        return map;
    }

    if (!doc || !doc.contents || !isMap(doc.contents)) {
        return map;
    }

    const termsNode = doc.contents.get("terms", true);
    if (!termsNode || !isSeq(termsNode)) {
        return map;
    }

    for (const item of termsNode.items) {
        if (!item || !isMap(item)) {
            continue;
        }

        const nameNode = item.get("name", true);
        if (!nameNode || !isScalar(nameNode)) {
            continue;
        }

        const nameValue = nameNode.value;
        if (typeof nameValue !== "string") {
            continue;
        }

        const name = nameValue.trim();
        if (!name || map.has(name)) {
            continue;
        }

        const range = nameNode.range;
        if (!range || range.length < 2) {
            continue;
        }

        const pos = offsetToLineColumn(frontmatterText, range[0]);
        const lineNumber = startLineNumber + (pos.line - 1);
        map.set(name, { line: lineNumber, column: pos.column });
    }

    return map;
}

function buildTermLocationMapByRegex(
    frontmatterLines: string[],
    startLineNumber: number,
): Map<string, { line: number; column: number }> {
    const map = new Map<string, { line: number; column: number }>();

    let termsLineIndex = -1;
    let termsIndent = 0;

    for (let i = 0; i < frontmatterLines.length; i++) {
        const line = frontmatterLines[i];
        const match = line.match(/^(\s*)terms\s*:\s*$/);
        if (match) {
            termsLineIndex = i;
            termsIndent = match[1].length;
            break;
        }
    }

    if (termsLineIndex === -1) {
        return map;
    }

    for (let i = termsLineIndex + 1; i < frontmatterLines.length; i++) {
        const line = frontmatterLines[i];
        if (!line.trim()) {
            continue;
        }
        const indentMatch = line.match(/^(\s*)/);
        const indent = indentMatch ? indentMatch[1].length : 0;

        if (indent <= termsIndent && /^\s*\w+\s*:/u.test(line)) {
            break;
        }

        const nameMatch = line.match(/^\s*-\s*name\s*:\s*(.+?)\s*$/u);
        let rawName: string | undefined;
        let valueIndex = -1;

        if (nameMatch) {
            rawName = nameMatch[1];
            valueIndex = line.indexOf(rawName);
        } else {
            const inlineMatch = line.match(/\bname\s*:\s*([^,#}]+?)(?:\s*(?:,|$|\}))/u);
            if (inlineMatch) {
                rawName = inlineMatch[1];
                valueIndex = line.indexOf(rawName);
            }
        }

        if (!rawName) {
            continue;
        }

        const name = normalizeYamlScalar(rawName);
        if (!name || map.has(name)) {
            continue;
        }

        const lineNumber = startLineNumber + i;
        const columnNumber = valueIndex >= 0 ? valueIndex + 1 : 1;
        map.set(name, { line: lineNumber, column: columnNumber });
    }

    return map;
}

/**
 * 从 frontmatter 的行中构建术语位置索引(name -> {line,column})
 */
export function buildTermLocationMap(
    frontmatterLines: string[],
    startLineNumber: number,
): Map<string, { line: number; column: number }> {
    const frontmatterText = frontmatterLines.join("\n");
    const parsed = buildTermLocationMapFromYaml(frontmatterText, startLineNumber);
    if (parsed.size > 0) {
        return parsed;
    }
    return buildTermLocationMapByRegex(frontmatterLines, startLineNumber);
}

/**
 * 从 frontmatter 的 `issue_title` 字段安全提取字符串标题(支持 string 或 string[])。
 */
export function extractIssueTitleFromFrontmatter(
    fm: FrontmatterData | null | undefined,
): string | undefined {
    if (!fm) {
        return undefined;
    }
    const issueTitle = fm.issue_title;
    if (typeof issueTitle === "string" && issueTitle.trim()) {
        return issueTitle.trim();
    }
    if (Array.isArray(issueTitle) && issueTitle.length > 0 && typeof issueTitle[0] === "string") {
        return issueTitle[0].trim();
    }
    return undefined;
}

/**
 * 分离 frontmatter 与正文,返回解析后的 frontmatter(如果存在)和剩余 body 文本。
 *
 * Note: YAML 解析失败时通过 `console.warn` 输出。原扩展端走 `Logger`,
 * 但服务层不能依赖 vscode;在扩展端 console 输出会进入 Extension Host 的开发者工具控制台,
 * 在 MCP server 一侧会输出到 stderr。
 */
export function extractFrontmatterAndBody(content: string): {
    frontmatter: FrontmatterData | null;
    body: string;
} {
    if (!content.startsWith("---")) {
        return { frontmatter: null, body: content };
    }
    const lines = content.split(/\r?\n/);
    let endIndex = -1;
    for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === "---") {
            endIndex = i;
            break;
        }
    }
    if (endIndex === -1) {
        return { frontmatter: null, body: content };
    }
    const body = lines.slice(endIndex + 1).join("\n");
    const yamlContent = lines.slice(1, endIndex).join("\n");
    try {
        const parsed = jsYaml.load(yamlContent);
        if (isValidObject(parsed)) {
            return { frontmatter: parsed as FrontmatterData, body };
        }
    } catch (error) {
        console.warn("[issue-core] 解析 frontmatter 失败", error);
    }
    return { frontmatter: null, body };
}

/**
 * 检查 frontmatter 是否属于 agent 系统自动生成文件。
 */
export function isAgentFileFrontmatter(
    frontmatter: Record<string, unknown> | null | undefined,
): boolean {
    if (!frontmatter) { return false; }
    for (const key of AGENT_FILE_TYPE_KEYS) {
        if (frontmatter[key] === true) { return true; }
    }
    return false;
}
