import * as vscode from 'vscode';
import { NoteMappingService } from '../services/noteMapping/NoteMappingService';
import { QuickPickNoteSelector } from '../ui/QuickPickNoteSelector';
import { getIssueDir } from '../config';
import { getRelativeToNoteRoot } from '../utils/pathUtils';
import { generateMappingId } from '../data/noteMappingStorage';

const DEFAULT_FILE_PRIORITY = 100;

/**
 * 为当前文件添加笔记映射
 * 支持多次添加，不会覆盖已有映射
 */
export async function addFileMapping(): Promise<void> {
  try {
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

    // 查找是否已有针对该文件的映射
    const allMappings = await mappingService.getAll();
    const existingMapping = allMappings.find(
      m => m.scope === 'file' && m.pattern === pattern
    );

    if (existingMapping) {
      // 如果已存在映射，追加到 targets 列表（去重）
      if (!existingMapping.targets.includes(issueId)) {
        existingMapping.targets.push(issueId);
        existingMapping.updatedAt = new Date().toISOString();
        await mappingService.addOrUpdate(existingMapping);
        vscode.window.showInformationMessage(`已为当前文件添加新的笔记映射。`);
      } else {
        vscode.window.showInformationMessage(`该映射已存在。`);
      }
    } else {
      // 创建新映射
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
    }
    
    // 更新编辑器上下文
    await vscode.commands.executeCommand('issueManager.updateEditorMappingContext');
  } catch (error) {
    console.error('addFileMapping failed:', error);
    vscode.window.showErrorMessage(
      `添加文件笔记映射失败: ${error instanceof Error ? error.message : String(error)}`
    );
  }
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
