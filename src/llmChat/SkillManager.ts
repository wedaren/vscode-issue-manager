/**
 * Agent Skills 管理器
 *
 * 遵循 agentskills.io 开放标准，扫描 skill 目录、解析 SKILL.md、
 * 提供按名称查询的接口，供 contextPipeline 注入到 system prompt。
 *
 * Skill 目录搜索顺序（高优先级覆盖低优先级）：
 *   1. <issueDir>/.skills/<name>/SKILL.md
 *   2. ~/.agents/skills/<name>/SKILL.md（个人级，跨项目共享）
 *
 * SKILL.md 格式（agentskills.io spec）：
 *   ---
 *   name: wecom
 *   description: 企业微信操作
 *   ---
 *   Markdown instructions...
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { Logger } from '../core/utils/Logger';

const logger = Logger.getInstance();

/** Skill 元数据（从 SKILL.md frontmatter 解析） */
export interface SkillMeta {
    /** Skill 名称（目录名，小写 + 连字符） */
    name: string;
    /** 描述 */
    description: string;
    /** 完整指令内容（SKILL.md body） */
    body: string;
    /** SKILL.md 文件的完整路径 */
    filePath: string;
    /** 来源层级 */
    source: 'project' | 'personal';
    /** 可选：license */
    license?: string;
    /** 可选：compatibility */
    compatibility?: string;
    /** 可选：依赖的工具名称列表（逗号分隔解析自 allowed-tools） */
    allowedTools?: string[];
}

/** SKILL.md frontmatter 解析结果 */
interface SkillFrontmatter {
    name?: string;
    description?: string;
    license?: string;
    compatibility?: string;
    metadata?: Record<string, string>;
    'allowed-tools'?: string;
}

export class SkillManager implements vscode.Disposable {
    private static _instance: SkillManager | undefined;
    private readonly _skills = new Map<string, SkillMeta>();
    private _issueDir: string | undefined;
    private _initialized = false;
    private readonly _disposables: vscode.Disposable[] = [];
    private _watcherDebounce: ReturnType<typeof setTimeout> | undefined;

    private readonly _onDidChange = new vscode.EventEmitter<void>();
    /** skill 列表变更事件（供树视图刷新使用） */
    readonly onDidChange: vscode.Event<void> = this._onDidChange.event;

    private constructor() {}

    static getInstance(): SkillManager {
        if (!SkillManager._instance) {
            SkillManager._instance = new SkillManager();
        }
        return SkillManager._instance;
    }

    /** 从 skill name 提取 vendor 前缀（第一个 - 之前的部分） */
    static extractVendor(name: string): string {
        const idx = name.indexOf('-');
        return idx > 0 ? name.slice(0, idx) : name;
    }

    /** 初始化：扫描 skill 目录并启动文件监听 */
    async initialize(issueDir: string): Promise<void> {
        if (this._initialized) { return; }
        this._initialized = true;
        this._issueDir = issueDir;
        await this.scan();
        this.startFileWatchers();
    }

    /** 重新扫描 skill 目录 */
    async rescan(): Promise<void> {
        this._skills.clear();
        await this.scan();
        this._onDidChange.fire();
    }

    dispose(): void {
        if (this._watcherDebounce) { clearTimeout(this._watcherDebounce); }
        for (const d of this._disposables) { d.dispose(); }
        this._onDidChange.dispose();
        SkillManager._instance = undefined;
    }

    /** 获取所有已加载的 skill 元数据 */
    getAllSkills(): SkillMeta[] {
        return [...this._skills.values()];
    }

    /** 按名称获取 skill */
    getSkill(name: string): SkillMeta | undefined {
        return this._skills.get(name);
    }

    /** 按名称列表获取多个 skill 的完整指令 */
    getSkillBodies(names: string[]): Array<{ name: string; description: string; body: string }> {
        const results: Array<{ name: string; description: string; body: string }> = [];
        for (const name of names) {
            const skill = this._skills.get(name);
            if (skill) {
                results.push({ name: skill.name, description: skill.description, body: skill.body });
            } else {
                logger.warn(`[SkillManager] 未找到 skill: "${name}"`);
            }
        }
        return results;
    }

