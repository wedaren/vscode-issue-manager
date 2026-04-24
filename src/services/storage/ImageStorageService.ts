// 图片存储核心服务：统一管理 ImageDir 目录下的图片文件的增删查操作。
// Markdown 引用使用 "ImageDir/xxx.png" 别名前缀；解析时展开为真实绝对路径。

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { getImageDir } from '../../config';

/** 超过此大小（1MB）且在 macOS 上时，自动用 sips 压缩为 JPEG 80% */
const COMPRESSION_THRESHOLD_BYTES = 1024 * 1024;

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);

/** Markdown 中图片路径的别名前缀，替代真实绝对路径 */
export const IMAGE_DIR_PREFIX = 'ImageDir';

/**
 * `save()` 的返回结果，包含别名路径及可选的压缩信息。
 */
export interface SaveResult {
    /** Markdown 引用路径，如 "ImageDir/paste_xxx.jpg" */
    relativePath: string;
    /** 压缩前字节数（仅在发生压缩时存在） */
    originalSize?: number;
    /** 压缩后字节数（仅在发生压缩时存在） */
    compressedSize?: number;
}

export interface ImageInfo {
    /** Markdown 引用路径，如 "ImageDir/screenshot_2026-04-23_120000.png" */
    relativePath: string;
    /** 绝对路径 */
    absolutePath: string;
    /** 文件名 */
    name: string;
    /** 修改时间戳（ms） */
    mtime: number;
}

/**
 * 图片存储服务：提供 ImageDir 目录下图片的保存、列举、删除与路径解析能力。
 */
export class ImageStorageService {
    /**
     * 生成默认文件名建议，供 UI 提示使用。
     * @param prefix - 文件名前缀
     * @param mimeType - MIME 类型
     */
    public static suggestFileName(prefix: string, mimeType: string): string {
        return this._generateFileName(prefix, this._extFromMime(mimeType));
    }

    /**
     * 将图片 Buffer 保存到 ImageDir，超过 1MB 的 PNG 在 macOS 上自动用 sips 压缩为 JPEG 80%。
     * @param data - 图片二进制数据
     * @param mimeType - MIME 类型，如 "image/png"
     * @param prefix - 文件名前缀，默认 "paste"
     * @param customName - 自定义文件名（含扩展名），优先于 prefix + 时间戳
     * @returns SaveResult（含别名路径及压缩信息），失败时返回 undefined
     */
    public static async save(
        data: Uint8Array,
        mimeType: string,
        prefix: string = 'paste',
        customName?: string,
    ): Promise<SaveResult | undefined> {
        const dir = getImageDir();
        if (!dir) {
            void vscode.window.showWarningMessage('请先配置 issueManager.imageDir 或 issueManager.issueDir。');
            return undefined;
        }

        try {
            await fs.promises.mkdir(dir, { recursive: true });
        } catch {
            // 目录已存在，忽略
        }

        const ext = this._extFromMime(mimeType);
        const name = customName ?? this._generateFileName(prefix, ext);
        const absolutePath = path.join(dir, name);

        await fs.promises.writeFile(absolutePath, Buffer.from(data));

        const compressed = this._tryCompressWithSips(absolutePath, name, dir);
        if (compressed) {
            return {
                relativePath: `${IMAGE_DIR_PREFIX}/${compressed.name}`,
                originalSize: compressed.originalSize,
                compressedSize: compressed.compressedSize,
            };
        }
        return { relativePath: `${IMAGE_DIR_PREFIX}/${name}` };
    }

    /**
     * 使用 macOS 内置 sips 工具将大图压缩为 JPEG 80%。
     * 非 macOS 或文件小于阈值时返回 null，保留原文件。
     * @param absolutePath - 已写入的原始文件绝对路径
     * @param name - 原始文件名
     * @param dir - 所在目录
     * @returns 压缩结果（新文件名及前后大小），无法压缩时返回 null
     */
    private static _tryCompressWithSips(
        absolutePath: string,
        name: string,
        dir: string,
    ): { name: string; originalSize: number; compressedSize: number } | null {
        if (process.platform !== 'darwin') { return null; }
        const ext = path.extname(name).toLowerCase();
        if (ext === '.jpg' || ext === '.jpeg' || ext === '.svg') { return null; } // 已是 JPEG 或 SVG（文本），跳过
        let originalSize: number;
        try {
            originalSize = fs.statSync(absolutePath).size;
        } catch {
            return null;
        }
        if (originalSize < COMPRESSION_THRESHOLD_BYTES) { return null; }
        const baseName = name.slice(0, name.length - ext.length);
        const jpgName = `${baseName}.jpg`;
        const jpgPath = path.join(dir, jpgName);
        try {
            execFileSync('sips', [
                '-s', 'format', 'jpeg',
                '-s', 'formatOptions', '80',
                absolutePath,
                '--out', jpgPath,
            ], { timeout: 10000 });
            const compressedSize = fs.statSync(jpgPath).size;
            fs.unlinkSync(absolutePath); // 删除原始大文件
            return { name: jpgName, originalSize, compressedSize };
        } catch {
            return null; // sips 失败，保留原文件
        }
    }

