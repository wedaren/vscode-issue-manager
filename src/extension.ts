import * as vscode from 'vscode';
import { ExtensionInitializer } from './core/ExtensionInitializer';
import { GitSyncService } from './services/GitSyncService';
import { TitleCacheService } from './services/TitleCacheService';
import { ChromeIntegrationServer } from './integration/ChromeIntegrationServer';
import { SharedConfig } from './config/SharedConfig';

// 当您的扩展被激活时，将调用此方法
export function activate(context: vscode.ExtensionContext) {
	// 初始化共享配置（必须在其他服务之前）
	SharedConfig.initialize(context);
	
	const initializer = new ExtensionInitializer(context);
	// 预加载标题缓存（不阻塞激活流程）
	void TitleCacheService.getInstance().preload();
	// 启动 Chrome 集成本地服务与 URI Handler（不阻塞激活流程）
	void ChromeIntegrationServer.getInstance().start(context);
	return initializer.initialize();
}

// 当您的扩展被停用时，将调用此方法
export async function deactivate() {
	// 执行最终同步
	const gitSyncService = GitSyncService.getInstance();
	await gitSyncService.performFinalSync();
}