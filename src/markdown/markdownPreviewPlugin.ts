// Markdown Preview 插件：将 "ImageDir/xxx" 别名内联为 base64 data URI，
// 绕过 VS Code 预览的 localResourceRoots 安全限制（iCloud 目录不在工作区内）。
// 通过 activate() 返回 { extendMarkdownIt } 由 VS Code 自动注入。

import * as fs from 'fs';
import * as path from 'path';
import { IMAGE_DIR_PREFIX, ImageStorageService } from '../services/storage/ImageStorageService';

/** markdown-it token 的最小类型定义（无需安装 @types/markdown-it） */
interface MdToken {
	type: string;
	content: string;
	children: MdToken[] | null;
	attrGet(name: string): string | null;
	attrSet(name: string, value: string): void;
}

interface MdStateCore {
	tokens: MdToken[];
}

interface MarkdownItInstance {
	core: {
		ruler: {
			push(name: string, fn: (state: MdStateCore) => void): void;
		};
	};
}

/** 扩展名 → MIME 类型映射表 */
const EXT_TO_MIME: Record<string, string> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
};

/**
 * VS Code Markdown Preview 插件入口：将 "ImageDir/xxx" 别名内联为 base64 data URI。
 * @param md - markdown-it 实例（由 VS Code Markdown Preview 扩展注入）
 * @returns 修改后的 md 实例
 */
export function extendMarkdownIt(md: MarkdownItInstance): MarkdownItInstance {
	md.core.ruler.push('imagedir-resolver', (state: MdStateCore) => {
		const prefix = `${IMAGE_DIR_PREFIX}/`;
		for (const token of state.tokens) {
			if (token.type !== 'inline' || !token.children) { continue; }
			for (const child of token.children) {
				if (child.type !== 'image') { continue; }
				const src = child.attrGet('src');
				if (!src?.startsWith(prefix)) { continue; }
				const resolved = ImageStorageService.resolve(src);
				if (!resolved) { continue; }
				try {
					const data = fs.readFileSync(resolved.fsPath);
					const ext = path.extname(resolved.fsPath).toLowerCase();
					const mime = EXT_TO_MIME[ext] ?? 'image/png';
					child.attrSet('src', `data:${mime};base64,${data.toString('base64')}`);
				} catch {
					// 检测 iCloud 占位文件（格式：.{filename}.icloud）
					const icloudPlaceholder = path.join(
						path.dirname(resolved.fsPath),
						`.${path.basename(resolved.fsPath)}.icloud`,
					);
					if (fs.existsSync(icloudPlaceholder) && child.children?.length) {
						child.children[0].content = `⚠ iCloud 未下载：${path.basename(resolved.fsPath)}`;
					}
					// 其他失败保留原始路径
				}
			}
		}
	});
	return md;
}