    /**
     * 将 base64 字符串保存到 ImageDir，返回 "ImageDir/xxx.png" 别名路径。
     * @param base64 - base64 编码的图片数据（不含 data URL 前缀）
     * @param mimeType - MIME 类型
     * @param originalName - 可选原始文件名（用于保留文件扩展名）
     * @param prefix - 文件名前缀
     */
    public static async saveBase64(
        base64: string,
        mimeType: string,
        originalName?: string,
        prefix: string = 'screenshot',
    ): Promise<string | undefined> {
        const buffer = Buffer.from(base64, 'base64');
        // 如果有原始文件名，尝试保留扩展名
        if (originalName) {
            const origExt = path.extname(originalName).toLowerCase();
            if (origExt && ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(origExt)) {
                return (await this.save(buffer, `image/${origExt.slice(1)}`, prefix))?.relativePath;
            }
        }
        return (await this.save(buffer, mimeType, prefix))?.relativePath;
    }

    /**
     * 列举 ImageDir 中所有图片，按修改时间倒序排列。
     */
    public static list(): ImageInfo[] {
        const dir = getImageDir();
        if (!dir || !fs.existsSync(dir)) {
            return [];
        }

        const files: ImageInfo[] = [];
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return [];
        }

        for (const entry of entries) {
            if (!entry.isFile()) { continue; }
            const ext = path.extname(entry.name).toLowerCase();
            if (!IMAGE_EXTENSIONS.has(ext)) { continue; }
            const absolutePath = path.join(dir, entry.name);
            try {
                const stat = fs.statSync(absolutePath);
                files.push({
                    name: entry.name,
                    absolutePath,
                    relativePath: this._toRelativePath(absolutePath),
                    mtime: stat.mtimeMs,
                });
            } catch {
                // 跳过 iCloud 占位文件等无法访问的文件
            }
        }

        files.sort((a, b) => b.mtime - a.mtime);
        return files;
    }

    /**
     * 删除图片文件（接受相对路径或绝对路径）。
     * @param pathInput - 相对路径（如 "images/xxx.png"）或绝对路径
     */
    public static async delete(pathInput: string): Promise<void> {
        const absolutePath = path.isAbsolute(pathInput)
            ? pathInput
            : this._resolveAbsolute(pathInput);

        if (!absolutePath) {
            return;
        }
        try {
            await vscode.workspace.fs.delete(vscode.Uri.file(absolutePath));
        } catch (err) {
            void vscode.window.showErrorMessage(`删除图片失败：${path.basename(absolutePath)}`);
            console.error('[ImageStorageService] delete error:', err);
        }
    }

    /**
     * 将 "ImageDir/xxx.png" 别名路径解析为 vscode.Uri（绝对路径）。
     * @param pathInput - 别名路径（如 "ImageDir/xxx.png"）或绝对路径
     */
    public static resolve(pathInput: string): vscode.Uri | undefined {
        const absolutePath = this._resolveAbsolute(pathInput);
        return absolutePath ? vscode.Uri.file(absolutePath) : undefined;
    }

    /**
     * 获取 ImageDir 的绝对路径（用于 FileSystemWatcher 等）。
     */
    public static getImageDirUri(): vscode.Uri | undefined {
        const dir = getImageDir();
        return dir ? vscode.Uri.file(dir) : undefined;
    }

    // ── 私有辅助 ────────────────────────────────────────────────────────────

    /**
     * 将图片绝对路径转为 "ImageDir/filename" 别名路径。
     * 图片始终保存在 imageDir 内，只取文件名部分拼前缀。
     */
    private static _toRelativePath(absolutePath: string): string {
        return `${IMAGE_DIR_PREFIX}/${path.basename(absolutePath)}`;
    }

    /**
     * 将路径解析为绝对路径：
     * - 绝对路径 → 直接返回
     * - "ImageDir/xxx.png" → {actualImageDir}/xxx.png
     */
    private static _resolveAbsolute(pathInput: string): string | undefined {
        if (path.isAbsolute(pathInput)) { return pathInput; }
        const prefix = `${IMAGE_DIR_PREFIX}/`;
        const imageDir = getImageDir();
        if (!imageDir) { return undefined; }
        if (pathInput.startsWith(prefix)) {
            return path.join(imageDir, pathInput.slice(prefix.length));
        }
        // 兼容旧格式：纯文件名或其他相对路径直接拼 imageDir
        return path.join(imageDir, path.basename(pathInput));
    }

    private static _extFromMime(mimeType: string): string {
        const map: Record<string, string> = {
            'image/png': '.png',
            'image/jpeg': '.jpg',
            'image/jpg': '.jpg',
            'image/gif': '.gif',
            'image/webp': '.webp',
            'image/svg+xml': '.svg',
        };
        return map[mimeType] ?? '.png';
    }

    private static _generateFileName(prefix: string, ext: string): string {
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
        const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
        return `${prefix}_${date}_${time}${ext}`;
    }
}
