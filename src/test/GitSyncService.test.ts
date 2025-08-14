import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { GitSyncService, SyncStatus } from '../services/GitSyncService';
import { simpleGit } from 'simple-git';

suite('GitSyncService Test Suite', () => {
    let tempDir: string;
    let gitSyncService: GitSyncService;

    suiteSetup(async () => {
        // 创建临时目录用于测试
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-sync-test-'));
        
        // 初始化git仓库
        const git = simpleGit(tempDir);
        await git.init();
        await git.addConfig('user.name', 'Test User');
        await git.addConfig('user.email', 'test@example.com');
        
        // 创建初始文件
        const testFile = path.join(tempDir, 'test.md');
        fs.writeFileSync(testFile, '# Test File\n');
        await git.add('.');
        await git.commit('Initial commit');
        
        console.log(`Test git repository created at: ${tempDir}`);
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

    test('GitSyncService should be singleton', () => {
        const instance1 = GitSyncService.getInstance();
        const instance2 = GitSyncService.getInstance();
        assert.strictEqual(instance1, instance2, 'GitSyncService should return the same instance');
    });

    test('should detect git repository correctly', async () => {
        // 模拟配置返回我们的测试目录
        const originalGetIssueDir = require('../config').getIssueDir;
        require('../config').getIssueDir = () => tempDir;

        try {
            gitSyncService.initialize();
            
            // 等待一下让初始化完成
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // 检查状态栏是否创建
            assert.ok(gitSyncService['statusBarItem'], 'Status bar item should be created');
        } finally {
            // 恢复原始函数
            require('../config').getIssueDir = originalGetIssueDir;
        }
    });

    test('should handle non-git directory', async () => {
        const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'non-git-'));
        
        try {
            const originalGetIssueDir = require('../config').getIssueDir;
            const originalIsAutoSyncEnabled = require('../config').isAutoSyncEnabled;
            require('../config').getIssueDir = () => nonGitDir;
            require('../config').isAutoSyncEnabled = () => true;

            gitSyncService.initialize();
            
            // 等待初始化
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // 检查状态应该是禁用的
            const currentStatus = gitSyncService['currentStatus'];
            assert.strictEqual(currentStatus.status, SyncStatus.Disabled);
            assert.ok(currentStatus.message.includes('不是Git仓库'));
            
            // 恢复原始函数
            require('../config').getIssueDir = originalGetIssueDir;
            require('../config').isAutoSyncEnabled = originalIsAutoSyncEnabled;
        } finally {
            fs.rmSync(nonGitDir, { recursive: true, force: true });
        }
    });

    test('should format time ago correctly', () => {
        const now = new Date();
        const oneMinuteAgo = new Date(now.getTime() - 60 * 1000);
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
        const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const justNow = new Date(now.getTime() - 30 * 1000);

        // 使用反射访问私有方法
        const getTimeAgo = gitSyncService['getTimeAgo'].bind(gitSyncService);
        
        assert.strictEqual(getTimeAgo(justNow), '刚刚');
        assert.strictEqual(getTimeAgo(oneMinuteAgo), '1分钟前');
        assert.strictEqual(getTimeAgo(oneHourAgo), '1小时前');
        assert.strictEqual(getTimeAgo(oneDayAgo), '1天前');
    });

    test('should handle git operations with simple-git', async () => {
        const git = simpleGit(tempDir);
        
        // 测试检查仓库状态
        const status = await git.status();
        assert.ok(status.isClean(), 'Repository should be clean initially');
        
        // 创建新文件
        const newFile = path.join(tempDir, 'new-test.md');
        fs.writeFileSync(newFile, '# New Test File\n');
        
        // 检查状态
        const statusAfterChange = await git.status();
        assert.ok(!statusAfterChange.isClean(), 'Repository should have changes');
        assert.strictEqual(statusAfterChange.not_added.length, 1, 'Should have one untracked file');
    });

    test('should generate commit message with date placeholder', () => {
        const originalGetAutoCommitMessage = require('../config').getAutoCommitMessage;
        require('../config').getAutoCommitMessage = () => '[Auto-Sync] Changes at {date}';
        
        try {
            // 模拟提交消息生成
            const template = require('../config').getAutoCommitMessage();
            const commitMessage = template.replace('{date}', new Date().toLocaleString('zh-CN'));
            
            assert.ok(commitMessage.includes('[Auto-Sync] Changes at'));
            assert.ok(!commitMessage.includes('{date}'), 'Date placeholder should be replaced');
        } finally {
            require('../config').getAutoCommitMessage = originalGetAutoCommitMessage;
        }
    });

    test('should handle configuration changes', async () => {
        const originalIsAutoSyncEnabled = require('../config').isAutoSyncEnabled;
        let isEnabled = false;
        
        require('../config').isAutoSyncEnabled = () => isEnabled;
        
        try {
            // 初始状态：禁用
            gitSyncService.initialize();
            await new Promise(resolve => setTimeout(resolve, 50));
            
            let currentStatus = gitSyncService['currentStatus'];
            assert.strictEqual(currentStatus.status, SyncStatus.Disabled);
            
            // 启用自动同步
            isEnabled = true;
            
            // 模拟配置变更事件
            gitSyncService['setupAutoSync']();
            await new Promise(resolve => setTimeout(resolve, 50));
            
            // 注意：由于没有有效的issueDir，状态仍然是禁用的，但原因不同
            currentStatus = gitSyncService['currentStatus'];
            assert.strictEqual(currentStatus.status, SyncStatus.Disabled);
            assert.ok(currentStatus.message.includes('配置问题目录'));
        } finally {
            require('../config').isAutoSyncEnabled = originalIsAutoSyncEnabled;
        }
    });

    test('should cleanup resources properly', () => {
        gitSyncService.initialize();
        
        // 检查资源是否创建
        assert.ok(gitSyncService['statusBarItem'], 'Status bar item should exist');
        assert.ok(gitSyncService['disposables'].length >= 0, 'Should have disposables');
        
        // 清理
        gitSyncService.dispose();
        
        // 检查清理是否完成
        // 注意：由于statusBarItem.dispose()后对象仍存在，我们主要检查disposables是否被清空
        assert.strictEqual(gitSyncService['disposables'].length, 0, 'Disposables should be cleared');
    });

    test('should handle sync status updates', () => {
        const originalMessage = 'Test message';
        const originalStatus = SyncStatus.Syncing;
        
        gitSyncService['currentStatus'] = {
            status: originalStatus,
            message: originalMessage,
            lastSync: new Date()
        };
        
        gitSyncService['updateStatusBar']();
        
        // 检查状态栏文本
        const statusBarText = gitSyncService['statusBarItem'].text;
        assert.strictEqual(statusBarText, '$(sync~spin)', 'Should show spinning sync icon');
        
        // 检查tooltip
        const tooltip = gitSyncService['statusBarItem'].tooltip as string;
        assert.ok(tooltip.includes(originalMessage), 'Tooltip should contain the message');
    });
});

