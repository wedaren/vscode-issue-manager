// 调查板持久化服务：管理 {issueDir}/.issueManager/boards/ 下的多调查板文件。
// 每个板子对应一个 {boardId}.json，boardId 由创建时生成（时间戳+随机串）。
// BoardMeta 索引文件 boards/index.json 维护所有板子的元数据列表。

import * as fs from 'fs';
import * as path from 'path';
import { getIssueDir } from '../../config';

// ── 数据结构 ──────────────────────────────────────────────────────────────────

/** 画布上的单个条目，可以是图片或 Issue 文档卡片 */
export type BoardItem =
    | {
          type: 'image';
          id: string;
          filePath: string;
          x: number;
          y: number;
          width: number;
          height: number;
          zIndex: number;
      }
    | {
          type: 'issue';
          id: string;
          /** Issue 文件的绝对路径 */
          filePath: string;
          /** Issue 标题（创建时快照，打开时实时读取覆盖） */
          title: string;
          /** Issue 内容前 120 字摘要 */
          excerpt: string;
          x: number;
          y: number;
          /** 卡片宽度，默认 260 */
          width: number;
          /** 卡片高度，默认 140 */
          height: number;
          zIndex: number;
      };

/** 单块调查板的完整数据 */
export interface BoardData {
    id: string;
    name: string;
    createdAt: number;
    updatedAt: number;
    canvasX: number;
    canvasY: number;
    canvasScale: number;
    items: BoardItem[];
}

/** boards/index.json 中每条板子的元数据（不含 items） */
export interface BoardMeta {
    id: string;
    name: string;
    createdAt: number;
    updatedAt: number;
}

// ── 辅助函数 ──────────────────────────────────────────────────────────────────

function getBoardsDir(): string | undefined {
    const issueDir = getIssueDir();
    if (!issueDir) { return undefined; }
    return path.join(issueDir, '.issueManager', 'boards');
}

function ensureBoardsDir(boardsDir: string): void {
    fs.mkdirSync(boardsDir, { recursive: true });
}

function boardFilePath(boardsDir: string, boardId: string): string {
    return path.join(boardsDir, `${boardId}.json`);
}

function indexFilePath(boardsDir: string): string {
    return path.join(boardsDir, 'index.json');
}

function readIndex(boardsDir: string): BoardMeta[] {
    const fp = indexFilePath(boardsDir);
    if (!fs.existsSync(fp)) { return []; }
    try {
        return JSON.parse(fs.readFileSync(fp, 'utf-8')) as BoardMeta[];
    } catch {
        return [];
    }
}

function writeIndex(boardsDir: string, index: BoardMeta[]): void {
    fs.writeFileSync(indexFilePath(boardsDir), JSON.stringify(index, null, 2));
}

function generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── 公开 API ──────────────────────────────────────────────────────────────────

/**
 * 调查板存储服务：提供多调查板的增删查改能力。
 */
export class BoardStorageService {
    /**
     * 列出所有调查板元数据，按创建时间倒序。
     * @returns 元数据数组（不含 items）
     */
    public static listBoards(): BoardMeta[] {
        const boardsDir = getBoardsDir();
        if (!boardsDir) { return []; }
        if (!fs.existsSync(boardsDir)) { return []; }
        return readIndex(boardsDir).sort((a, b) => b.createdAt - a.createdAt);
    }

    /**
     * 创建新调查板，写入文件并更新索引。
     * @param name - 调查板名称
     * @returns 新板子的完整数据
     */
    public static createBoard(name: string): BoardData | undefined {
        const boardsDir = getBoardsDir();
        if (!boardsDir) { return undefined; }
        ensureBoardsDir(boardsDir);

        const id = generateId();
        const now = Date.now();
        const data: BoardData = {
            id, name,
            createdAt: now,
            updatedAt: now,
            canvasX: 0, canvasY: 0, canvasScale: 1,
            items: [],
        };

        fs.writeFileSync(boardFilePath(boardsDir, id), JSON.stringify(data, null, 2));

        const index = readIndex(boardsDir);
        index.push({ id, name, createdAt: now, updatedAt: now });
        writeIndex(boardsDir, index);

        return data;
    }

