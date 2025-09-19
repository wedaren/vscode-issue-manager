import * as vscode from 'vscode';
import { ExtensionInitializer } from './core/ExtensionInitializer';
import { GitSyncService } from './services/GitSyncService';

// 当您的扩展被激活时，将调用此方法
export function activate(context: vscode.ExtensionContext) {
	const initializer = new ExtensionInitializer(context);
	return initializer.initialize();
}

// 当您的扩展被停用时，将调用此方法
export async function deactivate() {
	// 执行最终同步
	const gitSyncService = GitSyncService.getInstance();
	await gitSyncService.performFinalSync();
}