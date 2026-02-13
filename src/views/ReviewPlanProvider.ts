import * as vscode from 'vscode';
import { IssueMarkdown, getAllIssueMarkdowns, extractIssueTitleFromFrontmatter } from '../data/IssueMarkdowns';
import { getRelativeToNoteRoot } from '../utils/pathUtils';
import { onTitleUpdate } from '../data/IssueMarkdowns';

export type ReviewViewNode = vscode.TreeItem & { md?: IssueMarkdown };

export class ReviewPlanProvider implements vscode.TreeDataProvider<ReviewViewNode>, vscode.Disposable {
  private _onDidChangeTreeData = new vscode.EventEmitter<ReviewViewNode | null | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private disposables: vscode.Disposable[] = [];

  constructor(private context: vscode.ExtensionContext) {
    this.disposables.push(onTitleUpdate(() => this.refresh()));
  }

  dispose() {
    this.disposables.forEach(d => d.dispose());
    this._onDidChangeTreeData.dispose();
  }

  async getChildren(element?: ReviewViewNode): Promise<ReviewViewNode[]> {
    if (!element) {
      // 顶层：列出已经存在的回顾文档（frontmatter.review_period）
      const all = await getAllIssueMarkdowns({ sortBy: 'mtime' });
      const reviews = all.filter(m => !!m.frontmatter && typeof m.frontmatter.review_period === 'string');
      const items: ReviewViewNode[] = reviews.map(r => {
        const label = extractIssueTitleFromFrontmatter(r.frontmatter) ?? r.title;
        const rel = getRelativeToNoteRoot(r.uri.fsPath) ?? r.uri.fsPath;
        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None) as ReviewViewNode;
        item.command = { command: 'vscode.open', title: '打开', arguments: [r.uri] };
        item.description = rel;
        item.md = r;
        item.contextValue = 'reviewItem';
        return item;
      });
      return items;
    }
    return [];
  }

  getTreeItem(element: ReviewViewNode): vscode.TreeItem {
    return element;
  }

  getParent(): ReviewViewNode | null {
    return null;
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }
}
