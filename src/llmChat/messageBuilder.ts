/**
 * 对话消息构建模块
 *
 * 将 uri + role 组装为 LLM 请求所需的 messages 数组。
 * LLMChatService（UI 交互路径）和 RoleTimerManager（定时器路径）共用此实现。
 *
 * 上下文策略：contextPipeline — 角色声明所需上下文，管道并行获取并组装。
 * 视觉支持：扫描消息中 ![alt](images/xxx) 引用，若模型支持视觉则转为 DataPart，否则降级文本。
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import {
    getRoleSystemPrompt,
    getConversationConfig,
    parseConversationMessages,
    estimateTokens,
    getChatRoleById,
} from './llmChatDataManager';
import type { ChatRoleInfo } from './types';
import { runContextPipeline } from './contextPipeline';
import { ImageStorageService } from '../services/storage/ImageStorageService';
import { ModelRegistry } from '../llm/ModelRegistry';

/**
 * 为单角色对话构建 LLM 请求消息列表。
 *
 * 当历史 token 超过 maxTokens 的 70% 时，启用滑动窗口截断：
 *   保留第 1 轮（原始任务）+ 最近 N 轮，中间插入省略占位符。
 */
export async function buildConversationMessages(
    uri: vscode.Uri,
    role: ChatRoleInfo,
): Promise<vscode.LanguageModelChatMessage[]> {
    // ─── 基础数据 ────────────────────────────────────────────
    const prompt = await getRoleSystemPrompt(role.uri);
    const convoConfig = await getConversationConfig(uri);
    const autonomous = convoConfig?.autonomous ?? role.autonomous ?? false;
    const history = await parseConversationMessages(uri);

    let identity = prompt || '你是一个智能助手，请根据对话上下文给出有帮助的回复。';

    // ─── 群组协调者：注入成员名称列表 ────────────────────────
    if (role.groupMembers?.length) {
        const members = role.groupMembers
            .map(id => getChatRoleById(id))
            .filter((r): r is ChatRoleInfo => !!r);
        if (members.length) {
            const memberList = members.map(m => `- ${m.name}`).join('\n');
            identity += `\n\n## 你的团队成员\n${memberList}\n\n调用 ask_group_member 时，memberName 必须是以上名称之一（精确匹配）。`;
        }
    }

    // ─── 上下文管道 ──────────────────────────────────────────
    const effectiveModelFamily = convoConfig?.modelFamily || role.modelFamily;
    const modelDescriptor = await ModelRegistry.resolve(effectiveModelFamily);
    const contextWindow = modelDescriptor?.contextWindow;
    const latestUserMessage = getLatestUserMessage(history);
    const result = await runContextPipeline(
        identity,
        uri,
        role,
        convoConfig,
        autonomous,
        latestUserMessage,
        history.length > 0,
        contextWindow,
    );

    const systemMsg = vscode.LanguageModelChatMessage.User(result.systemPrompt);

    // ─── 历史消息 ─────────────────────────────────────────────
    const rounds = groupRounds(history);

    // 无 contextWindow 限制 或 轮次 ≤ 3 时，不截断
    if (!contextWindow || rounds.length <= 3) {
        return [systemMsg, ...roundsToMessages(rounds)];
    }

    // 预估全量 token
    const fullMsgs = [systemMsg, ...roundsToMessages(rounds)];
    const fullTokens = await estimateTokens(fullMsgs);
    const threshold = contextWindow * 0.7;

    if (fullTokens <= threshold) {
        return fullMsgs;
    }

    // 截断：保留第 1 轮 + 最近 N 轮，逐步增加 N 直到接近阈值
    const firstRound = rounds[0];
    let bestN = 1;

    for (let n = 1; n < rounds.length; n++) {
        const tail = rounds.slice(-n);
        const candidate = [
            systemMsg,
            ...roundsToMessages([firstRound]),
            vscode.LanguageModelChatMessage.User(`[...已省略 ${rounds.length - 1 - n} 轮对话...]`),
            ...roundsToMessages(tail),
        ];
        const est = await estimateTokens(candidate);
        if (est > threshold) { break; }
        bestN = n;
    }

    const kept = rounds.slice(-bestN);
    const omitted = rounds.length - 1 - bestN;
    const msgs = [systemMsg, ...roundsToMessages([firstRound])];
    if (omitted > 0) {
        msgs.push(vscode.LanguageModelChatMessage.User(`[...已省略 ${omitted} 轮对话...]`));
    }
    msgs.push(...roundsToMessages(kept));

    return msgs;
}

// ━━━ 辅助函数 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface ChatMsg { role: 'user' | 'assistant'; content: string }
interface Round { user: ChatMsg; assistant?: ChatMsg }

/** 从历史消息中提取最新用户消息（用于意图分类） */
function getLatestUserMessage(history: ChatMsg[]): string {
    for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].role === 'user') { return history[i].content; }
    }
    return '';
}

