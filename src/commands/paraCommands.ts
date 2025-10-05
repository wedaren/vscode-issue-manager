import * as vscode from 'vscode';
import {
  ParaCategory,
  getCategoryLabel,
  addIssueToCategory,
  findIssueCategory
} from '../data/paraManager';
import { getRelativePathToIssueDir } from '../utils/fileUtils';

/**
 * 添加问题到指定 PARA 分类
 * @param category PARA 分类 (projects, areas, resources, archives)
 * @param fileUri 问题文件 URI
 */
export async function addIssueToParaCategory(
  category: ParaCategory,
  fileUri?: vscode.Uri
): Promise<void> {
  // 获取文件路径
  let filePath: string | null = null;

  if (fileUri) {
    filePath = getRelativePathToIssueDir(fileUri.fsPath);
  } else {
    // 从当前活动编辑器获取
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
      filePath = getRelativePathToIssueDir(activeEditor.document.uri.fsPath);
    }
  }

  if (!filePath) {
    vscode.window.showWarningMessage('无法确定问题文件路径');
    return;
  }

  try {
    // 检查问题是否已在某个分类中
    const currentCategory = await findIssueCategory(filePath);
    
    // 添加到指定分类（会自动从其他分类移除）
    await addIssueToCategory(category, filePath);
    
    const categoryLabel = getCategoryLabel(category);
    
    if (currentCategory && currentCategory !== category) {
      // 从另一个分类移动过来
      const fromLabel = getCategoryLabel(currentCategory);
      vscode.window.showInformationMessage(`已将问题从 ${fromLabel} 移动到 ${categoryLabel}`);
    } else if (currentCategory === category) {
      // 已经在当前分类中
      vscode.window.showInformationMessage(`问题已在 ${categoryLabel} 中`);
    } else {
      // 新添加到分类
      vscode.window.showInformationMessage(`已将问题添加到 ${categoryLabel}`);
    }

    // 刷新视图
    vscode.commands.executeCommand('issueManager.para.refresh');
  } catch (error) {
    vscode.window.showErrorMessage(`操作失败: ${error}`);
  }
}

/**
 * 刷新 PARA 视图
 */
export function refreshParaView(): void {
  // 这个函数会在注册命令时被具体的 provider 实例替换
}
