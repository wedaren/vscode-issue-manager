import * as vscode from "vscode";
import * as path from "path";
import * as yaml from "js-yaml";
import { parseLinkedFileString, type TermDefinition } from "../data/IssueMarkdowns";

export interface TermLocation {
    line: number;
    column: number;
}

export interface TermSourceItem {
    term: TermDefinition;
    sourceUri: vscode.Uri;
    sourceBaseName: string;
    location?: TermLocation;
}

export interface TermDisplayItem extends TermSourceItem {
    displayName: string;
}

interface TermsParseResult {
    terms: TermDefinition[];
    termsReferences: string[];
    termLocations: Map<string, TermLocation>;
}

function isValidObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isTermDefinition(value: unknown): value is TermDefinition {
    return isValidObject(value) && typeof value.name === "string" && value.name.trim().length > 0;
}

function extractFrontmatterLines(content: string): { lines: string[]; startLineNumber: number } | null {
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
    const startLineNumber = 2; // frontmatter 第一行在文件的第 2 行
    return { lines: frontmatterLines, startLineNumber };
}

function normalizeYamlScalar(value: string): string {
    let result = value.trim();
    if ((result.startsWith("\"") && result.endsWith("\"")) || (result.startsWith("'") && result.endsWith("'"))) {
        result = result.slice(1, -1).trim();
    }
    return result;
}

function buildTermLocationMap(frontmatterLines: string[], startLineNumber: number): Map<string, TermLocation> {
    const map = new Map<string, TermLocation>();

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

function parseTermsFromContent(content: string): TermsParseResult {
    const frontmatterInfo = extractFrontmatterLines(content);
    if (!frontmatterInfo) {
        return { terms: [], termsReferences: [], termLocations: new Map() };
    }

    const frontmatterText = frontmatterInfo.lines.join("\n");
    let frontmatter: Record<string, unknown> = {};

    try {
        const parsed = yaml.load(frontmatterText);
        if (isValidObject(parsed)) {
            frontmatter = parsed;
        }
    } catch {
        return { terms: [], termsReferences: [], termLocations: new Map() };
    }

    const termsRaw = frontmatter.terms;
    const terms = Array.isArray(termsRaw) ? termsRaw.filter(isTermDefinition) : [];

    const referencesRaw = frontmatter.terms_references;
    const termsReferences = Array.isArray(referencesRaw)
        ? referencesRaw.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        : [];

    const termLocations = buildTermLocationMap(frontmatterInfo.lines, frontmatterInfo.startLineNumber);

    return { terms, termsReferences, termLocations };
}

function resolveReferenceUris(
    documentUri: vscode.Uri,
    issueDir: string,
    references: string[]
): vscode.Uri[] {
    const result: vscode.Uri[] = [];
    const seen = new Set<string>();

    for (const raw of references) {
        const parsed = parseLinkedFileString(raw);
        let candidatePath: string | undefined;

        if (parsed.fsPath) {
            candidatePath = parsed.fsPath;
        } else if (parsed.linkPath) {
            candidatePath = path.isAbsolute(parsed.linkPath)
                ? parsed.linkPath
                : path.resolve(issueDir, parsed.linkPath);
        }

        if (!candidatePath || !candidatePath.toLowerCase().endsWith(".md")) {
            continue;
        }

        const normalized = path.normalize(candidatePath);
        if (normalized === path.normalize(documentUri.fsPath)) {
            continue;
        }

        if (seen.has(normalized)) {
            continue;
        }
        seen.add(normalized);
        result.push(vscode.Uri.file(normalized));
    }

    return result;
}

async function readFileContent(uri: vscode.Uri): Promise<string | null> {
    try {
        const data = await vscode.workspace.fs.readFile(uri);
        return Buffer.from(data).toString("utf-8");
    } catch {
        return null;
    }
}

export async function collectTermsForDocument(
    document: vscode.TextDocument,
    issueDir: string
): Promise<TermDisplayItem[]> {
    const currentParsed = parseTermsFromContent(document.getText());
    const sources: TermSourceItem[] = [];

    const currentBaseName = path.basename(document.uri.fsPath, ".md");
    for (const term of currentParsed.terms) {
        const location = currentParsed.termLocations.get(term.name);
        sources.push({
            term,
            sourceUri: document.uri,
            sourceBaseName: currentBaseName,
            location,
        });
    }

    const referenceUris = resolveReferenceUris(document.uri, issueDir, currentParsed.termsReferences);

    const referenceContents = await Promise.all(
        referenceUris.map(async (uri) => ({ uri, content: await readFileContent(uri) }))
    );

    for (const { uri, content } of referenceContents) {
        if (!content) {
            continue;
        }
        const parsed = parseTermsFromContent(content);
        const baseName = path.basename(uri.fsPath, ".md");
        for (const term of parsed.terms) {
            const location = parsed.termLocations.get(term.name);
            sources.push({
                term,
                sourceUri: uri,
                sourceBaseName: baseName,
                location,
            });
        }
    }

    const nameCount = new Map<string, number>();
    for (const item of sources) {
        const key = item.term.name;
        nameCount.set(key, (nameCount.get(key) || 0) + 1);
    }

    return sources.map((item) => {
        const duplicated = (nameCount.get(item.term.name) || 0) > 1;
        const displayName = duplicated
            ? `${item.term.name}::${item.sourceBaseName}`
            : item.term.name;
        return { ...item, displayName };
    });
}
