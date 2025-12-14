import * as vscode from 'vscode';
import { NoteMappingService } from '../services/noteMapping/NoteMappingService';
import { QuickPickNoteSelector } from '../ui/QuickPickNoteSelector';
import { getIssueDir } from '../config';
import { generateMappingId } from '../data/noteMappingStorage';

// 工作区级别映射的默认模式
const WORKSPACE_PATTERN = '**/*';
const DEFAULT_WORKSPACE_PRIORITY = 10;

/**
 * 添加工作区级别的笔记映射
 */
export async function addWorkspaceMapping(): Promise<void> {
  const issueDir = getIssueDir();
  if (!issueDir) {
    vscode.window.showWarningMessage('请先配置问题目录。');
    return;
  }

  const mappingService = NoteMappingService.getInstance();

  // 选择 issue 文件
  const selector = new QuickPickNoteSelector();
  const issueId = await selector.selectSingle();

  if (!issueId) {
    return;
  }

  // 创建映射
  await mappingService.addOrUpdate({
    id: generateMappingId(),
    scope: 'workspace',
    pattern: WORKSPACE_PATTERN,
    targets: [issueId],
    priority: DEFAULT_WORKSPACE_PRIORITY,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  vscode.window.showInformationMessage(`已添加工作区笔记映射。`);
}

/**
 * 注册命令
 */
export function registerAddWorkspaceMappingCommand(context: vscode.ExtensionContext): void {
  const command = vscode.commands.registerCommand(
    'issueManager.addWorkspaceMapping',
    addWorkspaceMapping
  );
  context.subscriptions.push(command);
}