/** 将消息按轮次分组（一组 = user + assistant） */
function groupRounds(history: ChatMsg[]): Round[] {
    const rounds: Round[] = [];
    for (let i = 0; i < history.length; i++) {
        const m = history[i];
        if (m.role === 'user') {
            const next = history[i + 1];
            if (next?.role === 'assistant') {
                rounds.push({ user: m, assistant: next });
                i++;
            } else {
                rounds.push({ user: m });
            }
        }
    }
    return rounds;
}

/** 将轮次数组转为 LanguageModelChatMessage 数组（含视觉多模态支持） */
function roundsToMessages(rounds: Round[]): vscode.LanguageModelChatMessage[] {
    const msgs: vscode.LanguageModelChatMessage[] = [];
    for (const r of rounds) {
        msgs.push(buildUserMessage(r.user.content));
        if (r.assistant) {
            msgs.push(vscode.LanguageModelChatMessage.Assistant(r.assistant.content));
        }
    }
    return msgs;
}

// ── 视觉多模态辅助 ────────────────────────────────────────────────────────────

/** 检测 VSCode API 是否支持 LanguageModelDataPart（视觉能力需要 VSCode 1.93+） */
function isDataPartSupported(): boolean {
    return typeof (vscode as Record<string, unknown>)['LanguageModelDataPart'] !== 'undefined';
}

/**
 * 将消息文本中的 Markdown 图片引用解析为内嵌图片列表。
 * 仅处理 `ImageDir/xxx.png` 别名格式（由 ImageStorageService 管理），其他路径格式原样保留。
 * @param text - 原始消息文本
 * @returns 解析结果：{ cleanText（去图片后的文本）, imageParts（图片数据列表） }
 */
function parseImageRefsFromText(text: string): {
    cleanText: string;
    imageParts: Array<{ data: Uint8Array; mimeType: string; ref: string }>;
} {
    const IMAGE_REF_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;
    const imageParts: Array<{ data: Uint8Array; mimeType: string; ref: string }> = [];
    const cleanText = text.replace(IMAGE_REF_RE, (_match, _alt, imgPath: string) => {
        const imgPathTrimmed = imgPath.trim();
        // 只处理 ImageDir/ 别名格式，其余（http、相对路径等）原样保留
        const uri = ImageStorageService.resolve(imgPathTrimmed);
        if (!uri) { return _match; }
        const ext = imgPathTrimmed.split('.').pop()?.toLowerCase() ?? 'png';
        if (ext === 'svg') {
            // SVG 是矢量文本，视觉模型不支持 DataPart；展开为内联代码块让 LLM 读取图表结构
            try {
                const svgContent = fs.readFileSync(uri.fsPath, 'utf-8');
                const filename = imgPathTrimmed.split('/').pop() ?? imgPathTrimmed;
                return `\n\`\`\`svg\n<!-- ${filename} -->\n${svgContent}\n\`\`\`\n`;
            } catch {
                return `[SVG 图表: ${imgPathTrimmed}]`;
            }
        }
        try {
            const data = fs.readFileSync(uri.fsPath);
            const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
            imageParts.push({ data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), mimeType, ref: imgPathTrimmed });
            return ''; // 图片引用从文本中移除（将作为 DataPart 传入）
        } catch {
            return `[图片: ${imgPathTrimmed}]`;
        }
    }).trim();
    return { cleanText, imageParts };
}

/**
 * 构建用户消息，自动检测是否需要视觉多模态。
 * 若 API 支持且消息含 ImageDir/ 图片引用，则返回含 DataPart 的多模态消息；否则返回纯文本消息。
 */
function buildUserMessage(content: string): vscode.LanguageModelChatMessage {
    if (!isDataPartSupported()) {
        return vscode.LanguageModelChatMessage.User(content);
    }
    const { cleanText, imageParts } = parseImageRefsFromText(content);
    if (imageParts.length === 0) {
        return vscode.LanguageModelChatMessage.User(content);
    }

    // 构建多模态 parts 数组
    const vscodeAny = vscode as unknown as Record<string, { image: (data: Uint8Array, mimeType: string) => unknown } & (new (value: string) => unknown)>;
    const DataPartClass = vscodeAny['LanguageModelDataPart'] as { image: (data: Uint8Array, mimeType: string) => unknown };
    const TextPartClass = vscodeAny['LanguageModelTextPart'] as new (value: string) => unknown;
    const parts: unknown[] = [];
    if (cleanText) {
        parts.push(new TextPartClass(cleanText));
    }
    for (const img of imageParts) {
        parts.push(DataPartClass.image(img.data, img.mimeType));
    }
    return vscode.LanguageModelChatMessage.User(parts as Parameters<typeof vscode.LanguageModelChatMessage.User>[0]);
}
