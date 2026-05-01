/**
 * 抽象的文件存储接口。
 *
 * 设计目的:让 service 层既能在 VS Code 扩展进程里运行(用 `vscode.workspace.fs`),
 * 也能在独立 MCP server 进程里运行(用 `node:fs/promises`)。
 *
 * **不能依赖 vscode 模块**。
 *
 * 路径约定:
 * - 所有 `absPath` 必须是绝对路径(POSIX 或 Win32)
 * - `mtime` / `ctime` 单位是毫秒
 */
export interface Storage {
    /** 读取文件文本内容(utf-8) */
    readText(absPath: string): Promise<string>;

    /** 写入文件文本内容(utf-8)。如果父目录不存在则自动创建。 */
    writeText(absPath: string, content: string): Promise<void>;

    /** 获取文件的 mtime 与 ctime(毫秒)。文件不存在时抛错。 */
    stat(absPath: string): Promise<{ mtime: number; ctime: number }>;

    /**
     * 列出指定目录**根级**的所有 markdown 文件名(仅 *.md,不含子目录,不含点开头的隐藏目录)。
     * @returns 文件名数组(不含路径前缀)
     */
    listMarkdownFiles(dir: string): Promise<string[]>;

    /** 删除文件。文件不存在时静默忽略。 */
    delete(absPath: string): Promise<void>;

    /** 文件是否存在 */
    exists(absPath: string): Promise<boolean>;

    /** 确保目录存在(递归创建) */
    ensureDir(absPath: string): Promise<void>;
}
