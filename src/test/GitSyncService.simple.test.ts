import * as vscode from 'vscode';
import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { GitSyncService, SyncStatus } from '../services/GitSyncService';

suite('GitSyncService 基础测试', () => {
    let tempDir: string;
    let gitSyncService: GitSyncService;

    suiteSetup(() => {
        // 创建临时目录用于测试
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-sync-basic-test-'));
    });

    suiteTeardown(() => {
        // 清理临时目录
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    setup(() => {
        gitSyncService = GitSyncService.getInstance();
    });

    teardown(() => {
        if (gitSyncService) {
            gitSyncService.dispose();
        }
    });

    test('单例模式测试', () => {
        const instance1 = GitSyncService.getInstance();
        const instance2 = GitSyncService.getInstance();
        assert.strictEqual(instance1, instance2, 'GitSyncService应该返回相同的实例');
    });

    test('时间格式化功能', () => {
        const now = new Date();
        const testCases = [
            { offset: 30 * 1000, expected: '刚刚' },
            { offset: 2 * 60 * 1000, expected: '2分钟前' },
            { offset: 90 * 60 * 1000, expected: '1小时前' },
            { offset: 25 * 60 * 60 * 1000, expected: '1天前' },
        ];

        const getTimeAgo = (gitSyncService as any).getTimeAgo.bind(gitSyncService);
        
        testCases.forEach(({ offset, expected }) => {
            const testTime = new Date(now.getTime() - offset);
            assert.strictEqual(getTimeAgo(testTime), expected);
        });
    });

    test('Git仓库检测', () => {
        const isGitRepository = (gitSyncService as any).isGitRepository.bind(gitSyncService);
        
        // 测试无效的目录
        assert.ok(!isGitRepository(tempDir), '空目录应该检测为非Git仓库');
        
        // 创建.git目录
        const gitDir = path.join(tempDir, '.git');
        fs.mkdirSync(gitDir);
        assert.ok(isGitRepository(tempDir), '包含.git目录的路径应该检测为Git仓库');
    });

    test('提交消息模板处理', () => {
        const template = '[Auto-Sync] Changes at {date}';
        const result = template.replace('{date}', '2025-08-14 15:30:00');
        
        assert.ok(result.includes('[Auto-Sync] Changes at 2025-08-14 15:30:00'));
        assert.ok(!result.includes('{date}'), '日期占位符应该被替换');
    });

    test('状态栏初始化', () => {
        gitSyncService.initialize();
        
        const statusBarItem = (gitSyncService as any).statusBarItem;
        assert.ok(statusBarItem, '状态栏项应该被创建');
        assert.ok(statusBarItem.command === 'issueManager.synchronizeNow', '状态栏命令应该正确设置');
    });

    test('资源清理', () => {
        gitSyncService.initialize();
        
        const disposables = (gitSyncService as any).disposables;
        assert.ok(Array.isArray(disposables), '应该有disposables数组');
        
        gitSyncService.dispose();
        
        assert.strictEqual(disposables.length, 0, '资源应该被清理');
    });
});

suite('GitSyncService 状态测试', () => {
    let gitSyncService: GitSyncService;

    setup(() => {
        gitSyncService = GitSyncService.getInstance();
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

    test('状态栏图标映射', () => {
        const testCases = [
            { status: SyncStatus.Synced, expectedIcon: '$(sync)' },
            { status: SyncStatus.Syncing, expectedIcon: '$(sync~spin)' },
            { status: SyncStatus.HasLocalChanges, expectedIcon: '$(cloud-upload)' },
            { status: SyncStatus.Conflict, expectedIcon: '$(error)' },
            { status: SyncStatus.Disabled, expectedIcon: '$(sync-ignored)' }
        ];
        
        gitSyncService.initialize();
        const statusBarItem = (gitSyncService as any).statusBarItem;
        
        testCases.forEach(({ status, expectedIcon }) => {
            (gitSyncService as any).currentStatus = { status, message: 'Test message' };
            (gitSyncService as any).updateStatusBar();
            
            assert.strictEqual(statusBarItem.text, expectedIcon, `状态 ${status} 应显示图标 ${expectedIcon}`);
        });
    });
});
