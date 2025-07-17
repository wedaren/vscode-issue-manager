import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { AssociationService } from '../associations/associationService';
import { AssociationErrorType } from '../associations/types';
import { IssueTreeNode, TreeData } from '../data/treeManager';
import * as config from '../config';

suite('AssociationService 测试', () => {
  let associationService: AssociationService;
  let getIssueDirStub: any;
  let readTreeStub: any;

  setup(() => {
    associationService = new AssociationService();
    
    // 存根 getIssueDir 函数
    getIssueDirStub = sinon.stub(config, 'getIssueDir').returns('/test/issues');
    
    // 存根 readTree 函数
    const mockTreeData: TreeData = {
      version: '1.0.0',
      lastModified: new Date().toISOString(),
      rootNodes: [
        {
          id: 'root1',
          filePath: 'root1.md',
          children: [
            {
              id: 'child1',
              filePath: 'child1.md',
              children: [
                {
                  id: 'grandchild1',
                  filePath: 'test/file.md', // 匹配目标文件
                  children: []
                }
              ]
            }
          ]
        },
        {
          id: 'root2',
          filePath: 'root2.md',
          children: [
            {
              id: 'child2',
              filePath: 'test/file.md', // 匹配目标文件
              children: []
            }
          ]
        }
      ]
    };
    
    // @ts-ignore - 存根 readTree 函数
    readTreeStub = sinon.stub(require('../data/treeManager'), 'readTree').resolves(mockTreeData);
    
    // 存根 getRelativePath 函数
    // @ts-ignore - 存根 getRelativePath 函数
    sinon.stub(require('../data/treeManager'), 'getRelativePath').callsFake((filePath: string) => {
      if (filePath === '/test/issues/test/file.md') {
        return 'test/file.md';
      }
      return null;
    });
  });

  teardown(() => {
    sinon.restore();
  });

  test('findAssociations 应该找到所有匹配的节点', async () => {
    // 准备测试数据
    const fileUri = vscode.Uri.file('/test/issues/test/file.md');
    
    // 调用被测试的方法
    const result = await associationService.findAssociations(fileUri);
    
    // 验证结果
    assert.strictEqual('type' in result, false, '结果不应该是错误对象');
    if (!('type' in result)) {
      assert.strictEqual(result.hasAssociations, true, '应该找到关联');
      assert.strictEqual(result.paths.length, 2, '应该找到2个路径');
      
      // 验证第一个路径
      assert.strictEqual(result.paths[0].path.length, 3, '第一个路径应该有3个节点');
      assert.strictEqual(result.paths[0].path[0].id, 'root1', '第一个路径的第一个节点应该是 root1');
      assert.strictEqual(result.paths[0].path[1].id, 'child1', '第一个路径的第二个节点应该是 child1');
      assert.strictEqual(result.paths[0].path[2].id, 'grandchild1', '第一个路径的第三个节点应该是 grandchild1');
      
      // 验证第二个路径
      assert.strictEqual(result.paths[1].path.length, 2, '第二个路径应该有2个节点');
      assert.strictEqual(result.paths[1].path[0].id, 'root2', '第二个路径的第一个节点应该是 root2');
      assert.strictEqual(result.paths[1].path[1].id, 'child2', '第二个路径的第二个节点应该是 child2');
    }
  });

  test('findAssociations 应该处理文件不在问题目录内的情况', async () => {
    // 准备测试数据
    const fileUri = vscode.Uri.file('/other/path/file.md');
    
    // 调用被测试的方法
    const result = await associationService.findAssociations(fileUri);
    
    // 验证结果
    assert.strictEqual('type' in result, true, '结果应该是错误对象');
    if ('type' in result) {
      assert.strictEqual(result.type, AssociationErrorType.FILE_NOT_IN_ISSUE_DIR, '错误类型应该是 FILE_NOT_IN_ISSUE_DIR');
      assert.strictEqual(result.message, '文件不在问题目录内', '错误消息应该正确');
    }
  });

  test('findAssociations 应该处理文件未在问题总览中关联的情况', async () => {
    // 修改 getRelativePath 存根以返回不匹配的路径
    // @ts-ignore - 重新存根 getRelativePath 函数
    require('../data/treeManager').getRelativePath = (filePath: string) => 'not/matching/path.md';
    
    // 准备测试数据
    const fileUri = vscode.Uri.file('/test/issues/not/matching/path.md');
    
    // 调用被测试的方法
    const result = await associationService.findAssociations(fileUri);
    
    // 验证结果
    assert.strictEqual('type' in result, true, '结果应该是错误对象');
    if ('type' in result) {
      assert.strictEqual(result.type, AssociationErrorType.FILE_NOT_ASSOCIATED, '错误类型应该是 FILE_NOT_ASSOCIATED');
      assert.strictEqual(result.message, '文件未在问题总览中关联', '错误消息应该正确');
    }
  });

  test('findAssociations 应该处理问题目录未配置的情况', async () => {
    // 修改 getIssueDir 存根以返回 null
    // @ts-ignore - 重新存根 getIssueDir 函数
    config.getIssueDir = () => null;
    
    // 准备测试数据
    const fileUri = vscode.Uri.file('/test/file.md');
    
    // 调用被测试的方法
    const result = await associationService.findAssociations(fileUri);
    
    // 验证结果
    assert.strictEqual('type' in result, true, '结果应该是错误对象');
    if ('type' in result) {
      assert.strictEqual(result.type, AssociationErrorType.ISSUE_DIR_NOT_CONFIGURED, '错误类型应该是 ISSUE_DIR_NOT_CONFIGURED');
      assert.strictEqual(result.message, '问题目录未配置', '错误消息应该正确');
    }
  });

  test('findAssociations 应该处理数据加载失败的情况', async () => {
    // 修改 readTree 存根以返回 null
    // @ts-ignore - 重新存根 readTree 函数
    require('../data/treeManager').readTree = async () => null;
    
    // 准备测试数据
    const fileUri = vscode.Uri.file('/test/issues/test/file.md');
    
    // 调用被测试的方法
    const result = await associationService.findAssociations(fileUri);
    
    // 验证结果
    assert.strictEqual('type' in result, true, '结果应该是错误对象');
    if ('type' in result) {
      assert.strictEqual(result.type, AssociationErrorType.DATA_LOAD_FAILED, '错误类型应该是 DATA_LOAD_FAILED');
      assert.strictEqual(result.message, '无法加载问题总览数据', '错误消息应该正确');
    }
  });

  test('buildPathToNode 应该构建从根节点到指定节点的完整路径', async () => {
    // 先加载树数据
    await associationService.loadTreeData();
    
    // 调用私有方法
    // @ts-ignore - 访问私有方法
    const path = associationService['buildPathToNode']('grandchild1');
    
    // 验证结果
    assert.strictEqual(path.length, 3, '路径应该有3个节点');
    assert.strictEqual(path[0].id, 'root1', '第一个节点应该是 root1');
    assert.strictEqual(path[1].id, 'child1', '第二个节点应该是 child1');
    assert.strictEqual(path[2].id, 'grandchild1', '第三个节点应该是 grandchild1');
  });

  test('buildPathToNode 应该处理节点不存在的情况', async () => {
    // 先加载树数据
    await associationService.loadTreeData();
    
    // 调用私有方法
    // @ts-ignore - 访问私有方法
    const path = associationService['buildPathToNode']('nonexistent');
    
    // 验证结果
    assert.strictEqual(path.length, 0, '不存在的节点应该返回空路径');
  });

  test('findNodesByFilePath 应该找到所有匹配的节点', async () => {
    // 先加载树数据
    await associationService.loadTreeData();
    
    // 调用私有方法
    // @ts-ignore - 访问私有方法
    const nodes = associationService['findNodesByFilePath'](
      // @ts-ignore - 访问私有属性
      associationService['treeData']?.rootNodes || [], 
      'test/file.md'
    );
    
    // 验证结果
    assert.strictEqual(nodes.length, 2, '应该找到2个匹配的节点');
    assert.strictEqual(nodes[0].id, 'grandchild1', '第一个匹配的节点应该是 grandchild1');
    assert.strictEqual(nodes[1].id, 'child2', '第二个匹配的节点应该是 child2');
  });

  test('findNodesByFilePath 应该处理没有匹配节点的情况', async () => {
    // 先加载树数据
    await associationService.loadTreeData();
    
    // 调用私有方法
    // @ts-ignore - 访问私有方法
    const nodes = associationService['findNodesByFilePath'](
      // @ts-ignore - 访问私有属性
      associationService['treeData']?.rootNodes || [], 
      'nonexistent/file.md'
    );
    
    // 验证结果
    assert.strictEqual(nodes.length, 0, '不存在的文件路径应该返回空数组');
  });

  test('refresh 应该重新加载树数据', async () => {
    // 先加载树数据
    await associationService.loadTreeData();
    
    // 修改 readTree 存根以返回不同的数据
    const newMockTreeData: TreeData = {
      version: '1.0.0',
      lastModified: new Date().toISOString(),
      rootNodes: [
        {
          id: 'new_root',
          filePath: 'new_root.md',
          children: []
        }
      ]
    };
    // @ts-ignore - 重新存根 readTree 函数
    require('../data/treeManager').readTree = async () => newMockTreeData;
    
    // 调用 refresh 方法
    await associationService.refresh();
    
    // 验证树数据已更新
    // @ts-ignore - 访问私有属性
    assert.strictEqual(associationService['treeData']?.rootNodes.length, 1, '树数据应该已更新');
    // @ts-ignore - 访问私有属性
    assert.strictEqual(associationService['treeData']?.rootNodes[0].id, 'new_root', '树数据应该包含新的根节点');
  });
});