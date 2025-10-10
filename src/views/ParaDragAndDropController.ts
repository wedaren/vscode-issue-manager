import * as vscode from 'vscode';
import {
  addIssueToCategory,
  ParaCategory,
  getCategoryLabel
} from '../data/paraManager';
import { readTree, IssueTreeNode, TreeData } from '../data/treeManager';
import { getRelativePathToIssueDir } from '../utils/fileUtils';
import { ParaViewNode } from '../types';

/**
 * PARA 视图的拖拽控制器
 */
export class ParaDragAndDropController implements vscode.TreeDragAndDropController<ParaViewNode> {
  dropMimeTypes = ['application/vnd.code.tree.issueManager.views.para'];
  dragMimeTypes = ['application/vnd.code.tree.issueManager.views.para', 'text/uri-list'];

  constructor(private refreshCallback: () => void) {}

  /**
   * 处理拖拽操作
   */
  public async handleDrag(
    source: readonly ParaViewNode[],
    dataTransfer: vscode.DataTransfer,
    _token: vscode.CancellationToken
  ): Promise<void> {
    // 只允许拖拽问题节点
    const issues = source.filter(node => node.type === 'issue');
    if (issues.length === 0) {
      return;
    }

    dataTransfer.set(
      'application/vnd.code.tree.issueManager.views.para',
      new vscode.DataTransferItem(issues)
    );
  }

  /**
   * 处理放置操作
   */
  public async handleDrop(
    target: ParaViewNode | undefined,
    dataTransfer: vscode.DataTransfer,
    _token: vscode.CancellationToken
  ): Promise<void> {
    // 获取拖拽的数据
    const transferItem = dataTransfer.get('application/vnd.code.tree.issueManager.views.para');
    if (!transferItem) {
      // 尝试从其他视图拖拽
      await this.handleExternalDrop(target, dataTransfer);
      return;
    }

    const sourceNodes = transferItem.value as ParaViewNode[];
    if (!sourceNodes || sourceNodes.length === 0) {
      return;
    }

    // 确定目标分类
    let targetCategory: ParaCategory | null = null;

    if (!target) {
      vscode.window.showWarningMessage('请将问题拖放到具体的分类中');
      return;
    }

    if (target.type === 'category') {
      targetCategory = target.category;
    } else if (target.type === 'issue') {
      // 拖放到问题上，移动到该问题所在的分类
      targetCategory = target.category;
    }

    if (!targetCategory) {
      return;
    }

    // 移动所有问题
    try {
      for (const node of sourceNodes) {
        if (node.type !== 'issue') {
          continue;
        }

        await addIssueToCategory(targetCategory, node.id);
      }

      this.refreshCallback();
      
      const count = sourceNodes.length;
      const categoryName = getCategoryLabel(targetCategory);
      vscode.window.showInformationMessage(`已将 ${count} 个问题移动到 ${categoryName}`);
    } catch (error) {
      vscode.window.showErrorMessage(`移动问题失败: ${error}`);
    }
  }

  /**
   * 处理从外部视图拖拽的问题
   */
  private async handleExternalDrop(
    target: ParaViewNode | undefined,
    dataTransfer: vscode.DataTransfer
  ): Promise<void> {
    // 尝试从 URI 列表中获取文件
    const uriListItem = dataTransfer.get('text/uri-list');
    if (!uriListItem) {
      return;
    }

    const uriListText = uriListItem.value as string;
    const uris = uriListText.split('\n').filter(line => line.trim().length > 0);

    if (uris.length === 0) {
      return;
    }

    // 确定目标分类
    let targetCategory: ParaCategory | null = null;

    if (!target) {
      vscode.window.showWarningMessage('请将问题拖放到具体的分类中');
      return;
    }

    if (target.type === 'category') {
      targetCategory = target.category;
    } else if (target.type === 'issue') {
      targetCategory = target.category;
    }

    if (!targetCategory) {
      return;
    }

    // 处理每个文件
    try {
      // 读取树数据以查找节点 ID
      const treeData = await readTree();
      if (!treeData) {
        vscode.window.showWarningMessage('无法读取问题树数据');
        return;
      }

      let movedCount = 0;
      for (const uriString of uris) {
        const uri = vscode.Uri.parse(uriString);
        const relativePath = getRelativePathToIssueDir(uri.fsPath);
        
        if (!relativePath) {
          continue;
        }

        // 根据 filePath 查找所有匹配的节点 ID
        const nodeIds = this.findNodeIdsByFilePath(treeData, relativePath);
        
        if (nodeIds.length === 0) {
          continue;
        }

        // 如果有多个节点引用同一文件，添加所有节点
        for (const nodeId of nodeIds) {
          await addIssueToCategory(targetCategory, nodeId);
          movedCount++;
        }
      }

      if (movedCount > 0) {
        this.refreshCallback();
        const categoryName = getCategoryLabel(targetCategory);
        vscode.window.showInformationMessage(`已将 ${movedCount} 个问题移动到 ${categoryName}`);
      }
    } catch (error) {
      vscode.window.showErrorMessage(`移动问题失败: ${error}`);
    }
  }

  /**
   * 根据 filePath 查找所有节点 ID
   * （同一文件可能被多个节点引用）
   */
  private findNodeIdsByFilePath(treeData: TreeData, filePath: string): string[] {
    const ids: string[] = [];

    const findInNode = (node: IssueTreeNode): void => {
      if (node.filePath === filePath) {
        ids.push(node.id);
      }
      for (const child of node.children) {
        findInNode(child);
      }
    };

    for (const root of treeData.rootNodes) {
      findInNode(root);
    }

    return ids;
  }
}