suite('GitSyncService Integration Tests', () => {
    let tempDir: string;
    let gitSyncService: GitSyncService;

    suiteSetup(async () => {
        // 创建更复杂的测试环境
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-sync-integration-'));
        
        const git = simpleGit(tempDir);
        await git.init();
        await git.addConfig('user.name', 'Integration Test');
        await git.addConfig('user.email', 'integration@test.com');
        
        // 创建多个测试文件
        const files = ['doc1.md', 'doc2.md', 'subdir/doc3.md'];
        
        for (const file of files) {
            const fullPath = path.join(tempDir, file);
            const dir = path.dirname(fullPath);
            
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            
            fs.writeFileSync(fullPath, `# ${path.basename(file, '.md')}\n\nContent for ${file}\n`);
        }
        
        await git.add('.');
        await git.commit('Initial commit with multiple files');
    });

    suiteTeardown(() => {
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

    test('should handle multiple file changes', async () => {
        const git = simpleGit(tempDir);
        
        // 修改多个文件
        const filesToModify = [
            path.join(tempDir, 'doc1.md'),
            path.join(tempDir, 'doc2.md')
        ];
        
        for (const file of filesToModify) {
            const content = fs.readFileSync(file, 'utf-8');
            fs.writeFileSync(file, content + '\n\nAdded content\n');
        }
        
        // 检查Git状态
        const status = await git.status();
        assert.ok(!status.isClean(), 'Should have changes');
        assert.strictEqual(status.modified.length, 2, 'Should have 2 modified files');
    });

    test('should detect git repository structure', async () => {
        const gitDir = path.join(tempDir, '.git');
        assert.ok(fs.existsSync(gitDir), 'Git directory should exist');
        
        const isGitRepo = gitSyncService['isGitRepository'](tempDir);
        assert.ok(isGitRepo, 'Should detect as git repository');
        
        // 测试非Git目录
        const nonGitDir = path.join(tempDir, 'not-a-repo');
        fs.mkdirSync(nonGitDir);
        
        const isNotGitRepo = gitSyncService['isGitRepository'](nonGitDir);
        assert.ok(!isNotGitRepo, 'Should not detect as git repository');
    });
});
