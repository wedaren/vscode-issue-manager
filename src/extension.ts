import * as vscode from 'vscode';
import { ExtensionInitializer } from './core/ExtensionInitializer';
import { GitSyncService } from './services/GitSyncService';
import { TitleCacheService } from './services/TitleCacheService';
import { ChromeIntegrationServer } from './integration/ChromeIntegrationServer';
import { SharedConfig } from './config/SharedConfig';
import { IssueFileCompletionProvider } from './providers/IssueFileCompletionProvider';
import { IssueDocumentLinkProvider } from './providers/IssueDocumentLinkProvider';
import { copilotDocumentProvider } from './virtual/CopilotDocumentProvider';

// 当您的扩展被激活时,将调用此方法
export function activate(context: vscode.ExtensionContext) {
	// 初始化共享配置（必须在其他服务之前）
	SharedConfig.initialize(context);
	
	const initializer = new ExtensionInitializer(context);
	// 预加载标题缓存（不阻塞激活流程）
	void TitleCacheService.getInstance().preload();
	// 启动 Chrome 集成本地服务与 URI Handler（不阻塞激活流程）
	void ChromeIntegrationServer.getInstance().start(context);
	
	// 注册 Issue 文件补全提供器
	const completionProvider = new IssueFileCompletionProvider(context);
	// 从配置读取触发器并提取首字符，避免硬编码
	const completionConfig = vscode.workspace.getConfiguration('issueManager.completion');
	const triggers = completionConfig.get<string[]>('triggers', ['[[']);
	// 提取每个触发器的首字符并去重，过滤掉空字符串
	const triggerCharacters = [...new Set(triggers.map(t => (t || '').charAt(0)).filter(c => !!c))];
	const completionDisposable = vscode.languages.registerCompletionItemProvider(
		'markdown',
		completionProvider,
		...triggerCharacters
	);
	context.subscriptions.push(completionDisposable);
	
	// 注册 Issue 文档链接提供器
	const linkProvider = new IssueDocumentLinkProvider();
	const linkProviderDisposable = vscode.languages.registerDocumentLinkProvider(
		'markdown',
		linkProvider
	);
	context.subscriptions.push(linkProviderDisposable);

	// 注册 Copilot 虚拟文档提供者（用于展示不提示保存的虚拟编辑窗口）
	const providerDisposable = vscode.workspace.registerTextDocumentContentProvider('copilot', copilotDocumentProvider);
	context.subscriptions.push(providerDisposable);
	
	return initializer.initialize();
}

// 当您的扩展被停用时，将调用此方法
export async function deactivate() {
	// 执行最终同步
	const gitSyncService = GitSyncService.getInstance();
	await gitSyncService.performFinalSync();
}