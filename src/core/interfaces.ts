import * as vscode from 'vscode';
import { IssueTreeNode } from '../data/treeManager';

/**
 * 视图提供者接口
 * 定义所有树视图提供者的基本契约
 */
export interface IIssueViewProvider extends vscode.TreeDataProvider<any> {
    refresh(): void;
}

/**
 * 关注问题视图提供者特定接口
 */
export interface IFocusedIssuesProvider extends IIssueViewProvider {
    loadData(): Promise<void>;
    findFirstFocusedNodeById(id: string): { node: IssueTreeNode; parentList: IssueTreeNode[] } | null;
}

/**
 * 问题总览视图提供者特定接口  
 */
export interface IIssueOverviewProvider extends IIssueViewProvider {
    // IssueOverviewProvider 的 loadData 是私有的，所以不在接口中公开
}

/**
 * 视图注册返回的类型接口
 */
export interface IViewRegistryResult {
    issueOverviewProvider: IIssueOverviewProvider;
    focusedIssuesProvider: IFocusedIssuesProvider;
    recentIssuesProvider: IIssueViewProvider;
    overviewView: vscode.TreeView<IssueTreeNode>;
    focusedView: vscode.TreeView<IssueTreeNode>;
    recentIssuesView: vscode.TreeView<any>;
    rssIssuesProvider: IIssueViewProvider;
    rssIssuesView: vscode.TreeView<any>;
    issueStructureProvider: IIssueViewProvider;
    structureView: vscode.TreeView<any>;
}