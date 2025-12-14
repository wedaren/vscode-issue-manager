import * as vscode from 'vscode';
import { NoteMappingService } from '../services/noteMapping/NoteMappingService';
import { NoteMappingNode } from '../views/NoteMappingViewProvider';

/**
 * 从工作区映射中删除指定的 issue
 */
export async function removeWorkspaceMapping(node?: NoteMappingNode): Promise<void> {
  try {
    const mappingService = NoteMappingService.getInstance();

    if (!node || !node.issueId) {
      vscode.window.showWarningMessage('无效的映射节点。');
      return;
    }

    const issueId = node.issueId;

    // 查找包含此 issueId 的工作区映射
    const allMappings = await mappingService.getAll();
    const workspaceMapping = allMappings.find(m => 
      m.scope === 'workspace' && m.targets.includes(issueId)
    );

    if (!workspaceMapping) {
      vscode.window.showWarningMessage('未找到对应的工作区映射。');
      return;
    }

    // 如果映射中只有这一个 issueId，删除整个映射
    if (workspaceMapping.targets.length === 1) {
      await mappingService.remove(workspaceMapping.id);
      vscode.window.showInformationMessage('已删除工作区笔记映射。');
    } else {
      // 否则只从 targets 中移除这个 issueId
      const updatedTargets = workspaceMapping.targets.filter(id => id !== issueId);
      await mappingService.addOrUpdate({
        ...workspaceMapping,
        targets: updatedTargets,
        updatedAt: new Date().toISOString()
      });
      vscode.window.showInformationMessage('已从工作区映射中移除该笔记。');
    }
  } catch (error) {
    console.error('removeWorkspaceMapping failed:', error);
    vscode.window.showErrorMessage(
      `移除工作区映射失败: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * 注册命令
 */
export function registerRemoveWorkspaceMappingCommand(context: vscode.ExtensionContext): void {
  const command = vscode.commands.registerCommand(
    'issueManager.removeWorkspaceMapping',
    removeWorkspaceMapping
  );
  context.subscriptions.push(command);
}
