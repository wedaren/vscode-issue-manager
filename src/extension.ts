import * as vscode from 'vscode';
import * as path from 'path';
import { getIssueDir } from './config';
import { IssueOverviewProvider } from './views/IssueOverviewProvider';
import { FocusedIssuesProvider } from './views/FocusedIssuesProvider';
import { IsolatedIssuesProvider, IssueItem } from './views/IsolatedIssuesProvider';
import { RecentIssuesProvider } from './views/RecentIssuesProvider';
import { AssociationProvider } from './views/AssociationProvider';
import { IssueDragAndDropController } from './views/IssueDragAndDropController';
import { IssueTreeNode, readTree, writeTree, removeNode, stripFocusedId, updateNodeExpanded } from './data/treeManager';
import { addFocus, removeFocus, pinFocus } from './data/focusedManager';
import { debounce } from './utils/debounce';
import { RecordContentTool } from './llm/RecordContentTool';
import { smartCreateIssue } from './commands/smartCreateIssue';
import { addIssueToTree } from './commands/issueFileUtils';

/**
 * 设置或更新一个上下文变量，用于控制欢迎视图的显示。
 * 当 issueManager.issueDir 配置存在时，此上下文为 true，否则为 false。
 */
function updateConfigContext() {
	const issueDir = getIssueDir();
	vscode.commands.executeCommand('setContext', 'issueManager.isDirConfigured', !!issueDir);
}

