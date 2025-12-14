import * as vscode from 'vscode';
import * as path from 'path';
import { NoteMappingService } from '../services/noteMapping/NoteMappingService';
import { QuickPickNoteSelector } from '../ui/QuickPickNoteSelector';
import { getIssueDir } from '../config';
import { getRelativeToNoteRoot } from '../utils/pathUtils';
import { generateMappingId } from '../data/noteMappingStorage';

const DEFAULT_FILE_PRIORITY = 100;

/**
 * 为当前文件添加笔记映射
 */
export async function addFileMapping(): Promise<void> {
  const issueDir = getIssueDir();
  if (!issueDir) {
    vscode.window.showWarningMessage('请先配置问题目录。');
    return;
  }

  // 获取当前活动编辑器
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showInformationMessage('没有打开的文件。');
    return;
  }

  const currentFilePath = editor.document.uri.fsPath;
  const mappingService = NoteMappingService.getInstance();

  // 获取相对路径作为模式
  const relativePath = getRelativeToNoteRoot(currentFilePath);
  let pattern: string;

  if (relativePath !== undefined) {
    pattern = relativePath;
  } else {
    // 文件不在笔记根目录内，使用绝对路径
    pattern = currentFilePath;
  }

  // 选择 issue 文件
  const selector = new QuickPickNoteSelector();
  const issueId = await selector.selectSingle();

  if (!issueId) {
    return;
  }

  // 创建或更新映射
  await mappingService.addOrUpdate({
    id: generateMappingId(),
    scope: 'file',
    pattern: pattern,
    targets: [issueId],
    priority: DEFAULT_FILE_PRIORITY,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  vscode.window.showInformationMessage(`已为当前文件添加笔记映射。`);
  
  // 更新编辑器上下文
  await vscode.commands.executeCommand('issueManager.updateEditorMappingContext');
}

/**
 * 注册命令
 */
export function registerAddFileMappingCommand(context: vscode.ExtensionContext): void {
  const command = vscode.commands.registerCommand(
    'issueManager.addFileMapping',
    addFileMapping
  );
  context.subscriptions.push(command);
}
