import * as vscode from 'vscode';
import {  RelatedIssuesProvider } from './RelatedIssuesProvider';
import { ViewContextManager } from '../services/ViewContextManager';

/**
 * 注册"相关联问题视图"及相关命令
 * @param viewContextManager 可选的视图上下文管理器，用于注册视图实例
 */
export function registerRelatedIssuesView(context: vscode.ExtensionContext, viewContextManager?: ViewContextManager) {
  // 创建数据提供者实例
  const relatedIssuesProvider = new RelatedIssuesProvider(context);
  // 将数据提供者添加到订阅列表，确保正确的生命周期管理
  context.subscriptions.push(relatedIssuesProvider);
  // 视图锁定状态
  let isPinned = false;
  // 设置上下文变量
  function updatePinContext(val: boolean) {
    isPinned = val;
    vscode.commands.executeCommand('setContext', 'issueManager.relatedViewPinned', isPinned);
  }
  updatePinContext(false);
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

  // 注册锁定命令
  context.subscriptions.push(vscode.commands.registerCommand('issueManager.pinRelatedView', () => {
    updatePinContext(true);
    vscode.window.showInformationMessage('已锁定相关联问题视图，内容将不会自动刷新。');
  }));
  // 注册解锁命令
  context.subscriptions.push(vscode.commands.registerCommand('issueManager.unpinRelatedView', () => {
    updatePinContext(false);
    vscode.window.showInformationMessage('已解锁相关联问题视图，内容将根据上下文自动刷新。');
    // 解锁后立即刷新为当前上下文
    relatedIssuesProvider.updateContext(vscode.window.activeTextEditor?.document.uri);
  }));

  // 注册命令：查看关联问题
  context.subscriptions.push(vscode.commands.registerCommand('issueManager.viewRelatedIssues', async (uriOrNode: vscode.TreeItem | vscode.Uri) => {
    const resourceUri = uriOrNode instanceof vscode.Uri ? uriOrNode : uriOrNode?.resourceUri;
    if (!isPinned) {
      relatedIssuesProvider.updateContext(resourceUri);
    }
  }));
}
