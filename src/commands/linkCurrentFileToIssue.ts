import * as vscode from 'vscode';
import * as path from 'path';
import { quickCreateIssue } from '../commands/quickCreateIssue';
import { getIssueDir } from '../config';
import { getRelativeToNoteRoot } from '../utils/pathUtils';
import { getIssueMarkdownFrontmatter, updateIssueMarkdownFrontmatter } from '../data/IssueMarkdowns';
import { getIssueNodeById } from '../data/issueTreeManager';

export async function linkCurrentFileToIssue(): Promise<void> {
  try {
    const issueDir = getIssueDir();
    if (!issueDir) {
      vscode.window.showWarningMessage('请先配置问题目录。');
      return;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showInformationMessage('没有打开的文件。');
      return;
    }

    const currentFilePath = editor.document.uri.fsPath;
    const rel = getRelativeToNoteRoot(currentFilePath);
    // 优先使用相对于 issueDir 的相对路径，否则使用绝对路径
    const storedPath = rel !== undefined && rel !== '' ? rel : currentFilePath;

    // 支持记录当前编辑器选区或光标范围为 fragment（例如 #L10 或 #L10-L12）
    let fragment = '';  
    const sel = editor.selection;
    if (sel && !sel.isEmpty) {
      const startLine = sel.start.line + 1;
      const endLine = sel.end.line + 1;
      if (startLine === endLine) {
        fragment = `#L${startLine}`;
      } else {
        fragment = `#L${startLine}-L${endLine}`;
      }
    } else if (editor.selection) {
      // 光标处无选区，记录光标所在行
      const line = editor.selection.active.line + 1;
      fragment = `#L${line}`;
    }
    // 使用双中括号 wiki-link 结构存储，并在路径前加上 `file:` 前缀，带可选 fragment
    // 例如: [[file:notes/foo.md#L10-L12]] 或 [[file:/abs/path/to/file.md#L10]]
    const linkValue = `[[file:${storedPath}${fragment}]]`;

    // 使用 quickCreateIssue 选择或创建 issue（作为默认交互）
    const issueId = await quickCreateIssue();
    if (!issueId) return;

    // 仅使用 tree 中的节点以获取问题文件的 resourceUri
    const issueNode = await getIssueNodeById(issueId).catch(() => undefined);
    if (!issueNode || !issueNode.resourceUri) {
      console.error('未能通过 tree 找到对应的 issue 节点或 resourceUri，不会回退到基于 id 的路径。', { issueId });
      vscode.window.showErrorMessage('未能定位目标问题文件，请在问题视图中刷新或确保 tree.json 已包含该节点。');
      return;
    }
    const issueUri = issueNode.resourceUri;

    // 读取现有 frontmatter
    const fm = await getIssueMarkdownFrontmatter(issueUri) || {};
    let currentLinked: string[] = [];
    if (Array.isArray(fm.issue_linked_files)) {
      currentLinked = fm.issue_linked_files as string[];
    }

    if (currentLinked.includes(linkValue)) {
      vscode.window.showInformationMessage('该文件已关联到所选问题。');
      return;
    }

    const updated = [...currentLinked, linkValue];

    try {
      // 诊断：检查问题文件是否存在并打印当前 frontmatter
      try {
        await vscode.workspace.fs.stat(issueUri);
      } catch (statErr) {
        console.error('目标 issue 文件不存在:', issueUri.fsPath, statErr);
        vscode.window.showErrorMessage(`目标问题文件不存在: ${issueUri.fsPath}`);
        return;
      }

      console.debug('linkCurrentFileToIssue: current frontmatter:', fm);

      const ok = await updateIssueMarkdownFrontmatter(issueUri, { issue_linked_files: updated });
      if (ok) {
        vscode.window.showInformationMessage('已将当前文件关联到问题。');
      } else {
        // 进一步读取文件内容以便调试
        try {
          const doc = await vscode.workspace.openTextDocument(issueUri);
          console.error('updateIssueMarkdownFrontmatter 返回 false，目标文件内容（前2000字符）：', doc.getText().slice(0, 2000));
        } catch (readErr) {
          console.error('updateIssueMarkdownFrontmatter 返回 false，且无法读取目标文件内容:', readErr);
        }
        vscode.window.showErrorMessage('关联失败，请查看扩展开发者控制台以获得详细日志。');
      }
    } catch (err) {
      console.error('更新 frontmatter 过程中发生异常:', err);
      vscode.window.showErrorMessage('关联时发生异常，详情见控制台日志。');
    }
  } catch (err) {
    console.error('linkCurrentFileToIssue error:', err);
    vscode.window.showErrorMessage('将文件关联到问题时发生错误');
  }
}

export function registerLinkCurrentFileToIssue(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand('issueManager.linkCurrentFileToIssue', linkCurrentFileToIssue);
  context.subscriptions.push(disposable);
}

