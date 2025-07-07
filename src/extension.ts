import * as vscode from 'vscode';
import * as path from 'path';
import { getIssueDir } from './config';
import { IssueOverviewProvider } from './views/IssueOverviewProvider';
import { FocusedIssuesProvider } from './views/FocusedIssuesProvider';
import { IsolatedIssuesProvider,IssueTreeItem } from './views/IsolatedIssuesProvider';
import { RecentIssuesProvider } from './views/RecentIssuesProvider';
import { IssueDragAndDropController } from './views/IssueDragAndDropController';
import { TreeNode, readTree, writeTree, addNode, removeNode, stripFocusedId, updateNodeExpanded } from './data/treeManager';
import { addFocus, removeFocus, pinFocus } from './data/focusedManager';
import { LLMService } from './llm/LLMService';
import { debounce } from './utils/debounce';
import { RecordContentTool } from './llm/RecordContentTool';
import { generateFileName } from './utils/fileUtils';

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


	/**
	 * 仅负责在磁盘上创建新的问题文件。
	 * 文件名格式：YYYYMMDD-HHmmss-SSS.md，兼具可读性和唯一性。
	 * @param title 问题标题
	 * @returns 新建文件的 URI，如果失败则返回 null。
	 */
	async function createIssueFile(title: string): Promise<vscode.Uri | null> {
		const issueDir = getIssueDir();
		if (!issueDir) {
			vscode.window.showErrorMessage('问题目录未配置。');
			return null;
		}
		const filename = generateFileName();
		const filePath = vscode.Uri.file(path.join(issueDir, filename));
		const content = `# ${title}\n\n`;
		const contentBytes = Buffer.from(content, 'utf8');

		await vscode.workspace.fs.writeFile(filePath, contentBytes);
		await vscode.window.showTextDocument(filePath);

		return filePath;
	}

	/**
	 * 将指定文件路径的多个 issue 添加到 tree.json 数据中。
	 * @param issueUris 要添加的问题文件的 URI 数组
	 * @param parentId 父节点的 ID，如果为 null 则作为根节点
	 */
	async function addIssueToTree(issueUris: vscode.Uri[], parentId: string | null) {
		const issueDir = getIssueDir();
		if (!issueDir) { return; } // 安全检查

		const treeData = await readTree();
		for (const issueUri of issueUris) {
			const relPath = path.relative(issueDir, issueUri.fsPath);
			addNode(treeData, relPath, parentId);
		}
		await writeTree(treeData);

		vscode.commands.executeCommand('issueManager.refreshAllViews');
	}



	/**
	 * 智能创建工作流
	 */
	async function smartCreateIssue(parentId: string | null | undefined = null, isAddToTree: boolean = false) {
		const issueDir = getIssueDir();
		if (!issueDir) {
			vscode.window.showErrorMessage('请先在设置中配置“issueManager.issueDir”');
			vscode.commands.executeCommand('workbench.action.openSettings', 'issueManager.issueDir');
			return;
		}

		const quickPick = vscode.window.createQuickPick();
		quickPick.placeholder = '请输入您的问题...';
		quickPick.matchOnDescription = true; // 允许根据描述匹配
		quickPick.canSelectMany = true; // 支持多选
		quickPick.show();
		let quickPickValue = '';
		let requestSequence = 0;

		quickPick.onDidChangeValue(debounce(async (value) => {
			const mySequence = ++requestSequence;
			quickPickValue = value;
			if (!value) {
				quickPick.items = [];
				return;
			}

			// 初始时，只显示原始输入
			const originalInputItem: vscode.QuickPickItem = {
				label: `[创建新笔记] ${value}`,
				description: '使用原始输入创建新笔记'
			};
			quickPick.items = [originalInputItem];

			// 设置为加载状态
			quickPick.busy = true;

			try {
				// 调用 LLM 服务获取建议
				const suggestions = await LLMService.getSuggestions(value);
				console.log('LLM Suggestions:', suggestions); // 添加日志

				// 构建新的列表项
				const newItems: vscode.QuickPickItem[] = [originalInputItem];

				// 添加优化建议
				if (suggestions.optimized.length > 0) {
					newItems.push({ label: '---', kind: vscode.QuickPickItemKind.Separator });
					suggestions.optimized.forEach(opt => {
						newItems.push({ label: `[创建新笔记] ${opt}`, description: opt.includes(value) ? opt : value });
					});
				}


				// 添加分隔符和相似笔记
				if (suggestions.similar.length > 0) {
					newItems.push({ label: '---', kind: vscode.QuickPickItemKind.Separator });
					suggestions.similar.forEach(sim => {
						newItems.push({ label: `[打开已有笔记] ${sim.title}`, description: sim.title.includes(value) ? sim.title : value, detail: sim.filePath });
					});
				}
				if (mySequence === requestSequence) {
					quickPick.items = newItems;
					quickPick.show();
				}
			} catch (error) {
				if (mySequence === requestSequence) {
					quickPick.items = [originalInputItem];
				}
			} finally {
				// 只有最新请求才关闭 busy
				if (mySequence === requestSequence) {
					quickPick.busy = false;
				}
			}
		}, 500));

		quickPick.onDidAccept(async () => {
			requestSequence++; // 立即使所有后续异步响应失效

			const selectedItems = quickPick.selectedItems;
			if (!selectedItems || selectedItems.length === 0) {
				quickPick.hide();
				return;
			}


			// 允许“新建”与“打开已有”同时发生
			let uris: vscode.Uri[] = [];
			// 先处理所有新建
			for (const item of selectedItems) {
				if (item.label.startsWith('[创建新笔记]')) {
					const title = item.label.replace('[创建新笔记] ', '');
					if (title) {
						const uri = await createIssueFile(title);
						if (uri) {
							uris.push(uri);
						}
					}
				}
			}

			// 再处理所有打开
			for (const item of selectedItems) {
				if (item.label.startsWith('[打开已有笔记]')) {
					if (item.detail) {
						try {
							const uri = vscode.Uri.file(item.detail);
							// 尝试访问文件以确认其是否存在
							await vscode.workspace.fs.stat(uri);
							uris.push(uri);
							await vscode.window.showTextDocument(uri);
						} catch (error) {
							// 如果文件不存在或发生其他错误，则显示错误消息
							vscode.window.showErrorMessage(`无法打开文件，文件可能已被移动或删除: ${item.detail}`);
						}
					}
				}
			}
			if (uris.length && isAddToTree) {
				await addIssueToTree(uris, parentId);
			}

			quickPick.hide();

		});

		// 监听 QuickPick 隐藏事件，确保资源清理
		quickPick.onDidHide(() => {
			quickPick.dispose();
		});
	}


	// 注册“删除问题”命令
	const deleteIssueCommand = vscode.commands.registerCommand('issueManager.deleteIssue', async (item: IssueTreeItem) => {
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
	const disassociateIssueCommand = vscode.commands.registerCommand('issueManager.disassociateIssue', async (node: TreeNode) => {
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
	const createChildIssueCommand = vscode.commands.registerCommand('issueManager.createChildIssue', async (parentNode?: TreeNode) => {
		const id: string | null | undefined = parentNode?.id && stripFocusedId(parentNode.id);
		await smartCreateIssue(id || null, true);
	});
	context.subscriptions.push(createChildIssueCommand);
	// 注册“创建问题”命令
	const createIssueCommand = vscode.commands.registerCommand('issueManager.createIssue', async () => {
		await smartCreateIssue(null);
	});
	context.subscriptions.push(createIssueCommand);

	const createIssueFromOverviewCommand = vscode.commands.registerCommand('issueManager.createIssueFromOverview', async (node?: TreeNode) => {
		const selectedNode = node || (overviewView.selection.length > 0 ? overviewView.selection[0] : undefined);
		const parentId: string | null | undefined = selectedNode?.id ? stripFocusedId(selectedNode.id) : null;
		await smartCreateIssue(parentId, true);
	});
	context.subscriptions.push(createIssueFromOverviewCommand);

	// 注册“添加到关注”命令
	const focusIssueCommand = vscode.commands.registerCommand('issueManager.focusIssue', async (node: TreeNode) => {
		const issueDir = getIssueDir();
		if (!issueDir) { return; }
		if (!node || !node.id) {
			vscode.window.showErrorMessage('未找到要关注的问题节点。');
			return;
		}
		const realId = stripFocusedId(node.id);
		await addFocus(realId);
		vscode.commands.executeCommand('issueManager.refreshAllViews');
		vscode.window.showInformationMessage('已添加到关注问题。');
	});
	context.subscriptions.push(focusIssueCommand);

	// 注册“移除关注”命令
	const removeFocusCommand = vscode.commands.registerCommand('issueManager.removeFocus', async (node: TreeNode) => {
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
	context.subscriptions.push(vscode.commands.registerCommand('issueManager.pinFocus', async (node: TreeNode) => {
		if (node?.id) {
			const realId = stripFocusedId(node.id);
			await pinFocus(realId);
			vscode.commands.executeCommand('issueManager.focusedIssues.refresh');
		}
	}));

	// ========== TreeView 展开/折叠状态同步与持久化 ==========
	function registerExpandCollapseSync(treeView: vscode.TreeView<TreeNode>, viewName: string) {
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

	registerExpandCollapseSync(overviewView as vscode.TreeView<TreeNode>, 'overview');
	registerExpandCollapseSync(focusedView as vscode.TreeView<TreeNode>, 'focused');

	// 注册 Language Model Tool
	if (vscode.lm && vscode.lm.registerTool) {
		context.subscriptions.push(
			vscode.lm.registerTool('issueManager_recordContent', new RecordContentTool())
		);
	}
}

// 当您的扩展被停用时，将调用此方法
export function deactivate() { }
