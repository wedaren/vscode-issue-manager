import * as vscode from 'vscode';
import { Logger } from '../core/utils/Logger';

/**
 * 选择 LLM 模型命令
 */
export async function selectLLMModel(): Promise<void> {
    const logger = Logger.getInstance();
    
    try {
        // 获取所有可用的 Copilot 模型
        const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
        
        if (models.length === 0) {
            vscode.window.showWarningMessage('未找到可用的 Copilot 模型。请确保已安装并登录 GitHub Copilot 扩展。');
            return;
        }

        // 获取当前配置
        const config = vscode.workspace.getConfiguration('issueManager');
        const currentFamily = config.get<string>('llm.modelFamily') || 'gpt-4.1';

        // 构建 QuickPick 选项
        const items: vscode.QuickPickItem[] = models.map(model => {
            const isCurrent = model.family === currentFamily;
            return {
                label: model.family,
                description: isCurrent ? '(当前使用)' : undefined,
                detail: `Vendor: ${model.vendor}, Max Input: ${model.maxInputTokens}`,
                picked: isCurrent
            };
        });

        // 显示选择器
        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: '选择用于 AI 功能的 Copilot 模型',
            title: '选择 LLM 模型'
        });

        if (selected) {
            // 更新配置
            await config.update('llm.modelFamily', selected.label, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`已切换到模型: ${selected.label}`);
            logger.info(`用户切换 LLM 模型为: ${selected.label}`);
        }

    } catch (error) {
        logger.error('选择 LLM 模型失败', error);
        vscode.window.showErrorMessage('选择模型时发生错误');
    }
}
