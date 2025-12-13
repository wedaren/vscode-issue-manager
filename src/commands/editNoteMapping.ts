import * as vscode from 'vscode';
import { NoteMappingService } from '../services/noteMapping/NoteMappingService';
import { getIssueDir } from '../config';

/**
 * 编辑笔记映射（打开映射文件）
 */
export async function editNoteMapping(): Promise<void> {
  const issueDir = getIssueDir();
  if (!issueDir) {
    vscode.window.showWarningMessage('请先配置问题目录。');
    return;
  }

  // 获取映射文件路径
  const mappingsFilePath = `${issueDir}/.issueManager/mappings.yaml`;
  const uri = vscode.Uri.file(mappingsFilePath);

  try {
    // 检查文件是否存在
    await vscode.workspace.fs.stat(uri);
  } catch {
    // 文件不存在，创建一个空文件
    const content = `version: '1.0'
mappings: []
`;
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
  }

  // 打开文件
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document);
}

/**
 * 注册命令
 */
export function registerEditNoteMappingCommand(context: vscode.ExtensionContext): void {
  const command = vscode.commands.registerCommand(
    'issueManager.editNoteMapping',
    editNoteMapping
  );
  context.subscriptions.push(command);
}
