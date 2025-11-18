import * as vscode from 'vscode';
import { getIssueDir } from '../config';
import { createIssueFile } from '../commands/issueFileUtils';
import { LLMService } from '../llm/LLMService';
import { addFocus } from '../data/focusedManager';
import { getAllMarkdownIssues } from '../utils/markdown';
import * as path from 'path';
import { Logger } from '../core/utils/Logger';

/**
 * 命令别名常量定义
 */
const CREATE_COMMANDS = ['新建', 'new', 'create'] as const;
const SEARCH_COMMANDS = ['搜索', 'search', 'find'] as const;
const FOCUS_COMMANDS = ['关注', 'focus', 'watch'] as const;
const HELP_COMMANDS = ['帮助', 'help'] as const;

/**
 * 意图配置 - 定义每种意图的检测关键词和噪音词
 * 按从长到短排序，确保优先匹配较长的短语
 */
const INTENT_CONFIG = {
    create: {
        keywords: ['创建', '新建', 'create', 'new'],
        noiseWords: [
            'look for', 'document', 'create', 'issue', 'note', 'new',
            '帮我创建', '帮我新建', '一个关于', '关于', '问题', '笔记', '文档', '创建', '新建'
        ]
    },
    search: {
        keywords: ['搜索', '查找', '找', 'search', 'find'],
        noiseWords: [
            'look for', 'search', 'find',
            '帮我找找', '帮我找', '帮我搜索', '帮我查找', '相关的问题', '相关问题', '相关的', '相关', '找找', '搜索', '查找', '找'
        ]
    },
    focus: {
        keywords: ['关注', 'watch', 'follow'],
        noiseWords: [] // 关注命令暂不需要文本清理
    }
} as const;

/**
 * 从文本中移除噪音词，提取核心内容
 * @param text 原始文本
 * @param noiseWords 要移除的噪音词数组（应按从长到短排序）
 * @returns 清理后的文本
 */
function cleanText(text: string, noiseWords: string[]): string {
    let result = text;
    
    // 按从长到短的顺序替换，避免部分匹配问题
    for (const noise of noiseWords) {
        // 转义正则特殊字符，避免注入问题
        const escaped = noise.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(escaped, 'gi');
        result = result.replace(pattern, ' ');
    }
    
    // 清理多余空格
    return result.replace(/\s+/g, ' ').trim();
}

/**
 * 检测用户意图并提取核心内容
 * @param prompt 用户输入的原始文本
 * @param intentKeywords 意图检测关键词数组
 * @param noiseWords 要移除的噪音词数组
 * @returns 如果检测到意图，返回清理后的文本；否则返回 null
 */
function detectIntent(prompt: string, intentKeywords: readonly string[], noiseWords: readonly string[]): string | null {
    const lowerPrompt = prompt.toLowerCase();
    
    // 检查是否包含任何意图关键词
    if (!intentKeywords.some(keyword => lowerPrompt.includes(keyword))) {
        return null;
    }
    
    // 提取并清理文本
    const cleaned = cleanText(prompt, noiseWords as string[]);
    return cleaned || null;
}

/**
 * Issue Manager Chat Participant
 * 
 * 在 Copilot Chat 中提供问题管理功能
 * 使用 @issueManager 触发
 */
export class IssueChatParticipant {
    private participant: vscode.ChatParticipant | undefined;

    /**
     * 注册 Chat Participant
     */
    public register(context: vscode.ExtensionContext): void {
        // 检查是否支持 Chat API
        if (!vscode.chat || !vscode.chat.createChatParticipant) {
            Logger.getInstance().warn('[IssueChatParticipant] Chat API 不可用');
            return;
        }

        // 创建 Chat Participant
        this.participant = vscode.chat.createChatParticipant(
            'issueManager.chat',
            this.handleChatRequest.bind(this)
        );

        // 配置参与者
        this.participant.iconPath = vscode.Uri.file(
            path.join(context.extensionPath, 'resources', 'icon.svg')
        );

        context.subscriptions.push(this.participant);
        Logger.getInstance().info('[IssueChatParticipant] Chat Participant 已注册');
    }

