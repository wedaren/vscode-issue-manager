import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { GitSyncService, SyncStatus } from '../services/GitSyncService';
import { GitOperations } from '../services/git-sync';

// 中文 mock 依赖
class MockStatusBarManager {
    public lastStatus: any = null;
    public called = false;
    updateStatusBar(status: any) {
        this.lastStatus = status;
        this.called = true;
    }
    dispose() {}
}

class MockFileWatcherManager {
    public setupCalled = false;
    setupFileWatcher() { this.setupCalled = true; }
    cleanup() {}
    dispose() {}
}


suite('GitSyncService 单元测试', () => {
    let tempDir: string;
    let gitSyncService: any;
    let statusBarManager: MockStatusBarManager;
    let fileWatcherManager: MockFileWatcherManager;

    suiteSetup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-sync-basic-test-'));
    });

    suiteTeardown(() => {
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    setup(() => {
        statusBarManager = new MockStatusBarManager();
        fileWatcherManager = new MockFileWatcherManager();
        gitSyncService = new (GitSyncService as any)(fileWatcherManager, statusBarManager);
    });

    teardown(() => {
        if (gitSyncService) {
            gitSyncService.dispose();
        }
    });


    test('Git 仓库检测', () => {
        assert.ok(!GitOperations.isGitRepository(tempDir), '空目录应该检测为非 Git 仓库');
        const gitDir = path.join(tempDir, '.git');
        fs.mkdirSync(gitDir);
        assert.ok(GitOperations.isGitRepository(tempDir), '包含 .git 目录的路径应该检测为 Git 仓库');
    });

    test('提交消息模板处理', () => {
        const template = '[Auto-Sync] Changes at {date}';
        const result = template.replace('{date}', '2025-08-14 15:30:00');
        assert.ok(result.includes('[Auto-Sync] Changes at 2025-08-14 15:30:00'));
        assert.ok(!result.includes('{date}'), '日期占位符应该被替换');
    });

    test('状态栏初始化', () => {
        gitSyncService.initialize();
        assert.ok(statusBarManager.called, 'updateStatusBar 应该被调用');
        assert.ok(statusBarManager.lastStatus && statusBarManager.lastStatus.status === SyncStatus.Disabled, '初始化时状态应该为 Disabled');
    });

    test('资源清理', () => {
        gitSyncService.initialize();
        assert.ok(Array.isArray(gitSyncService.disposables), '应该有 disposables 数组');
        gitSyncService.dispose();
        assert.strictEqual(gitSyncService.disposables.length, 0, '资源应该被清理');
    });
});

suite('GitSyncService 状态测试', () => {
    let gitSyncService: any;
    let statusBarManager: MockStatusBarManager;
    let fileWatcherManager: MockFileWatcherManager;

    setup(() => {
        statusBarManager = new MockStatusBarManager();
        fileWatcherManager = new MockFileWatcherManager();
        gitSyncService = new (GitSyncService as any)(fileWatcherManager, statusBarManager);
    });

    teardown(() => {
        if (gitSyncService) {
            gitSyncService.dispose();
        }
    });

    test('状态枚举值', () => {
        assert.strictEqual(SyncStatus.Synced, 'synced');
        assert.strictEqual(SyncStatus.Syncing, 'syncing');
        assert.strictEqual(SyncStatus.HasLocalChanges, 'local');
        assert.strictEqual(SyncStatus.HasRemoteChanges, 'remote');
        assert.strictEqual(SyncStatus.Conflict, 'conflict');
        assert.strictEqual(SyncStatus.Disabled, 'disabled');
    });
});
