// MarkdownBoardService：以 Markdown + YAML Frontmatter 作为调查板载体。
// 替代原有的 JSON 存储方案（BoardStorageService），使 Agent 可用现有 issue 工具维护调查板。
//
// 调查板 Markdown 格式：
// ---
// issue_title: "调查板名称"
// board_type: survey
// board_id: xxx
// board_name: "调查板名称"
// board_canvasX: 0
// board_canvasY: 0
// board_canvasScale: 1
// board_items:
//   - type: image
//     id: i1
//     filePath: /abs/path/to/img.png
//     x: 100
//     y: 200
//     width: 300
//     height: 200
//     zIndex: 1
// ---
// （正文：人类可编辑的资料说明）

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as jsYaml from 'js-yaml';
import { getIssueDir } from '../../config';
import { extractFrontmatterAndBody, type FrontmatterData } from '../../data/IssueMarkdowns';
import { generateFileName } from '../../utils/fileUtils';
import { type BoardData, type BoardItem, type BoardMeta } from './BoardStorageService';

// ── 辅助函数 ──────────────────────────────────────────────────────────────────

function generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** 将 frontmatter 中的 board_items 转为 BoardItem[] */
function frontmatterItemsToBoardItems(rawItems: unknown[]): BoardItem[] {
    const items: BoardItem[] = [];
    for (const raw of rawItems) {
        if (!raw || typeof raw !== 'object') { continue; }
        const r = raw as Record<string, unknown>;
        const type = r.type;
        if (type !== 'image' && type !== 'issue') { continue; }
        const base = {
            id: String(r.id || ''),
            filePath: String(r.filePath || ''),
            x: Number(r.x || 0),
            y: Number(r.y || 0),
            width: Number(r.width || 0),
            height: Number(r.height || 0),
            zIndex: Number(r.zIndex || 1),
        };
        if (!base.id) { continue; }
        if (type === 'image') {
            items.push({ type: 'image', ...base });
        } else {
            items.push({
                type: 'issue',
                ...base,
                title: String(r.title || ''),
                excerpt: String(r.excerpt || ''),
            });
        }
    }
    return items;
}

/** 将 BoardItem[] 转为可序列化的 plain object[] */
function boardItemsToFrontmatterItems(items: BoardItem[]): unknown[] {
    return items.map(item => {
        if (item.type === 'image') {
            return {
                type: item.type,
                id: item.id,
                filePath: item.filePath,
                x: item.x,
                y: item.y,
                width: item.width,
                height: item.height,
                zIndex: item.zIndex,
            };
        }
        return {
            type: item.type,
            id: item.id,
            filePath: item.filePath,
            x: item.x,
            y: item.y,
            width: item.width,
            height: item.height,
            zIndex: item.zIndex,
            title: item.title,
            excerpt: item.excerpt,
        };
    });
}

// ── 核心 API ──────────────────────────────────────────────────────────────────

/**
 * 从 markdown 内容解析调查板数据。
 * @returns 包含 BoardData 和 body（正文），解析失败返回 undefined。
 */
export function parseBoardData(content: string): { data: BoardData; body: string } | undefined {
    const { frontmatter, body } = extractFrontmatterAndBody(content);
    if (!frontmatter || frontmatter.board_type !== 'survey') {
        return undefined;
    }

    const fm = frontmatter;
    const items: BoardItem[] = Array.isArray(fm.board_items)
        ? frontmatterItemsToBoardItems(fm.board_items)
        : [];

    const now = Date.now();
    const data: BoardData = {
        id: String(fm.board_id || generateId()),
        name: String(fm.board_name || fm.issue_title || '调查板'),
        createdAt: Number(fm.createdAt) || now,
        updatedAt: Number(fm.updatedAt) || now,
        canvasX: Number(fm.board_canvasX) || 0,
        canvasY: Number(fm.board_canvasY) || 0,
        canvasScale: Number(fm.board_canvasScale) || 1,
        items,
    };

    return { data, body };
}

/**
 * 将 BoardData + body 序列化为 markdown 字符串。
 * 保留原有 frontmatter 中的非 board 字段。
 */
