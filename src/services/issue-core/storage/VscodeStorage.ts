import * as vscode from "vscode";
import * as path from "path";
import type { Storage } from "../Storage";

/**
 * Storage 的 VS Code 扩展实现。供扩展进程使用。
 *
 * 与 NodeFsStorage 不同,这一份依赖 `vscode.workspace.fs`。
 * 仅在扩展进程内导入此文件;MCP server 切勿走到这里。
 */
export class VscodeStorage implements Storage {
    async readText(absPath: string): Promise<string> {
        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(absPath));
        return Buffer.from(bytes).toString("utf-8");
    }

    async writeText(absPath: string, content: string): Promise<void> {
        const dir = path.dirname(absPath);
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(dir));
        await vscode.workspace.fs.writeFile(vscode.Uri.file(absPath), Buffer.from(content, "utf-8"));
    }

    async stat(absPath: string): Promise<{ mtime: number; ctime: number }> {
        const s = await vscode.workspace.fs.stat(vscode.Uri.file(absPath));
        return { mtime: s.mtime, ctime: s.ctime };
    }

    async listMarkdownFiles(dir: string): Promise<string[]> {
        try {
            const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dir));
            return entries
                .filter(([name, type]) => type === vscode.FileType.File && name.endsWith(".md"))
                .map(([name]) => name);
        } catch (err) {
            if (err instanceof vscode.FileSystemError && err.code === "FileNotFound") {
                return [];
            }
            throw err;
        }
    }

    async delete(absPath: string): Promise<void> {
        try {
            await vscode.workspace.fs.delete(vscode.Uri.file(absPath));
        } catch (err) {
            if (err instanceof vscode.FileSystemError && err.code === "FileNotFound") {
                return;
            }
            throw err;
        }
    }

    async exists(absPath: string): Promise<boolean> {
        try {
            await vscode.workspace.fs.stat(vscode.Uri.file(absPath));
            return true;
        } catch {
            return false;
        }
    }

    async ensureDir(absPath: string): Promise<void> {
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(absPath));
    }
}
