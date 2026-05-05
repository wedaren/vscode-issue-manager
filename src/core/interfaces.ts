import * as vscode from 'vscode';
import { IssueNode } from '../data/issueTreeManager';
import { ParaViewProvider } from '../views/ParaViewProvider';
import { ParaViewNode } from '../types';
import { MarkerManager } from '../marker/MarkerManager';
import { MarkerTreeProvider } from '../marker/MarkerTreeProvider';

/**
 * 视图提供者基础接口
 * 
 * 定义所有树视图提供者必须实现的基本契约，
 * 确保视图能够正确响应数据变化和用户操作。
 * 
 * @template T 树节点的类型
 */
export interface IIssueViewProvider<T = vscode.TreeItem> extends vscode.TreeDataProvider<T> {  
    refresh(): void;  
    getElementByUri?(uri: vscode.Uri): Promise<T | null | undefined>;  
}  
/**
 * 问题总览视图提供者接口
 * 
 * 专门用于问题总览视图的接口定义，目前继承基础功能，
 * 为将来可能的扩展预留接口空间。
 */
export interface IIssueOverviewProvider extends IIssueViewProvider<IssueNode> {
    /** 标签刷新：仅触发 onDidChangeTreeData，不重读 tree.json */
    fireUpdate(): void;
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

    /** 最近问题视图提供者实例 */
    recentIssuesProvider: IIssueViewProvider<vscode.TreeItem>;

    /** 问题总览树视图实例 */
    overviewView: vscode.TreeView<IssueNode>;

    /** 最近问题树视图实例 */
    recentIssuesView: vscode.TreeView<vscode.TreeItem>;

    /** PARA 视图提供者实例 */
    paraViewProvider: ParaViewProvider;

    /** PARA 树视图实例 */
    paraView: vscode.TreeView<ParaViewNode>;

    /** 标记管理器实例 */
    markerManager: MarkerManager;

    /** 标记树视图提供者实例 */
    markerTreeProvider: MarkerTreeProvider;

    /** 标记树视图实例 */
    markerView: vscode.TreeView<vscode.TreeItem>;
    /** 编辑器组管理视图提供者实例 */
    editorGroupProvider: import('../views/EditorGroupTreeProvider').EditorGroupTreeProvider;
    /** 编辑器组管理树视图实例 */
    editorGroupView: vscode.TreeView<import('../views/EditorGroupTreeProvider').EditorGroupViewNode>;
    /** LLM 聊天角色视图提供者实例 */
    llmChatRoleProvider: import('../llmChat/LLMChatRoleProvider').LLMChatRoleProvider;
    /** LLM 聊天角色树视图实例 */
    llmChatRoleView: vscode.TreeView<import('../llmChat/LLMChatRoleProvider').LLMChatViewNode>;
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