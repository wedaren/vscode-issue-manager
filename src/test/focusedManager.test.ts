/**
 * focusedManager.test.ts
 * 测试关注管理器的功能，特别是重复添加时的行为
 */
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import { addFocus, readFocused, writeFocused, removeFocus, pinFocus, trimFocusedToMaxItems } from '../data/focusedManager';

suite('FocusedManager Test Suite', () => {
    let testIssueDir: vscode.Uri;
    let focusedFilePath: vscode.Uri;
    let originalConfig: string | undefined;

    suiteSetup(async () => {
        // 创建临时测试目录
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            throw new Error('需要打开一个工作区来运行测试');
        }
        
        testIssueDir = vscode.Uri.joinPath(workspaceFolders[0].uri, '.test-issues');
        const dataDir = vscode.Uri.joinPath(testIssueDir, '.issueManager');
        focusedFilePath = vscode.Uri.joinPath(dataDir, 'focused.json');

        // 保存原始配置
        const config = vscode.workspace.getConfiguration('issueManager');
        originalConfig = config.get<string>('issueDir');

        // 创建测试目录
        try {
            await vscode.workspace.fs.createDirectory(testIssueDir);
            await vscode.workspace.fs.createDirectory(dataDir);
        } catch (e) {
            // 目录可能已存在
        }

        // 设置测试配置
        await config.update('issueDir', testIssueDir.fsPath, vscode.ConfigurationTarget.Workspace);
    });

    suiteTeardown(async () => {
        // 恢复原始配置
        const config = vscode.workspace.getConfiguration('issueManager');
        await config.update('issueDir', originalConfig, vscode.ConfigurationTarget.Workspace);

        // 清理测试目录
        try {
            await vscode.workspace.fs.delete(testIssueDir, { recursive: true });
        } catch (e) {
            // 忽略删除错误
        }
    });

    setup(async () => {
        // 每个测试前清空focused.json
        try {
            await vscode.workspace.fs.delete(focusedFilePath);
        } catch (e) {
            // 文件可能不存在
        }
    });

    test('添加新关注节点到空列表', async () => {
        await addFocus(['node1', 'node2']);
        const data = await readFocused();
        
        // 由于reverse处理顺序，node2先处理，node1后处理，所以node1在最前
        assert.strictEqual(data.focusList.length, 2);
        assert.strictEqual(data.focusList[0], 'node1');
        assert.strictEqual(data.focusList[1], 'node2');
    });

    test('重复添加已存在的节点应移动到最前面', async () => {
        // 先添加三个节点
        await addFocus(['node1', 'node2', 'node3']);
        let data = await readFocused();
        // 处理顺序: node3, node2, node1 -> 最终 node1 在最前
        assert.deepStrictEqual(data.focusList, ['node1', 'node2', 'node3']);

        // 重复添加node3（当前在最后）
        await addFocus(['node3']);
        data = await readFocused();
        
        // node3应该移到最前面
        assert.strictEqual(data.focusList.length, 3);
        assert.strictEqual(data.focusList[0], 'node3');
        assert.strictEqual(data.focusList[1], 'node1');
        assert.strictEqual(data.focusList[2], 'node2');
    });

    test('重复添加中间位置的节点应移动到最前面', async () => {
        // 先添加三个节点
        await addFocus(['node1', 'node2', 'node3']);
        let data = await readFocused();
        assert.deepStrictEqual(data.focusList, ['node1', 'node2', 'node3']);

        // 重复添加node2（当前在中间）
        await addFocus(['node2']);
        data = await readFocused();
        
        // node2应该移到最前面
        assert.strictEqual(data.focusList.length, 3);
        assert.strictEqual(data.focusList[0], 'node2');
        assert.strictEqual(data.focusList[1], 'node1');
        assert.strictEqual(data.focusList[2], 'node3');
    });

    test('重复添加已在第一位的节点不应改变顺序', async () => {
        // 先添加三个节点
        await addFocus(['node1', 'node2', 'node3']);
        let data = await readFocused();
        assert.deepStrictEqual(data.focusList, ['node1', 'node2', 'node3']);

        // 重复添加node1（当前已在第一位）
        await addFocus(['node1']);
        data = await readFocused();
        
        // 顺序应该保持不变
        assert.strictEqual(data.focusList.length, 3);
        assert.deepStrictEqual(data.focusList, ['node1', 'node2', 'node3']);
    });

    test('批量添加时包含已存在和新节点', async () => {
        // 先添加一些节点
        await addFocus(['node1', 'node2', 'node3']);
        let data = await readFocused();
        assert.deepStrictEqual(data.focusList, ['node1', 'node2', 'node3']);

        // 批量添加，包含已存在的node2和新节点node4
        await addFocus(['node2', 'node4']);
        data = await readFocused();
        
        // reverse后处理顺序: node4, node2
        // node4添加到最前: ['node4', 'node1', 'node2', 'node3']
        // node2从索引2移到最前: ['node2', 'node4', 'node1', 'node3']
        assert.strictEqual(data.focusList.length, 4);
        assert.strictEqual(data.focusList[0], 'node2');
        assert.strictEqual(data.focusList[1], 'node4');
        assert.strictEqual(data.focusList[2], 'node1');
        assert.strictEqual(data.focusList[3], 'node3');
    });

    test('移除关注节点', async () => {
        await addFocus(['node1', 'node2', 'node3']);
        await removeFocus('node2');
        const data = await readFocused();
        
        assert.strictEqual(data.focusList.length, 2);
        assert.strictEqual(data.focusList[0], 'node1');
        assert.strictEqual(data.focusList[1], 'node3');
    });

    test('置顶关注节点', async () => {
        await addFocus(['node1', 'node2', 'node3']);
        let data = await readFocused();
        assert.deepStrictEqual(data.focusList, ['node1', 'node2', 'node3']);

        // 置顶node3（当前在最后）
        await pinFocus('node3');
        data = await readFocused();
        
        assert.strictEqual(data.focusList.length, 3);
        assert.strictEqual(data.focusList[0], 'node3');
        assert.strictEqual(data.focusList[1], 'node1');
        assert.strictEqual(data.focusList[2], 'node2');
    });

    test('置顶已在第一位的节点不应改变顺序', async () => {
        await addFocus(['node1', 'node2', 'node3']);
        let data = await readFocused();
        assert.deepStrictEqual(data.focusList, ['node1', 'node2', 'node3']);

        // 置顶node1（已在第一位）
        await pinFocus('node1');
        data = await readFocused();
        
        // 顺序应该保持不变
        assert.deepStrictEqual(data.focusList, ['node1', 'node2', 'node3']);
    });

    test('添加超过最大限制时应移除最旧的项目', async () => {
        // 设置测试配置 - 最大10项
        const config = vscode.workspace.getConfiguration('issueManager');
        const originalMaxItems = config.get<number>('focused.maxItems');
        await config.update('focused.maxItems', 5, vscode.ConfigurationTarget.Workspace);

        try {
            // 添加5个节点
            await addFocus(['node1', 'node2', 'node3', 'node4', 'node5']);
            let data = await readFocused();
            assert.strictEqual(data.focusList.length, 5);
            assert.deepStrictEqual(data.focusList, ['node1', 'node2', 'node3', 'node4', 'node5']);

            // 再添加一个新节点，应该移除最后一个
            await addFocus(['node6']);
            data = await readFocused();
            assert.strictEqual(data.focusList.length, 5);
            assert.strictEqual(data.focusList[0], 'node6');
            assert.strictEqual(data.focusList[4], 'node4');
            assert.strictEqual(data.focusList.indexOf('node5'), -1); // node5应该被移除

            // 再添加两个新节点，应该移除最后两个
            await addFocus(['node7', 'node8']);
            data = await readFocused();
            assert.strictEqual(data.focusList.length, 5);
            assert.deepStrictEqual(data.focusList, ['node7', 'node8', 'node6', 'node1', 'node2']);
        } finally {
            // 恢复原始配置
            await config.update('focused.maxItems', originalMaxItems, vscode.ConfigurationTarget.Workspace);
        }
    });

    test('重复添加不应触发移除旧项目（列表未超限）', async () => {
        const config = vscode.workspace.getConfiguration('issueManager');
        const originalMaxItems = config.get<number>('focused.maxItems');
        await config.update('focused.maxItems', 5, vscode.ConfigurationTarget.Workspace);

        try {
            // 添加5个节点
            await addFocus(['node1', 'node2', 'node3', 'node4', 'node5']);
            let data = await readFocused();
            assert.strictEqual(data.focusList.length, 5);

            // 重复添加一个已存在的节点（移到最前）
            await addFocus(['node3']);
            data = await readFocused();
            
            // 列表长度不变，node3移到最前
            assert.strictEqual(data.focusList.length, 5);
            assert.deepStrictEqual(data.focusList, ['node3', 'node1', 'node2', 'node4', 'node5']);
        } finally {
            // 恢复原始配置
            await config.update('focused.maxItems', originalMaxItems, vscode.ConfigurationTarget.Workspace);
        }
    });

    test('trimFocusedToMaxItems 应按配置裁剪列表', async () => {
        const config = vscode.workspace.getConfiguration('issueManager');
        const originalMaxItems = config.get<number>('focused.maxItems');

        try {
            // 添加8个节点
            await addFocus(['node1', 'node2', 'node3', 'node4', 'node5', 'node6', 'node7', 'node8']);
            let data = await readFocused();
            assert.strictEqual(data.focusList.length, 8);

            // 设置maxItems为5
            await config.update('focused.maxItems', 5, vscode.ConfigurationTarget.Workspace);
            
            // 调用trim函数

            const removedCount = await trimFocusedToMaxItems();
            
            // 应该移除3个节点
            assert.strictEqual(removedCount, 3);
            
            // 验证列表长度
            data = await readFocused();
            assert.strictEqual(data.focusList.length, 5);
            
            // 验证保留的是前5个（最新的）
            assert.deepStrictEqual(data.focusList, ['node1', 'node2', 'node3', 'node4', 'node5']);
        } finally {
            // 恢复原始配置
            await config.update('focused.maxItems', originalMaxItems, vscode.ConfigurationTarget.Workspace);
        }
    });

    test('trimFocusedToMaxItems 在未超限时不应修改列表', async () => {
        const config = vscode.workspace.getConfiguration('issueManager');
        const originalMaxItems = config.get<number>('focused.maxItems');

        try {
            // 添加3个节点
            await addFocus(['node1', 'node2', 'node3']);
            let data = await readFocused();
            assert.strictEqual(data.focusList.length, 3);

            // 设置maxItems为5（大于当前数量）
            await config.update('focused.maxItems', 5, vscode.ConfigurationTarget.Workspace);
            
            // 调用trim函数
            const removedCount = await trimFocusedToMaxItems();
            
            // 不应移除任何节点
            assert.strictEqual(removedCount, 0);
            
            // 验证列表未变
            data = await readFocused();
            assert.strictEqual(data.focusList.length, 3);
            assert.deepStrictEqual(data.focusList, ['node1', 'node2', 'node3']);
        } finally {
            // 恢复原始配置
            await config.update('focused.maxItems', originalMaxItems, vscode.ConfigurationTarget.Workspace);
        }
    });
});
