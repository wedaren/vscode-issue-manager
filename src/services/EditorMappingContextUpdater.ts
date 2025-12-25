import * as vscode from 'vscode';
import { NoteMappingService } from './noteMapping/NoteMappingService';

/**
 * 编辑器映射上下文更新器
 * 用于更新编辑器上下文，控制菜单显示
 */
export class EditorMappingContextUpdater {
  private mappingService: NoteMappingService;
  private disposables: vscode.Disposable[] = [];

  constructor(context: vscode.ExtensionContext) {
    this.mappingService = NoteMappingService.getInstance();

    // 监听编辑器切换
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(editor => {
        this.updateContext(editor);
      })
    );

    // 监听映射变更
    this.disposables.push(
      this.mappingService.watch(() => {
        this.updateContext(vscode.window.activeTextEditor);
      })
    );

    // 初始更新
    this.updateContext(vscode.window.activeTextEditor);

    // 注册手动更新命令
    this.disposables.push(
      vscode.commands.registerCommand('issueManager.updateEditorMappingContext', () => {
        this.updateContext(vscode.window.activeTextEditor);
      })
    );

    // 添加到上下文
    context.subscriptions.push(this);
  }

  /**
   * 更新编辑器上下文
   */
  private async updateContext(editor: vscode.TextEditor | undefined): Promise<void> {
    // 检查配置是否启用自动更新
    const config = vscode.workspace.getConfiguration('issueManager.noteMapping');
    const autoUpdate = config.get<boolean>('autoUpdateContext', true);

    if (!autoUpdate) {
      return;
    }

    if (!editor) {
      await vscode.commands.executeCommand('setContext', 'issueManager.hasMappedNote', false);
      return;
    }

    const filePath = editor.document.uri.fsPath;
    const hasMapping = await this.mappingService.hasMapping(filePath);

    await vscode.commands.executeCommand('setContext', 'issueManager.hasMappedNote', hasMapping);
  }

  /**
   * 释放资源
   */
  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];
  }
}
