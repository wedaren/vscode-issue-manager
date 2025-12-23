import * as vscode from 'vscode';
import * as path from 'path';
import { readTree, findNodeById } from '../data/issueTreeManager';
import { getIssueDir } from '../config';

/**
 * 通过 node.id 打开笔记
 * @param nodeId node.id（节点唯一标识符）
 */
export async function openNoteByNodeId(nodeId: string): Promise<void> {
  const issueDir = getIssueDir();
  if (!issueDir) {
    vscode.window.showWarningMessage('请先配置问题目录。');
    return;
  }

  const tree = await readTree();
  if (!tree) {
    vscode.window.showErrorMessage('无法加载问题树。');
    return;
  }

  const result = findNodeById(tree.rootNodes, nodeId);
  if (!result) {
    vscode.window.showErrorMessage(`找不到对应的笔记节点：${nodeId}`);
    return;
  }

  const filePath = path.join(issueDir, result.node.filePath);
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
export function registerOpenNoteByNodeIdCommand(context: vscode.ExtensionContext): void {
  const command = vscode.commands.registerCommand(
    'issueManager.openNoteByNodeId',
    openNoteByNodeId
  );
  context.subscriptions.push(command);
}
