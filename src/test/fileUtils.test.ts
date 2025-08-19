/**
 * 文件工具函数测试
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import { getIssueManagerDir, ensureIssueManagerDir, getRSSHistoryFilePath, readYAMLFile, writeYAMLFile } from '../utils/fileUtils';

suite('FileUtils Tests', () => {

    test('应该能够获取.issueManager目录路径', () => {
        const issueManagerDir = getIssueManagerDir();
        
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            assert.ok(issueManagerDir, '应该返回有效的目录路径');
            assert.ok(issueManagerDir!.fsPath.endsWith('.issueManager'), '路径应该以.issueManager结尾');
        } else {
            assert.strictEqual(issueManagerDir, null, '没有工作区时应该返回null');
        }
    });

    test('应该能够创建.issueManager目录', async () => {
        if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
            console.log('跳过测试：没有工作区');
            return;
        }

        const issueManagerDir = await ensureIssueManagerDir();
        assert.ok(issueManagerDir, '应该成功创建或确认目录存在');

        // 验证目录确实存在
        try {
            const stat = await vscode.workspace.fs.stat(issueManagerDir!);
            assert.strictEqual(stat.type, vscode.FileType.Directory, '应该是一个目录');
        } catch (error) {
            assert.fail('目录应该存在');
        }
    });

    test('应该能够写入和读取YAML文件', async () => {
        if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
            console.log('跳过测试：没有工作区');
            return;
        }

        // 确保目录存在
        const issueManagerDir = await ensureIssueManagerDir();
        assert.ok(issueManagerDir, '应该能够创建目录');

        // 创建测试文件路径
        const testFilePath = vscode.Uri.joinPath(issueManagerDir!, 'test.yaml');
        const testData = {
            test: 'data',
            number: 123,
            array: [1, 2, 3],
            nested: { key: 'value' }
        };

        try {
            // 写入文件
            const writeSuccess = await writeYAMLFile(testFilePath, testData);
            assert.strictEqual(writeSuccess, true, '应该成功写入文件');

            // 读取文件
            const readData = await readYAMLFile(testFilePath);
            assert.ok(readData, '应该成功读取文件');
            assert.deepStrictEqual(readData, testData, '读取的数据应该与写入的数据一致');

        } finally {
            // 清理测试文件
            try {
                await vscode.workspace.fs.delete(testFilePath);
            } catch (error) {
                // 忽略清理错误
            }
        }
    });

    test('应该正确处理不存在的YAML文件', async () => {
        if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
            console.log('跳过测试：没有工作区');
            return;
        }

        const issueManagerDir = await ensureIssueManagerDir();
        const nonExistentFile = vscode.Uri.joinPath(issueManagerDir!, 'non-existent.yaml');

        const result = await readYAMLFile(nonExistentFile);
        assert.strictEqual(result, null, '不存在的文件应该返回null');
    });
});
