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
  try {
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

    // 检查是否已有 workspace 级别的映射（使用相同的 pattern）
    const allMappings = await mappingService.getAll();
    const existingMapping = allMappings.find(
      m => m.scope === 'workspace' && m.pattern === WORKSPACE_PATTERN
    );

    if (existingMapping) {
      // 若已存在则追加到 targets（去重）并更新
      if (!existingMapping.targets.includes(issueId)) {
        existingMapping.targets.push(issueId);
        existingMapping.updatedAt = new Date().toISOString();
        await mappingService.addOrUpdate(existingMapping);
        vscode.window.showInformationMessage(`已为工作区映射追加笔记。`);
      } else {
        vscode.window.showInformationMessage(`该工作区映射已包含所选笔记。`);
      }
    } else {
      // 创建新的 workspace 映射
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

    // 更新编辑器上下文
    await vscode.commands.executeCommand('issueManager.updateEditorMappingContext');
  } catch (error) {
    console.error('addWorkspaceMapping failed:', error);
    vscode.window.showErrorMessage(
      `添加工作区笔记映射失败: ${error instanceof Error ? error.message : String(error)}`
    );
  }
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
