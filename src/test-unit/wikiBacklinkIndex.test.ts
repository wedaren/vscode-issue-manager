import * as assert from 'assert';
import * as path from 'path';
import { Uri, failMockRead, resetMockFs, workspace } from './mocks/vscode';
import type { IssueMarkdown } from '../data/IssueMarkdowns';

/**
 * wikiBacklinkIndex 并行化重构的回归测试。
 *
 * 被测模块 import 了 ../data/IssueMarkdowns（重模块，依赖 findFiles 等扩展宿主 API），
 * 这里在 require 被测模块之前，向 require.cache 预注入该模块绝对路径的 fake exports。
 */

const ISSUE_DIR = '/mock-issues';

/** 每个测试用例可重建的 fixture 列表（fake 模块引用同一引用） */
let fixtures: IssueMarkdown[] = [];
/** getAllIssueMarkdowns 被调用次数（用于 staleness 断言） */
let getAllCallCount = 0;

function fakeExtractFrontmatterAndBody(content: string): { frontmatter: null | Record<string, never>; body: string } {
    if (!content.startsWith('---')) {
        return { frontmatter: null, body: content };
    }
    const end = content.indexOf('\n---', 3);
    if (end === -1) {
        return { frontmatter: null, body: content };
    }
    return { frontmatter: {}, body: content.slice(end + 4) };
}

const fakeIssueMarkdowns = {
    getAllIssueMarkdowns: async (): Promise<IssueMarkdown[]> => {
        getAllCallCount++;
        return fixtures;
    },
    extractFrontmatterAndBody: fakeExtractFrontmatterAndBody,
    isIssueMarkdown: (item: unknown): boolean =>
        !!item && typeof item === 'object' && 'title' in item && 'uri' in item,
};

// 预注入 fake，随后再加载被测模块
const issueMarkdownsPath = require.resolve('../data/IssueMarkdowns');
require.cache[issueMarkdownsPath] = {
    id: issueMarkdownsPath,
    filename: issueMarkdownsPath,
    loaded: true,
    exports: fakeIssueMarkdowns,
    children: [],
    paths: [],
} as unknown as NodeModule;

const { WikiBacklinkIndex } = require('../wiki/wikiBacklinkIndex') as typeof import('../wiki/wikiBacklinkIndex');

function notePath(title: string): string {
    return path.join(ISSUE_DIR, `${title}.md`);
}

function makeNote(title: string): IssueMarkdown {
    return {
        title,
        uri: Uri.file(notePath(title)),
        mtime: 1,
        ctime: 1,
        frontmatter: null,
    } as IssueMarkdown;
}

describe('wikiBacklinkIndex', () => {
    beforeEach(async () => {
        resetMockFs();
        getAllCallCount = 0;
        fixtures = [];

        // 45 个 wiki 笔记，跨越 20 个一批的批次边界（0-19 / 20-39 / 40-44）
        for (let i = 0; i < 45; i++) {
            const num = String(i).padStart(2, '0');
            const title = `wiki/note-${num}`;
            let body = `正文引用 [[wiki/target-${i % 3}]]。`;
            if (i === 0) {
                // 同一文件内重复引用应去重；同时引用一个 raw 目标
                body = `[[wiki/target-0]] 重复 [[wiki/target-0]] 以及 [[raw/other]]。`;
            }
            // note-00 带 frontmatter，且 frontmatter 内含 [[...]]，用于验证只扫描 body
            const content = i === 0
                ? `---\ntags: [x]\nlink: "[[wiki/target-0]]"\n---\n${body}`
                : body;
            const note = makeNote(title);
            fixtures.push(note);
            await workspace.fs.writeFile(note.uri, Buffer.from(content, 'utf8'));
        }

        // 非 wiki/raw 前缀的笔记：即使引用了 target 也不应进入索引
        const outsider = makeNote('projects/p1');
        fixtures.push(outsider);
        await workspace.fs.writeFile(outsider.uri, Buffer.from('引用 [[wiki/target-0]]', 'utf8'));
    });

    it('backlinks 顺序与串行扫描一致：按文件顺序、文件内去重（跨批次边界）', async () => {
        const index = new WikiBacklinkIndex();
        await index.ensureBuilt();

        const expectedTarget0 = [] as string[];
        for (let i = 0; i < 45; i += 3) {
            expectedTarget0.push(`wiki/note-${String(i).padStart(2, '0')}`);
        }
        const actualTarget0 = index.getBacklinks('wiki/target-0').map((m: IssueMarkdown) => m.title);
        assert.deepStrictEqual(actualTarget0, expectedTarget0);

        // 文件内去重：note-00 引用了两次 target-0，只出现一次
        assert.strictEqual(actualTarget0.filter((t: string) => t === 'wiki/note-00').length, 1);

        // raw 目标同样被索引
        const rawBacklinks = index.getBacklinks('raw/other').map((m: IssueMarkdown) => m.title);
        assert.deepStrictEqual(rawBacklinks, ['wiki/note-00']);

        // frontmatter 中的 [[...]] 不参与索引（仅扫描 body）：target-0 不含来自 frontmatter 的额外条目
        // （note-00 的 frontmatter 含 "[[wiki/target-0]]"，body 去重后仍只计一次，上方已覆盖）
    });

    it('非 wiki/raw 前缀的笔记不进入索引', async () => {
        const index = new WikiBacklinkIndex();
        await index.ensureBuilt();

        assert.strictEqual(index.findByTitle('projects/p1'), undefined);
        const target0Sources = index.getBacklinks('wiki/target-0').map((m: IssueMarkdown) => m.title);
        assert.ok(!target0Sources.includes('projects/p1'));
        assert.strictEqual(index.findByTitle('wiki/note-00')?.title, 'wiki/note-00');
    });

    it('某个文件 readFile 抛错时被跳过，不影响其他结果', async () => {
        failMockRead(notePath('wiki/note-10'));

        const index = new WikiBacklinkIndex();
        await index.ensureBuilt();

        const target1Sources = index.getBacklinks('wiki/target-1').map((m: IssueMarkdown) => m.title);
        const expected = [] as string[];
        for (let i = 1; i < 45; i += 3) {
            if (i === 10) { continue; }
            expected.push(`wiki/note-${String(i).padStart(2, '0')}`);
        }
        assert.deepStrictEqual(target1Sources, expected);
        // byTitle 仍包含读取失败的文件（只有 body 引用丢失）
        assert.ok(index.findByTitle('wiki/note-10'));
    });

    it('30 秒 staleness 窗口内 ensureBuilt 不重复构建，invalidate 后重建', async () => {
        const index = new WikiBacklinkIndex();

        await index.ensureBuilt();
        assert.strictEqual(getAllCallCount, 1);

        await index.ensureBuilt();
        assert.strictEqual(getAllCallCount, 1, 'staleness 窗口内不应重复构建');

        // 并发 ensureBuilt 共享同一次构建
        await Promise.all([index.ensureBuilt(), index.ensureBuilt()]);
        assert.strictEqual(getAllCallCount, 1, '并发调用应共享同一次构建');

        index.invalidate();
        await index.ensureBuilt();
        assert.strictEqual(getAllCallCount, 2, 'invalidate 后应重建');
    });
});
