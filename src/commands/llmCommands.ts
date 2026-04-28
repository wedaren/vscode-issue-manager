import * as vscode from 'vscode';
import { Logger } from '../core/utils/Logger';
import { ModelRegistry } from '../llm/ModelRegistry';

/**
 * 选择 LLM 模型命令：展示 Copilot 模型与自定义模型分组列表，支持跳转至添加自定义模型。
 */
export async function selectLLMModel(): Promise<void> {
    const logger = Logger.getInstance();

    try {
        const allModels = await ModelRegistry.getAllActive();
        const config = vscode.workspace.getConfiguration('issueManager');
        const currentId = config.get<string>('llm.modelFamily') || 'copilot/gpt-5-mini';

        const copilotModels = allModels.filter(m => m.provider === 'copilot');
        const customModels = allModels.filter(m => m.provider !== 'copilot');

        if (copilotModels.length === 0 && customModels.length === 0) {
            vscode.window.showWarningMessage('未找到可用的模型。请确保已安装并登录 GitHub Copilot 扩展或配置自定义模型。');
            return;
        }

        type ModelItem = vscode.QuickPickItem & { modelId?: string };
        const items: ModelItem[] = [];

        if (copilotModels.length > 0) {
            items.push({ label: 'Copilot 模型', kind: vscode.QuickPickItemKind.Separator });
            for (const m of copilotModels) {
                items.push({
                    label: `$(sparkle) ${m.displayName}`,
                    description: m.contextWindow ? `上下文 ${(m.contextWindow / 1000).toFixed(0)}k tokens` : undefined,
                    detail: m.id === currentId ? '当前使用' : undefined,
                    picked: m.id === currentId,
                    modelId: m.id,
                });
            }
        }

        if (customModels.length > 0) {
            items.push({ label: '自定义模型', kind: vscode.QuickPickItemKind.Separator });
            for (const m of customModels) {
                items.push({
                    label: `$(server) ${m.displayName}`,
                    description: `${m.provider}${m.endpoint ? ` · ${m.endpoint}` : ''}`,
                    detail: m.id === currentId ? '当前使用' : undefined,
                    picked: m.id === currentId,
                    modelId: m.id,
                });
            }
        }

        items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
        items.push({ label: '$(add) 添加自定义模型…', description: '通过向导配置新模型', modelId: '__add__' });

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: `当前: ${currentId}`,
            title: '选择 LLM 模型',
        });

        if (!selected || !selected.modelId) { return; }

        if (selected.modelId === '__add__') {
            await vscode.commands.executeCommand('issueManager.llm.addModelWizard');
            return;
        }

        await config.update('llm.modelFamily', selected.modelId, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`已切换到模型: ${selected.modelId}`);
        logger.info(`用户切换 LLM 模型为: ${selected.modelId}`);

    } catch (error) {
        logger.error('选择 LLM 模型失败', error);
        vscode.window.showErrorMessage('选择模型时发生错误');
    }
}
