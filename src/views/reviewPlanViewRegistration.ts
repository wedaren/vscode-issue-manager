import * as vscode from 'vscode';
import { ReviewPlanProvider } from './ReviewPlanProvider';
import { ViewContextManager } from '../services/ViewContextManager';
import { EditorEventManager } from '../services/EditorEventManager';
import { onTitleUpdate } from '../data/IssueMarkdowns';

export function registerReviewPlanView(context: vscode.ExtensionContext, viewContextManager?: ViewContextManager) {
  const provider = new ReviewPlanProvider(context);
  context.subscriptions.push(provider);

  const view = vscode.window.createTreeView('issueManager.views.review', {
    treeDataProvider: provider,
    canSelectMany: false,
    showCollapseAll: false,
  });
  context.subscriptions.push(view);

  if (viewContextManager) {
    viewContextManager.registerTreeView('issueManager.views.review', view);
  }

  // 当 title/frontmatter 更新时刷新
  const sub = onTitleUpdate(() => provider.refresh());
  context.subscriptions.push(sub);

  // 支持在激活编辑器时刷新
  const editorSub = vscode.window.onDidChangeActiveTextEditor(() => provider.refresh());
  context.subscriptions.push(editorSub);

  // 按钮命令（在 package.json 已声明）：issueManager.openReviewPlanQuickPick
}