    /**
     * 处理聊天请求
     */
    private async handleChatRequest(
        request: vscode.ChatRequest,
        context: vscode.ChatContext,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<void> {
        // 检查问题目录是否配置
        const issueDir = getIssueDir();
        if (!issueDir) {
            stream.markdown('❌ 请先在设置中配置 `issueManager.issueDir`\n\n');
            stream.button({
                command: 'workbench.action.openSettings',
                arguments: ['issueManager.issueDir'],
                title: '打开设置'
            });
            return;
        }

        // 解析命令
        const command = request.command?.toLowerCase() || '';
        const prompt = request.prompt.trim();

        try {
            // 根据命令路由到不同的处理器
            if (CREATE_COMMANDS.includes(command as any)) {
                await this.handleCreateCommand(prompt, stream, token);
            } else if (SEARCH_COMMANDS.includes(command as any)) {
                await this.handleSearchCommand(prompt, stream, token);
            } else if (FOCUS_COMMANDS.includes(command as any)) {
                await this.handleFocusCommand(prompt, stream, token);
            } else if (HELP_COMMANDS.includes(command as any)) {
                this.handleHelpCommand(stream);
            } else {
                // 无命令时,尝试智能理解用户意图
                await this.handleDefaultCommand(prompt, stream, token);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            stream.markdown(`\n\n❌ 执行失败: ${errorMessage}\n`);
        }
    }

    /**
     * 处理创建问题命令
     */
    private async handleCreateCommand(
        prompt: string,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<void> {
        if (!prompt) {
            stream.markdown('❓ 请提供问题标题。例如: `/新建 修复登录bug`\n');
            return;
        }

        stream.progress('正在创建问题...');

        // 使用 LLM 优化标题
        let optimizedTitle = prompt;
        try {
            // 注意: VS Code 的 CancellationToken 与 AbortSignal 不完全兼容
            // 这里暂不传递 token,让 LLM 服务使用默认超时
            const generated = await LLMService.generateTitle(prompt);
            if (generated && !token.isCancellationRequested) {
                optimizedTitle = generated;
                stream.markdown(`💡 AI 优化标题: **${optimizedTitle}**\n\n`);
            }
        } catch (error) {
            // LLM 失败时使用原始输入
            console.log('[IssueChatParticipant] LLM 生成标题失败,使用原始输入', error);
        }

        // 创建问题文件
        const uri = await createIssueFile(optimizedTitle);
        
        if (uri) {
            const filename = path.basename(uri.fsPath);
            stream.markdown(`✅ 已创建问题: \`${filename}\`\n\n`);
            
            // 创建一个包含 resourceUri 的对象,符合 focusIssueFromIssueFile 命令的要求
            stream.button({
                command: 'issueManager.focusIssueFromIssueFile',
                arguments: [{ resourceUri: uri }],
                title: '⭐ 添加到关注'
            });
        } else {
            stream.markdown('❌ 创建问题失败\n');
        }
    }

    /**
     * 处理搜索问题命令
     */
    private async handleSearchCommand(
        prompt: string,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<void> {
        if (!prompt) {
            stream.markdown('❓ 请提供搜索关键词。例如: `/搜索 登录`\n');
            return;
        }

        stream.progress('正在搜索问题...');

        // 获取所有问题
        const allIssues = await getAllMarkdownIssues();
        
        // 简单的关键词匹配搜索
        const keyword = prompt.toLowerCase();
        const matchedIssues = allIssues.filter(issue => 
            issue.title.toLowerCase().includes(keyword) ||
            issue.filePath.toLowerCase().includes(keyword)
        );

        if (matchedIssues.length === 0) {
            stream.markdown(`🔍 没有找到包含 "${prompt}" 的问题\n`);
            return;
        }

        stream.markdown(`🔍 找到 **${matchedIssues.length}** 个相关问题:\n\n`);

        // 显示前10个结果
        const displayIssues = matchedIssues.slice(0, 10);
        displayIssues.forEach((issue, index) => {
            stream.markdown(`${index + 1}. **${issue.title}**\n`);
            stream.markdown(`   📁 \`${path.basename(issue.filePath)}\`\n\n`);
        });

        if (matchedIssues.length > 10) {
            stream.markdown(`\n_...还有 ${matchedIssues.length - 10} 个结果_\n\n`);
        }

        // 添加搜索按钮
        stream.button({
            command: 'issueManager.searchIssuesInFocused',
            title: '🔍 打开搜索面板'
        });
    }

    /**
     * 处理添加关注命令
     */
    private async handleFocusCommand(
        prompt: string,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<void> {
        if (!prompt) {
            stream.markdown('❓ 请提供问题文件名或 ID。例如: `/关注 20241118-123456-789.md`\n');
            return;
        }

        stream.progress('正在添加到关注列表...');

        // 搜索匹配的问题
        const allIssues = await getAllMarkdownIssues();
        const matchedIssue = allIssues.find(issue => 
            path.basename(issue.filePath).includes(prompt) ||
            issue.title.includes(prompt)
        );

        if (!matchedIssue) {
            stream.markdown(`❌ 未找到问题: "${prompt}"\n`);
            return;
        }

        try {
            // 添加到关注列表
            const issueDir = getIssueDir();
            if (!issueDir) {
                throw new Error('问题目录未配置');
            }

            const issueId = path.relative(issueDir, matchedIssue.filePath);
            await addFocus([issueId]);

            stream.markdown(`✅ 已将 **${matchedIssue.title}** 添加到关注列表\n\n`);
            
            // 刷新视图
            await vscode.commands.executeCommand('issueManager.refreshAllViews');

            // 添加操作按钮
            stream.button({
                command: 'issueManager.openFocusedView',
                title: '👀 查看关注列表'
            });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            stream.markdown(`❌ 添加关注失败: ${errorMessage}\n`);
        }
    }

    /**
     * 处理帮助命令
     */
    private handleHelpCommand(stream: vscode.ChatResponseStream): void {
        stream.markdown('# 问题管理器 - 帮助\n\n');
        stream.markdown('使用 `@issueManager` 在聊天中管理问题。\n\n');
        stream.markdown('## 📋 可用命令\n\n');
        
        stream.markdown('### `/新建` - 创建新问题\n');
        stream.markdown('创建一个新的问题文件,支持 AI 标题优化。\n\n');
        stream.markdown('**示例:**\n');
        stream.markdown('- `@issueManager /新建 修复登录bug`\n');
        stream.markdown('- `@issueManager /新建 优化首页加载速度`\n\n');

        stream.markdown('### `/搜索` - 搜索问题\n');
        stream.markdown('根据关键词搜索现有问题。\n\n');
        stream.markdown('**示例:**\n');
        stream.markdown('- `@issueManager /搜索 登录`\n');
        stream.markdown('- `@issueManager /搜索 性能`\n\n');

        stream.markdown('### `/关注` - 添加到关注列表\n');
        stream.markdown('将问题添加到关注列表。\n\n');
        stream.markdown('**示例:**\n');
        stream.markdown('- `@issueManager /关注 20241118-123456-789.md`\n');
        stream.markdown('- `@issueManager /关注 修复登录bug`\n\n');

        stream.markdown('### `/帮助` - 显示此帮助\n\n');

        stream.markdown('## 💡 智能模式\n\n');
        stream.markdown('不使用命令时,AI 会理解您的意图:\n');
        stream.markdown('- `@issueManager 创建一个关于性能优化的问题`\n');
        stream.markdown('- `@issueManager 帮我找找登录相关的问题`\n\n');

        // 添加快捷按钮
        stream.button({
            command: 'issueManager.openFocusedView',
            title: '👀 打开关注问题'
        });

        stream.button({
            command: 'issueManager.openRecentView',
            title: '🕐 打开最近问题'
        });
    }

    /**
     * 处理默认命令(无斜杠命令)
     * 使用 AI 理解用户意图
     */
    private async handleDefaultCommand(
        prompt: string,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<void> {
        if (!prompt) {
            this.handleHelpCommand(stream);
            return;
        }

        // 简单的意图识别
        const lowerPrompt = prompt.toLowerCase();

        // 检测创建意图
        const createTitle = detectIntent(prompt, INTENT_CONFIG.create.keywords, INTENT_CONFIG.create.noiseWords);
        if (createTitle) {
            stream.markdown(`💡 检测到创建意图...\n\n`);
            await this.handleCreateCommand(createTitle, stream, token);
            return;
        }

        // 检测搜索意图
        const searchKeyword = detectIntent(prompt, INTENT_CONFIG.search.keywords, INTENT_CONFIG.search.noiseWords);
        if (searchKeyword) {
            stream.markdown(`💡 检测到搜索意图...\n\n`);
            await this.handleSearchCommand(searchKeyword, stream, token);
            return;
        }

        // 检测关注意图
        if (INTENT_CONFIG.focus.keywords.some(keyword => lowerPrompt.includes(keyword))) {
            stream.markdown(`💡 检测到关注意图...\n\n`);
            stream.markdown('请使用命令: `/关注 [问题名称或文件名]`\n\n');
            return;
        }

        // 默认显示帮助
        stream.markdown('💡 我可以帮您管理问题。\n\n');
        stream.markdown('试试:\n');
        stream.markdown('- `/新建 [标题]` - 创建新问题\n');
        stream.markdown('- `/搜索 [关键词]` - 搜索问题\n');
        stream.markdown('- `/帮助` - 查看所有命令\n\n');
    }

    /**
     * 清理资源
     */
    public dispose(): void {
        if (this.participant) {
            this.participant.dispose();
        }
    }
}
