import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Storage } from "../Storage";

/**
 * Storage 的纯 node 实现。供独立 MCP server 进程使用。
 * **不依赖 vscode**。
 */
export class NodeFsStorage implements Storage {
    async readText(absPath: string): Promise<string> {
        return fs.readFile(absPath, "utf-8");
    }

    async writeText(absPath: string, content: string): Promise<void> {
        await fs.mkdir(path.dirname(absPath), { recursive: true });
        await fs.writeFile(absPath, content, "utf-8");
    }

    async stat(absPath: string): Promise<{ mtime: number; ctime: number }> {
        const s = await fs.stat(absPath);
        return { mtime: s.mtimeMs, ctime: s.ctimeMs };
    }

    async listMarkdownFiles(dir: string): Promise<string[]> {
        try {
            const entries = await fs.readdir(dir, { withFileTypes: true, encoding: "utf-8" });
            return entries
                .filter(e => e.isFile() && e.name.endsWith(".md"))
                .map(e => e.name);
        } catch (err: unknown) {
            if ((err as NodeJS.ErrnoException).code === "ENOENT") {
                return [];
            }
            throw err;
        }
    }

    async delete(absPath: string): Promise<void> {
        try {
            await fs.unlink(absPath);
        } catch (err: unknown) {
            if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
                throw err;
            }
        }
    }

    async exists(absPath: string): Promise<boolean> {
        try {
            await fs.stat(absPath);
            return true;
        } catch {
            return false;
        }
    }

    async ensureDir(absPath: string): Promise<void> {
        await fs.mkdir(absPath, { recursive: true });
    }
}
