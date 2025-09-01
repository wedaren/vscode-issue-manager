import * as vscode from 'vscode';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { getIssueDir } from '../config';

/**
 * 从 Markdown 文件内容中提取第一个一级标题。
 * @param content 文件内容。
 * @returns 第一个一级标题的文本，如果找不到则返回 undefined。
 */
function extractTitleFromContent(content: string): string | undefined {
    const match = content.match(/^#\s+(.*)/m);
    return match ? match[1].trim() : undefined;
}

/**
 * Frontmatter 数据结构
 */
export interface FrontmatterData {
    root_file?: string;
    parent_file?: string | null;
    children_files?: string[];
    [key: string]: any; // 支持其他字段
}

/**
 * 检查一个值是否为有效的对象（非 null 且为 object 类型）
 */
function isValidObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 从 Markdown 文件内容中解析 frontmatter
 * @param content 文件内容
 * @returns 解析出的 frontmatter 数据，如果没有则返回 null
 */
export function parseFrontmatter(content: string): FrontmatterData | null {
    // 检查是否以 frontmatter 开始
    if (!content.startsWith('---')) {
        return null;
    }

    // 找到结束的 ---
    const lines = content.split('\n');
    let endIndex = -1;
    for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === '---') {
            endIndex = i;
            break;
        }
    }

    if (endIndex === -1) {
        return null;
    }

    // 提取 YAML 内容
    const yamlContent = lines.slice(1, endIndex).join('\n');
    
    // 如果 YAML 内容为空或只包含空白字符，返回 null
    if (!yamlContent.trim()) {
        return null;
    }
    
    try {
        const parsed = yaml.load(yamlContent);
        
        // 类型安全检查：确保解析结果是一个有效对象
        if (isValidObject(parsed)) {
            return parsed as FrontmatterData;
        }
        
        // 如果解析结果不是对象，返回 null
        return null;
    } catch (error) {
        console.error('解析 frontmatter 失败:', error);
        return null;
    }
}

/**
 * 从 Markdown 文件中解析 frontmatter
 * @param fileUri 文件的 URI
 * @returns 解析出的 frontmatter 数据，如果没有则返回 null
 */
export async function getFrontmatter(fileUri: vscode.Uri): Promise<FrontmatterData | null> {
    try {
        const contentBytes = await vscode.workspace.fs.readFile(fileUri);
        const content = Buffer.from(contentBytes).toString('utf-8');
        return parseFrontmatter(content);
    } catch (error) {
        console.error(`读取文件时出错 ${fileUri.fsPath}:`, error);
        return null;
    }
}

/**
 * 异步地获取给定 Markdown 文件的标题。
 * 优先读取文件中的第一个一级标题 (`# `)。如果找不到，则使用文件名（不含扩展名）作为后备。
 * @param fileUri 文件的 URI。
 * @returns 解析出的标题。
 */
export async function getTitle(fileUri: vscode.Uri): Promise<string> {
    try {
        const contentBytes = await vscode.workspace.fs.readFile(fileUri);
        const content = Buffer.from(contentBytes).toString('utf-8');
        const titleFromContent = extractTitleFromContent(content);
        if (titleFromContent) {
            return titleFromContent;
        }
    } catch (error) {
        console.error(`读取文件时出错 ${fileUri.fsPath}:`, error);
    }
    // 如果读取失败，则回退到使用文件名
    return path.basename(fileUri.fsPath, '.md');
}

/**
 * 获取问题目录中所有 Markdown 文件的标题和文件路径。
 * @returns 包含标题和文件路径的对象数组。
 */
export async function getAllMarkdownIssues(): Promise<{ title: string, filePath: string }[]> {
    const issueDir = getIssueDir();
    if (!issueDir) {
        return [];
    }

    const files = await vscode.workspace.findFiles(new vscode.RelativePattern(issueDir, '**/*.md'), '**/.issueManager/**');
    const issues: { title: string, filePath: string }[] = [];

    for (const file of files) {
        const title = await getTitle(file);
        issues.push({ title, filePath: file.fsPath });
    }

    return issues;
}