    /**
     * 读取指定 boardId 的完整数据。
     * @param boardId - 板子 ID
     */
    public static readBoard(boardId: string): BoardData | undefined {
        const boardsDir = getBoardsDir();
        if (!boardsDir) { return undefined; }
        const fp = boardFilePath(boardsDir, boardId);
        if (!fs.existsSync(fp)) { return undefined; }
        try {
            return JSON.parse(fs.readFileSync(fp, 'utf-8')) as BoardData;
        } catch {
            return undefined;
        }
    }

    /**
     * 保存调查板数据（全量覆写），同步更新索引中的 updatedAt 和 name。
     * @param data - 完整板子数据
     */
    public static saveBoard(data: BoardData): void {
        const boardsDir = getBoardsDir();
        if (!boardsDir) { return; }
        ensureBoardsDir(boardsDir);

        data.updatedAt = Date.now();
        fs.writeFileSync(boardFilePath(boardsDir, data.id), JSON.stringify(data, null, 2));

        const index = readIndex(boardsDir);
        const entry = index.find(m => m.id === data.id);
        if (entry) {
            entry.name = data.name;
            entry.updatedAt = data.updatedAt;
        } else {
            index.push({ id: data.id, name: data.name, createdAt: data.createdAt, updatedAt: data.updatedAt });
        }
        writeIndex(boardsDir, index);
    }

    /**
     * 重命名调查板（只更新索引和 data.name，不移动文件）。
     * @param boardId - 板子 ID
     * @param newName - 新名称
     */
    public static renameBoard(boardId: string, newName: string): void {
        const boardsDir = getBoardsDir();
        if (!boardsDir) { return; }

        const data = this.readBoard(boardId);
        if (!data) { return; }
        data.name = newName;
        this.saveBoard(data);
    }

    /**
     * 删除调查板文件并从索引中移除。
     * @param boardId - 板子 ID
     */
    public static deleteBoard(boardId: string): void {
        const boardsDir = getBoardsDir();
        if (!boardsDir) { return; }

        const fp = boardFilePath(boardsDir, boardId);
        if (fs.existsSync(fp)) {
            fs.unlinkSync(fp);
        }

        const index = readIndex(boardsDir);
        writeIndex(boardsDir, index.filter(m => m.id !== boardId));
    }

    /**
     * 将旧的全局 .board.json 迁移为第一块调查板（若目标目录为空则执行）。
     * @param legacyBoardPath - 旧 .board.json 的绝对路径
     */
    public static migrateFromLegacy(legacyBoardPath: string): void {
        const boardsDir = getBoardsDir();
        if (!boardsDir) { return; }
        // 若已有板子则跳过迁移
        if (fs.existsSync(boardsDir) && readIndex(boardsDir).length > 0) { return; }
        if (!fs.existsSync(legacyBoardPath)) { return; }

        try {
            const raw = JSON.parse(fs.readFileSync(legacyBoardPath, 'utf-8')) as {
                canvasX?: number; canvasY?: number; canvasScale?: number;
                items?: Array<{ id: string; filePath: string; x: number; y: number; width: number; height: number }>;
            };

            ensureBoardsDir(boardsDir);
            const id = generateId();
            const now = Date.now();
            const data: BoardData = {
                id,
                name: '默认调查板（已迁移）',
                createdAt: now,
                updatedAt: now,
                canvasX: raw.canvasX ?? 0,
                canvasY: raw.canvasY ?? 0,
                canvasScale: raw.canvasScale ?? 1,
                items: (raw.items ?? []).map(item => ({
                    type: 'image' as const,
                    id: item.id,
                    filePath: item.filePath,
                    x: item.x,
                    y: item.y,
                    width: item.width,
                    height: item.height,
                    zIndex: 1,
                })),
            };

            fs.writeFileSync(boardFilePath(boardsDir, id), JSON.stringify(data, null, 2));
            writeIndex(boardsDir, [{ id, name: data.name, createdAt: now, updatedAt: now }]);
        } catch {
            // 迁移失败不中断用户流程
        }
    }
}
