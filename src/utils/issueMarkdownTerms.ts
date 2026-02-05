import * as vscode from "vscode";
import * as path from "path";
import { type TermDefinition, extractFrontmatterLines, buildTermLocationMap, isValidObject, extractFrontmatterAndBody, FrontmatterData, getIssueMarkdown } from "../data/IssueMarkdowns";
import { Logger } from "../core/utils/Logger";
import { parseFileLink } from "./fileLinkFormatter";
import { resolveIssueUri } from "./pathUtils";

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

function isTermDefinition(value: unknown): value is TermDefinition {
    return isValidObject(value) && typeof value.name === "string" && value.name.trim().length > 0;
}

function parseTermsFromContent(content: string): TermsParseResult {
    const parsed = extractFrontmatterAndBody(content);
    if (!parsed.frontmatter) {
        return { terms: [], termsReferences: [], termLocations: new Map() };
    }

    const frontmatter: FrontmatterData = parsed.frontmatter;

    const termsRaw = frontmatter.terms;
    const terms = Array.isArray(termsRaw) ? termsRaw.filter(isTermDefinition) : [];

    const referencesRaw = frontmatter.terms_references;
    const termsReferences = Array.isArray(referencesRaw)
        ? referencesRaw.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        : [];

    const frontmatterInfo = extractFrontmatterLines(content);
    const termLocations = frontmatterInfo ? buildTermLocationMap(frontmatterInfo.lines, frontmatterInfo.startLineNumber) : new Map<string, TermLocation>();

    return { terms, termsReferences, termLocations };
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

    const fileLinks = currentParsed.termsReferences
        .map((ref) => parseFileLink(ref))
        .filter((link): link is { filePath: string } =>
            isValidObject(link) &&
            typeof (link as { filePath?: unknown }).filePath === "string" &&
            (link as { filePath: string }).filePath.trim().length > 0
        );

    const resolvedUris = fileLinks
        .map((link) => resolveIssueUri(link.filePath))
        .filter((uri): uri is vscode.Uri => uri !== undefined && (uri as vscode.Uri).fsPath !== undefined);

    const referenceContents = await Promise.all(
        resolvedUris.map(async (uri) => ({ uri, content: await readFileContent(uri) }))
    );

    for (const { uri, content } of referenceContents) {
        if (!content) {
            Logger.getInstance().warn(`无法读取术语参考文件: ${uri.fsPath}`);
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
