import * as vscode from 'vscode';
import {  RelatedIssueNode, RelatedIssuesProvider } from './RelatedIssuesProvider';
import { onTitleUpdate } from '../data/IssueMarkdowns';
import { ViewContextManager } from '../services/ViewContextManager';
import { EditorEventManager } from '../services/EditorEventManager';

/**
 * 注册"相关联问题视图"及相关命令
 * @param viewContextManager 可选的视图上下文管理器,用于注册视图实例
 */
export function registerRelatedIssuesView(context: vscode.ExtensionContext, viewContextManager?: ViewContextManager) {
  // 创建数据提供者实例
  const relatedIssuesProvider = new RelatedIssuesProvider(context);
  // 将数据提供者添加到订阅列表，确保正确的生命周期管理
  context.subscriptions.push(relatedIssuesProvider);
  
  // 注册 TreeView
  const relatedIssuesView = vscode.window.createTreeView('issueManager.views.related', {
    treeDataProvider: relatedIssuesProvider,
    canSelectMany: false
  });
  context.subscriptions.push(relatedIssuesView);
  
  // 如果提供了视图上下文管理器，注册到管理器中
  if (viewContextManager) {
    viewContextManager.registerTreeView('issueManager.views.related', relatedIssuesView);
  }

  // 注册节点级 pin 命令
  context.subscriptions.push(vscode.commands.registerCommand('issueManager.pinRelatedNode', async (node: RelatedIssueNode) => {
    if (node?.id) {
      await relatedIssuesProvider.pinNode(node.id, node);
    }
  }));
  
  // 注册节点级 unpin 命令
  context.subscriptions.push(vscode.commands.registerCommand('issueManager.unpinRelatedNode', async (node: RelatedIssueNode) => {
    if (node?.id) {
      await relatedIssuesProvider.unpinNode(node.id);
    }
  }));

  // 订阅编辑器事件管理器，自动更新相关联问题视图
  const editorEventManager = EditorEventManager.getInstance();
  const subscription = editorEventManager.onIssueFileActivated((uri) => {
    relatedIssuesProvider.setContextUri(uri);  
  });
  context.subscriptions.push(subscription);

  // 订阅 VS Code 的活动编辑器变化，支持外部文件或任意文件的关联展示
  const editorSub = vscode.window.onDidChangeActiveTextEditor((editor) => {
    relatedIssuesProvider.setContextUri(editor?.document.uri);
  });
  context.subscriptions.push(editorSub);

  // 当 issue 文件的 frontmatter/title 更新时刷新视图（例如 updateIssueMarkdownFrontmatter 后）
  const titleSub = onTitleUpdate(() => {
    relatedIssuesProvider.refresh();
  });
  context.subscriptions.push(titleSub);
}
