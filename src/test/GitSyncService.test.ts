import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { GitSyncService, SyncStatus } from '../services/GitSyncService';
import { GitOperations } from '../services/git-sync/GitOperations';
import { simpleGit } from 'simple-git';

suite('GitSyncService 单元与集成测试', () => {
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

    test('单例模式', () => {
        const instance1 = GitSyncService.getInstance();
        const instance2 = GitSyncService.getInstance();
        assert.strictEqual(instance1, instance2, 'GitSyncService 应该返回同一个实例');
    });



    test('非 git 目录应禁用同步', async () => {
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
            assert.ok(currentStatus.message.includes('不是Git仓库'), '应提示不是Git仓库');
            
            // 恢复原始函数
            require('../config').getIssueDir = originalGetIssueDir;
            require('../config').isAutoSyncEnabled = originalIsAutoSyncEnabled;
        } finally {
            fs.rmSync(nonGitDir, { recursive: true, force: true });
        }
    });


    test('simple-git 操作', async () => {
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

    test('提交消息模板处理', () => {
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

    test('配置变更处理', async () => {
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

    test('资源清理', () => {
        gitSyncService.initialize();
        
        // 清理
        gitSyncService.dispose();
        assert.ok(true, 'Dispose 完成无错误');
    });

    test('同步状态栏更新', () => {
    // 这里只能断言 dispose 不报错，状态栏逻辑建议在 StatusBarManager 单独测试
    gitSyncService.dispose();
    assert.ok(true, 'Dispose 完成无错误');
    });
});

suite('GitSyncService 集成测试', () => {
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

    test('多文件变更检测', async () => {
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

    test('git 仓库结构检测', async () => {
        const gitDir = path.join(tempDir, '.git');
        assert.ok(fs.existsSync(gitDir), 'Git directory should exist');
        
        const isGitRepo = GitOperations.isGitRepository(tempDir);
        assert.ok(isGitRepo, 'Should detect as git repository');
        
        // 测试非Git目录
        const nonGitDir = path.join(tempDir, 'not-a-repo');
        fs.mkdirSync(nonGitDir);
        
        const isNotGitRepo = GitOperations.isGitRepository(nonGitDir);
        assert.ok(!isNotGitRepo, 'Should not detect as git repository');
    });
});
