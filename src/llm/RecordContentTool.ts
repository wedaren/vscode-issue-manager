import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { getIssueDir } from '../config';
import { generateFileName } from '../utils/fileUtils';

/**
 * Language Model Tool 的输入参数接口
 */
export interface IRecordContentParameters {
  content: string;
}

/**
 * 记录内容到文档的 Language Model Tool 实现
 */
export class RecordContentTool implements vscode.LanguageModelTool<IRecordContentParameters> {
  
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IRecordContentParameters>,
    _token: vscode.CancellationToken
  ) {
    const { content } = options.input;
    const previewTitle = this.extractTitleFromMarkdown(content);
    
    const confirmationMessages = {
      title: '记录内容到文档',
      message: new vscode.MarkdownString(
        `**将要创建新文档：**\n\n` +
        `**标题：** ${previewTitle}\n\n` +
        `**内容预览：**\n\`\`\`markdown\n${content.substring(0, 300)}${content.length > 300 ? '...' : ''}\n\`\`\``
      ),
    };

    return {
      invocationMessage: '正在记录内容到新文档...',
      confirmationMessages,
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IRecordContentParameters>,
    _token: vscode.CancellationToken
  ) {
    try {
      const { content } = options.input;
      
      // 获取配置的问题目录
      const issueDir = getIssueDir();
      if (!issueDir) {
        throw new Error('问题目录未配置。请先在设置中配置 issueManager.issueDir');
      }

      // 生成文件名和提取标题
      const fileName = generateFileName(); // 格式：YYYYMMDD-HHmmss.md
      const docTitle = this.extractTitleFromMarkdown(content);
      const filePath = path.join(issueDir, fileName);

      // 直接写入 Markdown 内容（LLM 已经提供了完整的格式）
      await fs.writeFile(filePath, content, 'utf8');

      // 触发视图刷新（通知孤立问题视图更新）
      vscode.commands.executeCommand('issueManager.refreshViews');

      // 可选：打开新创建的文件
      const document = await vscode.workspace.openTextDocument(filePath);
      await vscode.window.showTextDocument(document);

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `✅ 内容已成功记录到新文档：**${docTitle}**\n\n` +
          `文件路径：\`${fileName}\`\n\n` +
          `文档已创建，您可以在问题管理插件的视图中找到它。`
        )
      ]);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      throw new Error(`记录内容失败：${errorMessage}。请检查问题目录配置和文件权限。`);
    }
  }

  /**
   * 从 Markdown 内容中提取第一个一级标题
   */
  private extractTitleFromMarkdown(content: string): string {
    // 从 Markdown 内容中提取第一个一级标题
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('# ')) {
        return trimmed.substring(2).trim();
      }
    }
    
    // 如果没有找到标题，使用时间戳
    const now = new Date();
    return `记录内容 ${now.toLocaleString('zh-CN')}`;
  }
}
