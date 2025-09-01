import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { IssueStructureProvider } from '../views/IssueStructureProvider';

suite('IssueStructureProvider Title Update Tests', () => {
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
        provider.dispose();
    });

    test('should emit onDidUpdateTitle event when title changes', (done) => {
        let eventFired = false;
        let receivedTitle = '';

        // 监听标题更新事件
        const subscription = provider.onDidUpdateTitle(title => {
            eventFired = true;
            receivedTitle = title;
            
            // 验证事件参数
            assert.strictEqual(title, '测试标题', '事件应该携带正确的标题');
            
            subscription.dispose();
            done();
        });

        // 设置标题并触发更新
        (provider as any).viewTitle = '测试标题';
        (provider as any).updateViewTitle();

        // 如果事件在短时间内没有触发，测试失败
        setTimeout(() => {
            if (!eventFired) {
                subscription.dispose();
                assert.fail('onDidUpdateTitle事件应该被触发');
            }
        }, 100);
    });

    test('should allow multiple subscribers to receive title updates', () => {
        const titles: string[] = [];
        const subscription1 = provider.onDidUpdateTitle(title => titles.push(`sub1:${title}`));
        const subscription2 = provider.onDidUpdateTitle(title => titles.push(`sub2:${title}`));

        // 触发标题更新
        (provider as any).viewTitle = '多订阅者测试';
        (provider as any).updateViewTitle();

        // 验证两个订阅者都收到了事件
        assert.strictEqual(titles.length, 2, '应该有两个事件被触发');
        assert.ok(titles.includes('sub1:多订阅者测试'), '第一个订阅者应该收到事件');
        assert.ok(titles.includes('sub2:多订阅者测试'), '第二个订阅者应该收到事件');

        subscription1.dispose();
        subscription2.dispose();
    });

    test('should not emit events after dispose', () => {
        let eventCount = 0;
        const subscription = provider.onDidUpdateTitle(() => {
            eventCount++;
        });

        // 正常触发一次
        (provider as any).viewTitle = '销毁前';
        (provider as any).updateViewTitle();

        // 销毁后不应该触发事件
        provider.dispose();
        
        (provider as any).viewTitle = '销毁后';
        (provider as any).updateViewTitle();

        // 验证只触发了一次
        assert.strictEqual(eventCount, 1, '销毁后不应该再触发事件');

        subscription.dispose();
    });

    test('should handle dispose of title event emitter in main dispose method', () => {
        const titleEventEmitter = (provider as any)._onDidUpdateTitle;
        const disposeSpy = sandbox.spy(titleEventEmitter, 'dispose');

        // 调用dispose方法
        provider.dispose();

        // 验证标题事件发射器的dispose被调用
        assert.strictEqual(disposeSpy.calledOnce, true, '标题事件发射器的dispose方法应该被调用');
    });

    test('should emit title update when view state changes', () => {
        const titles: string[] = [];
        const subscription = provider.onDidUpdateTitle(title => titles.push(title));

        // 模拟不同的视图状态变化
        (provider as any).viewTitle = '问题结构';
        (provider as any).updateViewTitle();

        (provider as any).viewTitle = '问题结构: 测试文档';
        (provider as any).updateViewTitle();

        (provider as any).viewTitle = '问题结构: 错误';
        (provider as any).updateViewTitle();

        // 验证所有状态变化都触发了事件
        assert.deepStrictEqual(titles, [
            '问题结构',
            '问题结构: 测试文档', 
            '问题结构: 错误'
        ], '应该按顺序收到所有标题更新事件');

        subscription.dispose();
    });
});
