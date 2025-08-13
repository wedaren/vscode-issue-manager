import { moveToCommand } from './commands/moveTo';
import * as vscode from 'vscode';
import * as path from 'path';
import { getIssueDir } from './config';
import { registerOpenIssueDirCommand } from './commands/openIssueDir';
import { IssueOverviewProvider } from './views/IssueOverviewProvider';
import { registerSearchIssuesCommand } from './commands/searchIssues';
import { registerDeleteIssueFile } from './commands/deleteIssueFile';
import { FocusedIssuesProvider } from './views/FocusedIssuesProvider';
import { IsolatedIssuesProvider, IssueItem } from './views/IsolatedIssuesProvider';
import { RecentIssuesProvider } from './views/RecentIssuesProvider';
import { IssueDragAndDropController } from './views/IssueDragAndDropController';
import { IssueTreeNode, readTree, writeTree, removeNode, stripFocusedId, updateNodeExpanded, getAssociatedFiles } from './data/treeManager';
import { addFocus, removeFocus, pinFocus } from './data/focusedManager';
import { debounce } from './utils/debounce';
import { RecordContentTool } from './llm/RecordContentTool';
import { smartCreateIssue } from './commands/smartCreateIssue';
import { addIssueToTree } from './commands/issueFileUtils';
import { registerRelatedIssuesView } from './views/relatedIssuesViewRegistration';
import { getTitle } from './utils/markdown';

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

	// 注册“移动到...”命令
	context.subscriptions.push(vscode.commands.registerCommand('issueManager.moveTo', async (node: IssueTreeNode, selectedNodes?: IssueTreeNode[]) => {
		// 支持多选，selectedNodes 优先，否则单节点
		const nodes = selectedNodes && selectedNodes.length > 0 ? selectedNodes : node ? [node] : [];
		await moveToCommand(nodes);
	}));

	console.log('恭喜，您的扩展“issue-manager”现已激活！');

	// 首次激活时，立即更新上下文
	updateConfigContext();

	// 监听配置变化，以便在用户更改设置后再次更新上下文
	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
		if (e.affectsConfiguration('issueManager.issueDir')) {
			updateConfigContext();
		}
	}));

	// 注册“问题总览视图搜索”命令
	registerSearchIssuesCommand(context);
	registerOpenIssueDirCommand(context);
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

	// 注册“问题总览”视图定位命令
	context.subscriptions.push(vscode.commands.registerCommand('issueManager.views.overview.reveal', async (targetNode: IssueTreeNode, options?: { select?: boolean; focus?: boolean; expand?: boolean }) => {
		if (targetNode) {
			await overviewView.reveal(targetNode, options || { select: true, focus: true, expand: true });
		}
	}));


	const isolatedView = vscode.window.createTreeView('issueManager.views.isolated', {
		treeDataProvider: isolatedIssuesProvider,
		dragAndDropController: new IssueDragAndDropController(isolatedIssuesProvider, 'isolated'),
		canSelectMany: true // 允许多选
	});
	context.subscriptions.push(isolatedView);
	context.subscriptions.push(vscode.commands.registerCommand('issueManager.views.isolated.reveal', async (uri?: vscode.Uri) => {
		if (uri) {
			const associatedFiles = await getAssociatedFiles();
			const filename = path.basename(uri.fsPath);
			if (!associatedFiles.has(filename)) {
				const label = await getTitle(uri);
				const issueItem = new IssueItem(label, uri);
				await isolatedView.reveal(issueItem, { select: true, focus: true, expand: true });
			}
		}
	}));
	registerDeleteIssueFile(context, isolatedView as vscode.TreeView<IssueItem>);

	// 注册“关注问题”视图
	const focusedIssuesProvider = new FocusedIssuesProvider(context);
	const focusedView = vscode.window.createTreeView('issueManager.views.focused', {
		treeDataProvider: focusedIssuesProvider,
		dragAndDropController: new IssueDragAndDropController(focusedIssuesProvider, 'focused'),
		canSelectMany: true
	});
	context.subscriptions.push(focusedView);
	// 注册“关注问题”视图定位命令
	context.subscriptions.push(vscode.commands.registerCommand('issueManager.views.focused.reveal', async (targetNode: IssueTreeNode, options?: { select?: boolean; focus?: boolean; expand?: boolean }) => {
		await focusedView.reveal(targetNode, options || { select: true, focus: true, expand: true });
	}));

	context.subscriptions.push(vscode.commands.registerCommand('issueManager.searchIssuesInFocused', async () => {
		vscode.commands.executeCommand('issueManager.searchIssues', 'focused');
	}));
	context.subscriptions.push(vscode.commands.registerCommand('issueManager.searchIssuesInOverview', async () => {
		vscode.commands.executeCommand('issueManager.searchIssues', 'overview');
	}));

	// 注册命令：打开并在问题总览或关注问题中定位
	context.subscriptions.push(vscode.commands.registerCommand('issueManager.openAndRevealIssue', async (node: IssueTreeNode, type: 'focused' | 'overview') => {
		if (!node || !node.resourceUri) { return; }
		// 打开文件
		await vscode.window.showTextDocument(node.resourceUri, { preview: false });
		if (type === 'overview') {
			await vscode.commands.executeCommand('issueManager.views.overview.reveal', node, { select: true, focus: true, expand: true });
		} else if (type === 'focused') {
			const { node: target } = focusedIssuesProvider.findFirstFocusedNodeById(node.id) || {};
			if (target) {
				await vscode.commands.executeCommand('issueManager.views.focused.reveal', target, { select: true, focus: true, expand: true });
			} else {
				await vscode.commands.executeCommand('issueManager.views.overview.reveal', node, { select: true, focus: true, expand: true });
			}
		}
	}));

	// 注册“最近问题”视图
	const recentIssuesProvider = new RecentIssuesProvider(context);
	const recentIssuesView = vscode.window.createTreeView('issueManager.views.recent', {
		treeDataProvider: recentIssuesProvider,
		dragAndDropController: new IssueDragAndDropController(recentIssuesProvider, 'recent'),
		canSelectMany: true
	});
	context.subscriptions.push(recentIssuesView);

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

	context.subscriptions.push(vscode.commands.registerCommand('issueManager.refreshAllViews', () => {
		isolatedIssuesProvider.refresh();
		focusedIssuesProvider.refresh();
		issueOverviewProvider.refresh();
		recentIssuesProvider.refresh();
	}));

	// 注册统一的刷新视图命令，用于Language Model Tool等功能
	context.subscriptions.push(vscode.commands.registerCommand('issueManager.refreshViews', () => {
		isolatedIssuesProvider.refresh();
		focusedIssuesProvider.refresh();
		issueOverviewProvider.refresh();
		recentIssuesProvider.refresh();
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

	const createChildIssueHandler = (viewType: 'overview' | 'focused') => {
		return async (parentNode?: IssueTreeNode) => {
			const id = parentNode?.id && stripFocusedId(parentNode.id);
			await smartCreateIssue(id || null, true);
			if (parentNode) {
				const revealCommand = `issueManager.views.${viewType}.reveal`;
				await vscode.commands.executeCommand(revealCommand, parentNode, { select: true, focus: true, expand: true });
			}
		};
	};

	const createChildIssueCommandInOverview = vscode.commands.registerCommand(
		'issueManager.createChildIssueInOverview',
		createChildIssueHandler('overview')
	);

	const createChildIssueCommandInFocused = vscode.commands.registerCommand(
		'issueManager.createChildIssueInFocused',
		createChildIssueHandler('focused')
	);

	context.subscriptions.push(createChildIssueCommandInOverview, createChildIssueCommandInFocused);

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

	// 注册"打开关注问题视图"命令
	const openFocusedViewCommand = vscode.commands.registerCommand('issueManager.openFocusedView', async () => {
		// 激活问题管理扩展的活动栏
		await vscode.commands.executeCommand('workbench.view.extension.issue-manager');
		// 聚焦到关注问题视图
		await vscode.commands.executeCommand('issueManager.views.focused.focus');
		vscode.window.showInformationMessage('已打开关注问题视图');
	});
	context.subscriptions.push(openFocusedViewCommand);

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
	function registerExpandCollapseSync(treeView: vscode.TreeView<IssueTreeNode>, viewName: string) {
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

	registerExpandCollapseSync(overviewView as vscode.TreeView<IssueTreeNode>, 'overview');
	registerExpandCollapseSync(focusedView as vscode.TreeView<IssueTreeNode>, 'focused');

	// 注册 Language Model Tool
	if (vscode.lm && vscode.lm.registerTool) {
		context.subscriptions.push(
			vscode.lm.registerTool('issueManager_recordContent', new RecordContentTool())
		);
	}

	context.subscriptions.push(
		vscode.commands.registerCommand('issueManager.copyFilename', async (treeItemOrResourceUri?: vscode.TreeItem | vscode.Uri) => {
			// 优先获取 resourceUri，其次尝试使用当前激活编辑器的文件路径
			let resourceUri: vscode.Uri | undefined;

			if (treeItemOrResourceUri instanceof vscode.Uri) {
				resourceUri = treeItemOrResourceUri;
			} else if (treeItemOrResourceUri?.resourceUri) {
				resourceUri = treeItemOrResourceUri.resourceUri;
			} else if (vscode.window.activeTextEditor) {
				// 命令面板调用时，回退到当前激活的编辑器
				const doc = vscode.window.activeTextEditor.document;
				const issueDir = getIssueDir();
				// 仅当激活文件为问题目录下的 Markdown 文件时才继续
				if (doc.languageId === 'markdown' && issueDir && doc.uri.fsPath.startsWith(issueDir)) {
					resourceUri = doc.uri;
				}
			}

			if (resourceUri) {
				const fileName = path.basename(resourceUri.fsPath);
				try {
					await vscode.env.clipboard.writeText(fileName);
					vscode.window.showInformationMessage(`已复制文件名: ${fileName}`);
				} catch (e) {
					console.error('复制文件名到剪贴板失败:', e);
					vscode.window.showErrorMessage('复制文件名失败。');
				}
			} else {
				vscode.window.showWarningMessage('未找到有效的文件路径，无法复制文件名。');
			}
		})
	);

	registerRelatedIssuesView(context);
}

// 当您的扩展被停用时，将调用此方法
export function deactivate() { }
