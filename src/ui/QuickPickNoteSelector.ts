import * as vscode from 'vscode';
import * as path from 'path';
import { NoteMappingService } from '../services/noteMapping/NoteMappingService';
import { getIssueDir } from '../config';

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
  private mappingService: NoteMappingService;

  constructor() {
    this.mappingService = NoteMappingService.getInstance();
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
      const title = await this.mappingService.getIssueTitle(issueId);
      
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
   * 选择多个 issue（用于创建映射）
   * @returns issueId 列表
   */
  async selectMultiple(existingIds: string[] = []): Promise<string[] | undefined> {
    // 获取所有笔记文件
    const issueDir = getIssueDir();
    if (!issueDir) {
      vscode.window.showErrorMessage('未配置笔记根目录');
      return undefined;
    }

    // 使用文件选择对话框
    const uris = await vscode.window.showOpenDialog({
      defaultUri: vscode.Uri.file(issueDir),
      canSelectMany: true,
      canSelectFiles: true,
      canSelectFolders: false,
      filters: {
        'Markdown 文件': ['md', 'markdown']
      },
      title: '选择笔记文件'
    });

    if (!uris || uris.length === 0) {
      return undefined;
    }

    // 转换为 issueId（相对于 issueDir 的路径，不含 .md 扩展名）
    const issueIds: string[] = [];
    for (const uri of uris) {
      const relativePath = path.relative(issueDir, uri.fsPath);
      // 移除 .md 扩展名
      const issueId = relativePath.endsWith('.md') 
        ? relativePath.substring(0, relativePath.length - 3)
        : relativePath;
      issueIds.push(issueId);
    }

    return issueIds;
  }
}