    /**
     * 展开 skill 名称列表：精确匹配优先，不匹配时作为 vendor 前缀展开。
     *   "wecomcli" → [wecomcli-create-meeting, wecomcli-edit-meeting, ...]
     *   "microsoft-foundry" → [microsoft-foundry]
     */
    resolveNames(names: string[]): string[] {
        const result: string[] = [];
        const seen = new Set<string>();
        for (const name of names) {
            if (this._skills.has(name)) {
                // 精确匹配
                if (!seen.has(name)) { result.push(name); seen.add(name); }
            } else {
                // vendor 前缀展开：找所有以 name- 开头的 skill
                const prefix = name + '-';
                for (const key of this._skills.keys()) {
                    if (key.startsWith(prefix) && !seen.has(key)) {
                        result.push(key);
                        seen.add(key);
                    }
                }
            }
        }
        return result;
    }

    /** 获取 vendor 分组：{ vendor → SkillMeta[] } */
    getVendorGroups(): Map<string, SkillMeta[]> {
        const groups = new Map<string, SkillMeta[]>();
        for (const skill of this._skills.values()) {
            const vendor = SkillManager.extractVendor(skill.name);
            if (!groups.has(vendor)) { groups.set(vendor, []); }
            groups.get(vendor)!.push(skill);
        }
        return groups;
    }

    /** 将 ~/.agents/skills/ 下的 skill 复制到 <issueDir>/.skills/，已存在的跳过 */
    async importPersonalToProject(): Promise<{ copied: number; skipped: number }> {
        if (!this._issueDir) { return { copied: 0, skipped: 0 }; }

        const personalDir = path.join(os.homedir(), '.agents', 'skills');
        const projectDir = path.join(this._issueDir, '.skills');

        let entries: [string, vscode.FileType][];
        try {
            entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(personalDir));
        } catch { return { copied: 0, skipped: 0 }; }

