import * as vscode from 'vscode';
import * as path from 'path';
import { NoteMappingService } from '../services/noteMapping/NoteMappingService';

/**
 * QuickPick 项
 */
interface NoteQuickPickItem extends vscode.QuickPickItem {
  notePath: string;
  action?: 'create' | 'open';
}

/**
 * 笔记选择器
 */
export class QuickPickNoteSelector {
  private mappingService: NoteMappingService;

  constructor() {
    this.mappingService = NoteMappingService.getInstance();
  }

  /**
   * 显示笔记选择器
   * @param notePaths 候选笔记路径列表（绝对路径）
   * @param allowCreate 是否允许创建新笔记
   * @returns 选择的笔记路径，或 undefined 表示取消
   */
  async show(notePaths: string[], allowCreate: boolean = true): Promise<string | undefined> {
    if (notePaths.length === 0 && !allowCreate) {
      return undefined;
    }

    // 只有一个候选且不允许创建，直接返回
    if (notePaths.length === 1 && !allowCreate) {
      return notePaths[0];
    }

    // 准备 QuickPick 选项
    const items: NoteQuickPickItem[] = [];

    // 添加现有笔记
    for (const notePath of notePaths) {
      const title = await this.mappingService.getNoteTitle(notePath);
      const fileName = path.basename(notePath);
      const description = path.dirname(notePath);

      items.push({
        label: `$(file) ${title}`,
        description: description,
        detail: fileName,
        notePath: notePath,
        action: 'open'
      });
    }

    // 添加"创建新笔记"选项
    if (allowCreate) {
      items.push({
        label: `$(add) 创建新笔记`,
        description: '在笔记根目录创建新的 Markdown 文件',
        notePath: '',
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
      return await this.createNewNote();
    } else {
      return selected.notePath;
    }
  }

  /**
   * 创建新笔记
   */
  private async createNewNote(): Promise<string | undefined> {
    const issueDir = vscode.workspace.getConfiguration('issueManager').get<string>('issueDir');
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
    
    const fileName = `${year}${month}${day}-${hours}${minutes}${seconds}-${milliseconds}.md`;
    const filePath = path.join(issueDir, fileName);

    // 创建文件
    const fileUri = vscode.Uri.file(filePath);
    await vscode.workspace.fs.writeFile(fileUri, Buffer.from('# 新笔记\n\n', 'utf8'));

    return filePath;
  }

  /**
   * 选择多个笔记（用于创建映射）
   */
  async selectMultiple(existingPaths: string[] = []): Promise<string[] | undefined> {
    // 获取所有笔记文件
    const issueDir = vscode.workspace.getConfiguration('issueManager').get<string>('issueDir');
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

    return uris.map(uri => uri.fsPath);
  }
}
