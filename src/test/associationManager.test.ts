import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { AssociationManager } from '../associations/associationManager';
import { AssociationService } from '../associations/associationService';
import { AssociationResult, AssociationError, AssociationErrorType } from '../associations/types';
import { IssueTreeNode } from '../data/treeManager';

suite('AssociationManager 测试', () => {
  let associationManager: AssociationManager;
  let associationServiceStub: sinon.SinonStubbedInstance<AssociationService>;

  setup(() => {
    // 创建 AssociationService 的存根
    associationServiceStub = sinon.createStubInstance(AssociationService);
    
    // 使用依赖注入替换 AssociationManager 中的 AssociationService
    // @ts-ignore - 私有属性访问
    associationManager = new AssociationManager();
    // @ts-ignore - 私有属性访问
    associationManager['associationService'] = associationServiceStub;
  });

  teardown(() => {
    sinon.restore();
  });

  test('getAssociations 应该返回关联节点数组', async () => {
    // 准备测试数据
    const fileUri = vscode.Uri.file('/test/file.md');
    const mockResult: AssociationResult = {
      targetFileUri: fileUri,
      paths: [
        {
          path: [
            {
              id: 'node1',
              filePath: 'path/to/file1.md',
              resourceUri: vscode.Uri.file('/path/to/file1.md'),
              children: []
            },
            {
              id: 'node2',
              filePath: 'path/to/file2.md',
              resourceUri: vscode.Uri.file('/path/to/file2.md'),
              children: []
            }
          ] as IssueTreeNode[],
          targetNodeId: 'node2'
        }
      ],
      hasAssociations: true
    };

    // 设置存根行为
    associationServiceStub.findAssociations.resolves(mockResult);
    
    // 调用被测试的方法
    const result = await associationManager.getAssociations(fileUri);
    
    // 验证结果
    assert.strictEqual(Array.isArray(result), true, '结果应该是一个数组');
    if (Array.isArray(result)) {
      assert.strictEqual(result.length, 1, '应该有一个根节点');
      assert.strictEqual(result[0].type, 'path', '根节点类型应该是 path');
      assert.strictEqual(result[0].children.length, 2, '应该有两个子节点');
    }
    
    // 验证服务方法被调用
    sinon.assert.calledOnce(associationServiceStub.findAssociations);
    sinon.assert.calledWith(associationServiceStub.findAssociations, fileUri);
  });

  test('getAssociations 应该处理错误情况', async () => {
    // 准备测试数据
    const fileUri = vscode.Uri.file('/test/file.md');
    const mockError: AssociationError = {
      type: AssociationErrorType.FILE_NOT_ASSOCIATED,
      message: '文件未在问题总览中关联'
    };

    // 设置存根行为
    associationServiceStub.findAssociations.resolves(mockError);
    
    // 调用被测试的方法
    const result = await associationManager.getAssociations(fileUri);
    
    // 验证结果
    assert.strictEqual(Array.isArray(result), false, '结果应该是一个错误对象');
    if (!Array.isArray(result)) {
      assert.strictEqual(result.type, AssociationErrorType.FILE_NOT_ASSOCIATED);
      assert.strictEqual(result.message, '文件未在问题总览中关联');
    }
  });

  test('getAssociations 应该处理空文件URI', async () => {
    // 调用被测试的方法，传入 null
    const result = await associationManager.getAssociations(null as unknown as vscode.Uri);
    
    // 验证结果
    assert.strictEqual(Array.isArray(result), false, '结果应该是一个错误对象');
    if (!Array.isArray(result)) {
      assert.strictEqual(result.type, AssociationErrorType.DATA_LOAD_FAILED);
      assert.strictEqual(result.message, '文件URI不能为空');
    }
  });

  test('getAssociations 应该使用缓存', async () => {
    // 准备测试数据
    const fileUri = vscode.Uri.file('/test/file.md');
    const mockResult: AssociationResult = {
      targetFileUri: fileUri,
      paths: [
        {
          path: [
            {
              id: 'node1',
              filePath: 'path/to/file1.md',
              resourceUri: vscode.Uri.file('/path/to/file1.md'),
              children: []
            }
          ] as IssueTreeNode[],
          targetNodeId: 'node1'
        }
      ],
      hasAssociations: true
    };

    // 设置存根行为
    associationServiceStub.findAssociations.resolves(mockResult);
    
    // 第一次调用 - 应该调用服务
    await associationManager.getAssociations(fileUri);
    
    // 第二次调用 - 应该使用缓存
    await associationManager.getAssociations(fileUri);
    
    // 验证服务方法只被调用一次
    sinon.assert.calledOnce(associationServiceStub.findAssociations);
  });

  test('refresh 应该清除缓存', async () => {
    // 准备测试数据
    const fileUri = vscode.Uri.file('/test/file.md');
    const mockResult: AssociationResult = {
      targetFileUri: fileUri,
      paths: [
        {
          path: [
            {
              id: 'node1',
              filePath: 'path/to/file1.md',
              resourceUri: vscode.Uri.file('/path/to/file1.md'),
              children: []
            }
          ] as IssueTreeNode[],
          targetNodeId: 'node1'
        }
      ],
      hasAssociations: true
    };

    // 设置存根行为
    associationServiceStub.findAssociations.resolves(mockResult);
    
    // 第一次调用 - 应该调用服务
    await associationManager.getAssociations(fileUri);
    
    // 刷新 - 应该清除缓存
    await associationManager.refresh();
    
    // 第二次调用 - 应该再次调用服务
    await associationManager.getAssociations(fileUri);
    
    // 验证服务方法被调用两次
    sinon.assert.calledTwice(associationServiceStub.findAssociations);
  });

  // 新增测试 - 测试路径查找逻辑
  test('findAssociations 应该正确查找所有匹配的节点', async () => {
    // 准备测试数据
    const fileUri = vscode.Uri.file('/test/file.md');
    const mockResult: AssociationResult = {
      targetFileUri: fileUri,
      paths: [
        {
          path: [
            {
              id: 'node1',
              filePath: 'path/to/file1.md',
              resourceUri: vscode.Uri.file('/path/to/file1.md'),
              children: []
            },
            {
              id: 'node2',
              filePath: 'test/file.md', // 匹配目标文件
              resourceUri: vscode.Uri.file('/test/file.md'),
              children: []
            }
          ] as IssueTreeNode[],
          targetNodeId: 'node2'
        },
        {
          path: [
            {
              id: 'node3',
              filePath: 'path/to/file3.md',
              resourceUri: vscode.Uri.file('/path/to/file3.md'),
              children: []
            },
            {
              id: 'node4',
              filePath: 'test/file.md', // 匹配目标文件
              resourceUri: vscode.Uri.file('/test/file.md'),
              children: []
            }
          ] as IssueTreeNode[],
          targetNodeId: 'node4'
        }
      ],
      hasAssociations: true
    };

    // 设置存根行为
    associationServiceStub.findAssociations.resolves(mockResult);
    
    // 调用被测试的方法
    const result = await associationManager.getAssociations(fileUri);
    
    // 验证结果
    assert.strictEqual(Array.isArray(result), true, '结果应该是一个数组');
    if (Array.isArray(result)) {
      assert.strictEqual(result.length, 2, '应该有两个根节点');
      assert.strictEqual(result[0].type, 'path', '第一个根节点类型应该是 path');
      assert.strictEqual(result[1].type, 'path', '第二个根节点类型应该是 path');
    }
  });

  // 新增测试 - 测试路径构建算法
  test('deduplicateAndSortPaths 应该去重和排序路径', () => {
    // 创建测试数据 - 包含重复路径
    const paths = [
      {
        path: [
          createMockNode('node1', 'file1.md'),
          createMockNode('node2', 'file2.md')
        ],
        targetNodeId: 'node2'
      },
      {
        path: [
          createMockNode('node1', 'file1.md'),
          createMockNode('node2', 'file2.md')
        ],
        targetNodeId: 'node2'
      },
      {
        path: [
          createMockNode('node3', 'file3.md')
        ],
        targetNodeId: 'node3'
      },
      {
        path: [
          createMockNode('node1', 'file1.md'),
          createMockNode('node4', 'file4.md'),
          createMockNode('node5', 'file5.md')
        ],
        targetNodeId: 'node5'
      }
    ];

    // 调用私有方法
    // @ts-ignore - 访问私有方法
    const result = associationManager['deduplicateAndSortPaths'](paths);

    // 验证结果
    assert.strictEqual(result.length, 3, '应该有3个唯一路径');
    
    // 验证排序 - 按路径长度排序
    assert.strictEqual(result[0].path.length, 1, '最短路径应该在前面');
    assert.strictEqual(result[1].path.length, 2, '中等长度路径应该在中间');
    assert.strictEqual(result[2].path.length, 3, '最长路径应该在最后');
  });

  // 新增测试 - 测试路径构建算法的正确性
  test('buildPathHierarchy 应该构建正确的层次结构', () => {
    // 创建测试数据
    const path = [
      createMockNode('node1', 'file1.md'),
      createMockNode('node2', 'file2.md'),
      createMockNode('node3', 'file3.md')
    ];

    // 调用私有方法
    // @ts-ignore - 访问私有方法
    const result = associationManager['buildPathHierarchy'](path, 0);

    // 验证结果
    assert.ok(result, '应该返回一个根节点');
    assert.strictEqual(result?.type, 'path', '根节点类型应该是 path');
    assert.strictEqual(result?.children.length, 1, '根节点应该有一个子节点');
    
    // 验证第一层子节点
    const firstChild = result?.children[0];
    assert.strictEqual(firstChild?.type, 'issue', '子节点类型应该是 issue');
    assert.strictEqual(firstChild?.label, 'file1', '子节点标签应该是 file1');
    assert.strictEqual(firstChild?.children.length, 1, '第一个子节点应该有一个子节点');
    
    // 验证第二层子节点
    const secondChild = firstChild?.children[0];
    assert.strictEqual(secondChild?.type, 'issue', '子节点类型应该是 issue');
    assert.strictEqual(secondChild?.label, 'file2', '子节点标签应该是 file2');
    assert.strictEqual(secondChild?.children.length, 1, '第二个子节点应该有一个子节点');
    
    // 验证第三层子节点
    const thirdChild = secondChild?.children[0];
    assert.strictEqual(thirdChild?.type, 'issue', '子节点类型应该是 issue');
    assert.strictEqual(thirdChild?.label, 'file3 (当前)', '子节点标签应该是 file3 (当前)');
    assert.strictEqual(thirdChild?.children.length, 0, '第三个子节点不应该有子节点');
  });

  // 新增测试 - 测试路径显示字符串构建
  test('buildPathDisplayString 应该构建正确的路径显示字符串', () => {
    // 创建测试数据
    const path = [
      createMockNode('node1', 'file1.md'),
      createMockNode('node2', 'file2.md'),
      createMockNode('node3', 'file3.md')
    ];

    // 调用私有方法
    // @ts-ignore - 访问私有方法
    const result = associationManager['buildPathDisplayString'](path);

    // 验证结果
    assert.strictEqual(result, 'file1 / file2 / file3', '路径显示字符串应该正确');
  });

  // 新增测试 - 测试标签提取
  test('extractLabelFromPath 应该提取正确的标签', () => {
    // 调用私有方法
    // @ts-ignore - 访问私有方法
    const result1 = associationManager['extractLabelFromPath']('path/to/file.md');
    // @ts-ignore - 访问私有方法
    const result2 = associationManager['extractLabelFromPath']('file.md');
    // @ts-ignore - 访问私有方法
    const result3 = associationManager['extractLabelFromPath']('file');
    // @ts-ignore - 访问私有方法
    const result4 = associationManager['extractLabelFromPath']('');

    // 验证结果
    assert.strictEqual(result1, 'file', '应该提取文件名并移除扩展名');
    assert.strictEqual(result2, 'file', '应该提取文件名并移除扩展名');
    assert.strictEqual(result3, 'file', '应该保留没有扩展名的文件名');
    assert.strictEqual(result4, '未知文件', '空路径应该返回未知文件');
  });

  // 新增测试 - 测试边界条件
  test('deduplicateAndSortPaths 应该处理空路径数组', () => {
    // 调用私有方法
    // @ts-ignore - 访问私有方法
    const result = associationManager['deduplicateAndSortPaths']([]);

    // 验证结果
    assert.strictEqual(result.length, 0, '空路径数组应该返回空数组');
  });

  // 新增测试 - 测试边界条件
  test('deduplicateAndSortPaths 应该处理无效路径', () => {
    // 创建测试数据 - 包含无效路径
    const paths = [
      {
        path: null as unknown as IssueTreeNode[],
        targetNodeId: 'node1'
      },
      {
        path: [],
        targetNodeId: 'node2'
      },
      {
        path: [
          { id: 'node3', filePath: 'file3.md', children: [] }
        ] as IssueTreeNode[],
        targetNodeId: 'node3'
      }
    ];

    // 调用私有方法
    // @ts-ignore - 访问私有方法
    const result = associationManager['deduplicateAndSortPaths'](paths);

    // 验证结果
    assert.strictEqual(result.length, 1, '应该只有一个有效路径');
    assert.strictEqual(result[0].path[0].id, 'node3', '有效路径应该保留');
  });

  // 新增测试 - 测试边界条件
  test('buildPathHierarchy 应该处理空路径', () => {
    // 调用私有方法
    // @ts-ignore - 访问私有方法
    const result1 = associationManager['buildPathHierarchy']([], 0);
    // @ts-ignore - 访问私有方法
    const result2 = associationManager['buildPathHierarchy'](null as unknown as IssueTreeNode[], 0);

    // 验证结果
    assert.strictEqual(result1, null, '空路径应该返回 null');
    assert.strictEqual(result2, null, 'null 路径应该返回 null');
  });

  // 新增测试 - 测试边界条件
  test('buildPathHierarchy 应该处理无效节点', () => {
    // 创建测试数据 - 包含无效节点
    const path = [
      createMockNode('node1', 'file1.md'),
      null as unknown as IssueTreeNode,
      createMockNode('node3', 'file3.md')
    ];

    // 调用私有方法
    // @ts-ignore - 访问私有方法
    const result = associationManager['buildPathHierarchy'](path, 0);

    // 验证结果
    assert.ok(result, '应该返回一个根节点');
    assert.strictEqual(result?.children.length, 1, '根节点应该有一个子节点');
    assert.strictEqual(result?.children[0].children.length, 1, '第一个子节点应该有一个子节点');
  });

  // 新增测试 - 测试异常情况
  test('getAssociations 应该处理服务异常', async () => {
    // 准备测试数据
    const fileUri = vscode.Uri.file('/test/file.md');
    
    // 设置存根行为抛出异常
    associationServiceStub.findAssociations.rejects(new Error('服务异常'));
    
    // 调用被测试的方法
    const result = await associationManager.getAssociations(fileUri);
    
    // 验证结果
    assert.strictEqual(Array.isArray(result), false, '结果应该是一个错误对象');
    if (!Array.isArray(result)) {
      assert.strictEqual(result.type, AssociationErrorType.DATA_LOAD_FAILED);
      assert.strictEqual(result.message, '获取关联数据时发生未知错误');
      assert.strictEqual(result.details, '服务异常');
    }
  });

  // 新增测试 - 测试缓存机制
  test('缓存机制应该在文件修改后失效', async () => {
    // 准备测试数据
    const fileUri = vscode.Uri.file('/test/file.md');
    const mockResult: AssociationResult = {
      targetFileUri: fileUri,
      paths: [
        {
          path: [
            {
              id: 'node1',
              filePath: 'path/to/file1.md',
              resourceUri: vscode.Uri.file('/path/to/file1.md'),
              children: []
            }
          ] as IssueTreeNode[],
          targetNodeId: 'node1'
        }
      ],
      hasAssociations: true
    };

    // 设置存根行为
    associationServiceStub.findAssociations.resolves(mockResult);
    
    // 第一次调用 - 应该调用服务
    await associationManager.getAssociations(fileUri);
    
    // 模拟文件变更事件
    const mockDocument = {
      uri: fileUri,
      languageId: 'markdown'
    };
    // @ts-ignore - 调用私有方法
    associationManager['handleDocumentChange'](mockDocument as vscode.TextDocument);
    
    // 第二次调用 - 缓存应该失效，再次调用服务
    await associationManager.getAssociations(fileUri);
    
    // 验证服务方法被调用两次
    sinon.assert.calledTwice(associationServiceStub.findAssociations);
  });

  // 辅助函数 - 创建模拟节点
  function createMockNode(id: string, filePath: string): IssueTreeNode {
    return {
      id,
      filePath,
      resourceUri: vscode.Uri.file(`/path/to/${filePath}`),
      children: []
    } as IssueTreeNode;
  }
});