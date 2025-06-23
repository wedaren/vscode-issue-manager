import * as vscode from 'vscode';
import * as path from 'path';
import { IsolatedIssuesProvider, IssueTreeItem } from './views/IsolatedIssuesProvider';
import { getIssueDir } from './config';

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
	vscode.window.registerTreeDataProvider('issueManager.views.isolated', isolatedIssuesProvider);

	// 注册“创建问题”命令
	const createIssueCommand = vscode.commands.registerCommand('issueManager.createIssue', async () => {
		const issueDir = getIssueDir();
		if (!issueDir) {
			vscode.window.showErrorMessage('请先在设置中配置“issueManager.issueDir”');
			vscode.commands.executeCommand('workbench.action.openSettings', 'issueManager.issueDir');
			return;
		}

		const title = await vscode.window.showInputBox({
			prompt: '请输入您的问题标题',
			placeHolder: '例如：如何配置 VS Code 的主题？'
		});

		if (title) {
			const now = new Date();
			const filename = `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}-${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}.md`;
			
			const filePath = vscode.Uri.file(path.join(issueDir, filename));
			const content = `# ${title}\n\n`;
			const contentBytes = Buffer.from(content, 'utf8');

			try {
				await vscode.workspace.fs.writeFile(filePath, contentBytes);
				await vscode.window.showTextDocument(filePath);
			} catch (error) {
				vscode.window.showErrorMessage(`创建文件失败: ${error}`);
			}
		}
	});

	context.subscriptions.push(createIssueCommand);

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
}

// 当您的扩展被停用时，将调用此方法
export function deactivate() {}
