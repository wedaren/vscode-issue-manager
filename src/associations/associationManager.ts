import * as vscode from 'vscode';
import { AssociationService } from './associationService';
import { 
  AssociationNode, 
  AssociationResult, 
  AssociationError, 
  AssociationErrorType,
  AssociationPath,
  CachedAssociationData
} from './types';
import { IssueTreeNode } from '../data/treeManager';
import { debounce } from '../utils/debounce';

/**
 * 关联管理器类，负责管理文件与问题总览的关联关系
 * 提供统一的接口来处理关联查找、数据转换和缓存管理
 */
export class AssociationManager {
  private associationService: AssociationService;
  private associationCache: Map<string, CachedAssociationData> = new Map();
  private treeDataHash: string = '';
  private readonly CACHE_DURATION = 300000; // 5分钟缓存
  private readonly MAX_CACHE_SIZE = 100; // 最大缓存条目数
  private cacheAccessTimes: Map<string, number> = new Map(); // LRU缓存访问时间
  private cacheHits: number = 0;
  private cacheMisses: number = 0;
  private fileWatchers: Map<string, vscode.Disposable> = new Map(); // 文件监听器
  private treeDataChangeEmitter: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
  readonly onTreeDataChanged: vscode.Event<void> = this.treeDataChangeEmitter.event;
  
  // 防抖更新树数据哈希
  private debouncedUpdateTreeHash = debounce(async () => {
    this.treeDataHash = '';
    await this.getTreeDataHash();
    this.treeDataChangeEmitter.fire();
  }, 1000);

  constructor() {
    this.associationService = new AssociationService();
    
    // 监听文件变更事件，智能更新缓存
    vscode.workspace.onDidSaveTextDocument(this.handleDocumentChange, this);
    vscode.workspace.onDidDeleteFiles(this.handleFileDelete, this);
    vscode.workspace.onDidCreateFiles(this.handleFileCreate, this);
  }

