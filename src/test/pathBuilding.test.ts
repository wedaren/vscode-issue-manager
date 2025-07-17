import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { AssociationManager } from '../associations/associationManager';
import { AssociationPath } from '../associations/types';
import { IssueTreeNode } from '../data/treeManager';

suite('路径构建算法测试', () => {
  let associationManager: AssociationManager;

  setup(() => {
    associationManager = new AssociationManager();
  });

  teardown(() => {
    sinon.restore();
  });

  test('deduplicateAndSortPaths 应该去重和排序路径', () => {
    // 创建测试数据 - 包含重复路径
    const paths: AssociationPath[] = [
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

  test('deduplicateAndSortPaths 应该处理复杂的路径结构', () => {
    // 创建测试数据 - 复杂路径结构
    const paths: AssociationPath[] = [
      // A-B-C-D 路径
      {
        path: [
          createMockNode('nodeA', 'fileA.md'),
          createMockNode('nodeB', 'fileB.md'),
          createMockNode('nodeC', 'fileC.md'),
          createMockNode('nodeD', 'fileD.md')
        ],
        targetNodeId: 'nodeD'
      },
      // B-G 路径
      {
        path: [
          createMockNode('nodeB', 'fileB.md'),
          createMockNode('nodeG', 'fileG.md')
        ],
        targetNodeId: 'nodeG'
      },
      // G-B 路径
      {
        path: [
          createMockNode('nodeG', 'fileG.md'),
          createMockNode('nodeB', 'fileB.md')
        ],
        targetNodeId: 'nodeB'
      },
      // D-F-G-B 路径
      {
        path: [
          createMockNode('nodeD', 'fileD.md'),
          createMockNode('nodeF', 'fileF.md'),
          createMockNode('nodeG', 'fileG.md'),
          createMockNode('nodeB', 'fileB.md')
        ],
        targetNodeId: 'nodeB'
      }
    ];

    // 调用私有方法
    // @ts-ignore - 访问私有方法
    const result = associationManager['deduplicateAndSortPaths'](paths);

    // 验证结果
    assert.strictEqual(result.length, 4, '应该有4个唯一路径');
    
    // 验证排序 - 按路径长度排序
    assert.strictEqual(result[0].path.length, 2, '最短路径应该在前面');
    assert.strictEqual(result[1].path.length, 2, '第二短路径应该在第二位');
    assert.strictEqual(result[2].path.length, 4, '较长路径应该在后面');
    assert.strictEqual(result[3].path.length, 4, '最长路径应该在最后');
  });

  test('buildPathHierarchy 应该处理单节点路径', () => {
    // 创建测试数据 - 单节点路径
    const path = [
      createMockNode('node1', 'file1.md')
    ];

    // 调用私有方法
    // @ts-ignore - 访问私有方法
    const result = associationManager['buildPathHierarchy'](path, 0);

    // 验证结果
    assert.ok(result, '应该返回一个根节点');
    assert.strictEqual(result?.type, 'path', '根节点类型应该是 path');
    assert.strictEqual(result?.children.length, 1, '根节点应该有一个子节点');
    
    // 验证子节点
    const child = result?.children[0];
    assert.strictEqual(child?.type, 'issue', '子节点类型应该是 issue');
    assert.strictEqual(child?.label, 'file1 (当前)', '子节点标签应该是 file1 (当前)');
    assert.strictEqual(child?.children.length, 0, '子节点不应该有子节点');
  });

  test('buildPathHierarchy 应该处理无效的路径索引', () => {
    // 创建测试数据
    const path = [
      createMockNode('node1', 'file1.md'),
      createMockNode('node2', 'file2.md')
    ];

    // 调用私有方法，传入无效的路径索引
    // @ts-ignore - 访问私有方法
    const result1 = associationManager['buildPathHierarchy'](path, -1);
    // @ts-ignore - 访问私有方法
    const result2 = associationManager['buildPathHierarchy'](path, 'invalid' as unknown as number);

    // 验证结果
    assert.ok(result1, '应该返回一个根节点，即使路径索引无效');
    assert.ok(result2, '应该返回一个根节点，即使路径索引无效');
    assert.strictEqual(result1?.pathIndex, 0, '无效的负数索引应该被替换为0');
    assert.strictEqual(result2?.pathIndex, 0, '无效的非数字索引应该被替换为0');
  });

  test('buildPathDisplayString 应该处理特殊字符和空格', () => {
    // 创建测试数据 - 包含特殊字符和空格的路径
    const path = [
      createMockNode('node1', 'file with spaces.md'),
      createMockNode('node2', 'file-with-dashes.md'),
      createMockNode('node3', 'file_with_underscores.md')
    ];

    // 调用私有方法
    // @ts-ignore - 访问私有方法
    const result = associationManager['buildPathDisplayString'](path);

    // 验证结果
    assert.strictEqual(
      result, 
      'file with spaces / file-with-dashes / file_with_underscores', 
      '路径显示字符串应该正确处理特殊字符和空格'
    );
  });

  test('buildPathDisplayString 应该处理无效节点', () => {
    // 创建测试数据 - 包含无效节点
    const path = [
      createMockNode('node1', 'file1.md'),
      null as unknown as IssueTreeNode,
      createMockNode('node3', 'file3.md')
    ];

    // 调用私有方法
    // @ts-ignore - 访问私有方法
    const result = associationManager['buildPathDisplayString'](path);

    // 验证结果
    assert.strictEqual(result, 'file1 / file3', '路径显示字符串应该跳过无效节点');
  });

  test('buildPathDisplayString 应该处理无效的文件路径', () => {
    // 创建测试数据 - 包含无效的文件路径
    const path = [
      createMockNode('node1', 'file1.md'),
      createMockNode('node2', ''),
      createMockNode('node3', null as unknown as string)
    ];

    // 调用私有方法
    // @ts-ignore - 访问私有方法
    const result = associationManager['buildPathDisplayString'](path);

    // 验证结果
    assert.strictEqual(result, 'file1', '路径显示字符串应该跳过无效的文件路径');
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