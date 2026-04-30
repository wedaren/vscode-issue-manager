import * as vscode from 'vscode';

/**
 * 双层缓存：内存 Map（同进程极快） + globalStorage 文件（跨重启）。
 *
 * key 形如 `mermaid/<hash>.svg`，value 是渲染产物字符串（SVG 文本或预留给 math 的 HTML）。
 */
export class DiagramCache {
    private memCache = new Map<string, string>();
    private cacheRoot: vscode.Uri;

    constructor(globalStorageUri: vscode.Uri) {
        this.cacheRoot = vscode.Uri.joinPath(globalStorageUri, 'diagram-cache');
    }

    private fileUri(key: string): vscode.Uri {
        return vscode.Uri.joinPath(this.cacheRoot, `${key}.svg`);
    }

    /** 缓存文件的绝对磁盘路径（用于喂给 ImageLightboxPanel） */
    fsPath(key: string): string {
        return this.fileUri(key).fsPath;
    }

    async get(key: string): Promise<string | undefined> {
        const cached = this.memCache.get(key);
        if (cached !== undefined) { return cached; }
        try {
            const buf = await vscode.workspace.fs.readFile(this.fileUri(key));
            const text = Buffer.from(buf).toString('utf8');
            this.memCache.set(key, text);
            return text;
        } catch {
            return undefined;
        }
    }

    async set(key: string, value: string): Promise<void> {
        this.memCache.set(key, value);
        try {
            await vscode.workspace.fs.createDirectory(this.cacheRoot);
            await vscode.workspace.fs.writeFile(this.fileUri(key), Buffer.from(value, 'utf8'));
        } catch (err) {
            console.error('[diagramPreview] cache write failed:', err);
        }
    }

    /** 仅查询内存缓存（不触磁盘），用于同步路径如 hover */
    peek(key: string): string | undefined {
        return this.memCache.get(key);
    }
}
