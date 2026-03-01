import * as assert from 'assert';
import * as path from 'path';

suite('parseLinkedFileString Tests', () => {
    test('解析 wiki 风格绝对 file URI 并提取行号', () => {
        const { parseLinkedFileString } = require('../data/IssueMarkdowns');
        const r = parseLinkedFileString('[[file:/tmp/foo.md#L19]]');
        assert.ok(r.fsPath, '应包含 fsPath');
        // 路径可能在不同平台被 normalize
        assert.strictEqual(path.normalize(r.fsPath!), path.normalize('/tmp/foo.md'));
        assert.strictEqual(r.lineStart, 19);
    });

    test('解析 Markdown 链接并提取行列范围', () => {
        const { parseLinkedFileString } = require('../data/IssueMarkdowns');
        const r = parseLinkedFileString('[test](file:/tmp/bar.md#L8:1-L9:20)');
        assert.ok(r.fsPath, '应包含 fsPath');
        assert.strictEqual(path.normalize(r.fsPath!), path.normalize('/tmp/bar.md'));
        assert.strictEqual(r.lineStart, 8);
        assert.strictEqual(r.colStart, 1);
        assert.strictEqual(r.lineEnd, 9);
        assert.strictEqual(r.colEnd, 20);
    });

    test('解析相对路径的 wiki 链接，保留 linkPath 且不解析为 fsPath', () => {
        const { parseLinkedFileString } = require('../data/IssueMarkdowns');
        const r = parseLinkedFileString('[[notes/foo.md#L10-L12]]');
        assert.strictEqual(r.linkPath, 'notes/foo.md');
        assert.strictEqual(r.lineStart, 10);
        assert.strictEqual(r.lineEnd, 12);
        assert.strictEqual(r.fsPath, undefined);
    });
});
