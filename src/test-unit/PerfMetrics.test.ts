import * as assert from 'assert';
import { PerfMetrics } from '../services/PerfMetrics';

describe('PerfMetrics', function () {
    // 节流测试涉及 1 秒级等待，放宽 mocha 默认 2s 超时
    this.timeout(10000);

    let metrics: PerfMetrics;

    beforeEach(() => {
        metrics = new PerfMetrics();
    });

    it('increment 累加计数，同名多次累加正确', () => {
        metrics.increment('cache.para.hit');
        metrics.increment('cache.para.hit');
        metrics.increment('cache.para.hit', 5);
        metrics.increment('io.stat.issueMarkdown');

        const snap = metrics.snapshot();
        assert.strictEqual(snap.counters['cache.para.hit'], 7);
        assert.strictEqual(snap.counters['io.stat.issueMarkdown'], 1);
    });

    it('recordTiming 统计 count/totalMs/maxMs/lastMs 正确', () => {
        metrics.recordTiming('view.overview.getTreeItem', 10);
        metrics.recordTiming('view.overview.getTreeItem', 30);
        metrics.recordTiming('view.overview.getTreeItem', 20);

        const t = metrics.snapshot().timings['view.overview.getTreeItem'];
        assert.strictEqual(t.count, 3);
        assert.strictEqual(t.totalMs, 60);
        assert.strictEqual(t.maxMs, 30);
        assert.strictEqual(t.lastMs, 20);
    });

    it('recent 样本超过 100 时丢弃最旧样本', () => {
        for (let i = 1; i <= 105; i++) {
            metrics.recordTiming('activation.total', i);
        }

        // recent 不在快照中暴露，通过内部结构验证环形语义
        const stat = (metrics as unknown as {
            timings: Map<string, { recent: number[]; count: number }>;
        }).timings.get('activation.total');
        assert.ok(stat);
        assert.strictEqual(stat.count, 105);
        assert.strictEqual(stat.recent.length, 100);
        assert.strictEqual(stat.recent[0], 6, '最旧的 5 个样本应被丢弃');
        assert.strictEqual(stat.recent[99], 105);
    });

    it('snapshot 包含 counters/timings/memoryMB 且 avgMs 计算正确', () => {
        metrics.increment('watcher.markdownEvent', 2);
        metrics.recordTiming('view.load', 10);
        metrics.recordTiming('view.load', 20);
        metrics.recordTiming('view.load', 31);

        const snap = metrics.snapshot();
        assert.ok(snap.timestamp > 0);
        assert.strictEqual(snap.counters['watcher.markdownEvent'], 2);
        assert.strictEqual(snap.timings['view.load'].avgMs, 20.33);
        assert.ok(typeof snap.memoryMB.rss === 'number' && snap.memoryMB.rss > 0);
        assert.ok(typeof snap.memoryMB.heapUsed === 'number' && snap.memoryMB.heapUsed > 0);
        // snapshot 不应泄露 recent 内部数组
        assert.strictEqual('recent' in snap.timings['view.load'], false);
    });

    it('reset 清空所有计数器与耗时统计', () => {
        metrics.increment('cache.hit', 3);
        metrics.recordTiming('view.load', 10);
        metrics.reset();

        const snap = metrics.snapshot();
        assert.deepStrictEqual(snap.counters, {});
        assert.deepStrictEqual(snap.timings, {});
    });

    it('onDidUpdate 节流：短时间多次 increment 只触发一次事件', async () => {
        let fired = 0;
        metrics.onDidUpdate(() => { fired++; });

        // 首次触发延迟为 0，先等它发完，进入节流窗口
        await new Promise(resolve => setTimeout(resolve, 50));
        assert.strictEqual(fired, 0, '尚未有任何变更，不应触发事件');

        metrics.increment('a');
        await new Promise(resolve => setTimeout(resolve, 50));
        assert.strictEqual(fired, 1);

        // 节流窗口内连续 5 次变更，应合并为一次尾部触发
        for (let i = 0; i < 5; i++) {
            metrics.increment('a');
        }
        await new Promise(resolve => setTimeout(resolve, 300));
        assert.strictEqual(fired, 1, '节流窗口内不应立即触发');

        await new Promise(resolve => setTimeout(resolve, 1200));
        assert.strictEqual(fired, 2, '节流窗口结束后应只补发一次事件');
    });

    it('generateMarkdownReport 输出分组标题和指标行', () => {
        metrics.increment('cache.para.hit', 4);
        metrics.increment('watcher.markdownEvent');
        metrics.recordTiming('view.overview.getTreeItem', 12);
        metrics.recordTiming('view.overview.getTreeItem', 8);

        const report = metrics.generateMarkdownReport();
        assert.ok(report.includes('# Issue Manager 性能指标报告'));
        assert.ok(report.includes('## cache'));
        assert.ok(report.includes('## watcher'));
        assert.ok(report.includes('## view'));
        assert.ok(report.includes('### 计数器'));
        assert.ok(report.includes('### 耗时'));
        assert.ok(report.includes('| cache.para.hit | 4 |'));
        assert.ok(report.includes('| watcher.markdownEvent | 1 |'));
        assert.ok(report.includes('| view.overview.getTreeItem | 2 | 10 | 12 | 8 |'));
    });
});
