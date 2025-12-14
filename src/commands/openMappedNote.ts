import * as vscode from 'vscode';
import * as path from 'path';
import { NoteMappingService } from '../services/noteMapping/NoteMappingService';
import { QuickPickNoteSelector } from '../ui/QuickPickNoteSelector';
import { getIssueDir } from '../config';
import { readTree, findNodeById } from '../data/treeManager';

/**
 * 打开当前文件映射的笔记
 */
export async function openMappedNote(): Promise<void> {
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

  // 解析映射
  const issueIds = await mappingService.resolveForFile(currentFilePath);

  if (issueIds.length === 0) {
    // 没有映射，根据配置决定回退行为
    const config = vscode.workspace.getConfiguration('issueManager.noteMapping');
    const fallbackBehavior = config.get<string>('fallbackBehavior', 'ask');

    if (fallbackBehavior === 'none') {
      vscode.window.showInformationMessage('当前文件没有映射的笔记。');
      return;
    } else if (fallbackBehavior === 'noteRoot') {
      // 打开笔记根目录
      const uri = vscode.Uri.file(issueDir);
      await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: false });
      return;
    } else {
      // 询问用户
      const action = await vscode.window.showInformationMessage(
        '当前文件没有映射的笔记。',
        '创建映射',
        '取消'
      );

      if (action === '创建映射') {
        // 调用创建映射命令
        await vscode.commands.executeCommand('issueManager.mapNoteForFile');
      }
      return;
    }
  }

  // 有映射，使用 QuickPick 选择
  const selector = new QuickPickNoteSelector();
  const selectedIssueId = await selector.show(issueIds, false);

  if (!selectedIssueId) {
    return;
  }

  // selectedIssueId 是 node.id，需要查找节点获取文件路径
  const tree = await readTree();
  if (!tree) {
    vscode.window.showErrorMessage('无法加载问题树。');
    return;
  }

  const result = findNodeById(tree.rootNodes, selectedIssueId);
  if (!result) {
    vscode.window.showErrorMessage(`找不到对应的笔记节点：${selectedIssueId}`);
    return;
  }

  const filePath = path.join(issueDir, result.node.filePath);
  
  // 打开选中的笔记
  const uri = vscode.Uri.file(filePath);
  try {
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);
  } catch (error) {
    vscode.window.showErrorMessage(`无法打开笔记文件：${result.node.filePath}`);
    console.error('打开笔记失败:', error);
  }
}

/**
 * 注册命令
 */
export function registerOpenMappedNoteCommand(context: vscode.ExtensionContext): void {
  const command = vscode.commands.registerCommand(
    'issueManager.openMappedNote',
    openMappedNote
  );
  context.subscriptions.push(command);
}
