import * as vscode from 'vscode';
import {  RelatedIssuesProvider } from './RelatedIssuesProvider';
import { IssueTreeNode } from '../data/treeManager';

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
  context.subscriptions.push(vscode.commands.registerCommand('issueManager.viewRelatedIssues', async (uriOrNode: vscode.TreeItem | vscode.Uri) => {
    const resourceUri = uriOrNode instanceof vscode.Uri ? uriOrNode : uriOrNode?.resourceUri;
    relatedIssuesProvider.updateContext(resourceUri);
  }));

  // 注册命令：打开并在问题总览中定位
  context.subscriptions.push(vscode.commands.registerCommand('issueManager.openAndRevealIssue', async (node: IssueTreeNode) => {
    if (!node || !node.resourceUri) { return; }
    // 打开文件
    // await vscode.window.showTextDocument(node.resourceUri, { preview: false });
    // 在问题总览视图定位并高亮
    console.log(`Revealing issue in overview: ${node.id} (${node.filePath})`);
    await vscode.commands.executeCommand('issueManager.views.overview.reveal', node, { select: true, focus: true, expand: true });
  }));
}