  /**
   * 获取指定文件的关联节点数据
   * @param fileUri 文件URI
   * @returns 关联节点数组或错误信息
   */
  async getAssociations(fileUri: vscode.Uri): Promise<AssociationNode[] | AssociationError> {
    try {
      // 输入验证
      if (!fileUri) {
        return {
          type: AssociationErrorType.DATA_LOAD_FAILED,
          message: '文件URI不能为空'
        };
      }

      const cacheKey = fileUri.toString();
      
      // 检查缓存有效性
      const cachedData = await this.getCachedData(cacheKey, fileUri);
      if (cachedData) {
        return cachedData.nodes;
      }

      // 查找关联关系
      const result = await this.associationService.findAssociations(fileUri);
      
      if ('type' in result) {
        // 返回错误，添加额外的上下文信息
        const error = result as AssociationError;
        return {
          ...error,
          details: error.details || `处理文件时出错: ${fileUri.fsPath}`
        };
      }

      // 验证结果数据
      const associationResult = result as AssociationResult;
      if (!associationResult.paths || !Array.isArray(associationResult.paths)) {
        return {
          type: AssociationErrorType.DATA_LOAD_FAILED,
          message: '关联数据格式错误',
          details: '路径数据不是有效的数组格式'
        };
      }

      // 转换为关联节点数据
      const associationNodes = this.convertToAssociationNodes(associationResult);
      
      // 验证转换结果
      if (!Array.isArray(associationNodes)) {
        return {
          type: AssociationErrorType.DATA_LOAD_FAILED,
          message: '数据转换失败',
          details: '无法将关联数据转换为节点格式'
        };
      }
      
      // 更新缓存
      await this.setCachedData(cacheKey, associationNodes, fileUri);
      
      return associationNodes;
    } catch (error) {
      // 捕获所有未预期的错误
      return {
        type: AssociationErrorType.DATA_LOAD_FAILED,
        message: '获取关联数据时发生未知错误',
        details: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * 刷新关联数据
   */
  async refresh(): Promise<void> {
    try {
      await this.associationService.refresh();
      this.clearCache();
    } catch (error) {
      console.error('刷新关联数据失败:', error);
      // 即使刷新失败，也要清除缓存以避免使用过期数据
      this.clearCache();
      throw error;
    }
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.associationCache.clear();
    this.cacheAccessTimes.clear();
    this.treeDataHash = '';
  }

  /**
   * 获取缓存数据（智能缓存检查）
   * @param cacheKey 缓存键
   * @param fileUri 文件URI
   * @returns 缓存的数据或null
   */
  private async getCachedData(cacheKey: string, fileUri: vscode.Uri): Promise<CachedAssociationData | null> {
    const cachedData = this.associationCache.get(cacheKey);
    if (!cachedData) {
      this.cacheMisses++;
      return null;
    }

    // 更新访问时间和次数
    this.cacheAccessTimes.set(cacheKey, Date.now());
    cachedData.accessCount++;

    // 检查缓存是否过期
    const now = Date.now();
    if (now - cachedData.timestamp > this.CACHE_DURATION) {
      this.associationCache.delete(cacheKey);
      this.cacheAccessTimes.delete(cacheKey);
      this.cacheMisses++;
      return null;
    }

    // 检查文件是否被修改
    try {
      const fileStat = await vscode.workspace.fs.stat(fileUri);
      if (cachedData.fileModTime && fileStat.mtime !== cachedData.fileModTime) {
        this.associationCache.delete(cacheKey);
        this.cacheAccessTimes.delete(cacheKey);
        this.cacheMisses++;
        return null;
      }
    } catch (error) {
      // 文件可能不存在，删除缓存
      this.associationCache.delete(cacheKey);
      this.cacheAccessTimes.delete(cacheKey);
      this.cacheMisses++;
      return null;
    }

    // 检查树数据是否变化
    const currentTreeHash = await this.getTreeDataHash();
    if (cachedData.dataHash !== currentTreeHash) {
      this.associationCache.delete(cacheKey);
      this.cacheAccessTimes.delete(cacheKey);
      this.cacheMisses++;
      return null;
    }

    // 缓存命中
    this.cacheHits++;
    return cachedData;
  }

  /**
   * 设置缓存数据
   * @param cacheKey 缓存键
   * @param nodes 关联节点数据
   * @param fileUri 文件URI
   */
  private async setCachedData(cacheKey: string, nodes: AssociationNode[], fileUri: vscode.Uri): Promise<void> {
    // 检查缓存大小，如果超过限制则清理最少使用的条目
    if (this.associationCache.size >= this.MAX_CACHE_SIZE) {
      this.evictLeastRecentlyUsed();
    }

    try {
      // 获取文件修改时间
      const fileStat = await vscode.workspace.fs.stat(fileUri);
      const currentTreeHash = await this.getTreeDataHash();

      const cachedData: CachedAssociationData = {
        nodes,
        timestamp: Date.now(),
        dataHash: currentTreeHash,
        fileModTime: fileStat.mtime,
        accessCount: 1
      };

      this.associationCache.set(cacheKey, cachedData);
      this.cacheAccessTimes.set(cacheKey, Date.now());
    } catch (error) {
      console.warn('设置缓存数据时出错:', error);
      // 即使获取文件信息失败，也要缓存数据（不包含文件修改时间）
      const cachedData: CachedAssociationData = {
        nodes,
        timestamp: Date.now(),
        dataHash: await this.getTreeDataHash(),
        accessCount: 1
      };

      this.associationCache.set(cacheKey, cachedData);
      this.cacheAccessTimes.set(cacheKey, Date.now());
    }
  }

  /**
   * 获取树数据哈希值（用于检测数据变化）
   * 优化版本：使用更高效的哈希算法和缓存策略
   */
  private async getTreeDataHash(): Promise<string> {
    try {
      // 如果已有缓存的哈希值，直接返回
      if (this.treeDataHash) {
        return this.treeDataHash;
      }

      // 获取树数据
      await this.associationService.loadTreeData();
      
      // 优化：只序列化必要的数据，而不是整个服务实例
      // @ts-ignore - 访问私有属性
      const treeData = this.associationService['treeData'];
      if (!treeData) {
        return Date.now().toString();
      }
      
      // 只使用版本和最后修改时间来计算哈希，避免处理大量节点数据
      const hashSource = `${treeData.version}-${treeData.lastModified}`;
      
      // 使用更高效的哈希算法
      let hash = 0;
      const prime = 31;
      for (let i = 0; i < hashSource.length; i++) {
        hash = Math.imul(prime, hash) + hashSource.charCodeAt(i) | 0;
      }
      
      this.treeDataHash = hash.toString();
      return this.treeDataHash;
    } catch (error) {
      console.warn('计算树数据哈希时出错:', error);
      return Date.now().toString(); // 使用时间戳作为后备方案
    }
  }

  /**
   * 清理最少使用的缓存条目（LRU策略）
   * 优化版本：批量清理以减少频繁的单条目淘汰
   */
  private evictLeastRecentlyUsed(): void {
    if (this.cacheAccessTimes.size === 0) {
      return;
    }

    // 优化：当缓存超过限制时，一次性清理25%的条目，而不是只清理一个
    // 这样可以减少频繁调用此方法的开销
    const itemsToRemove = Math.max(1, Math.floor(this.MAX_CACHE_SIZE * 0.25));
    
    // 将所有条目按访问时间排序
    const sortedEntries = Array.from(this.cacheAccessTimes.entries())
      .sort((a, b) => a[1] - b[1]); // 按时间升序排序
    
    // 移除最旧的25%条目
    for (let i = 0; i < itemsToRemove && i < sortedEntries.length; i++) {
      const [key] = sortedEntries[i];
      this.associationCache.delete(key);
      this.cacheAccessTimes.delete(key);
    }
  }

  /**
   * 获取缓存统计信息
   */
  public getCacheStats(): {
    size: number;
    maxSize: number;
    hitRate: number;
    oldestEntry: number;
  } {
    const now = Date.now();
    let oldestTime = now;
    let totalHits = 0;

    for (const [key, cachedData] of this.associationCache.entries()) {
      totalHits += cachedData.accessCount;
      if (cachedData.timestamp < oldestTime) {
        oldestTime = cachedData.timestamp;
      }
    }

    return {
      size: this.associationCache.size,
      maxSize: this.MAX_CACHE_SIZE,
      hitRate: this.associationCache.size > 0 ? totalHits / this.associationCache.size : 0,
      oldestEntry: now - oldestTime
    };
  }

  /**
   * 将关联结果转换为关联节点数据结构
   * @param result 关联查找结果
   * @returns 关联节点数组
   */
  private convertToAssociationNodes(result: AssociationResult): AssociationNode[] {
    // 去重和排序路径
    const uniquePaths = this.deduplicateAndSortPaths(result.paths);
    
    // 为每个路径创建根节点
    const rootNodes: AssociationNode[] = [];
    
    uniquePaths.forEach((associationPath, pathIndex) => {
      const pathNode = this.buildPathHierarchy(associationPath.path, pathIndex);
      if (pathNode) {
        rootNodes.push(pathNode);
      }
    });

    return rootNodes;
  }

  /**
   * 去重和排序关联路径
   * @param paths 原始路径数组
   * @returns 去重排序后的路径数组
   */
  private deduplicateAndSortPaths(paths: AssociationPath[]): AssociationPath[] {
    // 边界条件检查
    if (!paths || paths.length === 0) {
      return [];
    }

    // 过滤无效路径并使用路径字符串作为去重键
    const pathMap = new Map<string, AssociationPath>();
    
    paths.forEach(path => {
      // 验证路径数据的有效性
      if (!path || !path.path || !Array.isArray(path.path) || path.path.length === 0) {
        return; // 跳过无效路径
      }

      // 验证路径中的节点
      const validPath = path.path.filter(node => 
        node && 
        typeof node.id === 'string' && 
        typeof node.filePath === 'string'
      );

      if (validPath.length === 0) {
        return; // 跳过没有有效节点的路径
      }

      const pathKey = this.buildPathDisplayString(validPath);
      if (pathKey && !pathMap.has(pathKey)) {
        pathMap.set(pathKey, {
          ...path,
          path: validPath
        });
      }
    });

    // 按路径深度和字母顺序排序
    return Array.from(pathMap.values()).sort((a, b) => {
      const depthDiff = a.path.length - b.path.length;
      if (depthDiff !== 0) {
        return depthDiff;
      }
      return this.buildPathDisplayString(a.path).localeCompare(
        this.buildPathDisplayString(b.path)
      );
    });
  }

  /**
   * 构建路径的层次结构
   * @param path 路径中的节点数组
   * @param pathIndex 路径索引
   * @returns 根节点
   */
  private buildPathHierarchy(path: IssueTreeNode[], pathIndex: number): AssociationNode | null {
    // 边界条件检查
    if (!path || path.length === 0) {
      return null;
    }

    // 验证路径索引
    if (typeof pathIndex !== 'number' || pathIndex < 0) {
      pathIndex = 0;
    }

    try {
      // 获取目标节点（路径的最后一个节点）
      const targetNode = path[path.length - 1];
      if (!targetNode || !targetNode.filePath) {
        return null;
      }

      // 创建路径根节点 - 显示目标问题的标题
      const targetLabel = this.extractLabelFromPath(targetNode.filePath);
      
      const rootNode: AssociationNode = {
        id: `root_${pathIndex}_${targetNode.id}`,
        type: 'path',
        label: targetLabel,
        children: [],
        pathIndex,
        treeNodeId: targetNode.id
      };

      // 构建子节点层次结构 - 显示完整的路径链
      let currentParent = rootNode;
      
      path.forEach((treeNode, index) => {
        // 验证节点数据
        if (!treeNode || !treeNode.id || !treeNode.filePath) {
          return; // 跳过无效节点
        }

        const isTargetNode = index === path.length - 1;
        const nodeLabel = this.extractLabelFromPath(treeNode.filePath);
        const displayLabel = isTargetNode ? `${nodeLabel} (当前)` : nodeLabel;

        const childNode: AssociationNode = {
          id: `node_${pathIndex}_${index}_${treeNode.id}`,
          type: 'issue',
          label: displayLabel,
          filePath: treeNode.filePath,
          resourceUri: treeNode.resourceUri,
          treeNodeId: treeNode.id,
          children: [],
          pathIndex
        };

        currentParent.children.push(childNode);
        currentParent = childNode;
      });

      return rootNode;
    } catch (error) {
      console.error('构建路径层次结构时出错:', error);
      return null;
    }
  }

  /**
   * 构建路径显示字符串
   * @param path 路径节点数组
   * @returns 路径显示字符串
   */
  private buildPathDisplayString(path: IssueTreeNode[]): string {
    // 边界条件检查
    if (!path || path.length === 0) {
      return '';
    }

    try {
      const pathLabels = path
        .filter(node => node && node.filePath) // 过滤无效节点
        .map(node => this.extractLabelFromPath(node.filePath))
        .filter(label => label && label.trim()); // 过滤空标签
      
      if (pathLabels.length === 0) {
        return '';
      }

      // 如果路径只有一个节点，直接返回标签
      if (pathLabels.length === 1) {
        return pathLabels[0];
      }

      // 多个节点时，用 / 连接（用于路径显示）
      return pathLabels.join(' / ');
    } catch (error) {
      console.error('构建路径显示字符串时出错:', error);
      return '';
    }
  }

  // 移除未使用的方法

  /**
   * 处理文档变更事件
   * @param document 变更的文档
   */
  private handleDocumentChange(document: vscode.TextDocument): void {
    // 只处理 Markdown 文件变更
    if (document.languageId !== 'markdown') {
      return;
    }

    // 检查是否是问题文件
    const fileUri = document.uri;
    
    // 智能更新缓存 - 只有当文件内容变化可能影响关联关系时才更新
    this.invalidateCacheForFile(fileUri);
    
    // 防抖更新树数据哈希
    this.debouncedUpdateTreeHash();
  }

  /**
   * 处理文件删除事件
   * @param event 文件删除事件
   */
  private handleFileDelete(event: vscode.FileDeleteEvent): void {
    // 检查是否有删除的 Markdown 文件
    const hasMdFiles = event.files.some(uri => uri.fsPath.endsWith('.md'));
    
    if (hasMdFiles) {
      // 删除相关缓存
      event.files.forEach(uri => {
        this.invalidateCacheForFile(uri);
        this.removeFileWatcher(uri.toString());
      });
      
      // 防抖更新树数据哈希
      this.debouncedUpdateTreeHash();
    }
  }

  /**
   * 处理文件创建事件
   * @param event 文件创建事件
   */
  private handleFileCreate(event: vscode.FileCreateEvent): void {
    // 检查是否有新建的 Markdown 文件
    const hasMdFiles = event.files.some(uri => uri.fsPath.endsWith('.md'));
    
    if (hasMdFiles) {
      // 防抖更新树数据哈希
      this.debouncedUpdateTreeHash();
      
      // 为新文件添加监听器
      event.files.forEach(uri => {
        if (uri.fsPath.endsWith('.md')) {
          this.addFileWatcher(uri);
        }
      });
    }
  }

  /**
   * 为文件添加监听器
   * @param uri 文件URI
   */
  private addFileWatcher(uri: vscode.Uri): void {
    const key = uri.toString();
    
    // 如果已有监听器，先移除
    this.removeFileWatcher(key);
    
    // 添加新的文件监听器
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(uri, '*')
    );
    
    // 监听文件变更
    watcher.onDidChange(() => {
      this.invalidateCacheForFile(uri);
      this.debouncedUpdateTreeHash();
    });
    
    // 监听文件删除
    watcher.onDidDelete(() => {
      this.invalidateCacheForFile(uri);
      this.removeFileWatcher(key);
      this.debouncedUpdateTreeHash();
    });
    
    this.fileWatchers.set(key, watcher);
  }

  /**
   * 移除文件监听器
   * @param key 文件URI字符串
   */
  private removeFileWatcher(key: string): void {
    const watcher = this.fileWatchers.get(key);
    if (watcher) {
      watcher.dispose();
      this.fileWatchers.delete(key);
    }
  }

  /**
   * 使指定文件的缓存失效
   * @param fileUri 文件URI
   */
  private invalidateCacheForFile(fileUri: vscode.Uri): void {
    const cacheKey = fileUri.toString();
    
    // 直接删除该文件的缓存
    if (this.associationCache.has(cacheKey)) {
      this.associationCache.delete(cacheKey);
      this.cacheAccessTimes.delete(cacheKey);
    }
    
    // 查找并删除可能受影响的相关缓存
    // 这里采用保守策略，如果无法确定是否受影响，就删除缓存
    for (const [key, data] of this.associationCache.entries()) {
      // 检查缓存的节点中是否包含该文件的引用
      const hasReference = this.checkNodeReferences(data.nodes, fileUri);
      if (hasReference) {
        this.associationCache.delete(key);
        this.cacheAccessTimes.delete(key);
      }
    }
  }

  /**
   * 检查节点数组中是否包含对指定文件的引用
   * @param nodes 节点数组
   * @param fileUri 文件URI
   * @returns 是否包含引用
   */
  private checkNodeReferences(nodes: AssociationNode[], fileUri: vscode.Uri): boolean {
    for (const node of nodes) {
      // 检查当前节点
      if (node.resourceUri && node.resourceUri.toString() === fileUri.toString()) {
        return true;
      }
      
      // 检查子节点
      if (node.children && node.children.length > 0) {
        if (this.checkNodeReferences(node.children, fileUri)) {
          return true;
        }
      }
    }
    
    return false;
  }

  /**
   * 获取缓存命中率
   */
  public getCacheHitRate(): number {
    const total = this.cacheHits + this.cacheMisses;
    return total > 0 ? this.cacheHits / total : 0;
  }

  /**
   * 重置缓存统计
   */
  public resetCacheStats(): void {
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  /**
   * 释放资源
   */
  public dispose(): void {
    // 清除所有文件监听器
    for (const watcher of this.fileWatchers.values()) {
      watcher.dispose();
    }
    this.fileWatchers.clear();
    
    // 清除缓存
    this.clearCache();
  }

  /**
   * 从文件路径提取显示标签
   * @param filePath 文件路径
   * @returns 显示标签
   */
  private extractLabelFromPath(filePath: string): string {
    // 边界条件检查
    if (!filePath || typeof filePath !== 'string') {
      return '未知文件';
    }

    try {
      const trimmedPath = filePath.trim();
      if (!trimmedPath) {
        return '未知文件';
      }

      const parts = trimmedPath.split('/');
      const fileName = parts[parts.length - 1];
      
      // 移除 .md 扩展名
      if (fileName.endsWith('.md')) {
        return fileName.slice(0, -3);
      }
      
      return fileName || trimmedPath;
    } catch (error) {
      console.error('提取文件标签时出错:', error);
      return '未知文件';
    }
  }
}