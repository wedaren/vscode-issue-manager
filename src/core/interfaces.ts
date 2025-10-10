import * as vscode from 'vscode';
import { IssueTreeNode } from '../data/treeManager';
import { IssueStructureProvider } from '../views/IssueStructureProvider';
import { ParaViewProvider } from '../views/ParaViewProvider';
import { ParaViewNode } from '../types';

/**
 * 视图提供者基础接口
 * 
 * 定义所有树视图提供者必须实现的基本契约，
 * 确保视图能够正确响应数据变化和用户操作。
 * 
 * @template T 树节点的类型
 */
export interface IIssueViewProvider<T = vscode.TreeItem> extends vscode.TreeDataProvider<T> {
    /**
     * 刷新视图数据
     * 
     * 触发视图重新加载和渲染，通常在数据源发生变化时调用
     */
    refresh(): void;
}

/**
 * 关注问题视图提供者接口
 * 
 * 扩展基础视图提供者，添加关注问题特有的功能，
 * 包括数据加载和节点查找功能。
 */
export interface IFocusedIssuesProvider extends IIssueViewProvider<IssueTreeNode> {
    /**
     * 加载关注问题数据
     * 
     * 异步加载关注问题列表，包括从存储中读取
     * 用户标记的问题和相关元数据。
     * 
     * @returns Promise<void> 数据加载完成的Promise
     */
    loadData(): Promise<void>;
    
    /**
     * 根据ID查找关注的问题节点
     * 
     * 在关注问题树中查找指定ID的节点，返回节点实例
     * 及其在树中的路径信息。
     * 
     * @param id 问题节点的唯一标识符
     * @returns 查找结果，包含节点和父级列表，未找到则返回null
     */
    findFirstFocusedNodeById(id: string): { node: IssueTreeNode; parentList: IssueTreeNode[] } | null;
}

/**
 * 问题总览视图提供者接口
 * 
 * 专门用于问题总览视图的接口定义，目前继承基础功能，
 * 为将来可能的扩展预留接口空间。
 */
export interface IIssueOverviewProvider extends IIssueViewProvider<IssueTreeNode> {
    // 问题总览视图的特有方法可以在这里定义
    // 目前使用基础接口功能即可
}

/**
 * 视图注册结果接口
 * 
 * 定义视图注册管理器返回的所有视图实例类型，
 * 确保类型安全和智能提示的完整性。
 */
export interface IViewRegistryResult {
    /** 问题总览视图提供者实例 */
    issueOverviewProvider: IIssueOverviewProvider;
    
    /** 关注问题视图提供者实例 */
    focusedIssuesProvider: IFocusedIssuesProvider;
    
    /** 最近问题视图提供者实例 */
    recentIssuesProvider: IIssueViewProvider<vscode.TreeItem>;
    
    /** 问题总览树视图实例 */
    overviewView: vscode.TreeView<IssueTreeNode>;
    
    /** 关注问题树视图实例 */
    focusedView: vscode.TreeView<IssueTreeNode>;
    
    /** 最近问题树视图实例 */
    recentIssuesView: vscode.TreeView<vscode.TreeItem>;
    
    /** RSS问题视图提供者实例 */
    rssIssuesProvider: IIssueViewProvider<vscode.TreeItem>;
    
    /** RSS问题树视图实例 */
    rssIssuesView: vscode.TreeView<vscode.TreeItem>;
    
    /** 问题结构视图提供者实例 */
    issueStructureProvider: IssueStructureProvider;
    
    /** 问题结构树视图实例 */
    structureView: vscode.TreeView<vscode.TreeItem>;
    
    /** PARA 视图提供者实例 */
    paraViewProvider: ParaViewProvider;
    
    /** PARA 树视图实例 */
    paraView: vscode.TreeView<ParaViewNode>;
}

/**
 * 命令注册错误类型
 * 
 * 用于标识命令注册过程中可能出现的错误类型
 */
export enum CommandRegistrationError {
    /** 基础命令注册失败 */
    BASIC_COMMANDS_FAILED = 'BASIC_COMMANDS_FAILED',
    
    /** 视图命令注册失败 */
    VIEW_COMMANDS_FAILED = 'VIEW_COMMANDS_FAILED',
    
    /** 外部命令注册失败 */
    EXTERNAL_COMMANDS_FAILED = 'EXTERNAL_COMMANDS_FAILED',
    
    /** 工具命令注册失败 */
    UTILITY_COMMANDS_FAILED = 'UTILITY_COMMANDS_FAILED'
}

/**
 * 初始化阶段枚举
 * 
 * 定义扩展初始化的各个阶段，用于错误报告和进度跟踪
 */
export enum InitializationPhase {
    /** 配置监听初始化 */
    CONFIGURATION = 'CONFIGURATION',
    
    /** 服务初始化 */
    SERVICES = 'SERVICES',
    
    /** 视图注册 */
    VIEWS = 'VIEWS',
    
    /** 命令注册 */
    COMMANDS = 'COMMANDS'
}

/**
 * 生命周期管理接口
 * 
 * 定义组件的生命周期方法，确保资源能够正确清理
 */
export interface ILifecycleManager extends vscode.Disposable {
    /**
     * 初始化组件
     * 
     * @returns Promise<void> 初始化完成的Promise
     */
    initialize?(): Promise<void>;
    
    /**
     * 获取组件的健康状态
     * 
     * @returns boolean 组件是否健康运行
     */
    isHealthy?(): boolean;
}