// 当您的扩展被激活时，将调用此方法
export function activate(context: vscode.ExtensionContext) {

	console.log('恭喜，您的扩展“issue-manager”现已激活！');

	// 首次激活时，立即更新上下文
	updateConfigContext();

	// 监听配置变化，以便在用户更改设置后再次更新上下文
	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
		if (e.affectsConfiguration('issueManager.issueDir')) {
			updateConfigContext();
		}
	}));

	// 注册“孤立问题”视图
	const isolatedIssuesProvider = new IsolatedIssuesProvider(context);
	// vscode.window.registerTreeDataProvider('issueManager.views.isolated', isolatedIssuesProvider);

	// 注册“问题总览”视图
	const issueOverviewProvider = new IssueOverviewProvider(context);
	// vscode.window.registerTreeDataProvider('issueManager.views.overview', issueOverviewProvider);

	// 注册拖拽控制器

	// 使用 createTreeView 注册视图，并附加拖拽控制器
	const overviewView = vscode.window.createTreeView('issueManager.views.overview', {
		treeDataProvider: issueOverviewProvider,
		dragAndDropController: new IssueDragAndDropController(issueOverviewProvider, 'overview'),
		canSelectMany: true // 允许多选
	});
	context.subscriptions.push(overviewView);

	const isolatedView = vscode.window.createTreeView('issueManager.views.isolated', {
		treeDataProvider: isolatedIssuesProvider,
		dragAndDropController: new IssueDragAndDropController(isolatedIssuesProvider, 'isolated'),
		canSelectMany: true // 允许多选
	});
	context.subscriptions.push(isolatedView);

	// 注册“关注问题”视图
	const focusedIssuesProvider = new FocusedIssuesProvider(context);
	const focusedView = vscode.window.createTreeView('issueManager.views.focused', {
		treeDataProvider: focusedIssuesProvider,
		dragAndDropController: new IssueDragAndDropController(focusedIssuesProvider, 'focused'),
		canSelectMany: true
	});
	context.subscriptions.push(focusedView);

	// 注册“最近问题”视图
	const recentIssuesProvider = new RecentIssuesProvider(context);
	const recentIssuesView = vscode.window.createTreeView('issueManager.views.recent', {
		treeDataProvider: recentIssuesProvider,
		dragAndDropController: new IssueDragAndDropController(recentIssuesProvider, 'recent'),
		canSelectMany: true
	});
	context.subscriptions.push(recentIssuesView);

	// 注册"关联视图"
	const associationProvider = new AssociationProvider(context);
	const associationView = vscode.window.createTreeView('issueManager.views.associations', {
		treeDataProvider: associationProvider,
		canSelectMany: false
	});
	context.subscriptions.push(associationView);

	// 创建关联视图管理器
	class AssociationViewManager {
		private static instance: AssociationViewManager;
		private isViewVisible: boolean = false;
		private currentFileUri: vscode.Uri | null = null;
		private viewVisibilityDisposable: vscode.Disposable | null = null;

		constructor(
			private associationView: vscode.TreeView<any>,
			private associationProvider: AssociationProvider
		) {
			this.setupViewVisibilityTracking();
		}

		public static getInstance(
			associationView: vscode.TreeView<any>,
			associationProvider: AssociationProvider
		): AssociationViewManager {
			if (!AssociationViewManager.instance) {
				AssociationViewManager.instance = new AssociationViewManager(associationView, associationProvider);
			}
			return AssociationViewManager.instance;
		}

		/**
		 * 设置视图可见性跟踪
		 */
		private setupViewVisibilityTracking(): void {
			this.viewVisibilityDisposable = this.associationView.onDidChangeVisibility((e) => {
				this.isViewVisible = e.visible;
				if (!e.visible) {
					// 当视图不可见时，重置状态但保留当前文件信息
					console.log('关联视图已隐藏');
				} else {
					console.log('关联视图已显示');
				}
			});
		}

		/**
		 * 显示关联视图面板
		 * 处理多次调用时的面板复用
		 */
		public async showAssociationView(fileUri: vscode.Uri): Promise<void> {
			try {
				// 检查是否为同一个文件的重复调用
				const isSameFile = this.currentFileUri?.toString() === fileUri.toString();

				if (isSameFile && this.isViewVisible) {
					// 如果是同一个文件且视图已可见，聚焦到关联视图
					try {
						await vscode.commands.executeCommand('issueManager.views.associations.focus');
						console.log('关联视图已存在且可见，已聚焦');
					} catch (error) {
						console.log('聚焦关联视图失败，但视图已可见:', error);
					}
					return;
				}

				// 存储当前文件URI
				this.currentFileUri = fileUri;

				// 更新关联数据
				await this.associationProvider.updateCurrentFile(fileUri);

				// 显示视图面板 - TreeView 会自动显示，我们不需要调用 reveal
				// TreeView.reveal 需要一个具体的元素参数，这里我们只是想显示视图

				// 设置视图标题
				const fileName = this.extractFileName(fileUri);
				this.associationView.title = `关联: ${fileName}`;

				console.log(`关联视图已显示，目标文件: ${fileName}`);
			} catch (error) {
				console.error('显示关联视图失败:', error);
				// 显示用户友好的错误消息
				vscode.window.showErrorMessage(`显示关联视图失败: ${error instanceof Error ? error.message : String(error)}`);
				throw error;
			}
		}

		/**
		 * 隐藏关联视图面板
		 * 注意：VS Code TreeView 没有直接的隐藏方法，这里主要用于重置状态
		 */
		public hideAssociationView(): void {
			// 重置视图标题
			this.associationView.title = '关联视图';

			// 清空当前文件信息
			this.currentFileUri = null;

			// 清空关联数据 - 传递 null 来清空数据
			this.associationProvider.updateCurrentFile(vscode.Uri.parse('file:///empty')).catch(error => {
				console.error('清空关联数据失败:', error);
			});

			console.log('关联视图状态已重置');
		}

		/**
		 * 检查视图是否可见
		 */
		public isVisible(): boolean {
			return this.isViewVisible;
		}

		/**
		 * 获取当前文件URI
		 */
		public getCurrentFileUri(): vscode.Uri | null {
			return this.currentFileUri;
		}

		/**
		 * 刷新当前关联视图
		 */
		public async refreshCurrentView(): Promise<void> {
			if (this.currentFileUri && this.isViewVisible) {
				try {
					await this.showAssociationView(this.currentFileUri);
					console.log('关联视图已刷新');
				} catch (error) {
					console.error('刷新关联视图失败:', error);
					vscode.window.showErrorMessage(`刷新关联视图失败: ${error instanceof Error ? error.message : String(error)}`);
				}
			}
		}

		/**
		 * 检查是否有活动的关联视图
		 */
		public hasActiveView(): boolean {
			return this.currentFileUri !== null;
		}

		/**
		 * 从文件URI提取文件名
		 */
		private extractFileName(fileUri: vscode.Uri): string {
			try {
				const fileName = fileUri.path.split('/').pop() || '未知文件';
				// 移除 .md 扩展名以获得更简洁的显示
				return fileName.endsWith('.md') ? fileName.slice(0, -3) : fileName;
			} catch (error) {
				console.error('提取文件名失败:', error);
				return '未知文件';
			}
		}

		/**
		 * 清理资源
		 */
		public dispose(): void {
			if (this.viewVisibilityDisposable) {
				this.viewVisibilityDisposable.dispose();
				this.viewVisibilityDisposable = null;
			}
		}
	}

	// 创建关联视图管理器实例
	const associationViewManager = AssociationViewManager.getInstance(associationView, associationProvider);

	// 监听视图可见性变化
	context.subscriptions.push(
		associationView.onDidChangeVisibility((e) => {
			if (!e.visible) {
				// 当视图不可见时，重置管理器状态
				associationViewManager.hideAssociationView();
			}
		})
	);

	// 注册"查看关联"命令
	context.subscriptions.push(
		vscode.commands.registerCommand('issueManager.viewAssociations', async (item) => {
			try {
				// 处理从不同来源触发的情况
				let fileUri: vscode.Uri | undefined;

				if (item instanceof vscode.Uri) {
					// 从编辑器文件直接触发
					fileUri = item;
				} else if (item?.resourceUri instanceof vscode.Uri) {
					// 从 TreeItem 触发
					fileUri = item.resourceUri;
				} else if (vscode.window.activeTextEditor?.document.uri) {
					// 从命令面板触发，使用当前活动编辑器
					fileUri = vscode.window.activeTextEditor.document.uri;
				}

				if (!fileUri) {
					vscode.window.showErrorMessage('无法确定要查看关联的文件');
					return;
				}

				// 检查是否为同一个文件的重复调用
				if (associationViewManager.isVisible() && associationViewManager.getCurrentFileUri()?.toString() === fileUri.toString()) {
					// 如果是同一个文件，只需要显示视图面板
					// 注意：TreeView.reveal 需要一个元素参数，这里我们只是想聚焦视图
					console.log('关联视图已存在，直接显示');
					return;
				}

				// 使用视图管理器显示关联视图
				await associationViewManager.showAssociationView(fileUri);

			} catch (error) {
				console.error('查看关联命令执行失败:', error);
				vscode.window.showErrorMessage(`查看关联失败: ${error instanceof Error ? error.message : String(error)}`);
			}
		})
	);

	// 注册"隐藏关联视图"命令（可选，用于测试或高级用户）
	context.subscriptions.push(
		vscode.commands.registerCommand('issueManager.hideAssociations', () => {
			associationViewManager.hideAssociationView();
		})
	);

	// 注册关联视图刷新命令
	context.subscriptions.push(
		vscode.commands.registerCommand('issueManager.refreshAssociationView', async () => {
			await associationViewManager.refreshCurrentView();
		})
	);

	// 注册"打开关联文件"命令
	context.subscriptions.push(
		vscode.commands.registerCommand('issueManager.openAssociationFile', async (fileUri: vscode.Uri, fileName?: string) => {
			try {
				if (!fileUri) {
					vscode.window.showErrorMessage('无法打开文件：文件路径无效');
					return;
				}

				// 检查文件是否存在
				try {
					await vscode.workspace.fs.stat(fileUri);
				} catch (statError) {
					const displayName = fileName || fileUri.path.split('/').pop() || '未知文件';
					vscode.window.showErrorMessage(`无法打开文件 "${displayName}"：文件不存在或无法访问`);
					console.error('文件状态检查失败:', statError);
					return;
				}

				// 尝试打开文件
				const document = await vscode.workspace.openTextDocument(fileUri);
				await vscode.window.showTextDocument(document, {
					preview: false, // 不使用预览模式，确保文件在新标签页中打开
					preserveFocus: false // 聚焦到打开的文件
				});

				console.log(`成功打开关联文件: ${fileUri.fsPath}`);

			} catch (error) {
				const displayName = fileName || fileUri?.path.split('/').pop() || '未知文件';
				const errorMessage = error instanceof Error ? error.message : String(error);

				console.error('打开关联文件失败:', error);
				vscode.window.showErrorMessage(`打开文件 "${displayName}" 失败: ${errorMessage}`);
			}
		})
	);

	// 注册"在问题总览中定位"命令
	context.subscriptions.push(
		vscode.commands.registerCommand('issueManager.locateInOverview', async (treeNodeId: string) => {
			try {
				if (!treeNodeId) {
					vscode.window.showWarningMessage('无法定位：缺少节点标识符');
					return;
				}

				// 显示问题总览视图
				await vscode.commands.executeCommand('issueManager.views.overview.focus');

				// 尝试在问题总览中选择和展开对应节点
				// 注意：VS Code TreeView API 有限，我们只能聚焦到视图
				// 具体的节点定位需要依赖视图提供者的实现
				console.log(`尝试在问题总览中定位节点: ${treeNodeId}`);

				// 可以考虑通过 IssueOverviewProvider 添加定位方法
				// 这里先显示信息提示用户
				vscode.window.showInformationMessage(`已聚焦到问题总览视图，请查找相关问题`);

			} catch (error) {
				console.error('在问题总览中定位失败:', error);
				vscode.window.showErrorMessage(`定位失败: ${error instanceof Error ? error.message : String(error)}`);
			}
		})
	);

	// 将关联视图管理器添加到清理列表
	context.subscriptions.push({
		dispose: () => {
			associationViewManager.dispose();
		}
	});

	// 激活时加载一次数据
	focusedIssuesProvider.loadData();

	// 可根据需要注册命令刷新关注视图
	context.subscriptions.push(vscode.commands.registerCommand('issueManager.focusedIssues.refresh', () => {
		focusedIssuesProvider.loadData();
	}));

	// 注册一个命令，用于手动刷新“孤立问题”视图
	context.subscriptions.push(vscode.commands.registerCommand('issueManager.isolatedIssues.refresh', () => {
		isolatedIssuesProvider.refresh();
	}));

	context.subscriptions.push(vscode.commands.registerCommand('issueManager.recentIssues.refresh', () => {
		recentIssuesProvider.refresh();
	}));

	context.subscriptions.push(vscode.commands.registerCommand('issueManager.associations.refresh', () => {
		associationProvider.refresh();
	}));

	// 注册"添加到问题总览"命令
	context.subscriptions.push(
		vscode.commands.registerCommand('issueManager.addToOverview', async (fileUri: vscode.Uri) => {
			try {
				if (!fileUri) {
					vscode.window.showErrorMessage('无法获取文件信息');
					return;
				}

				// 显示提示信息，指导用户如何添加到问题总览
				const action = await vscode.window.showInformationMessage(
					'要将此文件添加到问题总览，请在问题总览的 Markdown 文件中添加对此文件的引用。',
					'打开问题总览',
					'了解更多'
				);

				if (action === '打开问题总览') {
					// 尝试打开问题总览视图
					await vscode.commands.executeCommand('issueManager.issueOverview.focus');
				} else if (action === '了解更多') {
					// 打开帮助文档
					await vscode.env.openExternal(vscode.Uri.parse('https://github.com/your-repo/wiki/associations'));
				}
			} catch (error) {
				console.error('添加到问题总览失败:', error);
				vscode.window.showErrorMessage('添加到问题总览时出错');
			}
		})
	);

	context.subscriptions.push(vscode.commands.registerCommand('issueManager.refreshAllViews', () => {
		isolatedIssuesProvider.refresh();
		focusedIssuesProvider.refresh();
		issueOverviewProvider.refresh();
		recentIssuesProvider.refresh();
		associationProvider.refresh();
	}));

	// 注册统一的刷新视图命令，用于Language Model Tool等功能
	context.subscriptions.push(vscode.commands.registerCommand('issueManager.refreshViews', () => {
		isolatedIssuesProvider.refresh();
		focusedIssuesProvider.refresh();
		issueOverviewProvider.refresh();
		recentIssuesProvider.refresh();
		associationProvider.refresh();
	}));

	// 监听 issueDir 下的 Markdown 文件变化，刷新相关视图
	let watcher: vscode.FileSystemWatcher | undefined;

	const setupWatcher = () => {
		if (watcher) {
			watcher.dispose();
			// 从 subscriptions 中移除旧的引用
			const index = context.subscriptions.indexOf(watcher);
			if (index !== -1) {
				context.subscriptions.splice(index, 1);
			}

		}
		const issueDir = getIssueDir();
		if (issueDir) {
			watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(issueDir, '**/*.md'));

			const debouncedRefresh = debounce(() => {
				console.log('Markdown file changed, refreshing views...');
				vscode.commands.executeCommand('issueManager.refreshAllViews');
			}, 500);

			watcher.onDidChange(debouncedRefresh);
			watcher.onDidCreate(debouncedRefresh);
			watcher.onDidDelete(debouncedRefresh);

			context.subscriptions.push(watcher);
		}
	};

	// 首次激活时设置监听器
	setupWatcher();

	// 当配置更改时，重新设置监听器
	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
		if (e.affectsConfiguration('issueManager.issueDir')) {
			setupWatcher();
			// 刷新所有视图以反映新目录的内容
			vscode.commands.executeCommand('issueManager.refreshAllViews');
		}
	}));



	// 注册“删除问题”命令
	const deleteIssueCommand = vscode.commands.registerCommand('issueManager.deleteIssue', async (item: IssueItem) => {
		if (!item || !item.resourceUri) {
			vscode.window.showErrorMessage('无法删除问题：未找到有效的文件路径。');
			return;
		}

		const confirm = await vscode.window.showWarningMessage(
			`您确定要永久删除文件 “${path.basename(item.resourceUri.fsPath)}” 吗？此操作无法撤销。`,
			{ modal: true }, // 模态对话框，阻止其他操作
			'确认删除'
		);

		if (confirm === '确认删除') {
			try {
				await vscode.workspace.fs.delete(item.resourceUri);
				vscode.window.showInformationMessage(`文件 “${path.basename(item.resourceUri.fsPath)}” 已被删除。`);
				// 视图会自动通过 FileSystemWatcher 刷新，无需手动调用 refresh
			} catch (error) {
				vscode.window.showErrorMessage(`删除文件时出错: ${error}`);
			}
		}
	});

	context.subscriptions.push(deleteIssueCommand);

	// 注册“解除关联”命令
	const disassociateIssueCommand = vscode.commands.registerCommand('issueManager.disassociateIssue', async (node: IssueTreeNode) => {
		if (!node || node.id === 'placeholder-no-issues') {
			return;
		}

		// 判断是否有子节点
		if (node.children && node.children.length > 0) {
			const confirm = await vscode.window.showWarningMessage(
				'该节点下包含子问题，解除关联将一并移除其所有子节点。是否继续？',
				{ modal: true },
				'确定'
			);
			if (confirm !== '确定') {
				return;
			}
		}

		const treeData = await readTree();
		if (!treeData) {
			vscode.window.showErrorMessage('无法读取问题树数据。');
			return;
		}

		const { success } = removeNode(treeData, stripFocusedId(node.id));

		if (success) {
			await writeTree(treeData);
			vscode.commands.executeCommand('issueManager.refreshAllViews');
		} else {
			vscode.window.showWarningMessage('无法在树中找到该节点以解除关联。');
		}
	});

	context.subscriptions.push(disassociateIssueCommand);

	// 修改“新建子问题”命令，复用工具函数
	const createChildIssueCommand = vscode.commands.registerCommand('issueManager.createChildIssue', async (parentNode?: IssueTreeNode) => {
		const id: string | null | undefined = parentNode?.id && stripFocusedId(parentNode.id);
		await smartCreateIssue(id || null, true);
	});
	context.subscriptions.push(createChildIssueCommand);
	// 注册“创建问题”命令
	const createIssueCommand = vscode.commands.registerCommand('issueManager.createIssue', async () => {
		await smartCreateIssue(null);
	});
	context.subscriptions.push(createIssueCommand);

	const createIssueFromOverviewCommand = vscode.commands.registerCommand('issueManager.createIssueFromOverview', async () => {
		await smartCreateIssue(null, true);
	});
	context.subscriptions.push(createIssueFromOverviewCommand);

	const createIssueFromFocusedCommand = vscode.commands.registerCommand('issueManager.createIssueFromFocused', async (node?: IssueTreeNode) => {
		await smartCreateIssue(null, true, true);
	});
	context.subscriptions.push(createIssueFromFocusedCommand);

	// 注册“添加到关注”命令
	const focusIssueCommand = vscode.commands.registerCommand('issueManager.focusIssue', async (node: IssueTreeNode) => {
		const issueDir = getIssueDir();
		if (!issueDir) { return; }
		if (!node || !node.id) {
			vscode.window.showErrorMessage('未找到要关注的问题节点。');
			return;
		}
		const realId = stripFocusedId(node.id);
		await addFocus([realId]);
		vscode.commands.executeCommand('issueManager.refreshAllViews');
		vscode.window.showInformationMessage('已添加到关注问题。');
	});
	context.subscriptions.push(focusIssueCommand);

	const focusIssueFromIsolatedCommand = vscode.commands.registerCommand('issueManager.focusIssueFromIsolated', async (node: IssueItem) => {
		if (!node || !node.resourceUri) {
			vscode.window.showErrorMessage('未找到要关注的问题节点。');
			return;
		}
		await addIssueToTree([node.resourceUri], null, true);
		vscode.window.showInformationMessage('已添加到关注问题。');
	});
	context.subscriptions.push(focusIssueFromIsolatedCommand);


	// 注册“移除关注”命令
	const removeFocusCommand = vscode.commands.registerCommand('issueManager.removeFocus', async (node: IssueTreeNode) => {
		if (!node?.id) {
			vscode.window.showErrorMessage('未找到要移除关注的问题节点。');
			return;
		}
		const realId = stripFocusedId(node.id);
		await removeFocus(realId);
		vscode.commands.executeCommand('issueManager.refreshAllViews');
		vscode.window.showInformationMessage('已移除关注。');
	});
	context.subscriptions.push(removeFocusCommand);

	// 注册“置顶关注”命令
	context.subscriptions.push(vscode.commands.registerCommand('issueManager.pinFocus', async (node: IssueTreeNode) => {
		if (node?.id) {
			const realId = stripFocusedId(node.id);
			await pinFocus(realId);
			vscode.commands.executeCommand('issueManager.focusedIssues.refresh');
		}
	}));

	// ========== TreeView 展开/折叠状态同步与持久化 ==========
	function registerExpandCollapseSync(treeView: vscode.TreeView<IssueTreeNode>) {
		treeView.onDidExpandElement(async (e) => {
			const treeData = await readTree();
			if (updateNodeExpanded(treeData.rootNodes, stripFocusedId(e.element.id), true)) {
				await writeTree(treeData);
				vscode.commands.executeCommand('issueManager.refreshAllViews');
			}
		});
		treeView.onDidCollapseElement(async (e) => {
			const treeData = await readTree();
			if (updateNodeExpanded(treeData.rootNodes, stripFocusedId(e.element.id), false)) {
				await writeTree(treeData);
				vscode.commands.executeCommand('issueManager.refreshAllViews');
			}
		});
	}

	registerExpandCollapseSync(overviewView as vscode.TreeView<IssueTreeNode>);
	registerExpandCollapseSync(focusedView as vscode.TreeView<IssueTreeNode>);

	// 注册 Language Model Tool
	if (vscode.lm && vscode.lm.registerTool) {
		context.subscriptions.push(
			vscode.lm.registerTool('issueManager_recordContent', new RecordContentTool())
		);
	}

	context.subscriptions.push(
		vscode.commands.registerCommand('issueManager.copyFilename', async (item: vscode.TreeItem) => {
			if (item && item.resourceUri) {
				const filePath = item.resourceUri.fsPath;
				const fileName = path.basename(filePath);
				try {
					await vscode.env.clipboard.writeText(fileName);
					vscode.window.showInformationMessage(`已复制文件名: ${fileName}`);
				} catch (e) {
					console.error('Failed to copy filename to clipboard:', e);
					vscode.window.showErrorMessage('复制文件名失败。');
				}
			}
		})
	);
}

// 当您的扩展被停用时，将调用此方法
export function deactivate() { }
