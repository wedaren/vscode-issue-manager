import * as vscode from 'vscode';
import * as path from 'path';
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
import { registerRemoveWikiLinksFromSelection } from './commands/removeWikiLinksFromSelection';
import { copilotDocumentProvider } from './virtual/CopilotDocumentProvider';
import { activateA2A } from './a2a';
import { ImageGalleryViewProvider } from './views/ImageGalleryViewProvider';
import { ImageBoardEditorProvider } from './views/ImageBoardEditorProvider';
import { BoardListProvider } from './views/BoardListProvider';
import { BoardStorageService } from './services/storage/BoardStorageService';
import { registerImageCommands } from './commands/image.commands';
import { ImageStorageService } from './services/storage/ImageStorageService';
import { ImageDocumentLinkProvider, ImageDocumentHoverProvider, ImageLightboxPanel } from './providers/ImageDocumentLinkProvider';
import { ConversationImagePasteEditProvider } from './providers/ConversationImagePasteEditProvider';
import { extendMarkdownIt } from './markdown/markdownPreviewPlugin';
import { registerChatStatusBar } from './llmChat/chatStatusBarItem';
import { registerPendingImageStatusBar } from './llmChat/pendingImageStatusBar';
import { ModelRegistry } from './llm/ModelRegistry';
import { IssueManagerLMProvider } from './llm/IssueManagerLMProvider';
import { activateDiagramPreview } from './diagramPreview';
import { registerWikiModule } from './wiki/registerWiki';
export { extendMarkdownIt };

