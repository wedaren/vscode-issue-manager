import * as vscode from 'vscode';
import * as path from 'path';
import { getIssueDir } from '../config';
import { generateFileName } from '../utils/fileUtils';
import { readTree, addNode, writeTree } from '../data/treeManager';

/**
 * 仅负责在磁盘上创建新的问题文件。
 * 文件名格式：YYYYMMDD-HHmmss-SSS.md，兼具可读性和唯一性。
 * @param title 问题标题
 * @returns 新建文件的 URI，如果失败则返回 null。
 */
export async function createIssueFile(title: string): Promise<vscode.Uri | null> {
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
export async function addIssueToTree(issueUris: vscode.Uri[], parentId: string | null) {
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
