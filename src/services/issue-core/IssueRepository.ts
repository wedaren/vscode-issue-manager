import * as path from "node:path";
import * as jsYaml from "js-yaml";
import type { Storage } from "./Storage";
import type { FrontmatterData, IssueMarkdownCore } from "./types";
import {
    extractFrontmatterAndBody,
    extractIssueTitleFromFrontmatter,
    extractTitleFromContent,
} from "./frontmatter";
import { generateFileName, getTimestampFromFileName } from "./fileNaming";
import { IssueNotFoundError } from "./errors";

/**
 * Issue markdown 的 CRUD 仓库。
 *
 * - 不带缓存:每个查询都走 storage 真实读盘。扩展端如需缓存,由扩展端单独维护。
 * - 不发事件:扩展端的 TreeView 刷新等机制由 adapter 层处理。
 * - 路径约定:`fileName` 总是相对 `issueDir` 的文件名(不含目录前缀)。
 */
export class IssueRepository {
    constructor(
        private readonly storage: Storage,
        private readonly issueDir: string,
    ) {}

    /** 解析 fileName 得到绝对路径。fileName 不允许包含路径分隔符。 */
    private absPath(fileName: string): string {
        if (fileName.includes("/") || fileName.includes("\\")) {
            // 仅允许根级文件名;调用方必须先 basename
            throw new Error(`fileName must be a basename without directory: "${fileName}"`);
        }
        return path.join(this.issueDir, fileName);
    }

    private toCore(fileName: string, content: string, mtime: number, statCtime: number): IssueMarkdownCore {
        const { frontmatter, body } = extractFrontmatterAndBody(content);
        let title = extractIssueTitleFromFrontmatter(frontmatter);
        if (!title) {
            const t = extractTitleFromContent(body);
            if (t) { title = t; }
        }
        if (!title) { title = path.basename(fileName, ".md"); }
        const ctime = getTimestampFromFileName(fileName) ?? statCtime;
        return {
            absPath: this.absPath(fileName),
            fileName,
            title,
            frontmatter,
            mtime,
            ctime,
        };
    }

    /** 列出 issueDir 根目录下所有 .md 文件,按 mtime 或 ctime 降序。 */
    async getAll(opts: { sortBy?: "mtime" | "ctime" } = {}): Promise<IssueMarkdownCore[]> {
        const sortBy = opts.sortBy ?? "mtime";
        const fileNames = await this.storage.listMarkdownFiles(this.issueDir);
        const results = await Promise.all(
            fileNames.map(async fileName => {
                try {
                    return await this.get(fileName);
                } catch {
                    return null;
                }
            }),
        );
        const items = results.filter((x): x is IssueMarkdownCore => x !== null);
        items.sort((a, b) => (sortBy === "ctime" ? b.ctime - a.ctime : b.mtime - a.mtime));
        return items;
    }

    /** 读取单个 issue 的元数据(标题 + frontmatter + 时间)。文件不存在返回 null。 */
    async get(fileName: string): Promise<IssueMarkdownCore | null> {
        const abs = this.absPath(fileName);
        if (!(await this.storage.exists(abs))) {
            return null;
        }
        const [content, st] = await Promise.all([
            this.storage.readText(abs),
            this.storage.stat(abs),
        ]);
        return this.toCore(fileName, content, st.mtime, st.ctime);
    }

    /** 读取原始全文(含 frontmatter)。 */
    async getRaw(fileName: string): Promise<string> {
        const abs = this.absPath(fileName);
        if (!(await this.storage.exists(abs))) {
            throw new IssueNotFoundError(fileName);
        }
        return this.storage.readText(abs);
    }

    /** 读取仅正文(去除 frontmatter)。 */
    async getContent(fileName: string): Promise<string> {
        const raw = await this.getRaw(fileName);
        const { body } = extractFrontmatterAndBody(raw);
        return body;
    }

    /**
     * 创建一个新 issue 文件。
     * - 文件名由 `generateFileName()` 自动生成
     * - 写入 `issueDir`(已通过 ensureDir 保证存在)
     * - 失败抛错;成功返回 fileName 与 absPath
     */
    async create(opts: {
        frontmatter?: Partial<FrontmatterData> | null;
        body?: string;
    }): Promise<{ fileName: string; absPath: string }> {
        const { frontmatter = null, body = "" } = opts;
        await this.storage.ensureDir(this.issueDir);

        const fileName = generateFileName();
        const abs = this.absPath(fileName);
        const fmYaml = frontmatter
            ? jsYaml.dump(frontmatter, { flowLevel: -1, lineWidth: -1 }).trim()
            : null;
        const content = fmYaml ? `---\n${fmYaml}\n---\n${body}` : body;
        await this.storage.writeText(abs, content);
        return { fileName, absPath: abs };
    }

    /**
     * 更新指定 issue 的 frontmatter,只替换或添加 patch 中的字段(浅合并)。
     * 返回 true 表示成功。文件不存在抛 IssueNotFoundError。
     */
    async updateFrontmatter(fileName: string, patch: Partial<FrontmatterData>): Promise<boolean> {
        const raw = await this.getRaw(fileName);
        const { frontmatter, body } = extractFrontmatterAndBody(raw);
        const fm: FrontmatterData = (frontmatter ? { ...frontmatter } : {}) as FrontmatterData;
        for (const [k, v] of Object.entries(patch)) {
            (fm as Record<string, unknown>)[k] = v;
        }
        const fmYaml = jsYaml.dump(fm, { flowLevel: -1, lineWidth: -1 }).trim();
        const newContent = `---\n${fmYaml}\n---\n${body}`;
        if (newContent === raw) { return true; }
        await this.storage.writeText(this.absPath(fileName), newContent);
        return true;
    }

    /**
     * 更新指定 issue 的正文,保留原 frontmatter。
     * - `append=false` (默认): 完整替换正文
     * - `append=true`: 追加到现有正文末尾
     */
    async updateBody(
        fileName: string,
        newBody: string,
        opts: { append?: boolean } = {},
    ): Promise<boolean> {
        const raw = await this.getRaw(fileName);
        const { frontmatter, body } = extractFrontmatterAndBody(raw);
        const finalBody = opts.append ? (body + (body.endsWith("\n") ? "" : "\n") + newBody) : newBody;
        const fm: FrontmatterData | null = frontmatter ? { ...frontmatter } : null;
        const fmYaml = fm ? jsYaml.dump(fm, { flowLevel: -1, lineWidth: -1 }).trim() : null;
        const newContent = fmYaml ? `---\n${fmYaml}\n---\n${finalBody}` : finalBody;
        if (newContent === raw) { return true; }
        await this.storage.writeText(this.absPath(fileName), newContent);
        return true;
    }

    /** 删除指定 issue。文件不存在视为成功(幂等)。 */
    async delete(fileName: string): Promise<boolean> {
        const abs = this.absPath(fileName);
        await this.storage.delete(abs);
        return true;
    }
}
