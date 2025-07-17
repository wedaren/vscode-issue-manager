import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { AssociationManager } from '../associations/associationManager';
import { AssociationService } from '../associations/associationService';
import { AssociationResult, AssociationPath } from '../associations/types';
import { IssueTreeNode, TreeData } from '../data/treeManager';

/**
 * 性能测试套件 - 测试关联功能的性能表现
 */
suite('关联功能性能测试', () => {
  let associationManager: AssociationManager;
  let associationService: AssociationService;
  let clock: sinon.SinonFakeTimers;

  setup(() => {
    // 使用假时钟来控制时间
    clock = sinon.useFakeTimers();
    
    associationManager = new AssociationManager();
    associationService = new AssociationService();
  });

  teardown(() => {
    clock.restore();
    sinon.restore();
    associationManager.dispose();
  });

  /**
   * 创建大规模测试数据
   */
  function createLargeTreeData(nodeCount: number): TreeData {
    const rootNodes: IssueTreeNode[] = [];
    
    // 创建多层嵌套结构
    for (let i = 0; i < Math.ceil(nodeCount / 10); i++) {
      const rootNode: IssueTreeNode = {
        id: `root_${i}`,
        filePath: `root_${i}.md`,
        children: []
      };
      
      // 为每个根节点创建子节点
      for (let j = 0; j < 10 && (i * 10 + j) < nodeCount; j++) {
        const childNode: IssueTreeNode = {
          id: `child_${i}_${j}`,
          filePath: `folder_${i}/child_${j}.md`,
          children: []
        };
        
        // 为部分子节点创建孙节点
        if (j < 5) {
          for (let k = 0; k < 3; k++) {
            childNode.children.push({
              id: `grandchild_${i}_${j}_${k}`,
              filePath: `folder_${i}/subfolder_${j}/grandchild_${k}.md`,
              children: []
            });
          }
        }
        
        rootNode.children.push(childNode);
      }
      
      rootNodes.push(rootNode);
    }

    return {
      version: '1.0.0',
      lastModified: new Date().toISOString(),
      rootNodes
    };
  }

  /**
   * 创建模拟的关联结果
   */
  function createMockAssociationResult(pathCount: number, pathDepth: number): AssociationResult {
    const paths: AssociationPath[] = [];
    
    for (let i = 0; i < pathCount; i++) {
      const path: IssueTreeNode[] = [];
      
      for (let j = 0; j < pathDepth; j++) {
        path.push({
          id: `node_${i}_${j}`,
          filePath: `path_${i}/level_${j}.md`,
          children: []
        });
      }
      
      paths.push({
        path,
        targetNodeId: `node_${i}_${pathDepth - 1}`
      });
    }

    return {
      targetFileUri: vscode.Uri.file('/test/target.md'),
      paths,
      hasAssociations: true
    };
  }

  test('大规模数据下的关联查找性能', async () => {
    // 创建包含1000个节点的大规模数据
    const largeTreeData = createLargeTreeData(1000);
    
    // 存根树数据加载
    const readTreeStub = sinon.stub(require('../data/treeManager'), 'readTree')
      .resolves(largeTreeData);
    
    // 存根配置
    sinon.stub(require('../config'), 'getIssueDir').returns('/test/issues');
    sinon.stub(require('../data/treeManager'), 'getRelativePath')
      .returns('folder_5/child_3.md');

    const fileUri = vscode.Uri.file('/test/issues/folder_5/child_3.md');
    
    // 测量查找性能
    const startTime = Date.now();
    const result = await associationService.findAssociations(fileUri);
    const endTime = Date.now();
    
    const executionTime = endTime - startTime;
    
    // 验证结果正确性
    assert.strictEqual('type' in result, false, '应该成功找到关联');
    if (!('type' in result)) {
      assert.strictEqual(result.hasAssociations, true, '应该找到关联');
      assert.ok(result.paths.length > 0, '应该有关联路径');
    }
    
    // 性能断言 - 大规模数据下查找应该在合理时间内完成
    assert.ok(executionTime < 1000, `查找时间应该小于1秒，实际: ${executionTime}ms`);
    
    console.log(`大规模数据查找性能: ${executionTime}ms (1000个节点)`);
  });

  test('缓存性能测试', async () => {
    const fileUri = vscode.Uri.file('/test/file.md');
    const mockResult = createMockAssociationResult(5, 3);
    
    // 存根服务方法
    const findAssociationsStub = sinon.stub(associationService, 'findAssociations')
      .resolves(mockResult);
    
    // 替换管理器中的服务实例
    // @ts-ignore - 访问私有属性
    associationManager['associationService'] = associationService;
    
    // 第一次调用 - 冷启动
    const startTime1 = Date.now();
    await associationManager.getAssociations(fileUri);
    const coldStartTime = Date.now() - startTime1;
    
    // 第二次调用 - 缓存命中
    const startTime2 = Date.now();
    await associationManager.getAssociations(fileUri);
    const cacheHitTime = Date.now() - startTime2;
    
    // 验证缓存效果
    assert.ok(cacheHitTime < coldStartTime, '缓存命中应该比冷启动更快');
    assert.ok(cacheHitTime < 10, `缓存命中时间应该很短，实际: ${cacheHitTime}ms`);
    
    // 验证服务只被调用一次
    sinon.assert.calledOnce(findAssociationsStub);
    
    console.log(`缓存性能: 冷启动 ${coldStartTime}ms, 缓存命中 ${cacheHitTime}ms`);
  });

  test('路径去重和排序性能', async () => {
    // 创建大量重复路径
    const duplicatePaths: AssociationPath[] = [];
    const uniquePathCount = 50;
    const duplicateCount = 10;
    
    for (let i = 0; i < uniquePathCount; i++) {
      const basePath: IssueTreeNode[] = [
        { id: `node_${i}_0`, filePath: `path_${i}/level_0.md`, children: [] },
        { id: `node_${i}_1`, filePath: `path_${i}/level_1.md`, children: [] },
        { id: `node_${i}_2`, filePath: `path_${i}/level_2.md`, children: [] }
      ];
      
      // 创建重复路径
      for (let j = 0; j < duplicateCount; j++) {
        duplicatePaths.push({
          path: [...basePath],
          targetNodeId: `node_${i}_2`
        });
      }
    }
    
    const mockResult: AssociationResult = {
      targetFileUri: vscode.Uri.file('/test/target.md'),
      paths: duplicatePaths,
      hasAssociations: true
    };
    
    // 测量去重和排序性能
    const startTime = Date.now();
    // @ts-ignore - 访问私有方法
    const uniquePaths = associationManager['deduplicateAndSortPaths'](mockResult.paths);
    const endTime = Date.now();
    
    const executionTime = endTime - startTime;
    
    // 验证去重效果
    assert.strictEqual(uniquePaths.length, uniquePathCount, '应该正确去重');
    
    // 性能断言
    assert.ok(executionTime < 100, `去重排序时间应该小于100ms，实际: ${executionTime}ms`);
    
    console.log(`路径去重排序性能: ${executionTime}ms (${duplicatePaths.length} -> ${uniquePaths.length})`);
  });

  test('层次结构构建性能', async () => {
    // 创建深层路径
    const deepPath: IssueTreeNode[] = [];
    const pathDepth = 20;
    
    for (let i = 0; i < pathDepth; i++) {
      deepPath.push({
        id: `deep_node_${i}`,
        filePath: `level_${i}/file_${i}.md`,
        children: []
      });
    }
    
    // 测量层次结构构建性能
    const startTime = Date.now();
    // @ts-ignore - 访问私有方法
    const hierarchy = associationManager['buildPathHierarchy'](deepPath, 0);
    const endTime = Date.now();
    
    const executionTime = endTime - startTime;
    
    // 验证结构正确性
    assert.ok(hierarchy, '应该成功构建层次结构');
    assert.strictEqual(hierarchy?.type, 'path', '根节点类型应该正确');
    
    // 验证深度
    let currentNode = hierarchy;
    let actualDepth = 0;
    while (currentNode && currentNode.children.length > 0) {
      currentNode = currentNode.children[0];
      actualDepth++;
    }
    assert.strictEqual(actualDepth, pathDepth, '层次深度应该正确');
    
    // 性能断言
    assert.ok(executionTime < 50, `层次结构构建时间应该小于50ms，实际: ${executionTime}ms`);
    
    console.log(`层次结构构建性能: ${executionTime}ms (深度: ${pathDepth})`);
  });

  test('缓存LRU淘汰性能', async () => {
    // 获取缓存最大大小
    // @ts-ignore - 访问私有属性
    const maxCacheSize = associationManager['MAX_CACHE_SIZE'];
    
    const mockResult = createMockAssociationResult(1, 2);
    
    // 存根服务方法
    sinon.stub(associationService, 'findAssociations').resolves(mockResult);
    // @ts-ignore - 替换服务实例
    associationManager['associationService'] = associationService;
    
    // 填满缓存
    const fileUris: vscode.Uri[] = [];
    for (let i = 0; i < maxCacheSize + 10; i++) {
      fileUris.push(vscode.Uri.file(`/test/file_${i}.md`));
    }
    
    // 测量缓存填充和淘汰性能
    const startTime = Date.now();
    
    for (const uri of fileUris) {
      await associationManager.getAssociations(uri);
    }
    
    const endTime = Date.now();
    const executionTime = endTime - startTime;
    
    // 验证缓存大小限制
    const cacheStats = associationManager.getCacheStats();
    assert.ok(cacheStats.size <= maxCacheSize, '缓存大小应该不超过限制');
    
    // 性能断言
    const avgTimePerOperation = executionTime / fileUris.length;
    assert.ok(avgTimePerOperation < 10, `平均操作时间应该小于10ms，实际: ${avgTimePerOperation}ms`);
    
    console.log(`缓存LRU性能: ${executionTime}ms (${fileUris.length}次操作)`);
  });

  test('哈希计算性能', async () => {
    // 创建大规模树数据
    const largeTreeData = createLargeTreeData(500);
    
    // 存根树数据加载
    sinon.stub(require('../data/treeManager'), 'readTree').resolves(largeTreeData);
    
    // 替换服务实例
    // @ts-ignore - 访问私有属性
    associationManager['associationService'] = associationService;
    
    // 测量哈希计算性能
    const startTime = Date.now();
    // @ts-ignore - 调用私有方法
    const hash1 = await associationManager['getTreeDataHash']();
    const firstCallTime = Date.now() - startTime;
    
    // 第二次调用应该使用缓存
    const startTime2 = Date.now();
    // @ts-ignore - 调用私有方法
    const hash2 = await associationManager['getTreeDataHash']();
    const secondCallTime = Date.now() - startTime2;
    
    // 验证哈希一致性
    assert.strictEqual(hash1, hash2, '哈希值应该一致');
    
    // 验证缓存效果
    assert.ok(secondCallTime < firstCallTime, '缓存的哈希计算应该更快');
    assert.ok(secondCallTime < 5, `缓存哈希计算应该很快，实际: ${secondCallTime}ms`);
    
    console.log(`哈希计算性能: 首次 ${firstCallTime}ms, 缓存 ${secondCallTime}ms`);
  });

  test('并发访问性能', async () => {
    const concurrentCount = 20;
    const fileUri = vscode.Uri.file('/test/concurrent.md');
    const mockResult = createMockAssociationResult(3, 2);
    
    // 存根服务方法
    const findAssociationsStub = sinon.stub(associationService, 'findAssociations')
      .resolves(mockResult);
    
    // @ts-ignore - 替换服务实例
    associationManager['associationService'] = associationService;
    
    // 创建并发请求
    const promises: Promise<any>[] = [];
    const startTime = Date.now();
    
    for (let i = 0; i < concurrentCount; i++) {
      promises.push(associationManager.getAssociations(fileUri));
    }
    
    // 等待所有请求完成
    const results = await Promise.all(promises);
    const endTime = Date.now();
    
    const executionTime = endTime - startTime;
    
    // 验证所有结果都正确
    results.forEach(result => {
      assert.ok(Array.isArray(result), '每个结果都应该是数组');
    });
    
    // 验证缓存效果 - 服务应该只被调用一次
    sinon.assert.calledOnce(findAssociationsStub);
    
    // 性能断言
    const avgTimePerRequest = executionTime / concurrentCount;
    assert.ok(avgTimePerRequest < 10, `平均请求时间应该小于10ms，实际: ${avgTimePerRequest}ms`);
    
    console.log(`并发访问性能: ${executionTime}ms (${concurrentCount}个并发请求)`);
  });

  test('内存使用优化测试', async () => {
    const iterationCount = 100;
    const mockResult = createMockAssociationResult(10, 4);
    
    // 存根服务方法
    sinon.stub(associationService, 'findAssociations').resolves(mockResult);
    // @ts-ignore - 替换服务实例
    associationManager['associationService'] = associationService;
    
    // 记录初始缓存状态
    const initialStats = associationManager.getCacheStats();
    
    // 执行大量操作
    for (let i = 0; i < iterationCount; i++) {
      const fileUri = vscode.Uri.file(`/test/memory_test_${i}.md`);
      await associationManager.getAssociations(fileUri);
      
      // 每10次操作检查一次内存使用
      if (i % 10 === 0) {
        const currentStats = associationManager.getCacheStats();
        // 缓存大小应该受到限制
        assert.ok(currentStats.size <= currentStats.maxSize, 
          `缓存大小应该受限制: ${currentStats.size}/${currentStats.maxSize}`);
      }
    }
    
    // 最终检查
    const finalStats = associationManager.getCacheStats();
    assert.ok(finalStats.size <= finalStats.maxSize, '最终缓存大小应该受限制');
    
    // 验证缓存命中率
    const hitRate = associationManager.getCacheHitRate();
    console.log(`内存优化测试: 缓存命中率 ${(hitRate * 100).toFixed(2)}%, 最终缓存大小 ${finalStats.size}/${finalStats.maxSize}`);
  });
});