export function serializeBoard(data: BoardData, body?: string, originalFrontmatter?: FrontmatterData | null): string {
    const fm: FrontmatterData = originalFrontmatter ? { ...originalFrontmatter } : {};

    // 更新 board 字段
    fm.issue_title = data.name;
    fm.board_type = 'survey';
    fm.board_id = data.id;
    fm.board_name = data.name;
    fm.board_canvasX = data.canvasX;
    fm.board_canvasY = data.canvasY;
    fm.board_canvasScale = data.canvasScale;
    fm.board_items = boardItemsToFrontmatterItems(data.items);
    fm.updatedAt = Date.now();
    if (!fm.createdAt) {
        fm.createdAt = data.createdAt;
    }

    const fmYaml = jsYaml.dump(fm, { flowLevel: -1, lineWidth: -1 }).trim();
    const safeBody = body ?? '';
    return `---\n${fmYaml}\n---\n${safeBody}`;
}

// ── 文件级 API ────────────────────────────────────────────────────────────────

/**
 * 扫描 issueDir 下所有 board_type: survey 的 markdown 文件。
 * @returns 按修改时间倒序的 BoardMeta 数组（包含 filePath）
 */
export async function listBoardMarkdowns(): Promise<(BoardMeta & { filePath: string })[]> {
    const issueDir = getIssueDir();
    if (!issueDir) { return []; }

    const results: BoardMeta[] = [];

    try {
        const entries = await fs.promises.readdir(issueDir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isFile() || !entry.name.endsWith('.md')) { continue; }
            const fp = path.join(issueDir, entry.name);
            try {
                const content = await fs.promises.readFile(fp, 'utf-8');
                const parsed = parseBoardData(content);
                if (!parsed) { continue; }
                const stat = await fs.promises.stat(fp);
                results.push({
                    id: parsed.data.id,
                    name: parsed.data.name,
                    createdAt: parsed.data.createdAt,
                    updatedAt: stat.mtime.getTime(),
                    filePath: fp,
                });
            } catch {
                // 跳过无法读取的文件
            }
        }
    } catch {
        // 目录不存在或无法读取
    }

    return results.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * 读取指定 markdown 文件中的调查板数据。
 */
export async function readBoardMarkdown(fsPath: string): Promise<BoardData | undefined> {
    try {
        const content = await fs.promises.readFile(fsPath, 'utf-8');
        const parsed = parseBoardData(content);
        if (!parsed) { return undefined; }
        // 用文件实际 mtime 覆盖
        const stat = await fs.promises.stat(fsPath);
        parsed.data.updatedAt = stat.mtime.getTime();
        return parsed.data;
    } catch {
        return undefined;
    }
}

/**
 * 保存调查板数据到 markdown 文件（只更新 frontmatter，保留正文）。
 */
export async function saveBoardMarkdown(fsPath: string, data: BoardData): Promise<boolean> {
    let originalFm: FrontmatterData | null = null;
    let body = '';
    try {
        const content = await fs.promises.readFile(fsPath, 'utf-8');
        const parsed = extractFrontmatterAndBody(content);
        originalFm = parsed.frontmatter;
        body = parsed.body;
    } catch {
        // 文件不存在或无法读取，以空内容创建
    }

    const newContent = serializeBoard(data, body, originalFm);
    try {
        await fs.promises.writeFile(fsPath, newContent, 'utf-8');
        return true;
    } catch {
        return false;
    }
}

/**
 * 创建新的调查板 markdown 文件。
 * @param name - 调查板名称
 * @returns 创建的文件的 BoardMeta，失败返回 undefined
 */
export async function createBoardMarkdown(name: string): Promise<BoardMeta | undefined> {
    const issueDir = getIssueDir();
    if (!issueDir) { return undefined; }

    const id = generateId();
    const now = Date.now();
    const data: BoardData = {
        id, name,
        createdAt: now,
        updatedAt: now,
        canvasX: 0, canvasY: 0, canvasScale: 1,
        items: [],
    };

    const fileName = generateFileName();
    const fsPath = path.join(issueDir, fileName);
    const content = serializeBoard(data, `# ${name}\n\n`, null);

    try {
        await fs.promises.writeFile(fsPath, content, 'utf-8');
        return { id, name, createdAt: now, updatedAt: now };
    } catch {
        return undefined;
    }
}

/**
 * 重命名调查板（更新 frontmatter 中的 board_name 和 issue_title）。
 */
