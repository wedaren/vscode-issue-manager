import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { IssueStructureProvider } from '../views/IssueStructureProvider';

suite('IssueStructureProvider Dispose Tests', () => {
    let provider: IssueStructureProvider;
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;

    setup(() => {
        sandbox = sinon.createSandbox();
        
        // Mock extension context
        mockContext = {
            subscriptions: []
        } as unknown as vscode.ExtensionContext;
        
        provider = new IssueStructureProvider(mockContext);
    });

    teardown(() => {
        sandbox.restore();
    });

    test('should properly dispose resources when dispose is called', () => {
        // 获取事件发射器的引用
        const eventEmitter = (provider as any)._onDidChangeTreeData;
        
        // 监听dispose方法的调用
        const disposeSpy = sandbox.spy(eventEmitter, 'dispose');
        
        // 获取缓存的引用
        const nodeCache = (provider as any).nodeCache;
        
        // 添加一些测试数据到缓存
        nodeCache.set('test.md', {
            node: {
                id: 'test.md',
                filePath: 'test.md',
                title: 'Test',
                children: [],
                hasError: false
            },
            lastModified: Date.now()
        });
        
        // 验证缓存有数据
        assert.strictEqual(nodeCache.size, 1, '缓存应该有一个条目');
        
        // 调用dispose方法
        provider.dispose();
        
        // 验证事件发射器的dispose方法被调用
        assert.strictEqual(disposeSpy.calledOnce, true, '事件发射器的dispose方法应该被调用一次');
        
        // 验证缓存被清空
        assert.strictEqual(nodeCache.size, 0, '缓存应该被清空');
    });

    test('should be safe to call dispose multiple times', () => {
        // 获取事件发射器的引用
        const eventEmitter = (provider as any)._onDidChangeTreeData;
        
        // 监听dispose方法的调用
        const disposeSpy = sandbox.spy(eventEmitter, 'dispose');
        
        // 多次调用dispose
        provider.dispose();
        provider.dispose();
        provider.dispose();
        
        // 验证事件发射器的dispose方法被调用了3次
        assert.strictEqual(disposeSpy.callCount, 3, '事件发射器的dispose方法应该被调用3次');
        
        // 验证没有抛出异常（如果到达这里说明没有异常）
        assert.ok(true, 'dispose方法应该可以安全地多次调用');
    });

    test('should handle dispose when cache is already empty', () => {
        // 获取缓存的引用
        const nodeCache = (provider as any).nodeCache;
        
        // 确保缓存为空
        nodeCache.clear();
        assert.strictEqual(nodeCache.size, 0, '缓存应该为空');
        
        // 调用dispose方法不应该抛出异常
        assert.doesNotThrow(() => {
            provider.dispose();
        }, 'dispose方法在缓存为空时应该安全执行');
        
        // 验证缓存仍然为空
        assert.strictEqual(nodeCache.size, 0, '缓存应该仍然为空');
    });
});