// 当您的扩展被激活时,将调用此方法
export async function activate(context: vscode.ExtensionContext) {
	// 初始化共享配置（必须在其他服务之前）
	SharedConfig.initialize(context);
	// 初始化模型注册表（注入 SecretStorage，供自定义模型 API Key 安全存储）
	ModelRegistry.init(context.secrets);

	// 将自定义模型注册为 VS Code LanguageModelChatProvider（出现在 Copilot 模型选择器中）
	const lmProvider = new IssueManagerLMProvider(context);
	context.subscriptions.push(
		vscode.lm.registerLanguageModelChatProvider('issue-manager', lmProvider),
		lmProvider,
	);

	const initializer = new ExtensionInitializer(context);
	// 笔记映射功能已移除：不再预加载相关服务或更新上下文
	// 启动 Chrome 集成本地服务与 URI Handler（不阻塞激活流程）
	void ChromeIntegrationServer.getInstance().start(context);

	// A2A 协议 server（根据 issueManager.a2a.enabled 按需启动）
	activateA2A(context);
	
	// 注册 Issue 文件补全提供器
	const completionProvider = new IssueNodeCompletionProvider(context);
	// 从配置读取触发器并提取首字符，避免硬编码
	const completionConfig = vscode.workspace.getConfiguration('issueManager.completion');
	const triggers = completionConfig.get<string[]>('triggers', ['[', '【']);
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

	// 注册从选区移除 Wiki 链接（[[...]]）命令
	registerRemoveWikiLinksFromSelection(context);

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

	// 注册 ImageDir/xxx 链接解析器（Markdown 中可点击跳转真实图片文件）
	context.subscriptions.push(
		vscode.languages.registerDocumentLinkProvider(
			{ language: 'markdown', scheme: 'file' },
			new ImageDocumentLinkProvider(),
		),
	);

	// 注册 ImageDir/xxx hover 预览（悬停显示图片缩略图）
	context.subscriptions.push(
		vscode.languages.registerHoverProvider(
			{ language: 'markdown', scheme: 'file' },
			new ImageDocumentHoverProvider(),
		),
	);

	// 注册图片交互预览命令（hover 中「⊕ 交互预览」按钮触发，打开支持缩放/平移的 lightbox 面板）
	context.subscriptions.push(
		vscode.commands.registerCommand('issueManager.previewImageLightbox', (filePath: string) => {
			ImageLightboxPanel.open(filePath);
		}),
	);

	// 注册 Markdown 图片粘贴 Provider（Cmd+V 图片 → 自动保存到 ImageDir，插入 ![](ImageDir/xxx.png)）
	context.subscriptions.push(
		vscode.languages.registerDocumentPasteEditProvider(
			{ language: 'markdown', scheme: 'file' },
			new ConversationImagePasteEditProvider(),
			{
				providedPasteEditKinds: [vscode.DocumentDropOrPasteEditKind.Text.append('imageDir')],
				pasteMimeTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
			},
		),
	);

	// ── 图片库 & 调查板 ───────────────────────────────────────────────────────
	const galleryProvider = new ImageGalleryViewProvider(context.extensionUri);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			ImageGalleryViewProvider.viewId,
			galleryProvider,
			{ webviewOptions: { retainContextWhenHidden: true } },
		),
	);

	// 打开调查板侧边栏（由图片库工具栏的"调查板"按钮触发）
	context.subscriptions.push(
		vscode.commands.registerCommand('issueManager.image.openBoard', () => {
			void vscode.commands.executeCommand('issueManager.views.boardList.focus');
		}),
	);

	// ── 调查板多板系统 ────────────────────────────────────────────────────────
	const boardListProvider = new BoardListProvider();
	context.subscriptions.push(
		vscode.window.registerTreeDataProvider(BoardListProvider.viewId, boardListProvider),
	);

	// 新建调查板（标题栏 + 按钮）
	context.subscriptions.push(
		vscode.commands.registerCommand('issueManager.board.new', async () => {
			const name = await vscode.window.showInputBox({
				prompt: '调查板名称',
				placeHolder: '例如：Bug #42 分析',
				validateInput: v => v.trim() ? undefined : '名称不能为空',
			});
			if (!name) { return; }
			const board = BoardStorageService.createBoard(name.trim());
			boardListProvider.refresh();
			if (board) {
				ImageBoardEditorProvider.open(board.id, context.extensionUri);
			}
		}),
	);

	// 从 Issue 右键菜单创建调查板
	context.subscriptions.push(
		vscode.commands.registerCommand('issueManager.board.newFromIssue', async (node: { resourceUri?: vscode.Uri; label?: string }) => {
			const uri = node?.resourceUri;
			const baseName = uri ? path.basename(uri.fsPath, '.md') : undefined;
			const defaultName = baseName ? `调查：${baseName}` : '新调查板';
			const name = await vscode.window.showInputBox({
				prompt: '调查板名称',
				value: defaultName,
				validateInput: v => v.trim() ? undefined : '名称不能为空',
			});
			if (!name) { return; }
			const board = BoardStorageService.createBoard(name.trim());
			boardListProvider.refresh();
			if (board) {
				ImageBoardEditorProvider.open(board.id, context.extensionUri);
			}
		}),
	);

	// 打开指定调查板
	context.subscriptions.push(
		vscode.commands.registerCommand('issueManager.board.open', (boardId: string) => {
			ImageBoardEditorProvider.open(boardId, context.extensionUri);
		}),
	);

	// 重命名调查板
	context.subscriptions.push(
		vscode.commands.registerCommand('issueManager.board.rename', async (item: { meta?: { id: string; name: string } }) => {
			const meta = item?.meta;
			if (!meta) { return; }
			const name = await vscode.window.showInputBox({
				prompt: '新名称',
				value: meta.name,
				validateInput: v => v.trim() ? undefined : '名称不能为空',
			});
			if (!name) { return; }
			BoardStorageService.renameBoard(meta.id, name.trim());
			boardListProvider.refresh();
		}),
	);

	// 删除调查板
	context.subscriptions.push(
		vscode.commands.registerCommand('issueManager.board.delete', async (item: { meta?: { id: string; name: string } }) => {
			const meta = item?.meta;
			if (!meta) { return; }
			const confirm = await vscode.window.showWarningMessage(
				`删除调查板「${meta.name}」？此操作不可撤销。`,
				{ modal: true },
				'删除',
			);
			if (confirm !== '删除') { return; }
			BoardStorageService.deleteBoard(meta.id);
			boardListProvider.refresh();
		}),
	);

	// FileSystemWatcher：ImageDir 变动时自动刷新图片库
	const imageDirUri = ImageStorageService.getImageDirUri();
	if (imageDirUri) {
		const imgWatcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(imageDirUri, '*.{png,jpg,jpeg,gif,webp}'),
		);
		imgWatcher.onDidCreate(() => galleryProvider.refresh());
		imgWatcher.onDidDelete(() => galleryProvider.refresh());
		context.subscriptions.push(imgWatcher);
	}

	// 注册图片相关命令
	registerImageCommands(context, galleryProvider);

	// 注册 Chat 状态栏（ChatHistoryPanel 删除后补偿正在执行的可见性）
	registerChatStatusBar(context);

	// 注册"待发送图片"状态栏（展示当前 chat 文件里未发送的 ImageDir 引用数量与合计大小）
	registerPendingImageStatusBar(context);

	// 注册 Markdown Diagram 预览（mermaid hover/codelens/折叠 + math 入口）
	activateDiagramPreview(context);

	// 注册 Wiki 模块(Today TreeView + [[wiki/...]] 链接/Hover + 状态栏 + 保存选中到 raw/)
	registerWikiModule(context);

	await initializer.initialize();
	return { extendMarkdownIt };
}

// 当您的扩展被停用时，将调用此方法
export async function deactivate() {
	const gitSyncService = GitSyncService.getInstance();
	await gitSyncService.performFinalSync();
}