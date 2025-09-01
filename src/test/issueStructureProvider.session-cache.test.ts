import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as sinon from 'sinon';
import { IssueStructureProvider } from '../views/IssueStructureProvider';

suite('IssueStructureProvider Session Cache Tests', () => {
    let provider: IssueStructureProvider;
    let sandbox: sinon.SinonSandbox;
    let mockReadFileStub: sinon.SinonStub;
    let mockStatStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        
        // Mock extension context
        const mockContext = {
            subscriptions: []
        } as unknown as vscode.ExtensionContext;
        
        provider = new IssueStructureProvider(mockContext);
        
        // Mock vscode.workspace.fs
        mockReadFileStub = sandbox.stub(vscode.workspace.fs, 'readFile');
        mockStatStub = sandbox.stub(vscode.workspace.fs, 'stat');
        
        // Mock getIssueDir to return a test directory
        sandbox.stub(require('../utils/fileUtils'), 'getIssueDir').returns('/test/issues');
    });

    teardown(() => {
        sandbox.restore();
    });

    test('should use session cache to avoid duplicate node construction in DAG structures', async () => {
        // 设置文件系统模拟
        const sharedContent = `---
title: "Shared Component"
---

# Shared Component
This is a shared component referenced by multiple parents.`;

        const parent1Content = `---
root_file: "root.md"
children_files:
  - "shared.md"
---

# Parent 1`;

        const parent2Content = `---
root_file: "root.md"
children_files:
  - "shared.md"
---

# Parent 2`;

        const rootContent = `---
children_files:
  - "parent1.md"
  - "parent2.md"
---

# Root Document`;

        // 设置文件stat模拟
        mockStatStub.callsFake(async (uri: vscode.Uri) => {
            return {
                type: vscode.FileType.File,
                ctime: 1000,
                mtime: 1000,
                size: 100
            };
        });

        // 设置文件读取模拟
        mockReadFileStub.callsFake(async (uri: vscode.Uri) => {
            const fileName = path.basename(uri.fsPath);
            switch (fileName) {
                case 'root.md':
                    return Buffer.from(rootContent);
                case 'parent1.md':
                    return Buffer.from(parent1Content);
                case 'parent2.md':
                    return Buffer.from(parent2Content);
                case 'shared.md':
                    return Buffer.from(sharedContent);
                default:
                    throw new Error('File not found');
            }
        });

        // 模拟活动编辑器
        const mockDocument = {
            uri: vscode.Uri.file('/test/issues/root.md'),
            getText: () => rootContent
        } as vscode.TextDocument;

        const mockEditor = {
            document: mockDocument
        } as vscode.TextEditor;

        sandbox.stub(vscode.window, 'activeTextEditor').value(mockEditor);

        // 监听refresh方法的调用
        let refreshCallCount = 0;
        const originalRefresh = (provider as any).refresh.bind(provider);
        sandbox.stub(provider as any, 'refresh').callsFake(async () => {
            refreshCallCount++;
            console.log(`Refresh called ${refreshCallCount} times`);
            return originalRefresh();
        });

        // 监听buildNodeRecursively方法的调用次数
        let buildNodeCallCount = 0;
        const originalBuildNode = (provider as any).buildNodeRecursively.bind(provider);
        sandbox.stub(provider as any, 'buildNodeRecursively').callsFake(async (...args: any[]) => {
            buildNodeCallCount++;
            const fileName = args[0];
            console.log(`Building node for ${fileName} (call #${buildNodeCallCount})`);
            return originalBuildNode(...args);
        });

        // 触发刷新
        await (provider as any).refresh();

        // 验证结果
        const rootNodes = await provider.getChildren();
        assert.strictEqual(rootNodes?.length, 1, '应该有一个根节点');

        const rootNode = rootNodes![0];
        assert.strictEqual(rootNode.title, 'Root Document', '根节点标题应该正确');

        const children = await provider.getChildren(rootNode);
        assert.strictEqual(children?.length, 2, '根节点应该有两个子节点');

        // 获取parent1和parent2的子节点
        const parent1Children = await provider.getChildren(children![0]);
        const parent2Children = await provider.getChildren(children![1]);

        assert.strictEqual(parent1Children?.length, 1, 'parent1应该有一个子节点');
        assert.strictEqual(parent2Children?.length, 1, 'parent2应该有一个子节点');

        // 验证共享节点确实是同一个（通过标题验证）
        assert.strictEqual(parent1Children![0].title, 'Shared Component', 'parent1的子节点应该是共享组件');
        assert.strictEqual(parent2Children![0].title, 'Shared Component', 'parent2的子节点应该是共享组件');

        // 最重要的验证：buildNodeRecursively对shared.md应该只调用一次
        // 总调用应该是：root.md(1) + parent1.md(1) + parent2.md(1) + shared.md(1) = 4次
        // 如果没有会话缓存，shared.md会被调用两次，总共5次
        console.log(`Total buildNodeRecursively calls: ${buildNodeCallCount}`);
        assert.strictEqual(buildNodeCallCount, 4, 'buildNodeRecursively应该总共被调用4次（有会话缓存）而不是5次（无缓存）');
    });

    test('should respect visited set for cycle detection even with session cache', async () => {
        // 创建循环引用结构：A -> B -> A
        const fileAContent = `---
children_files:
  - "fileB.md"
---

# File A`;

        const fileBContent = `---
children_files:
  - "fileA.md"
---

# File B`;

        mockStatStub.callsFake(async (uri: vscode.Uri) => {
            return {
                type: vscode.FileType.File,
                ctime: 1000,
                mtime: 1000,
                size: 100
            };
        });

        mockReadFileStub.callsFake(async (uri: vscode.Uri) => {
            const fileName = path.basename(uri.fsPath);
            switch (fileName) {
                case 'fileA.md':
                    return Buffer.from(fileAContent);
                case 'fileB.md':
                    return Buffer.from(fileBContent);
                default:
                    throw new Error('File not found');
            }
        });

        const mockDocument = {
            uri: vscode.Uri.file('/test/issues/fileA.md'),
            getText: () => fileAContent
        } as vscode.TextDocument;

        const mockEditor = {
            document: mockDocument
        } as vscode.TextEditor;

        sandbox.stub(vscode.window, 'activeTextEditor').value(mockEditor);

        // 触发刷新
        await (provider as any).refresh();

        // 验证结果
        const rootNodes = await provider.getChildren();
        assert.strictEqual(rootNodes?.length, 1, '应该有一个根节点');

        const rootNode = rootNodes![0];
        const children = await provider.getChildren(rootNode);
        assert.strictEqual(children?.length, 1, '应该有一个子节点');

        const childNode = children![0];
        // 子节点应该检测到循环引用
        assert.strictEqual(childNode.hasError, true, '子节点应该有错误标记');
        assert.ok(childNode.title.includes('循环引用'), '子节点应该显示循环引用错误');
    });
});
