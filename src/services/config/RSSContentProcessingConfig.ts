import * as vscode from 'vscode';
import { ContentProcessingOptions } from '../converters/ContentProcessor';

/**
 * RSS内容处理配置服务
 * 管理用户的内容处理偏好设置
 */
export class RSSContentProcessingConfig {
    private static readonly CONFIG_SECTION = 'issueManager.rss.contentProcessing';

    /**
     * 获取默认内容处理配置
     */
    public static getDefaultProcessingConfig(): {
        preset?: string;
        processors?: string[];
        options?: ContentProcessingOptions;
    } {
        const config = vscode.workspace.getConfiguration();
        
        return {
            preset: config.get(`${this.CONFIG_SECTION}.defaultPreset`, 'concise'),
            processors: config.get(`${this.CONFIG_SECTION}.defaultProcessors`, []),
            options: {
                maxLength: config.get(`${this.CONFIG_SECTION}.maxLength`, 500),
                preserveHtml: config.get(`${this.CONFIG_SECTION}.preserveHtml`, false),
                preserveImages: config.get(`${this.CONFIG_SECTION}.preserveImages`, true),
                preserveLinks: config.get(`${this.CONFIG_SECTION}.preserveLinks`, true),
                removeTags: config.get(`${this.CONFIG_SECTION}.removeTags`, ['script', 'style', 'iframe']),
                summaryMode: {
                    enabled: config.get(`${this.CONFIG_SECTION}.summaryMode.enabled`, false),
                    maxSentences: config.get(`${this.CONFIG_SECTION}.summaryMode.maxSentences`, 3),
                    preferredSections: config.get(`${this.CONFIG_SECTION}.summaryMode.preferredSections`, ['摘要', '总结'])
                },
                customRules: config.get(`${this.CONFIG_SECTION}.customRules`, []),
                // Base64 图片处理配置
                imageProcessOptions: {
                    extractBase64Images: config.get(`${this.CONFIG_SECTION}.base64Images.extract`, true),
                    base64SizeThreshold: config.get(`${this.CONFIG_SECTION}.base64Images.sizeThreshold`, 1024),
                    removeBase64Images: config.get(`${this.CONFIG_SECTION}.base64Images.remove`, false),
                    fallbackToBase64: config.get(`${this.CONFIG_SECTION}.base64Images.fallbackToBase64`, false)
                }
            }
        };
    }

    /**
     * 更新内容处理配置
     */
    public static async updateProcessingConfig(
        key: string, 
        value: any, 
        configurationTarget?: vscode.ConfigurationTarget
    ): Promise<void> {
        const config = vscode.workspace.getConfiguration();
        await config.update(`${this.CONFIG_SECTION}.${key}`, value, configurationTarget);
    }

    /**
     * 获取订阅源特定的处理配置
     */
    public static getFeedSpecificConfig(feedId: string): {
        preset?: string;
        processors?: string[];
        options?: ContentProcessingOptions;
    } | null {
        const config = vscode.workspace.getConfiguration();
        const feedConfigs = config.get<Record<string, { preset?: string; processors?: string[]; options?: ContentProcessingOptions; }>>(`${this.CONFIG_SECTION}.feedSpecific`, {});
        
        return feedConfigs[feedId] || null;
    }

    /**
     * 设置订阅源特定的处理配置
     */
    public static async setFeedSpecificConfig(
        feedId: string, 
        processingConfig: {
            preset?: string;
            processors?: string[];
            options?: ContentProcessingOptions;
        }
    ): Promise<void> {
        const config = vscode.workspace.getConfiguration();
        const feedConfigs = config.get(`${this.CONFIG_SECTION}.feedSpecific`, {}) as Record<string, any>;
        
        feedConfigs[feedId] = processingConfig;
        
        await config.update(`${this.CONFIG_SECTION}.feedSpecific`, feedConfigs);
    }

    /**
     * 创建配置管理命令
     */
    public static createConfigCommands(): vscode.Disposable[] {
        return [
            vscode.commands.registerCommand('issueManager.rss.configureContentProcessing', async () => {
                await this.showContentProcessingConfigDialog();
            }),
            
            vscode.commands.registerCommand('issueManager.rss.configureFeedSpecificProcessing', async (feedId?: string) => {
                await this.showFeedSpecificConfigDialog(feedId);
            })
        ];
    }

    /**
     * 显示内容处理配置对话框
     */
    private static async showContentProcessingConfigDialog(): Promise<void> {
        const presets = ['concise', 'summary', 'clean', 'plain', 'custom'];
        
        const selectedPreset = await vscode.window.showQuickPick(presets, {
            placeHolder: '选择默认的内容处理预设',
            title: 'RSS内容处理配置'
        });

        if (selectedPreset) {
            await this.updateProcessingConfig('defaultPreset', selectedPreset);
            vscode.window.showInformationMessage(`已设置默认预设为: ${selectedPreset}`);
        }
    }

    /**
     * 显示订阅源特定配置对话框
     */
    private static async showFeedSpecificConfigDialog(feedId?: string): Promise<void> {
        if (!feedId) {
            vscode.window.showErrorMessage('请指定订阅源ID');
            return;
        }

        const options = [
            { label: '使用默认配置', value: null },
            { label: '简洁模式', value: { preset: 'concise' } },
            { label: '摘要模式', value: { preset: 'summary' } },
            { label: '清洁模式', value: { preset: 'clean' } },
            { label: '纯文本模式', value: { preset: 'plain' } }
        ];

        const selected = await vscode.window.showQuickPick(options, {
            placeHolder: `为订阅源 ${feedId} 选择内容处理方式`,
            title: '订阅源特定配置'
        });

        if (selected !== undefined) {
            if (selected.value === null) {
                // 移除特定配置，使用默认配置
                const config = vscode.workspace.getConfiguration();
                const feedConfigs = config.get(`${this.CONFIG_SECTION}.feedSpecific`, {}) as Record<string, any>;
                delete feedConfigs[feedId];
                await config.update(`${this.CONFIG_SECTION}.feedSpecific`, feedConfigs);
            } else {
                await this.setFeedSpecificConfig(feedId, selected.value);
            }
            vscode.window.showInformationMessage(`已更新订阅源 ${feedId} 的配置`);
        }
    }
}
