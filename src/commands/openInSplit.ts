import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export function registerOpenInSplit(context: vscode.ExtensionContext) {
	const disposable = vscode.commands.registerCommand('extension.openInSplit', async (args) => {
		try {
			let payload = args;
			if (Array.isArray(args) && args.length > 0) payload = args[0];

			const target = (payload && payload.target) ? String(payload.target) : undefined;
			const source = (payload && payload.source) ? String(payload.source) : undefined;
			if (!target) {
				vscode.window.showErrorMessage('未提供目标文件路径');
				return;
			}

			// 拆分 fragment（例如 file.md#L10 或 file.md#L10-L12）
			let rawPath = target;
			let fragment = '';
			const hashIdx = target.indexOf('#');
			if (hashIdx !== -1) {
				rawPath = target.substring(0, hashIdx);
				fragment = target.substring(hashIdx + 1);
			}

			// 解析相对路径的基准目录
			let resolvedPath: string;
			const workspaceFolders = vscode.workspace.workspaceFolders;
			if (path.isAbsolute(rawPath)) {
				resolvedPath = rawPath;
			} else if (workspaceFolders && workspaceFolders.length > 0) {
				// 优先使用触发链接文档所在的 workspace folder
				if (source) {
					try {
						const srcUri = vscode.Uri.parse(source);
						const wf = vscode.workspace.getWorkspaceFolder(srcUri);
						const base = wf ? wf.uri.fsPath : workspaceFolders[0].uri.fsPath;
						resolvedPath = path.join(base, rawPath);
					} catch (e) {
						resolvedPath = path.join(workspaceFolders[0].uri.fsPath, rawPath);
					}
				} else {
					resolvedPath = path.join(workspaceFolders[0].uri.fsPath, rawPath);
				}
			} else if (source) {
				// 无 workspace 时回退到源文档目录
				try {
					const srcUri = vscode.Uri.parse(source);
					resolvedPath = path.resolve(path.dirname(srcUri.fsPath), rawPath);
				} catch (e) {
					resolvedPath = path.resolve(rawPath);
				}
			} else {
				resolvedPath = path.resolve(rawPath);
			}

			// 验证文件存在
			if (!fs.existsSync(resolvedPath)) {
				vscode.window.showErrorMessage(`未找到文件: ${resolvedPath}`);
				return;
			}

			const fileUri = vscode.Uri.file(resolvedPath);
			const doc = await vscode.workspace.openTextDocument(fileUri);
			const editor = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: false });

			// 解析 fragment 并定位（支持 L10 / L10-L12 / 10 / 10-12 / 10:5）
			if (fragment) {
				// L 开头的行号格式
				let m = fragment.match(/^L?(\d+)(?:-L?(\d+))?(?::(\d+))?(?::(\d+))?$/);
				if (m) {
					const startLine = Math.max(0, parseInt(m[1], 10) - 1);
					const endLine = m[2] ? Math.max(0, parseInt(m[2], 10) - 1) : startLine;
					const startChar = m[3] ? Math.max(0, parseInt(m[3], 10) - 1) : 0;
					const endChar = Math.min(doc.lineAt(endLine).text.length, startChar + 1);
					const range = new vscode.Range(startLine, startChar, endLine, endChar);
					editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
					editor.selection = new vscode.Selection(range.start, range.start);
				}
			}
		} catch (err) {
			console.error('openInSplit error:', err);
			vscode.window.showErrorMessage('打开文件时发生错误');
		}
	});

	context.subscriptions.push(disposable);
}

export default registerOpenInSplit;
