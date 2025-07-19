import * as vscode from 'vscode';
import {  RelatedIssuesProvider } from './RelatedIssuesProvider';

/**
 * 注册“关联问题视图”及相关命令
 */
export function registerRelatedIssuesView(context: vscode.ExtensionContext) {
  // 创建数据提供者实例
  const relatedIssuesProvider = new RelatedIssuesProvider();
  // 注册 TreeView
  const relatedIssuesView = vscode.window.createTreeView('issueManager.views.related', {
    treeDataProvider: relatedIssuesProvider,
    canSelectMany: false
  });
  context.subscriptions.push(relatedIssuesView);

  // 注册命令：查看关联问题
  context.subscriptions.push(vscode.commands.registerCommand('issueManager.viewRelatedIssues', async (node: vscode.TreeItem) => {
    relatedIssuesProvider.updateContext(node.resourceUri);
  }));
}
