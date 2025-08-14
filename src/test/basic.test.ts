import * as assert from 'assert';

suite('基础测试', () => {
    test('基本断言测试', () => {
        assert.strictEqual(1 + 1, 2, '1 + 1 应该等于 2');
        assert.ok(true, '这应该通过');
        assert.strictEqual('hello'.length, 5, '字符串长度应该是5');
    });

    test('GitSyncService 导入测试', () => {
        try {
            const { GitSyncService, SyncStatus } = require('../services/GitSyncService');
            assert.ok(GitSyncService, 'GitSyncService 应该能够导入');
            assert.ok(SyncStatus, 'SyncStatus 应该能够导入');
            assert.ok(SyncStatus.Synced, 'SyncStatus.Synced 应该存在');
        } catch (error) {
            assert.fail(`导入失败: ${error}`);
        }
    });

    test('配置模块导入测试', () => {
        try {
            const config = require('../config');
            assert.ok(config.getIssueDir, 'getIssueDir 函数应该存在');
            assert.ok(config.isAutoSyncEnabled, 'isAutoSyncEnabled 函数应该存在');
            assert.ok(config.getAutoCommitMessage, 'getAutoCommitMessage 函数应该存在');
        } catch (error) {
            assert.fail(`配置模块导入失败: ${error}`);
        }
    });
});
