import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { TitleCacheService } from '../services/TitleCacheService';
import { TestHelper } from './TestHelper';

suite('TitleCacheService', () => {
    const tmpDir = path.join(__dirname, '..', '..', '..', 'tmp-title-cache-tests');
    const issueDir = tmpDir;
    const cacheDir = path.join(issueDir, '.issueManager');
    const cacheFile = path.join(cacheDir, 'titleCache.json');

    setup(() => {
        // 设置 issueDir 配置，使 readTitleCacheJson 能找到缓存文件
        TestHelper.mockVSCodeConfig();
        TestHelper.setMockConfig('issueManager.issueDir', issueDir);

        // 准备目录与初始缓存
        const fs = require('fs');
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(cacheFile, JSON.stringify({
            'a/b.md': 'A B',
            'c/d.md': 'C D'
        }, null, 2));
    });

    teardown(() => {
        // 清理配置与临时目录
        TestHelper.restoreVSCodeConfig();

        const fs = require('fs');
        const rimraf = (p: string) => {
            if (fs.existsSync(p)) {
                fs.rmSync(p, { recursive: true, force: true });
            }
        };
        rimraf(tmpDir);
        // 重置单例（通过重新加载模块通常更稳，但这里简单清理状态）
    });

    test('get 与 getMany 命中缓存与回退为 basename', async () => {
        const svc = TitleCacheService.getInstance();
        await svc.preload();

        const t1 = await svc.get('a/b.md');
        assert.strictEqual(t1, 'A B');

        const titles = await svc.getMany(['a/b.md', 'x/y.md']);
        assert.deepStrictEqual(titles, ['A B', 'y']); // 未命中回退为文件名不含扩展名
    });

    test('reload 后读取到最新缓存', async () => {
        const svc = TitleCacheService.getInstance();
        await svc.preload();
        let t = await svc.get('e/f.md');
        assert.strictEqual(t, undefined);

        // 更新缓存文件
        const fs = require('fs');
        fs.writeFileSync(cacheFile, JSON.stringify({
            'e/f.md': 'E F'
        }, null, 2));

        await svc.reload();
        t = await svc.get('e/f.md');
        assert.strictEqual(t, 'E F');
    });
});
