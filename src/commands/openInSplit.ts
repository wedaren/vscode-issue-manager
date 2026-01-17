import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { type FileLocation } from '../utils/fileLinkFormatter';

export function registerOpenInSplit(context: vscode.ExtensionContext) {
	const disposable = vscode.commands.registerCommand('extension.openInSplit', async (args) => {
		try {
			let payload = args;
			if (Array.isArray(args) && args.length > 0) payload = args[0];

			// 支持新的 location 对象格式
			const location = (payload && payload.location) ? payload.location as FileLocation : undefined;
			const target = (payload && payload.target) ? String(payload.target) : undefined;
			const source = (payload && payload.source) ? String(payload.source) : undefined;
			
			// 优先使用新格式
			if (location) {
				await openFileWithLocation(location, source);
				return;
			}
			
			// 回退到旧格式
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

			// 兼容以冒号附带行/列的写法，例如 /path/to/file.py:316 或 /path/to/file.py:316:5 或 /path/to/file.py:10-12 或 /path/to/file.py:10:5-12:8
			if (!fragment) {
				// 仅当最后一个冒号位于最后一个路径分隔符之后时才作为 fragment 处理，避免在 Windows 驱动器或其他路径中的误判
				const lastSlash = Math.max(rawPath.lastIndexOf('/'), rawPath.lastIndexOf('\\'));
				// 使用正则从路径末尾匹配完整的 fragment，支持多个形式：
				// L257:2-L259:5, 316:5, 10-12, 10:5-12:8 等
				const fragRegex = /(L?\d+(?::\d+)?(?:-L?\d+(?::\d+)?)?)$/;
				const fragMatch = rawPath.match(fragRegex);
				if (fragMatch) {
					const matchStart = rawPath.length - fragMatch[0].length;
					// 确保前导字符是 ':' 且该 ':' 在最后一个路径分隔符之后
					if (matchStart > 0 && rawPath.charAt(matchStart - 1) === ':' && matchStart - 1 > lastSlash) {
						fragment = fragMatch[0];
						rawPath = rawPath.substring(0, matchStart - 1);
					}
				}
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

			// 解析 fragment 并定位与选择（支持以下格式）:
			// L10, 10, L10-L12, 10-12, 10:5, 10:5-12:8
			if (fragment) {
				const m = fragment.match(/^L?(\d+)(?::(\d+))?(?:-L?(\d+)(?::(\d+))?)?$/);
				if (m) {
					const startLine = Math.max(0, parseInt(m[1], 10) - 1);
					const startChar = m[2] ? Math.max(0, parseInt(m[2], 10) - 1) : 0;
					const endLine = m[3] ? Math.max(0, parseInt(m[3], 10) - 1) : startLine;
					let endChar: number;
					if (m[4]) {
						endChar = Math.max(0, parseInt(m[4], 10) - 1);
					} else if (endLine === startLine) {
						// 如果同一行且未指定 endChar，选中到行末
						endChar = doc.lineAt(endLine).text.length;
					} else {
						// 不同的结束行且未指定 endChar，则为结束行行末
						endChar = doc.lineAt(endLine).text.length;
					}
					const range = new vscode.Range(startLine, startChar, endLine, Math.min(endChar, doc.lineAt(endLine).text.length));
					editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
					editor.selection = new vscode.Selection(range.start, range.end);
				}
			}
		} catch (err) {
			console.error('openInSplit error:', err);
			vscode.window.showErrorMessage('打开文件时发生错误');
		}
	});

	context.subscriptions.push(disposable);
}

/**
 * 使用新的统一位置格式打开文件
 */
async function openFileWithLocation(location: FileLocation, source?: string): Promise<void> {
	let resolvedPath: string;
	const rawPath = location.filePath;
	const workspaceFolders = vscode.workspace.workspaceFolders;
	
	// 解析路径
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
	try {
		await vscode.workspace.fs.stat(vscode.Uri.file(resolvedPath));
	} catch {
		vscode.window.showErrorMessage(`未找到文件: ${resolvedPath}`);
		return;
	}

	const fileUri = vscode.Uri.file(resolvedPath);
	const doc = await vscode.workspace.openTextDocument(fileUri);
	const editor = await vscode.window.showTextDocument(doc, { 
		viewColumn: vscode.ViewColumn.Beside, 
		preview: false 
	});

	// 定位到指定位置（如果有）
	if (location.startLine !== undefined) {
		const startLine = Math.max(0, location.startLine - 1); // 转换为 0-based
		const startChar = Math.max(0, (location.startColumn || 1) - 1);
		
		let endLine: number;
		let endChar: number;
		
		if (location.endLine !== undefined) {
			endLine = Math.max(0, location.endLine - 1);
			if (location.endColumn !== undefined) {
				endChar = Math.max(0, location.endColumn - 1);
			} else {
				// 未指定结束列，选中到行末
				endChar = doc.lineAt(endLine).text.length;
			}
		} else {
			// 未指定结束行
			endLine = startLine;
			if (location.startColumn !== undefined) {
				// 有起始列但无结束位置，选中到行末
				endChar = doc.lineAt(endLine).text.length;
			} else {
				// 只有行号，选中整行
				endChar = doc.lineAt(endLine).text.length;
			}
		}
		
		const range = new vscode.Range(
			startLine, 
			startChar, 
			endLine, 
			Math.min(endChar, doc.lineAt(endLine).text.length)
		);
		editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
		editor.selection = new vscode.Selection(range.start, range.end);
	}
}

export default registerOpenInSplit;
