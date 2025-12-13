import * as vscode from 'vscode';
import * as path from 'path';
import {
  NoteMapping,
  readMappings,
  writeMappings,
  generateMappingId
} from '../../data/noteMappingStorage';
import {
  matchPattern,
  getRelativeToNoteRoot,
  resolveFromNoteRoot,
  isPathInNoteRoot,
  normalizePath
} from '../../utils/pathUtils';
import { TitleCacheService } from '../TitleCacheService';
import { getIssueDir } from '../../config';

/**
 * 笔记映射服务
 * 提供映射的 CRUD 操作和匹配逻辑
 */
export class NoteMappingService {
  private static instance: NoteMappingService | null = null;
  private mappings: NoteMapping[] = [];
  private loaded = false;
  private changeListeners: Array<() => void> = [];
  private titleCache: TitleCacheService;

  private constructor() {
    this.titleCache = TitleCacheService.getInstance();
  }

  static getInstance(): NoteMappingService {
    if (!NoteMappingService.instance) {
      NoteMappingService.instance = new NoteMappingService();
    }
    return NoteMappingService.instance;
  }

  /**
   * 预加载映射数据
   */
  async preload(): Promise<void> {
    if (this.loaded) {
      return;
    }

    try {
      this.mappings = await readMappings();
      // 按优先级降序排序
      this.mappings.sort((a, b) => b.priority - a.priority);
      this.loaded = true;
    } catch (error) {
      console.error('预加载映射数据失败:', error);
      this.loaded = true;
    }
  }

  /**
   * 重新加载映射数据
   */
  async reload(): Promise<void> {
    this.loaded = false;
    await this.preload();
    this.notifyChange();
  }

  /**
   * 获取所有映射
   */
  async getAll(): Promise<NoteMapping[]> {
    if (!this.loaded) {
      await this.preload();
    }
    return [...this.mappings];
  }

  /**
   * 根据 ID 获取映射
   */
  async getById(id: string): Promise<NoteMapping | undefined> {
    if (!this.loaded) {
      await this.preload();
    }
    return this.mappings.find(m => m.id === id);
  }

  /**
   * 解析文件的映射笔记
   * @param filePath 文件的绝对路径
   * @returns 匹配的笔记路径列表（绝对路径）
   */
  async resolveForFile(filePath: string): Promise<string[]> {
    if (!this.loaded) {
      await this.preload();
    }

    const issueDir = getIssueDir();
    if (!issueDir) {
      return [];
    }

    const normalizedPath = normalizePath(filePath);
    const relativePath = getRelativeToNoteRoot(normalizedPath);

    // 收集所有匹配的映射（已按优先级排序）
    const matchedMappings: NoteMapping[] = [];

    for (const mapping of this.mappings) {
      let isMatch = false;

      if (mapping.scope === 'workspace') {
        // 工作区级别：匹配所有文件
        isMatch = true;
      } else if (mapping.scope === 'file') {
        // 文件级别：匹配特定模式
        if (relativePath !== undefined) {
          isMatch = matchPattern(mapping.pattern, relativePath);
        } else {
          // 文件不在笔记根目录内，也尝试匹配绝对路径
          isMatch = matchPattern(mapping.pattern, normalizedPath);
        }
      }

      if (isMatch) {
        matchedMappings.push(mapping);
      }
    }

    // 如果没有匹配，返回空数组
    if (matchedMappings.length === 0) {
      return [];
    }

    // 取第一个匹配的映射（优先级最高）
    const mapping = matchedMappings[0];
    
    // 解析目标路径
    const targetPaths: string[] = [];
    for (const target of mapping.targets) {
      const absolutePath = resolveFromNoteRoot(target);
      if (absolutePath) {
        targetPaths.push(absolutePath);
      }
    }

    return targetPaths;
  }

  /**
   * 添加或更新映射
   */
  async addOrUpdate(mapping: NoteMapping): Promise<void> {
    if (!this.loaded) {
      await this.preload();
    }

    // 确保有 ID
    if (!mapping.id) {
      mapping.id = generateMappingId();
    }

    // 设置时间戳
    const now = new Date().toISOString();
    if (!mapping.createdAt) {
      mapping.createdAt = now;
    }
    mapping.updatedAt = now;

    // 查找是否已存在
    const index = this.mappings.findIndex(m => m.id === mapping.id);
    if (index >= 0) {
      // 更新
      this.mappings[index] = mapping;
    } else {
      // 添加
      this.mappings.push(mapping);
    }

    // 重新排序
    this.mappings.sort((a, b) => b.priority - a.priority);

    // 保存到文件
    await writeMappings(this.mappings);
    this.notifyChange();
  }

  /**
   * 删除映射
   */
  async remove(id: string): Promise<boolean> {
    if (!this.loaded) {
      await this.preload();
    }

    const index = this.mappings.findIndex(m => m.id === id);
    if (index >= 0) {
      this.mappings.splice(index, 1);
      await writeMappings(this.mappings);
      this.notifyChange();
      return true;
    }

    return false;
  }

  /**
   * 注册变更监听器
   */
  watch(callback: () => void): vscode.Disposable {
    this.changeListeners.push(callback);
    return {
      dispose: () => {
        const index = this.changeListeners.indexOf(callback);
        if (index >= 0) {
          this.changeListeners.splice(index, 1);
        }
      }
    };
  }

  /**
   * 通知变更
   */
  private notifyChange(): void {
    for (const listener of this.changeListeners) {
      try {
        listener();
      } catch (error) {
        console.error('映射变更监听器执行失败:', error);
      }
    }
  }

  /**
   * 获取笔记的显示标题
   */
  async getNoteTitle(notePath: string): Promise<string> {
    const relativePath = getRelativeToNoteRoot(notePath);
    if (relativePath) {
      // 确保缓存已加载
      await this.titleCache.preload();
      const title = await this.titleCache.get(relativePath);
      if (title) {
        return title;
      }
    }
    
    // 回退到文件名
    return path.basename(notePath, path.extname(notePath));
  }

  /**
   * 检查文件是否有映射
   */
  async hasMapping(filePath: string): Promise<boolean> {
    const targets = await this.resolveForFile(filePath);
    return targets.length > 0;
  }
}
