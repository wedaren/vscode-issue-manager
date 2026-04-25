// Markdown 文件图片粘贴处理：用户在 Markdown 文件中粘贴图片时，
// 自动将图片保存到 ImageDir 并在光标处插入 ![](ImageDir/chat_xxx.png)。
// 通过 DocumentPasteEditProvider 接管 VS Code 的图片粘贴默认行为（需 VS Code 1.101+）。

import * as vscode from 'vscode';
import { ImageStorageService } from '../services/storage/ImageStorageService';

const IMAGE_PASTE_KIND = vscode.DocumentDropOrPasteEditKind.Text.append('imageDir');

const SUPPORTED_MIME_TYPES: readonly string[] = [
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
];

/**
 * Markdown 文件中的图片粘贴编辑 Provider。
 * 将剪贴板图片保存到 ImageDir，并在光标处插入 `![](ImageDir/chat_xxx.png)` 引用。
 */
export class ConversationImagePasteEditProvider implements vscode.DocumentPasteEditProvider {
    /**
     * 处理图片粘贴：保存到 ImageDir，返回插入 `![](ImageDir/xxx.png)` 的编辑。
     * @param dataTransfer - 剪贴板数据，从中提取图片
     * @returns 含图片引用插入文本的 DocumentPasteEdit，无图片时返回空数组
     */
    async provideDocumentPasteEdits(
        _document: vscode.TextDocument,
        _ranges: readonly vscode.Range[],
        dataTransfer: vscode.DataTransfer,
        _context: vscode.DocumentPasteEditContext,
        _token: vscode.CancellationToken,
    ): Promise<vscode.DocumentPasteEdit[]> {
        for (const mimeType of SUPPORTED_MIME_TYPES) {
            const item = dataTransfer.get(mimeType);
            if (!item) { continue; }

            const file = item.asFile();
            if (!file) { continue; }

            const data = await file.data();
            const result = await ImageStorageService.save(data, mimeType, 'chat');
            if (!result) { return []; }

            const snippet = new vscode.SnippetString(`![\${1}](${result.relativePath})`);
            const edit = new vscode.DocumentPasteEdit(snippet, '插入图片到 ImageDir', IMAGE_PASTE_KIND);
            return [edit];
        }
        return [];
    }
}