export async function renameBoardMarkdown(fsPath: string, newName: string): Promise<boolean> {
    try {
        const content = await fs.promises.readFile(fsPath, 'utf-8');
        const parsed = parseBoardData(content);
        if (!parsed) { return false; }
        parsed.data.name = newName;
        return await saveBoardMarkdown(fsPath, parsed.data);
    } catch {
        return false;
    }
}

/**
 * 删除调查板（删除 markdown 文件）。
 */
export async function deleteBoardMarkdown(fsPath: string): Promise<boolean> {
    try {
        await fs.promises.unlink(fsPath);
        return true;
    } catch {
        return false;
    }
}

// ── 迁移 ──────────────────────────────────────────────────────────────────────

/**
 * 将旧 JSON 格式的调查板迁移为 Markdown 格式。
 * 迁移成功后，旧 JSON 文件移至 `.issueManager/boards/backup/`。
 * @returns 成功迁移的数量
 */
export async function migrateLegacyBoards(): Promise<number> {
    const issueDir = getIssueDir();
    if (!issueDir) { return 0; }

    const oldBoardsDir = path.join(issueDir, '.issueManager', 'boards');
    if (!fs.existsSync(oldBoardsDir)) { return 0; }

    // 检查是否已有 markdown 调查板（避免重复迁移）
    const existing = await listBoardMarkdowns();
    if (existing.length > 0) { return 0; }

    const backupDir = path.join(oldBoardsDir, 'backup');
    fs.mkdirSync(backupDir, { recursive: true });

    let migrated = 0;

    // 读取 index.json 获取元数据
    const indexPath = path.join(oldBoardsDir, 'index.json');
    let metas: BoardMeta[] = [];
    try {
        if (fs.existsSync(indexPath)) {
            metas = JSON.parse(fs.readFileSync(indexPath, 'utf-8')) as BoardMeta[];
        }
    } catch {
        // index 损坏，尝试扫描目录
    }

    // 如果没有 index，扫描目录
    if (metas.length === 0) {
        try {
            const entries = fs.readdirSync(oldBoardsDir);
            for (const entry of entries) {
                if (!entry.endsWith('.json') || entry === 'index.json') { continue; }
                const fp = path.join(oldBoardsDir, entry);
                try {
                    const raw = JSON.parse(fs.readFileSync(fp, 'utf-8')) as BoardData;
                    metas.push({
                        id: raw.id || entry.replace('.json', ''),
                        name: raw.name || '调查板',
                        createdAt: raw.createdAt || Date.now(),
                        updatedAt: raw.updatedAt || Date.now(),
                    });
                } catch { /* skip */ }
            }
        } catch { /* skip */ }
    }

    for (const meta of metas) {
        const oldPath = path.join(oldBoardsDir, `${meta.id}.json`);
        if (!fs.existsSync(oldPath)) { continue; }

        try {
            const raw = JSON.parse(fs.readFileSync(oldPath, 'utf-8')) as BoardData;
            const data: BoardData = {
                id: raw.id || meta.id,
                name: raw.name || meta.name,
                createdAt: raw.createdAt || meta.createdAt,
                updatedAt: raw.updatedAt || meta.updatedAt,
                canvasX: raw.canvasX ?? 0,
                canvasY: raw.canvasY ?? 0,
                canvasScale: raw.canvasScale ?? 1,
                items: (raw.items || []).map(item => ({
                    ...item,
                    zIndex: (item as any).zIndex ?? 1,
                })) as BoardItem[],
            };

            const fileName = generateFileName();
            const newPath = path.join(issueDir, fileName);
            const mdContent = serializeBoard(data, `# ${data.name}\n\n（此调查板已从旧格式迁移）\n`, null);
            await fs.promises.writeFile(newPath, mdContent, 'utf-8');

            // 备份旧文件
            await fs.promises.rename(oldPath, path.join(backupDir, `${meta.id}.json`));
            migrated++;
        } catch {
            // 单个迁移失败不中断
        }
    }

    // 备份 index.json
    if (migrated > 0 && fs.existsSync(indexPath)) {
        try {
            await fs.promises.rename(indexPath, path.join(backupDir, 'index.json'));
        } catch { /* ignore */ }
    }

    return migrated;
}
