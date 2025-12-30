import * as vscode from 'vscode';
import * as path from 'path';
import { getIssueDir } from '../config';
import { generateFileName } from '../utils/fileUtils';
import { readTree, addNode, writeTree, IssueTreeNode } from '../data/issueTreeManager';
import { addFocus } from '../data/focusedManager';

/**
 * 仅负责在磁盘上创建新的问题文件。
 * 文件名格式：YYYYMMDD-HHmmss-SSS.md，兼具可读性和唯一性。
 * @param title 问题标题
 * @returns 新建文件的 URI，如果失败则返回 null。
 */
export async function createIssueFile(title: string, content?: string): Promise<vscode.Uri | null> {
	const issueDir = getIssueDir();
	if (!issueDir) {
		vscode.window.showErrorMessage('问题目录未配置。');
		return null;
	}
	const filename = generateFileName();
	const filePath = vscode.Uri.file(path.join(issueDir, filename));

	// 如果外部传入了 content，则直接使用；否则根据 title 生成最小内容
	const finalContent = (typeof content === 'string' && content.length > 0) ? content : `# ${title}\n\n`;
	const contentBytes = Buffer.from(finalContent, 'utf8');

	await vscode.workspace.fs.writeFile(filePath, contentBytes);
	await vscode.window.showTextDocument(filePath);

	return filePath;
}

/**
 * 与 `createIssueFile` 类似，但不会在创建后自动打开编辑器。
 * 供需要“创建但不打开”场景（例如后台填充）使用。
 */
export async function createIssueFileSilent(title: string, content?: string): Promise<vscode.Uri | null> {
	const issueDir = getIssueDir();
	if (!issueDir) {
		vscode.window.showErrorMessage('问题目录未配置。');
		return null;
	}
	const filename = generateFileName();
	const filePath = vscode.Uri.file(path.join(issueDir, filename));

	const finalContent = (typeof content === 'string' && content.length > 0) ? content : `# ${title}\n\n`;
	const contentBytes = Buffer.from(finalContent, 'utf8');

	await vscode.workspace.fs.writeFile(filePath, contentBytes);
	// 注意：与 createIssueFile 不同，这里不调用 showTextDocument，从而实现“静默创建”。
	return filePath;
}

/**
 * 将指定文件路径的多个 issue 添加到 tree.json 数据中。
 * @param issueUris 要添加的问题文件的 URI 数组
 * @param parentId 父节点的 ID，如果为 null 则作为根节点
 * @param isAddToFocused 是否将新添加的节点添加到关注列表
 */
export async function addIssueToTree(issueUris: vscode.Uri[], parentId: string | null, isAddToFocused: boolean = true): Promise<IssueTreeNode[] | null> {
	const issueDir = getIssueDir();
	if (!issueDir) { return null; } // 安全检查

	const treeData = await readTree();
	const relPaths = issueUris.map(issueUri => path.relative(issueDir, issueUri.fsPath));
	const res = addNode(treeData, relPaths, parentId);
	if (!res) {
		// 写回当前（可能未变更）数据并刷新视图
		await writeTree(treeData);
		vscode.commands.executeCommand('issueManager.refreshAllViews');
		return null;
	}

	const ids = res.map(node => node.id);
	if (isAddToFocused) {
		addFocus(ids);
	}

	await writeTree(treeData);
	vscode.commands.executeCommand('issueManager.refreshAllViews');
	return res;
}
