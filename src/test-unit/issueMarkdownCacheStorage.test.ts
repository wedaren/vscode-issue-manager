import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    Uri,
    readMockFile,
    resetMockConfig,
    resetMockFs,
    setMockConfig,
    workspace,
} from './mocks/vscode';
import {
    load,
    save,
    type IssueMarkdownCacheEntry,
} from '../data/issueMarkdownCacheStorage';

describe('issueMarkdownCacheStorage', function () {
    // 防抖窗口为 1 秒，放宽 mocha 默认 2s 超时
    this.timeout(10000);

    let issueDir: string;
    let cacheFilePath: string;

    beforeEach(() => {
        resetMockFs();
        resetMockConfig();
        // config.getIssueDir 用 node 真实 fs.statSync 校验目录存在，故使用真实临时目录
        issueDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-manager-test-'));
        setMockConfig('issueManager', { issueDir });
        cacheFilePath = path.join(issueDir, '.issueManager', 'issueMarkdownCache.json');
    });

    afterEach(() => {
        resetMockConfig();
        resetMockFs();
        fs.rmSync(issueDir, { recursive: true, force: true });
    });

    function waitForDebounce(): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, 1300));
    }

    it('防抖窗口内多次 save，工厂函数只被调用一次（回归：旧实现每次都构建全量快照）', async () => {
        let factoryCalls = 0;
        const makeFactory = (tag: string) => () => {
            factoryCalls++;
            return { [tag]: { mtime: 1 } } as Record<string, IssueMarkdownCacheEntry>;
        };

        save(makeFactory('a.md'));
        save(makeFactory('b.md'));
        save(makeFactory('c.md'));
        assert.strictEqual(factoryCalls, 0, '防抖期间不应同步调用工厂函数');

        await waitForDebounce();
        assert.strictEqual(factoryCalls, 1, '防抖窗口内多次 save 应只触发一次工厂调用');
    });

    it('防抖结束后写盘的是最后一次调用时工厂返回的数据', async () => {
        save(() => ({ 'old.md': { mtime: 100 } }));
        save(() => ({ 'new.md': { mtime: 200, title: '最新' } }));

        await waitForDebounce();
        const written = readMockFile(cacheFilePath);
        assert.ok(written, '缓存文件应已写入内存文件系统');
        const obj = JSON.parse(written) as Record<string, IssueMarkdownCacheEntry>;
        assert.deepStrictEqual(obj, { 'new.md': { mtime: 200, title: '最新' } });
    });

    it('写盘位置为 <issueDir>/.issueManager/issueMarkdownCache.json', async () => {
        save(() => ({ 'x.md': { mtime: 1 } }));

        await waitForDebounce();
        const wrongPath = path.join(issueDir, 'issueMarkdownCache.json');
        assert.strictEqual(readMockFile(wrongPath), undefined);
        assert.ok(readMockFile(cacheFilePath), '缓存应写入 .issueManager 子目录');
    });

    it('load 能读回 save 写入的内容', async () => {
        const entries: Record<string, IssueMarkdownCacheEntry> = {
            'a.md': { mtime: 111, title: 'A', vtime: 222 },
            'b.md': { mtime: 333, frontmatter: { tags: ['x'] } },
        };
        save(() => entries);
        await waitForDebounce();

        const loaded = await load();
        assert.deepStrictEqual(loaded, {
            'a.md': { mtime: 111, title: 'A', vtime: 222 },
            // vtime 缺失的旧条目会被迁移为 vtime = mtime
            'b.md': { mtime: 333, frontmatter: { tags: ['x'] }, vtime: 333 },
        });
    });

    it('load 为缺失 vtime 的旧条目补 vtime=mtime（迁移逻辑）', async () => {
        // 直接写入旧格式缓存（无 vtime 字段）
        const legacy = {
            'old.md': { mtime: 777 },
            'newer.md': { mtime: 888, vtime: 999 },
        };
        await workspace.fs.writeFile(Uri.file(cacheFilePath), Buffer.from(JSON.stringify(legacy), 'utf8'));

        const loaded = await load();
        assert.ok(loaded);
        assert.strictEqual(loaded['old.md'].vtime, 777, '缺失 vtime 应迁移为 mtime');
        assert.strictEqual(loaded['newer.md'].vtime, 999, '已有 vtime 不应被覆盖');
    });

    it('load 在缓存文件不存在时返回 undefined', async () => {
        const loaded = await load();
        assert.strictEqual(loaded, undefined);
    });
});
