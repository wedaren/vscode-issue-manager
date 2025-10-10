import * as vscode from 'vscode';
import {
  ParaCategory,
  getCategoryLabel,
  addIssueToCategory,
  findIssueCategory
} from '../data/paraManager';

/**
 * 添加问题到指定 PARA 分类。
 *
 * @param category PARA 分类（projects、areas、resources、archives），用于指明目标分类。
 * @param issueId 问题节点的 ID（从树节点传递）；若缺失则不会执行分类操作。
 * @returns 返回一个 Promise，当分类操作完成并刷新 PARA 视图后 resolve；若过程中出现错误则会在消息面板提示。
 */
export async function addIssueToParaCategory(
  category: ParaCategory,
  issueId?: string
): Promise<void> {
  if (!issueId) {
    vscode.window.showWarningMessage('无法确定问题节点 ID');
    return;
  }

  try {
    // 检查问题是否已在某个分类中
    const currentCategory = await findIssueCategory(issueId);
    
    // 添加到指定分类（会自动从其他分类移除）
    await addIssueToCategory(category, issueId);
    
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
    vscode.window.showErrorMessage(`操作失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}