        // 确保项目 .skills 目录存在
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(projectDir));

        let copied = 0;
        let skipped = 0;
        for (const [name, type] of entries) {
            if (type !== vscode.FileType.Directory) { continue; }
            const targetDir = path.join(projectDir, name);
            try {
                await vscode.workspace.fs.stat(vscode.Uri.file(targetDir));
                skipped++; // 已存在
            } catch {
                // 不存在，复制整个目录
                await vscode.workspace.fs.copy(
                    vscode.Uri.file(path.join(personalDir, name)),
                    vscode.Uri.file(targetDir),
                );
                copied++;
            }
        }

        logger.info(`[SkillManager] 导入完成: copied=${copied}, skipped=${skipped}`);
        return { copied, skipped };
    }

    // ─── 内部扫描逻辑 ──────────────────────────────────────────

    private async scan(): Promise<void> {
        const dirs = this.getSkillDirs();

        // 低优先级先扫描，高优先级后扫描（覆盖同名）
        for (const { dir, source } of dirs) {
            await this.scanDir(dir, source);
        }

        logger.info(`[SkillManager] 已加载 ${this._skills.size} 个 skill: ${[...this._skills.keys()].join(', ') || '(无)'}`);
    }

    /** 返回 skill 目录列表（按优先级从低到高） */
    private getSkillDirs(): Array<{ dir: string; source: 'personal' | 'project' }> {
        const dirs: Array<{ dir: string; source: 'personal' | 'project' }> = [];

        // 个人级：~/.agents/skills/（跨项目共享）
        const personalDir = path.join(os.homedir(), '.agents', 'skills');
        dirs.push({ dir: personalDir, source: 'personal' });

        // 项目级：<issueDir>/.skills/
        if (this._issueDir) {
            dirs.push({ dir: path.join(this._issueDir, '.skills'), source: 'project' });
        }

        return dirs;
    }

    /** 扫描单个目录下的所有 skill 子目录 */
    private async scanDir(dir: string, source: 'personal' | 'project'): Promise<void> {
        try {
            const dirUri = vscode.Uri.file(dir);
            const entries = await vscode.workspace.fs.readDirectory(dirUri);

            for (const [name, type] of entries) {
                if (type !== vscode.FileType.Directory) { continue; }

                const skillMdPath = path.join(dir, name, 'SKILL.md');
                try {
                    const raw = Buffer.from(
                        await vscode.workspace.fs.readFile(vscode.Uri.file(skillMdPath)),
                    ).toString('utf8');

                    const parsed = this.parseSkillMd(raw, name, skillMdPath, source);
                    if (parsed) {
                        this._skills.set(parsed.name, parsed);
                    }
                } catch {
                    // SKILL.md 不存在或读取失败，跳过
                }
            }
        } catch {
            // 目录不存在，静默跳过
        }
    }

    /** 解析 SKILL.md：提取 frontmatter + body */
    private parseSkillMd(
        raw: string,
        dirName: string,
        filePath: string,
        source: 'personal' | 'project',
    ): SkillMeta | null {
        const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw);
        if (!fmMatch) {
            // 无 frontmatter，整个内容作为 body
            return {
                name: dirName,
                description: raw.split('\n')[0]?.replace(/^#\s*/, '').trim() || dirName,
                body: raw.trim(),
                filePath,
                source,
            };
        }

        const fmRaw = fmMatch[1];
        const body = fmMatch[2].trim();
        const fm = this.parseSimpleYaml(fmRaw);

        const name = fm.name || dirName;
        const description = fm.description || body.split('\n')[0]?.replace(/^#\s*/, '').trim() || name;

        // 验证 name 格式（agentskills.io spec）
        if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(name) || name.includes('--')) {
            logger.warn(`[SkillManager] skill name "${name}" 不符合规范（小写字母+数字+连字符），已跳过`);
            return null;
        }

        // 解析 allowed-tools（逗号分隔的工具名列表）
        const allowedTools = fm['allowed-tools']
            ? fm['allowed-tools'].split(',').map(t => t.trim()).filter(Boolean)
            : undefined;

        return {
            name,
            description: description.slice(0, 1024),
            body,
            filePath,
            source,
            license: fm.license,
            compatibility: fm.compatibility,
            allowedTools,
        };
    }

    /** 简易 YAML 解析（仅支持顶层 key: value 字符串字段，够用于 SKILL.md frontmatter） */
    private parseSimpleYaml(raw: string): SkillFrontmatter {
        const result: Record<string, string> = {};
        for (const line of raw.split('\n')) {
            const match = /^(\w[\w-]*):\s*(.*)$/.exec(line);
            if (match) {
                result[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
            }
        }
        return result as unknown as SkillFrontmatter;
    }

    // ─── 文件监听 ────────────────────────────────────────────

    /** 监听 skill 目录中的文件变化，自动重新扫描 */
    private startFileWatchers(): void {
        for (const { dir } of this.getSkillDirs()) {
            try {
                const pattern = new vscode.RelativePattern(vscode.Uri.file(dir), '**/SKILL.md');
                const watcher = vscode.workspace.createFileSystemWatcher(pattern);
                const handler = () => this.scheduleRescan();
                this._disposables.push(
                    watcher,
                    watcher.onDidCreate(handler),
                    watcher.onDidChange(handler),
                    watcher.onDidDelete(handler),
                );
            } catch {
                // 目录不存在时 watcher 创建可能失败，静默跳过
            }
        }
    }

    private scheduleRescan(): void {
        if (this._watcherDebounce) { clearTimeout(this._watcherDebounce); }
        this._watcherDebounce = setTimeout(() => {
            this._skills.clear();
            void this.scan().then(() => this._onDidChange.fire());
        }, 1_000);
    }
}
