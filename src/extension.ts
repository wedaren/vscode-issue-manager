import * as vscode from 'vscode';
import { GitSyncService } from './services/GitSyncService';
import {
	ConfigurationInitializer,
	ServiceInitializer,
	ViewRegistrar,
	CommandRegistrar,
	EventListenerRegistrar
} from './activation';


// 当您的扩展被激活时，将调用此方法
export function activate(context: vscode.ExtensionContext) {
	// 初始化配置和上下文
	ConfigurationInitializer.initialize(context);
	
	// 初始化服务
	ServiceInitializer.initialize(context);
	
	// 注册视图
	const viewComponents = ViewRegistrar.register(context);
	
	// 注册命令
	CommandRegistrar.register(context, viewComponents);
	
	// 注册事件监听器
	EventListenerRegistrar.register(context);
}

// 当您的扩展被停用时，将调用此方法
export async function deactivate() {
	// 执行最终同步
	const gitSyncService = GitSyncService.getInstance();
	await gitSyncService.performFinalSync();
}