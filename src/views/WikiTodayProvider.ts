import * as vscode from 'vscode';
import * as path from 'path';
import { getIssueDir } from '../config';
import { getAllIssueMarkdowns, type IssueMarkdown, extractFrontmatterAndBody } from '../data/IssueMarkdowns';

/**
 * Wiki 今日视图 ─ Karpathy LLM Knowledge Base 的"第二大脑"入口。
 *
 * 三组(默认展开):
 *   ✨ 自动捕获 (今日新增的 raw/* 笔记)
 *   📚 已编译到 wiki (今日新增的 wiki/* 笔记)
 *   🌱 桩文章 (wiki/* 中正文 < 200 字的全部,Top 15)
 * 第四组 📅 最近 7 天 仅在前两组都为空时显示,作为冷启动的引导。
 */

const STUB_BODY_THRESHOLD = 200;

class GroupItem extends vscode.TreeItem {
    constructor(
        public readonly key: 'today_raw' | 'today_wiki' | 'stubs' | 'recent',
        label: string,
        count: number,
        public readonly issues: IssueMarkdown[],
    ) {
        super(`${label} (${count})`, vscode.TreeItemCollapsibleState.Expanded);
        this.contextValue = `wikiGroup-${key}`;
        switch (key) {
            case 'today_raw':
                this.iconPath = new vscode.ThemeIcon('sparkle');
                break;
            case 'today_wiki':
                this.iconPath = new vscode.ThemeIcon('book');
                break;
            case 'stubs':
                this.iconPath = new vscode.ThemeIcon('symbol-event');
                break;
            case 'recent':
                this.iconPath = new vscode.ThemeIcon('history');
                this.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
                break;
        }
    }
}

class WikiNoteItem extends vscode.TreeItem {
    constructor(
        public readonly issue: IssueMarkdown,
        public readonly variant: 'raw' | 'wiki' | 'stub',
    ) {
        const fileName = path.basename(issue.uri.fsPath);
        // 标题去掉 raw/  wiki/  前缀只展示 category/name 让树更清爽
        const title = issue.title.replace(/^(raw|wiki)\//, '');
        super(title, vscode.TreeItemCollapsibleState.None);
        this.id = `wiki-note:${fileName}`;
        this.resourceUri = issue.uri;
        const time = new Date(issue.mtime);
        const hh = String(time.getHours()).padStart(2, '0');
        const mm = String(time.getMinutes()).padStart(2, '0');
        this.description = variant === 'stub' ? '<200字' : `${hh}:${mm}`;
        this.tooltip = new vscode.MarkdownString(
            `**${issue.title}**\n\n\`${fileName}\`\n\n最后更新: ${time.toLocaleString()}`,
        );
        this.command = {
            command: 'vscode.open',
            title: '打开',
            arguments: [issue.uri],
        };
        this.contextValue = variant === 'raw' ? 'wikiRawNote'
            : variant === 'wiki' ? 'wikiArticle'
                : 'wikiStub';
    }
}

export class WikiTodayProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    /** 缓存当次扫描结果,getChildren 时复用 */
    private cache: {
        rawToday: IssueMarkdown[];
        wikiToday: IssueMarkdown[];
        stubs: IssueMarkdown[];
        recent: IssueMarkdown[];
    } | null = null;

    constructor(private readonly context: vscode.ExtensionContext) {}

    refresh(): void {
        this.cache = null;
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(el: vscode.TreeItem): vscode.TreeItem { return el; }

    async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
        if (!getIssueDir()) {
            return [new vscode.TreeItem('请先配置 issueDir', vscode.TreeItemCollapsibleState.None)];
        }
        if (!element) {
            // 根节点
            const data = await this.loadData();
            const groups: vscode.TreeItem[] = [];

            const todayEmpty = data.rawToday.length === 0 && data.wikiToday.length === 0;

            if (data.rawToday.length > 0 || !todayEmpty) {
                groups.push(new GroupItem('today_raw', '✨ 今日自动捕获', data.rawToday.length, data.rawToday));
            }
            if (data.wikiToday.length > 0 || !todayEmpty) {
                groups.push(new GroupItem('today_wiki', '📚 今日已编译', data.wikiToday.length, data.wikiToday));
            }
            if (data.stubs.length > 0) {
                groups.push(new GroupItem('stubs', '🌱 桩文章(待扩展)', data.stubs.length, data.stubs));
            }
            // 冷启动引导:今日两组都空时,展示最近 7 天
            if (todayEmpty) {
                if (data.recent.length === 0 && data.stubs.length === 0) {
                    return [
                        new InfoItem(
                            '🪴 知识库还是空的',
                            'wiki/  raw/ 都没有数据。可以让"知识编译员"角色跑起来,或在对话里问问题让 hook 自动捕获。',
                        ),
                    ];
                }
                groups.push(new GroupItem('recent', '📅 最近 7 天 raw + wiki', data.recent.length, data.recent));
            }
            return groups;
        }
        if (element instanceof GroupItem) {
            const variant: 'raw' | 'wiki' | 'stub' =
                element.key === 'today_raw' ? 'raw'
                    : element.key === 'today_wiki' ? 'wiki'
                        : element.key === 'stubs' ? 'stub'
                            : 'wiki';
            return element.issues.map(i => new WikiNoteItem(i, variant));
        }
        return [];
    }

    private async loadData(): Promise<NonNullable<WikiTodayProvider['cache']>> {
        if (this.cache) { return this.cache; }
        const all = await getAllIssueMarkdowns({});
        const rawAll = all.filter(i => typeof i.title === 'string' && i.title.startsWith('raw/'));
        const wikiAll = all.filter(i => typeof i.title === 'string' && i.title.startsWith('wiki/'));

        const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
        const todayMs = startOfToday.getTime();
        const rawToday = rawAll.filter(i => i.mtime >= todayMs).sort((a, b) => b.mtime - a.mtime);
        const wikiToday = wikiAll.filter(i => i.mtime >= todayMs).sort((a, b) => b.mtime - a.mtime);

        // 桩文章:正文 < 200 字。需读 body,限制到 wikiAll 前 150 条避免大库扫描卡顿。
        const stubs: IssueMarkdown[] = [];
        const candidatesForStub = wikiAll.slice(0, 150);
        for (const issue of candidatesForStub) {
            try {
                const bytes = await vscode.workspace.fs.readFile(issue.uri);
                const { body } = extractFrontmatterAndBody(Buffer.from(bytes).toString('utf8'));
                if (body.trim().length < STUB_BODY_THRESHOLD) {
                    stubs.push(issue);
                    if (stubs.length >= 15) { break; }
                }
            } catch {
                // 跳过读取失败
            }
        }

        // 最近 7 天 raw + wiki(冷启动引导)
        const sevenDaysMs = todayMs - 6 * 24 * 60 * 60 * 1000;
        const recent = [...rawAll, ...wikiAll]
            .filter(i => i.mtime >= sevenDaysMs)
            .sort((a, b) => b.mtime - a.mtime)
            .slice(0, 30);

        this.cache = { rawToday, wikiToday, stubs, recent };
        return this.cache;
    }
}

class InfoItem extends vscode.TreeItem {
    constructor(label: string, tooltip: string) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.tooltip = new vscode.MarkdownString(tooltip);
        this.iconPath = new vscode.ThemeIcon('info');
        this.contextValue = 'wikiInfo';
    }
}
