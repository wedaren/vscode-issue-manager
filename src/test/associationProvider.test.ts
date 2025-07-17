import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { AssociationProvider } from '../views/AssociationProvider';
import { AssociationManager } from '../associations/associationManager';
import { AssociationNode, AssociationError, AssociationErrorType } from '../associations/types';

suite('AssociationProvider 测试', () => {
  let associationProvider: AssociationProvider;
  let associationManagerStub: sinon.SinonStubbedInstance<AssociationManager>;
  let mockContext: vscode.ExtensionContext;
  let onDidChangeTreeDataSpy: sinon.SinonSpy;

  setup(() => {
    // 创建模拟的 ExtensionContext
    mockContext = {
      subscriptions: [],
    } as unknown as vscode.ExtensionContext;

    // 创建 AssociationManager 的存根
    associationManagerStub = sinon.createStubInstance(AssociationManager);
    
    // 创建 AssociationProvider 实例
    associationProvider = new AssociationProvider(mockContext);
    
    // 替换 AssociationManager
    // @ts-ignore - 私有属性访问
    associationProvider['associationManager'] = associationManagerStub;
    
    // 监视 onDidChangeTreeData 事件
    // @ts-ignore - 私有属性访问
    onDidChangeTreeDataSpy = sinon.spy(associationProvider['_onDidChangeTreeData'], 'fire');
  });

  teardown(() => {
    sinon.restore();
  });

  test('updateCurrentFile 应该更新当前文件并刷新关联', async () => {
    // 准备测试数据
    const fileUri = vscode.Uri.file('/test/file.md');
    
    // 设置存根行为
    associationManagerStub.getAssociations.resolves([]);
    
    // 调用被测试的方法
    await associationProvider.updateCurrentFile(fileUri);
    
    // 验证当前文件已更新
    // @ts-ignore - 私有属性访问
    assert.strictEqual(associationProvider['currentFileUri'], fileUri);
    
    // 验证刷新方法被调用
    sinon.assert.calledOnce(associationManagerStub.getAssociations);
    sinon.assert.calledWith(associationManagerStub.getAssociations, fileUri);
    
    // 验证树数据变更事件被触发
    sinon.assert.called(onDidChangeTreeDataSpy);
  });

  test('refreshAssociations 应该处理成功情况', async () => {
    // 准备测试数据
    const fileUri = vscode.Uri.file('/test/file.md');
    const mockNodes: AssociationNode[] = [{
      id: 'root',
      type: 'path',
      label: 'Test',
      children: []
    }];
    
    // 设置当前文件
    // @ts-ignore - 私有属性访问
    associationProvider['currentFileUri'] = fileUri;
    
    // 设置存根行为
    associationManagerStub.getAssociations.resolves(mockNodes);
    
    // 调用被测试的方法
    await associationProvider.refreshAssociations();
    
    // 验证关联节点已更新
    // @ts-ignore - 私有属性访问
    assert.deepStrictEqual(associationProvider['associationNodes'], mockNodes);
    
    // 验证树数据变更事件被触发
    sinon.assert.calledTwice(onDidChangeTreeDataSpy);
  });

  test('refreshAssociations 应该处理错误情况', async () => {
    // 准备测试数据
    const fileUri = vscode.Uri.file('/test/file.md');
    const mockError: AssociationError = {
      type: AssociationErrorType.FILE_NOT_ASSOCIATED,
      message: '文件未在问题总览中关联'
    };
    
    // 设置当前文件
    // @ts-ignore - 私有属性访问
    associationProvider['currentFileUri'] = fileUri;
    
    // 设置存根行为
    associationManagerStub.getAssociations.resolves(mockError);
    
    // 调用被测试的方法
    await associationProvider.refreshAssociations();
    
    // 验证错误节点已创建
    // @ts-ignore - 私有属性访问
    const nodes = associationProvider['associationNodes'];
    assert.strictEqual(nodes.length, 1);
    assert.strictEqual(nodes[0].type, 'error');
    assert.strictEqual(nodes[0].label, '⚠️ 文件未在问题总览中关联');
    
    // 验证树数据变更事件被触发
    sinon.assert.calledTwice(onDidChangeTreeDataSpy);
  });

  test('getTreeItem 应该返回正确的树项', async () => {
    // 准备测试数据
    const mockNode: AssociationNode = {
      id: 'test',
      type: 'path',
      label: 'Test Node',
      children: []
    };
    
    // 调用被测试的方法
    const treeItem = await associationProvider.getTreeItem(mockNode);
    
    // 验证树项属性
    assert.strictEqual(treeItem.id, 'test');
    assert.strictEqual(treeItem.label, 'Test Node');
    assert.strictEqual(treeItem.collapsibleState, vscode.TreeItemCollapsibleState.None);
  });

  test('getChildren 应该返回子节点', async () => {
    // 准备测试数据
    const mockParent: AssociationNode = {
      id: 'parent',
      type: 'path',
      label: 'Parent',
      children: [{
        id: 'child',
        type: 'issue',
        label: 'Child',
        children: []
      }]
    };
    
    // 设置关联节点
    // @ts-ignore - 私有属性访问
    associationProvider['associationNodes'] = [mockParent];
    
    // 调用被测试的方法 - 获取根节点
    const rootNodes = await associationProvider.getChildren();
    
    // 验证根节点
    assert.strictEqual(rootNodes.length, 1);
    assert.strictEqual(rootNodes[0].id, 'parent');
    
    // 调用被测试的方法 - 获取子节点
    const childNodes = await associationProvider.getChildren(mockParent);
    
    // 验证子节点
    assert.strictEqual(childNodes.length, 1);
    assert.strictEqual(childNodes[0].id, 'child');
  });

  test('createLoadingNodes 应该创建加载状态节点', () => {
    // 设置当前文件
    // @ts-ignore - 私有属性访问
    associationProvider['currentFileUri'] = vscode.Uri.file('/test/file.md');
    
    // 调用私有方法
    // @ts-ignore - 访问私有方法
    const nodes = associationProvider['createLoadingNodes']();
    
    // 验证节点结构
    assert.strictEqual(nodes.length, 1);
    assert.strictEqual(nodes[0].type, 'loading');
    assert.strictEqual(nodes[0].children.length, 7); // 7个加载步骤子节点
  });

  test('createEmptyNodes 应该创建空状态节点', () => {
    // 设置当前文件
    // @ts-ignore - 私有属性访问
    associationProvider['currentFileUri'] = vscode.Uri.file('/test/file.md');
    
    // 调用私有方法
    // @ts-ignore - 访问私有方法
    const nodes = associationProvider['createEmptyNodes']();
    
    // 验证节点结构
    assert.strictEqual(nodes.length, 1);
    assert.strictEqual(nodes[0].type, 'empty');
    assert.strictEqual(nodes[0].children.length, 5); // 5个空状态子节点
  });

  test('createErrorNodes 应该创建错误状态节点', () => {
    // 准备测试数据
    const mockError: AssociationError = {
      type: AssociationErrorType.FILE_NOT_ASSOCIATED,
      message: '文件未在问题总览中关联'
    };
    
    // 调用私有方法
    // @ts-ignore - 访问私有方法
    const nodes = associationProvider['createErrorNodes'](mockError);
    
    // 验证节点结构
    assert.strictEqual(nodes.length, 1);
    assert.strictEqual(nodes[0].type, 'error');
    assert.strictEqual(nodes[0].label, '⚠️ 文件未在问题总览中关联');
  });
});