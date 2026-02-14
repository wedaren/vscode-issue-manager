import * as vscode from 'vscode';
import { ExtensionInitializer } from './core/ExtensionInitializer';
import { GitSyncService } from './services/GitSyncService';
import { ChromeIntegrationServer } from './integration/ChromeIntegrationServer';
import { SharedConfig } from './config/SharedConfig';
import { IssueNodeCompletionProvider } from './providers/IssueNodeCompletionProvider';
import { IssueTermCompletionProvider } from './providers/IssueTermCompletionProvider';
import { IssueDocumentHoverProvider, IssueDocumentLinkProvider } from './providers/IssueDocumentLinkProvider';
import { CsvDocumentLinkProvider } from './providers/CsvDocumentLinkProvider';
import { registerOpenInSplit } from './commands/openInSplit';
import { registerLinkCurrentFileToIssue } from './commands/linkCurrentFileToIssue';
import { registerLinkWorkspaceToIssue } from './commands/linkWorkspaceToIssue';
import { registerQuickPeekIssue } from './commands/quickPeekIssue';
import { copilotDocumentProvider } from './virtual/CopilotDocumentProvider';

// 当您的扩展被激活时,将调用此方法
export function activate(context: vscode.ExtensionContext) {
	// 初始化共享配置（必须在其他服务之前）
	SharedConfig.initialize(context);
	
	const initializer = new ExtensionInitializer(context);
	// 笔记映射功能已移除：不再预加载相关服务或更新上下文
	// 启动 Chrome 集成本地服务与 URI Handler（不阻塞激活流程）
	void ChromeIntegrationServer.getInstance().start(context);
	
	// 注册 Issue 文件补全提供器
	const completionProvider = new IssueNodeCompletionProvider(context);
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

	// 注册 Issue 术语补全提供器（可配置触发字符）
	const termCompletionProvider = new IssueTermCompletionProvider();
	// 从配置读取术语补全触发器（例如: "`"、"·"），并提取每个触发器的首字符用于注册
	const termCompletionConfig = vscode.workspace.getConfiguration('issueManager.completion');
	const termTriggers = termCompletionConfig.get<string[]>('termTriggers', ['`', '·']);
	const termTriggerChars = [...new Set(termTriggers.map(t => (t || '').charAt(0)).filter(c => !!c))];
	const termCompletionDisposable = vscode.languages.registerCompletionItemProvider(
		'markdown',
		termCompletionProvider,
		...termTriggerChars
	);
	context.subscriptions.push(termCompletionDisposable);
	
	// 注册 Issue 文档链接提供器
	const linkProvider = new IssueDocumentLinkProvider();
	const linkProviderDisposable = vscode.languages.registerDocumentLinkProvider(
		'markdown',
		linkProvider
	);
	context.subscriptions.push(linkProviderDisposable);

	// 注册 Issue 文档 Hover 提示（支持 Markdown 按钮）
	const hoverProvider = new IssueDocumentHoverProvider();
	const hoverProviderDisposable = vscode.languages.registerHoverProvider(
		'markdown',
		hoverProvider
	);
	context.subscriptions.push(hoverProviderDisposable);

	// 注册 CSV 文档链接提供器（为特定列生成可点击链接）
	try {
		const csvLinkProvider = new CsvDocumentLinkProvider();
		const csvLinkDisposable = vscode.languages.registerDocumentLinkProvider({ language: 'csv', scheme: 'file' }, csvLinkProvider);
		context.subscriptions.push(csvLinkDisposable);
	} catch (err) {
		console.error('Failed to register CSV link provider:', err);
	}

	// 在 commands 目录中注册 openInSplit 命令
	registerOpenInSplit(context);

	// 注册 将当前编辑器文件关联到 issue 的命令
	registerLinkCurrentFileToIssue(context);

	// 注册 将工作区/文件夹关联到 issue 的命令
	registerLinkWorkspaceToIssue(context);

	// 注册快速查看 Issue 命令
	registerQuickPeekIssue(context);

	// 注册 CSV 搜索命令（由文档链接触发）
	const csvSearchDisposable = vscode.commands.registerCommand('issueManager.csvSearch', (value: string) => {
		if (!value) return;
		void vscode.commands.executeCommand('workbench.action.findInFiles', { query: value });
	});
	context.subscriptions.push(csvSearchDisposable);

	// 注册 Copilot 虚拟文档提供者（用于展示不提示保存的虚拟编辑窗口）
	const providerDisposable = vscode.workspace.registerTextDocumentContentProvider('copilot', copilotDocumentProvider);
	context.subscriptions.push(providerDisposable);


	// 当 Copilot 虚拟文档被关闭时，清理提供者中的缓存以避免内存泄漏
	const closeDisposable = vscode.workspace.onDidCloseTextDocument((doc) => {
		try {
			if (doc?.uri?.scheme === 'copilot') {
				copilotDocumentProvider.clear(doc.uri);
			}
		} catch (err) {
			// 忽略清理时的错误，防止影响扩展生命周期
			console.error('Error clearing copilot document provider cache:', err);
		}
	});
	context.subscriptions.push(closeDisposable);
	
	return initializer.initialize();
}

// 当您的扩展被停用时，将调用此方法
export async function deactivate() {
	// 执行最终同步
	const gitSyncService = GitSyncService.getInstance();
	await gitSyncService.performFinalSync();
}