import * as vscode from 'vscode';
import { getIssueDir } from '../config';
import { debounce } from '../utils/debounce';
import { LLMService } from '../llm/LLMService';
import { createIssueFile, addIssueToTree } from './issueFileUtils';

/**
 * 智能创建工作流
 * @param parentId 父节点ID，可为null
 * @param isAddToTree 是否添加到树结构
 */
export async function smartCreateIssue(
  parentId: string | null | undefined = null,
  isAddToTree: boolean = false
) {
  const issueDir = getIssueDir();
  if (!issueDir) {
    vscode.window.showErrorMessage('请先在设置中配置“issueManager.issueDir”');
    vscode.commands.executeCommand('workbench.action.openSettings', 'issueManager.issueDir');
    return;
  }

  const quickPick = vscode.window.createQuickPick();
  quickPick.placeholder = '请输入您的问题...';
  quickPick.matchOnDescription = true; // 允许根据描述匹配
  quickPick.canSelectMany = true; // 支持多选
  quickPick.show();
  let quickPickValue = '';
  let requestSequence = 0;

  quickPick.onDidChangeValue(debounce(async (value) => {
    const mySequence = ++requestSequence;
    quickPickValue = value;
    if (!value) {
      quickPick.items = [];
      return;
    }

    // 初始时，只显示原始输入
    const originalInputItem: vscode.QuickPickItem = {
      label: `[创建新笔记] ${value}`,
      description: '使用原始输入创建新笔记'
    };
    quickPick.items = [originalInputItem];

    // 设置为加载状态
    quickPick.busy = true;

    try {
      // 调用 LLM 服务获取建议
      const suggestions = await LLMService.getSuggestions(value);
      // 构建新的列表项
      const newItems: vscode.QuickPickItem[] = [originalInputItem];

      // 添加优化建议
      if (suggestions.optimized.length > 0) {
        newItems.push({ label: '---', kind: vscode.QuickPickItemKind.Separator });
        suggestions.optimized.forEach(opt => {
          newItems.push({ label: `[创建新笔记] ${opt}`, description: opt.includes(value) ? opt : value });
        });
      }

      // 添加分隔符和相似笔记
      if (suggestions.similar.length > 0) {
        newItems.push({ label: '---', kind: vscode.QuickPickItemKind.Separator });
        suggestions.similar.forEach(sim => {
          newItems.push({ label: `[打开已有笔记] ${sim.title}`, description: sim.title.includes(value) ? sim.title : value, detail: sim.filePath });
        });
      }
      if (mySequence === requestSequence) {
        quickPick.items = newItems;
        quickPick.show();
      }
    } catch (error) {
      if (mySequence === requestSequence) {
        quickPick.items = [originalInputItem];
      }
    } finally {
      // 只有最新请求才关闭 busy
      if (mySequence === requestSequence) {
        quickPick.busy = false;
      }
    }
  }, 500));

  quickPick.onDidAccept(async () => {
    requestSequence++; // 立即使所有后续异步响应失效

    const selectedItems = quickPick.selectedItems;
    if (!selectedItems || selectedItems.length === 0) {
      quickPick.hide();
      return;
    }

    // 允许“新建”与“打开已有”同时发生
    let uris: vscode.Uri[] = [];
    // 先处理所有新建
    for (const item of selectedItems) {
      if (item.label.startsWith('[创建新笔记]')) {
        const title = item.label.replace('[创建新笔记] ', '');
        if (title) {
          const uri = await createIssueFile(title);
          if (uri) {
            uris.push(uri);
          }
        }
      }
    }

    // 再处理所有打开
    for (const item of selectedItems) {
      if (item.label.startsWith('[打开已有笔记]')) {
        if (item.detail) {
          try {
            const uri = vscode.Uri.file(item.detail);
            // 尝试访问文件以确认其是否存在
            await vscode.workspace.fs.stat(uri);
            uris.push(uri);
            await vscode.window.showTextDocument(uri);
          } catch (error) {
            vscode.window.showErrorMessage(`无法打开文件，文件可能已被移动或删除: ${item.detail}`);
          }
        }
      }
    }
    if (uris.length && isAddToTree) {
      await addIssueToTree(uris, parentId);
    }

    quickPick.hide();
  });

  // 监听 QuickPick 隐藏事件，确保资源清理
  quickPick.onDidHide(() => {
    quickPick.dispose();
  });
}
