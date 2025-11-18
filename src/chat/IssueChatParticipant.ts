import * as vscode from 'vscode';
import { getIssueDir } from '../config';
import { createIssueFile } from '../commands/issueFileUtils';
import { LLMService } from '../llm/LLMService';
import { getFlatTree } from '../data/treeManager';
import * as path from 'path';
import { Logger } from '../core/utils/Logger';

/**
 * 命令别名常量定义
 */
const CREATE_COMMANDS = ['新建', 'new', 'create'] as const;
const SEARCH_COMMANDS = ['搜索', 'search', 'find'] as const;
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

        // 扁平化树节点（已包含标题）
        const flatNodes =  await getFlatTree();
        
        // 关键词匹配搜索：标题、文件路径、父节点标题
        const keyword = prompt.toLowerCase();
        const matchedIssueNodes = flatNodes.filter(node => {
            // 匹配标题
            if (node.title.toLowerCase().includes(keyword)) {
                return true;
            }
            // 匹配文件路径
            if (node.filePath.toLowerCase().includes(keyword)) {
                return true;
            }
            // 匹配父节点标题（分组标题）
            if (node.parentPath.some(parent => parent.title.toLowerCase().includes(keyword))) {
                return true;
            }
            return false;
        });

        if (matchedIssueNodes.length === 0) {
            stream.markdown(`🔍 没有找到包含 "${prompt}" 的问题\n`);
            return;
        }

        stream.markdown(`🔍 找到 **${matchedIssueNodes.length}** 个相关问题:\n\n`);

        // 显示前10个结果
        const displayIssues = matchedIssueNodes.slice(0, 10);
        displayIssues.forEach((issue, index) => {
            stream.markdown(`${index + 1}. **${issue.title}**\n`);
            
            // 显示父节点信息
            if (issue.parentPath.length > 0) {
            const parentTitles = issue.parentPath.map(parent => parent.title).join(' > ');
            stream.markdown(`${parentTitles}\n`);
            }
        });

        if (matchedIssueNodes.length > 10) {
            stream.markdown(`\n_...还有 ${matchedIssueNodes.length - 10} 个结果_\n\n`);
        }

        // 添加搜索按钮
        stream.button({
            command: 'issueManager.searchIssuesInFocused',
            title: '🔍 打开搜索面板'
        });
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
