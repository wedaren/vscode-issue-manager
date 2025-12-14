import * as vscode from 'vscode';
import { NoteMappingService } from '../services/noteMapping/NoteMappingService';
import { NoteMappingNode } from '../views/NoteMappingViewProvider';

/**
 * 从当前文件映射中删除指定的 issue
 */
export async function removeFileMapping(node?: NoteMappingNode): Promise<void> {
  const mappingService = NoteMappingService.getInstance();
  const editor = vscode.window.activeTextEditor;

  if (!editor) {
    vscode.window.showWarningMessage('没有打开的文件。');
    return;
  }

  if (!node || !node.issueId) {
    vscode.window.showWarningMessage('无效的映射节点。');
    return;
  }

  const currentFilePath = editor.document.uri.fsPath;
  const issueId = node.issueId;

  // 查找当前文件的映射
  const allMappings = await mappingService.getAll();
  const fileMapping = allMappings.find(m => {
    if (m.scope !== 'file') {
      return false;
    }
    // 检查模式是否匹配当前文件
    return m.targets.includes(issueId);
  });

  if (!fileMapping) {
    vscode.window.showWarningMessage('未找到对应的文件映射。');
    return;
  }

  // 如果映射中只有这一个 issueId，删除整个映射
  if (fileMapping.targets.length === 1) {
    await mappingService.remove(fileMapping.id);
    vscode.window.showInformationMessage('已删除文件笔记映射。');
  } else {
    // 否则只从 targets 中移除这个 issueId
    const updatedTargets = fileMapping.targets.filter(id => id !== issueId);
    await mappingService.addOrUpdate({
      ...fileMapping,
      targets: updatedTargets,
      updatedAt: new Date().toISOString()
    });
    vscode.window.showInformationMessage('已从文件映射中移除该笔记。');
  }
  
  // 更新编辑器上下文
  await vscode.commands.executeCommand('issueManager.updateEditorMappingContext');
}

/**
 * 注册命令
 */
export function registerRemoveFileMappingCommand(context: vscode.ExtensionContext): void {
  const command = vscode.commands.registerCommand(
    'issueManager.removeFileMapping',
    removeFileMapping
  );
  context.subscriptions.push(command);
}
