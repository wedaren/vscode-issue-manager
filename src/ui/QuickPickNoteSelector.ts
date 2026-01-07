import * as vscode from 'vscode';
import * as path from 'path';
import { getIssueDir } from '../config';
import { getFlatTree, FlatTreeNode, getIssueTitle } from '../data/issueTreeManager';

/**
 * QuickPick 项
 */
interface IssueQuickPickItem extends vscode.QuickPickItem {
  issueId: string;
  action?: 'create' | 'open';
}

/**
 * Issue 选择器
 */
export class QuickPickNoteSelector {
  constructor() {
    // NoteMappingService 已移除，不需要初始化
  }

  /**
   * 显示 issue 选择器
   * @param issueIds 候选 issueId 列表
   * @param allowCreate 是否允许创建新 issue
   * @returns 选择的 issueId，或 undefined 表示取消
   */
  async show(issueIds: string[], allowCreate: boolean = true): Promise<string | undefined> {
    if (issueIds.length === 0 && !allowCreate) {
      return undefined;
    }

    // 只有一个候选且不允许创建，直接返回
    if (issueIds.length === 1 && !allowCreate) {
      return issueIds[0];
    }

    // 准备 QuickPick 选项
    const items: IssueQuickPickItem[] = [];

    // 添加现有 issue
    for (const issueId of issueIds) {
      const title = await getIssueTitle(issueId);
      
      items.push({
        label: `$(file) ${title}`,
        description: issueId,
        detail: `${issueId}.md`,
        issueId: issueId,
        action: 'open'
      });
    }

    // 添加"创建新 issue"选项
    if (allowCreate) {
      items.push({
        label: `$(add) 创建新笔记`,
        description: '在笔记根目录创建新的 Markdown 文件',
        issueId: '',
        action: 'create'
      });
    }

    // 显示 QuickPick
    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: '选择要打开的笔记',
      matchOnDescription: true,
      matchOnDetail: true
    });

    if (!selected) {
      return undefined;
    }

    if (selected.action === 'create') {
      // 创建新笔记
      return await this.createNewIssue();
    } else {
      return selected.issueId;
    }
  }

  /**
   * 创建新 issue
   */
  private async createNewIssue(): Promise<string | undefined> {
    const issueDir = getIssueDir();
    if (!issueDir) {
      vscode.window.showErrorMessage('未配置笔记根目录');
      return undefined;
    }

    // 生成文件名
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const milliseconds = String(now.getMilliseconds()).padStart(3, '0');
    
    const issueId = `${year}${month}${day}-${hours}${minutes}${seconds}-${milliseconds}`;
    const fileName = `${issueId}.md`;
    const filePath = path.join(issueDir, fileName);

    // 创建文件
    const fileUri = vscode.Uri.file(filePath);
    await vscode.workspace.fs.writeFile(fileUri, Buffer.from('# 新笔记\n\n', 'utf8'));

    return issueId;
  }

  /**
   * 选择单个 issue（用于创建映射）
   * 参考 searchIssues.ts 的实现，提供更好的交互体验
   * 使用 node.id 作为 issueId
   * @returns issueId（node.id）
   */
  async selectSingle(): Promise<string | undefined> {
    const issueDir = getIssueDir();
    if (!issueDir) {
      vscode.window.showErrorMessage('未配置笔记根目录');
      return undefined;
    }

    // 创建 QuickPick
    const quickPick = vscode.window.createQuickPick<IssueQuickPickItem>();
    quickPick.busy = true;
    quickPick.placeholder = '请搜索并选择要映射的问题...';
    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = false;
    quickPick.show();

    // 获取扁平化的树结构
    const flatNodes = await getFlatTree();

    // 获取每个节点的 mtime
    async function getMtime(node: FlatTreeNode): Promise<number> {
      try {
        const uri = node.resourceUri || vscode.Uri.file(node.filePath);
        const stat = await vscode.workspace.fs.stat(uri);
        return stat.mtime;
      } catch {
        return 0;
      }
    }

    // 并发获取所有 mtime
    const nodesWithMtime = await Promise.all(flatNodes.map(async node => {
      const mtime = await getMtime(node);
      return { ...node, mtime };
    }));

    // 按 mtime 降序排序
    nodesWithMtime.sort((a, b) => b.mtime - a.mtime);

    // 构建 QuickPickItem 列表，使用 node.id 作为 issueId
    const items: IssueQuickPickItem[] = nodesWithMtime.map(node => {
      const title = node.title;
      let description = '';
      // 层级路径展示优化：一级节点 description 留空，二级及以上显示父级路径
      if (node.parentPath.length > 0) {
        const parentTitles = node.parentPath.map(n => n.title);
        description = ['', ...parentTitles].join(' / ');
      }
      
      return {
        label: title,
        description,
        detail: node.id,
        issueId: node.id,
        action: 'open'
      };
    });

    quickPick.items = items;
    quickPick.busy = false;

    return new Promise<string | undefined>((resolve) => {
      quickPick.onDidAccept(() => {
        const selected = quickPick.selectedItems[0];
        quickPick.hide();
        if (selected) {
          resolve(selected.issueId);
        } else {
          resolve(undefined);
        }
      });

      quickPick.onDidHide(() => {
        quickPick.dispose();
        resolve(undefined);
      });
    });
  }
}
