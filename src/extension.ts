import * as vscode from 'vscode';
import * as path from 'path';
import { IsolatedIssuesProvider, IssueTreeItem } from './views/IsolatedIssuesProvider';
import { IssueOverviewProvider } from './views/IssueOverviewProvider';
import { IssueDragAndDropController } from './views/IssueDragAndDropController';
import { getIssueDir } from './config';
import { TreeNode, readTree, writeTree, addNode, TreeData, isFocusedRootId, stripFocusedRootId } from './data/treeManager';
import { addFocus, removeFocus, readFocused, writeFocused } from './data/focusedManager';
import { FocusedIssuesProvider } from './views/FocusedIssuesProvider';
import { LLMService } from './llm/LLMService';
import { debounce } from './utils/debounce';

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
	const issueOverviewProvider = new IssueOverviewProvider();
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
	const focusedIssuesProvider = new FocusedIssuesProvider();
	const focusedView = vscode.window.createTreeView('issueManager.views.focused', {
		treeDataProvider: focusedIssuesProvider,
		dragAndDropController: new IssueDragAndDropController(focusedIssuesProvider, 'focused'),
		canSelectMany: true
	});
	context.subscriptions.push(focusedView);

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
	context.subscriptions.push(vscode.commands.registerCommand('issueManager.refreshAllView', () => {
		isolatedIssuesProvider.refresh();
		focusedIssuesProvider.refresh();
		issueOverviewProvider.refresh();
	}));

	/**
	 * 仅负责在磁盘上创建新的问题文件。
	 * @param title 问题标题
	 * @returns 新建文件的 URI，如果失败则返回 null。
	 */
	async function createIssueFile(title: string): Promise<vscode.Uri | null> {
		const issueDir = getIssueDir();
		if (!issueDir) {
			// 此情况应由调用方处理，但作为安全措施
			vscode.window.showErrorMessage('问题目录未配置。');
			return null;
		}
		const now = new Date();
		const filename = `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}-${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}.md`;
		const filePath = vscode.Uri.file(path.join(issueDir, filename));
		const content = `# ${title}\n\n`;
		const contentBytes = Buffer.from(content, 'utf8');

		await vscode.workspace.fs.writeFile(filePath, contentBytes);
		await vscode.window.showTextDocument(filePath);

		return filePath;
	}

	/**
	 * 将指定文件路径的 issue 添加到 tree.json 数据中。
	 * @param issueUri 要添加的问题文件的 URI
	 * @param parentId 父节点的 ID，如果为 null 则作为根节点
	 */
	async function addIssueToTree(issueUri: vscode.Uri, parentId: string | null | undefined) {
		const issueDir = getIssueDir();
		if (!issueDir) { return; } // 安全检查

		const treeData = await readTree();
		const relPath = path.relative(issueDir, issueUri.fsPath);
		addNode(treeData, relPath, parentId);
		await writeTree(treeData);

		vscode.commands.executeCommand('issueManager.refreshAllView');
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

		let quickPickValue = '';
		quickPick.onDidChangeValue(debounce(async (value) => {
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
				console.log('QuickPick newItems:', newItems); // 添加日志
				quickPick.items = newItems;
			} catch (error) {
				console.error('Error getting suggestions from LLMService:', error);
				// 出错时，至少保证原始输入项仍然可用
				quickPick.items = [originalInputItem];
			} finally {
				// 结束加载状态
				quickPick.busy = false;
			}
		}, 500));

		quickPick.onDidAccept(async () => {
			const selectedItem = quickPick.selectedItems[0];
			if (!selectedItem) {
				quickPick.hide();
				return;
			}
			let uri: vscode.Uri | null = null;
			// 根据选择的类型执行操作
			if (selectedItem.label.startsWith('[创建新笔记]')) {
				// 从 label 中提取标题
				const title = selectedItem.label.replace('[创建新笔记] ', '');
				if (title) {
					uri = await createIssueFile(title);
				}
			} else if (selectedItem.label.startsWith('[打开已有笔记]')) {
				// 从 description 中获取文件路径
				const filePath = selectedItem.detail;
				if (filePath) {
					uri = vscode.Uri.file(filePath);
				}
			}
			if (uri) {

				await vscode.window.showTextDocument(uri);
				if (isAddToTree) {
					await addIssueToTree(uri, parentId);
				}
			}

			quickPick.hide();
		});

		quickPick.onDidHide(() => quickPick.dispose());
		quickPick.show();
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
		await issueOverviewProvider.disassociateIssue(node) && vscode.commands.executeCommand('issueManager.refreshAllView');
	});

	context.subscriptions.push(disassociateIssueCommand);

	// 修改“新建子问题”命令，复用工具函数
	const createChildIssueCommand = vscode.commands.registerCommand('issueManager.createChildIssue', async (parentNode?: TreeNode) => {
		const id: string | null | undefined = parentNode?.id && stripFocusedRootId(parentNode.id);
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
		const parentId: string | null | undefined = selectedNode?.id ? stripFocusedRootId(selectedNode.id) : null;
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
		await addFocus(issueDir, node.id);
		vscode.commands.executeCommand('issueManager.refreshAllView');
		vscode.window.showInformationMessage('已添加到关注问题。');
	});
	context.subscriptions.push(focusIssueCommand);

	// 注册“移除关注”命令
	const removeFocusCommand = vscode.commands.registerCommand('issueManager.removeFocus', async (node: TreeNode) => {
		const issueDir = getIssueDir();
		if (!issueDir) { return; }
		if (!node || !node.id) {
			vscode.window.showErrorMessage('未找到要移除关注的问题节点。');
			return;
		}
		const realId = stripFocusedRootId(node.id);
		await removeFocus(issueDir, realId);
		vscode.commands.executeCommand('issueManager.refreshAllView');
		vscode.window.showInformationMessage('已移除关注。');
	});
	context.subscriptions.push(removeFocusCommand);

}

// 当您的扩展被停用时，将调用此方法
export function deactivate() { }
