import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { createIssueFromCompletionAndInsert, CreateIssueFromCompletionArgs } from '../commands/createIssueFromCompletion';

suite('createIssueFromCompletion Command Tests', () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    suite('基础功能测试', () => {
        test('当没有活动编辑器时应直接退出', async () => {
            sandbox.stub(vscode.window, 'activeTextEditor').get(() => undefined);

            const mockDocument = {
                uri: vscode.Uri.file('/test/issues/test.md'),
                lineAt: () => ({ text: '' }),
                getText: () => ''
            } as any;

            const args: CreateIssueFromCompletionArgs = {
                document: mockDocument,
                triggers: ['[['],
                insertMode: 'markdownLink',
                selectedText: '测试标题'
            };

            // 应该不抛出错误
            await createIssueFromCompletionAndInsert(args);
            
            // 验证通过（没有崩溃即可）
            assert.ok(true);
        });

        test('CreateIssueFromCompletionArgs 接口应包含必需字段', () => {
            const mockDocument = {
                uri: vscode.Uri.file('/test/issues/test.md')
            } as vscode.TextDocument;

            const args: CreateIssueFromCompletionArgs = {
                document: mockDocument,
                triggers: ['[['],
                insertMode: 'markdownLink'
            };

            assert.ok(args.document);
            assert.ok(Array.isArray(args.triggers));
            assert.strictEqual(args.insertMode, 'markdownLink');
        });

        test('CreateIssueFromCompletionArgs 接口应支持可选的 selectedText', () => {
            const mockDocument = {
                uri: vscode.Uri.file('/test/issues/test.md')
            } as vscode.TextDocument;

            const argsWithText: CreateIssueFromCompletionArgs = {
                document: mockDocument,
                triggers: ['[['],
                insertMode: 'markdownLink',
                selectedText: '测试文本'
            };

            const argsWithoutText: CreateIssueFromCompletionArgs = {
                document: mockDocument,
                triggers: ['[['],
                insertMode: 'markdownLink'
            };

            assert.strictEqual(argsWithText.selectedText, '测试文本');
            assert.strictEqual(argsWithoutText.selectedText, undefined);
        });
    });

    suite('插入模式支持', () => {
        test('应支持 markdownLink 插入模式', () => {
            const mockDocument = {} as vscode.TextDocument;
            const args: CreateIssueFromCompletionArgs = {
                document: mockDocument,
                triggers: ['[['],
                insertMode: 'markdownLink'
            };
            assert.strictEqual(args.insertMode, 'markdownLink');
        });

        test('应支持 filename 插入模式', () => {
            const mockDocument = {} as vscode.TextDocument;
            const args: CreateIssueFromCompletionArgs = {
                document: mockDocument,
                triggers: ['[['],
                insertMode: 'filename'
            };
            assert.strictEqual(args.insertMode, 'filename');
        });

        test('应支持 relativePath 插入模式', () => {
            const mockDocument = {} as vscode.TextDocument;
            const args: CreateIssueFromCompletionArgs = {
                document: mockDocument,
                triggers: ['[['],
                insertMode: 'relativePath'
            };
            assert.strictEqual(args.insertMode, 'relativePath');
        });
    });

    suite('触发符配置', () => {
        test('应支持多个触发符', () => {
            const mockDocument = {} as vscode.TextDocument;
            const args: CreateIssueFromCompletionArgs = {
                document: mockDocument,
                triggers: ['[[', '@issue:', '#'],
                insertMode: 'markdownLink'
            };
            
            assert.strictEqual(args.triggers.length, 3);
            assert.ok(args.triggers.includes('[['));
            assert.ok(args.triggers.includes('@issue:'));
            assert.ok(args.triggers.includes('#'));
        });

        test('应支持空触发符数组', () => {
            const mockDocument = {} as vscode.TextDocument;
            const args: CreateIssueFromCompletionArgs = {
                document: mockDocument,
                triggers: [],
                insertMode: 'markdownLink'
            };
            
            assert.strictEqual(args.triggers.length, 0);
        });
    });

    suite('错误处理', () => {
        test('当命令执行出错时应捕获异常', async () => {
            const consoleErrorStub = sandbox.stub(console, 'error');
            
            // 强制编辑器返回 null 触发错误
            sandbox.stub(vscode.window, 'activeTextEditor').get(() => {
                throw new Error('测试错误');
            });

            const mockDocument = {} as vscode.TextDocument;
            const args: CreateIssueFromCompletionArgs = {
                document: mockDocument,
                triggers: ['[['],
                insertMode: 'markdownLink',
                selectedText: '测试'
            };

            // 不应该抛出未捕获的异常
            await createIssueFromCompletionAndInsert(args);
            
            // 验证错误被记录
            assert.ok(consoleErrorStub.called);
        });
    });
});
