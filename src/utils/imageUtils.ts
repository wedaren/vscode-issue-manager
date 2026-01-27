import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';
import { getIssueDir } from '../config';

/**
 * 图片处理工具类
 */
export class ImageUtils {
    /**
     * Base64 图片大小限制(字节),超过此大小的图片将被提取保存
     * 默认 50KB
     */
    private static readonly BASE64_SIZE_THRESHOLD = 50 * 1024;

    /**
     * 检测字符串是否为 base64 图片
     */
    public static isBase64Image(src: string): boolean {
        return /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/i.test(src);
    }

    /**
     * 获取 base64 图片的实际大小(字节)
     */
    public static getBase64Size(base64Data: string): number {
        const base64Content = base64Data.split(',')[1] || base64Data;
        // Base64 编码后的大小约为原始大小的 4/3
        // 精确计算需要考虑 padding
        const padding = (base64Content.match(/=/g) || []).length;
        return Math.floor((base64Content.length * 3) / 4) - padding;
    }

    /**
     * 从 base64 数据 URL 中提取图片格式
     */
    public static extractImageFormat(dataUrl: string): string {
        const match = dataUrl.match(/^data:image\/([a-z+]+);base64,/i);
        if (!match) {
            return 'png';
        }
        const format = match[1].toLowerCase();
        return format === 'svg+xml' ? 'svg' : format;
    }

    /**
     * 生成图片的哈希名称
     */
    public static generateImageHash(base64Data: string): string {
        const base64Content = base64Data.split(',')[1] || base64Data;
        const hash = crypto.createHash('sha256');
        hash.update(base64Content);
        return hash.digest('hex').substring(0, 16);
    }

    /**
     * 保存 base64 图片到本地文件
     * @param base64Data 完整的 base64 数据 URL (data:image/png;base64,...)
     * @param alt 图片的 alt 文本,用于生成文件名
     * @param contextFilePath 可选:正在创建的 Markdown 文件路径
     * @returns 相对于 Markdown 文件的图片路径
     */
    public static async saveBase64Image(
        base64Data: string, 
        alt: string = '',
        contextFilePath?: string
    ): Promise<string | null> {
        try {
            // 提取 base64 内容
            const base64Content = base64Data.split(',')[1];
            if (!base64Content) {
                return null;
            }

            // 解码 base64
            const buffer = Buffer.from(base64Content, 'base64');

            // 获取图片格式
            const format = this.extractImageFormat(base64Data);
            const extension = format === 'jpeg' ? 'jpg' : format;

            // 生成文件名
            const hash = this.generateImageHash(base64Data);
            const sanitizedAlt = alt ? this.sanitizeFilename(alt).substring(0, 30) + '-' : '';
            const filename = `${sanitizedAlt}${hash}.${extension}`;

            let assetsDir: string;
            let relativePath: string;

            if (contextFilePath) {
                // 方案 B: 在 Markdown 文件同级创建 {filename}.assets 目录
                const mdDir = path.dirname(contextFilePath);
                const mdBasename = path.basename(contextFilePath, path.extname(contextFilePath));
                assetsDir = path.join(mdDir, `${mdBasename}.assets`);
                relativePath = `./${mdBasename}.assets/${filename}`;
            } else {
                // 方案 A: 回退方案 - 在 issue 目录根创建统一的 .assets 目录
                const issuesDir = getIssueDir();
                if (!issuesDir) {
                    throw new Error('未配置 issue 目录');
                }
                assetsDir = path.join(issuesDir, '.assets');
                relativePath = `.assets/${filename}`;
            }
            
            // 确保 assets 目录存在
            const assetsDirUri = vscode.Uri.file(assetsDir);
            try {
                await vscode.workspace.fs.stat(assetsDirUri);
            } catch {
                await vscode.workspace.fs.createDirectory(assetsDirUri);
            }

            // 保存文件
            const filePath = path.join(assetsDir, filename);
            const fileUri = vscode.Uri.file(filePath);
            await vscode.workspace.fs.writeFile(fileUri, buffer);

            // 返回相对路径
            return relativePath;
        } catch (error) {
            console.error('保存 base64 图片失败:', error);
            return null;
        }
    }

    /**
     * 清理文件名,移除非法字符
     */
    private static sanitizeFilename(filename: string): string {
        return filename
            .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
            .replace(/\s+/g, '-')
            .replace(/^\.+/, '')
            .replace(/\.+$/, '');
    }

    /**
     * 处理图片源,根据配置决定是否保存 base64 图片
     * @param src 图片源
     * @param alt 图片 alt 文本
     * @param options 处理选项
     * @param contextFilePath 可选:正在创建的 Markdown 文件路径
     * @returns 处理后的图片源,如果返回 null 表示应移除图片
     */
    public static async processImageSource(
        src: string,
        alt: string,
        options: ImageProcessOptions = {},
        contextFilePath?: string
    ): Promise<string | null> {
        // 如果不是 base64 图片,直接返回
        if (!this.isBase64Image(src)) {
            return src;
        }

        // 获取图片大小
        const size = this.getBase64Size(src);

        // 根据配置决定处理策略
        const sizeThreshold = options.base64SizeThreshold ?? this.BASE64_SIZE_THRESHOLD;
        const extractLargeImages = options.extractBase64Images ?? true;
        const removeLargeImages = options.removeBase64Images ?? false;

        // 如果图片小于阈值,保留 base64
        if (size < sizeThreshold) {
            return src;
        }

        // 图片超过阈值
        if (removeLargeImages) {
            // 移除图片,返回 null
            return null;
        }

        if (extractLargeImages) {
            // 尝试保存图片
            const savedPath = await this.saveBase64Image(src, alt, contextFilePath);
            if (savedPath) {
                return savedPath;
            }
            // 保存失败,根据配置决定是保留还是移除
            return options.fallbackToBase64 !== false ? src : null;
        }

        // 默认保留 base64
        return src;
    }
}

/**
 * 图片处理选项
 */
export interface ImageProcessOptions {
    /**
     * Base64 图片大小阈值(字节)
     * 默认 50KB
     */
    base64SizeThreshold?: number;

    /**
     * 是否提取大型 base64 图片到本地文件
     * 默认 true
     */
    extractBase64Images?: boolean;

    /**
     * 是否移除大型 base64 图片
     * 默认 false
     */
    removeBase64Images?: boolean;

    /**
     * 当提取失败时是否回退到保留 base64
     * 默认 true
     */
    fallbackToBase64?: boolean;
}
