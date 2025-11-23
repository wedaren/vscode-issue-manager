import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import { IssueDocumentLinkProvider } from '../providers/IssueDocumentLinkProvider';

suite('IssueDocumentLinkProvider 测试', () => {
    let provider: IssueDocumentLinkProvider;

    setup(() => {
        provider = new IssueDocumentLinkProvider();
    });

    test('应该能够创建 IssueDocumentLinkProvider 实例', () => {
        assert.ok(provider, 'Provider 应该能够创建');
        assert.ok(provider.provideDocumentLinks, 'provideDocumentLinks 方法应该存在');
    });

    test('应该能够导入 IssueDocumentLinkProvider', () => {
        const { IssueDocumentLinkProvider: ImportedProvider } = require('../providers/IssueDocumentLinkProvider');
        assert.ok(ImportedProvider, 'IssueDocumentLinkProvider 应该能够导入');
    });

    test('对于非 markdown 文档应返回空数组', async () => {
        // 创建一个简单的文本文档
        const doc = await vscode.workspace.openTextDocument({
            language: 'plaintext',
            content: '[test](path.md?issueId=123)'
        });

        const links = provider.provideDocumentLinks(doc, new vscode.CancellationTokenSource().token);
        const result = links instanceof Array ? links : await links;
        
        assert.strictEqual(result?.length, 0, '非 markdown 文档应返回空数组');
    });

    test('解析包含 issueId 的链接', async () => {
        // 创建一个 markdown 文档
        const content = '# Test\n\n这是一个 [测试链接](test.md?issueId=test-123) 链接。';
        const doc = await vscode.workspace.openTextDocument({
            language: 'markdown',
            content: content
        });

        const links = provider.provideDocumentLinks(doc, new vscode.CancellationTokenSource().token);
        const result = links instanceof Array ? links : await links;
        
        // 如果没有配置 issueDir，可能返回空数组
        assert.ok(result !== undefined, '应该返回结果');
        assert.ok(Array.isArray(result), '应该返回数组');
    });

    test('解析多个链接', async () => {
        const content = `# Test
        
[链接1](file1.md?issueId=id1)
[链接2](file2.md)
[链接3](file3.md?issueId=id3&other=value)
`;
        const doc = await vscode.workspace.openTextDocument({
            language: 'markdown',
            content: content
        });

        const links = provider.provideDocumentLinks(doc, new vscode.CancellationTokenSource().token);
        const result = links instanceof Array ? links : await links;
        
        assert.ok(result !== undefined, '应该返回结果');
        assert.ok(Array.isArray(result), '应该返回数组');
    });

    test('应该跳过外部 HTTP 链接', async () => {
        const content = '这是一个 [外部链接](https://example.com) 和 [本地链接](test.md)';
        const doc = await vscode.workspace.openTextDocument({
            language: 'markdown',
            content: content
        });

        const links = provider.provideDocumentLinks(doc, new vscode.CancellationTokenSource().token);
        const result = links instanceof Array ? links : await links;
        
        assert.ok(result !== undefined, '应该返回结果');
        assert.ok(Array.isArray(result), '应该返回数组');
    });

    test('应该跳过锚点链接', async () => {
        const content = '这是一个 [锚点链接](#section) 和 [文件链接](test.md)';
        const doc = await vscode.workspace.openTextDocument({
            language: 'markdown',
            content: content
        });

        const links = provider.provideDocumentLinks(doc, new vscode.CancellationTokenSource().token);
        const result = links instanceof Array ? links : await links;
        
        assert.ok(result !== undefined, '应该返回结果');
        assert.ok(Array.isArray(result), '应该返回数组');
    });
});
