import * as vscode from 'vscode';
import * as path from 'path';
import { quickCreateIssue } from '../commands/quickCreateIssue';
import { getIssueNodeById } from '../data/issueTreeManager';
import { getIssueMarkdownFrontmatter, updateIssueMarkdownFrontmatter } from '../data/IssueMarkdowns';

/**
 * 将工作区/文件夹关联到选中的 issue（frontmatter.issue_linked_workspace）
 */
export async function linkWorkspaceToIssue(): Promise<void> {
  try {
    const wf = vscode.workspace.workspaceFolders || [];

    // 提示选择已有工作区或输入自定义路径
    const items: vscode.QuickPickItem[] = wf.map(f => ({ label: f.name || path.basename(f.uri.fsPath), description: f.uri.fsPath }));
    items.push({ label: '$(file-directory) 输入自定义路径', description: '' });

    const picked = await vscode.window.showQuickPick(items, { placeHolder: '选择要关联的工作区/文件夹，或选择输入自定义路径' });
    if (!picked) return;

    let workspacePath: string | undefined;
    if (picked.description) {
      workspacePath = picked.description;
    } else {
      const input = await vscode.window.showInputBox({
        prompt: '请输入工作区或文件夹的绝对路径或 .code-workspace 文件路径',
        validateInput: (value) => {
          if (!value.trim()) {
            return '路径不能为空。';
          }
          if (!path.isAbsolute(value.trim())) {
            return '必须输入绝对路径。';
          }
          return null; // valid
        }
      });
      if (!input) return;
      workspacePath = input.trim();
    }

    // 验证路径存在
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(workspacePath));
    } catch (e) {
      vscode.window.showErrorMessage(`无法访问路径: ${workspacePath}`);
      return;
    }

    // 使用 quickCreateIssue 选择或创建 issue
    const issueId = await quickCreateIssue();
    if (!issueId) return;

    const issueNode = await getIssueNodeById(issueId).catch(() => undefined);
    if (!issueNode || !issueNode.resourceUri) {
      vscode.window.showErrorMessage('未能定位选定问题的文件，请确保 tree.json 已包含该节点并刷新问题视图。');
      return;
    }

    const issueUri = issueNode.resourceUri;

    // 读取现有 frontmatter
    const fm = await getIssueMarkdownFrontmatter(issueUri) || {};
    let current: string[] = [];
    if (Array.isArray(fm.issue_linked_workspace)) current = fm.issue_linked_workspace as string[];

    const linkValue = `[[workspace:${workspacePath}]]`;
    if (current.includes(linkValue)) {
      vscode.window.showInformationMessage('该工作区已关联到所选问题。');
      return;
    }

    const updated = [...current, linkValue];
    const ok = await updateIssueMarkdownFrontmatter(issueUri, { issue_linked_workspace: updated });
    if (ok) {
      vscode.window.showInformationMessage('已将工作区关联到问题。');
    } else {
      vscode.window.showErrorMessage('关联失败，请查看开发者控制台日志。');
    }
  } catch (err) {
    console.error('linkWorkspaceToIssue error:', err);
    vscode.window.showErrorMessage('关联工作区到问题时发生错误');
  }
}

export function registerLinkWorkspaceToIssue(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand('issueManager.linkWorkspaceToIssue', linkWorkspaceToIssue);
  context.subscriptions.push(disposable);
}

