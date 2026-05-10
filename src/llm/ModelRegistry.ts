/**
 * 模型注册表
 *
 * 统一管理 Copilot 动态模型与用户自定义模型（OpenAI 兼容 / Ollama），
 * 以 "<provider>/<modelId>" 为唯一标识，提供模型查找、能力描述、禁用状态与 API Key 的安全存储。
 * 所有上层模块通过此注册表获取模型描述，不直接调用 vscode.lm.selectChatModels。
 */
import * as vscode from 'vscode';

// ─── 模型描述符 ──────────────────────────────────────────────

/** 模型提供方 */
export type ModelProvider = 'copilot' | 'openai' | 'ollama' | 'custom';

/** 思考/推理预算档位（适用于 o-series、Claude Extended Thinking、DeepSeek-R1 等） */
export type ThinkingBudget = 'low' | 'medium' | 'high';

/** 模型能力标志 */
export interface ModelCapabilities {
    /** 支持视觉（图片输入） */
    supportsVision?: boolean;
    /** 支持工具/函数调用 */
    supportsTools?: boolean;
    /** 支持思考/推理模式（CoT 预算） */
    supportsThinking?: boolean;
    /** 思考档位（low/medium/high），仅当 supportsThinking=true 时有效 */
    thinkingBudget?: ThinkingBudget;
    /**
     * Copilot 请求倍率（相对基准 1x）。
     * 仅 Copilot 模型有意义，自定义模型可留空。
     * 数据来源：GitHub Copilot 官方文档 "Models available in Copilot" 表格。
     */
    requestMultiplier?: number;
}

/**
 * 统一模型描述符。
 * Copilot 模型由运行时动态枚举填充；自定义模型由用户在 settings 中配置。
 */
export interface ModelDescriptor {
    /**
     * 全局唯一标识，格式 "<provider>/<modelId>"。
     * 例如：copilot/gpt-4.1、openai/gpt-4o、ollama/qwen3:14b
     */
    id: string;
    /** 用户可读的显示名称 */
    displayName: string;
    /** 提供方 */
    provider: ModelProvider;
    /**
     * API endpoint（仅自定义模型需要）。
     * - openai 兼容：如 https://api.openai.com/v1
     * - ollama：如 http://localhost:11434
     * - 安全限制：只允许 http://localhost 或 https:// 前缀
     */
    endpoint?: string;
    /** 发送给 API 的 model 参数（Copilot 模型此字段等于 family name） */
    model: string;
    /**
     * 上下文窗口大小（tokens）。
     * Copilot 模型从 vscode.LanguageModelChat.maxInputTokens 读取；
     * 自定义模型在配置时手动填写或通过 /v1/models 端点自动获取。
     * 用于驱动消息历史滑动窗口截断，不作为花费门禁。
     */
    contextWindow?: number;
    /** 模型能力标志与倍率 */
    capabilities?: ModelCapabilities;
    /** 是否已被用户禁用（禁用后不参与模型选择与路由，但仍显示在树视图中） */
    disabled?: boolean;
}

/** settings 中 issueManager.llm.customModels 数组的单个条目 */
export interface CustomModelSetting {
    id: string;
    displayName?: string;
    provider: ModelProvider;
    endpoint?: string;
    model: string;
    contextWindow?: number;
    /** 是否禁用（禁用后不出现在选择列表中） */
    disabled?: boolean;
    /** 思考模式默认档位 */
    thinkingBudget?: ThinkingBudget;
    /** 是否支持视觉（图片输入），向导时从静态表自动填充 */
    supportsVision?: boolean;
}

// ─── Copilot 已知倍率与能力表（来自官方文档） ────────────────────

/**
 * 已知 Copilot 模型的静态元数据（倍率 + 能力）。
 * 与运行时 vscode.lm 枚举结果合并，丰富树视图信息。
 * 数据基于 GitHub Copilot 官方文档 "Models available in Copilot" 表格。
 */
const COPILOT_MODEL_METADATA: Record<string, { multiplier?: number; vision?: boolean; thinking?: boolean; contextWindow?: number }> = {
    // ── Claude ────────────────────────────────────────────────
    'claude-haiku-4.5':       { multiplier: 0.33, vision: true,  contextWindow: 163_840 },
    'claude-opus-4.7':        { multiplier: 7.5,  vision: true,  contextWindow: 196_608 },
    'claude-sonnet-4':        { multiplier: 1,    vision: true,  contextWindow: 147_456 },
    'claude-sonnet-4.5':      { multiplier: 1,    vision: true,  contextWindow: 163_840 },
    'claude-sonnet-4.6':      { multiplier: 1,    vision: true,  contextWindow: 163_840 },
    // ── Gemini ────────────────────────────────────────────────
    'gemini-2.5-pro':         { multiplier: 1,    vision: true,  contextWindow: 177_152 },
    'gemini-3-flash':         { multiplier: 0.33, vision: true,  contextWindow: 177_152 },
    'gemini-3.1-pro-preview': { multiplier: 1,    vision: true,  contextWindow: 177_152 },
    // ── GPT ───────────────────────────────────────────────────
    'gpt-4.1':                { multiplier: 0,    vision: true,  contextWindow: 131_072 },
    'gpt-4o':                 { multiplier: 0,    vision: true,  contextWindow: 69_632  },
    'gpt-5-mini':             { multiplier: 1,    vision: true,  contextWindow: 196_608 },
    'gpt-5.2':                { multiplier: 1,    vision: true,  contextWindow: 196_608 },
    'gpt-5.2-codex':          { multiplier: 1,    vision: true,  contextWindow: 409_600 },
    'gpt-5.3-codex':          { multiplier: 1,    vision: true,  contextWindow: 409_600 },
    'gpt-5.4':                { multiplier: 1,    vision: true,  contextWindow: 409_600 },
    'gpt-5.4-mini':           { multiplier: 0.33, vision: true,  contextWindow: 409_600 },
    'gpt-5.5':                { multiplier: 7.5,  vision: true,  contextWindow: 409_600 },
    // ── Grok / Raptor ─────────────────────────────────────────
    'grok-code':              { multiplier: 0.25,               contextWindow: 177_152 },
    'grok-code-fast-1':       { multiplier: 0.25,               contextWindow: 177_152 },
    'raptor-mini':            { multiplier: 0,    vision: true,  contextWindow: 270_336 },
    // ── 推理模型 ───────────────────────────────────────────────
    'o1':                     { multiplier: 1,    vision: true,  thinking: true },
    'o3':                     { multiplier: 1,    vision: true,  thinking: true },
    'o3-mini':                { multiplier: 1,                   thinking: true },
    'o4-mini':                { multiplier: 1,                   thinking: true },
};

// ─── 注册表 ──────────────────────────────────────────────────

/**
 * 模型注册表（单例）。
 * 使用 ExtensionContext.secrets 存储 API Key，确保不泄漏到 settings.json。
 */
export class ModelRegistry {
    private static _secrets: vscode.SecretStorage | undefined;

    /**
     * 初始化注册表，注入 ExtensionContext.secrets。
     * 应在 extension.ts activate() 中调用一次。
     * @param secrets - VS Code SecretStorage 实例
     */
    static init(secrets: vscode.SecretStorage): void {
        ModelRegistry._secrets = secrets;
    }

    /**
     * 获取所有可用模型（Copilot 动态模型 + settings 中的自定义模型，含禁用项）。
     * 如需过滤禁用模型，使用 getAllActive()。
     * @returns 全部模型描述符列表
     */
    static async getAll(): Promise<ModelDescriptor[]> {
        const copilotModels = await ModelRegistry._getCopilotModels();
        const customModels = ModelRegistry._getCustomModels();
        return [...copilotModels, ...customModels];
    }

    /**
     * 获取所有未禁用的可用模型。
     * @returns 过滤掉 disabled=true 后的模型列表
     */
    static async getAllActive(): Promise<ModelDescriptor[]> {
        const all = await ModelRegistry.getAll();
        return all.filter(m => !m.disabled);
    }

    /**
     * 根据模型 ID 查找描述符。
     * @param id - 模型 ID（格式 "<provider>/<modelId>"）
     * @returns 匹配的 ModelDescriptor，未找到时返回 undefined
     */
    static async getById(id: string): Promise<ModelDescriptor | undefined> {
        const all = await ModelRegistry.getAll();
        return all.find(m => m.id === id);
    }

    /**
     * 根据角色/对话的 modelFamily 字符串解析出实际描述符。
     * 若 modelFamily 为空，则使用全局默认配置中的模型。
     * @param modelFamily - 角色或对话配置的 modelFamily 字符串
     * @returns 解析到的 ModelDescriptor，未找到时返回 undefined
     */
    static async resolve(modelFamily?: string): Promise<ModelDescriptor | undefined> {
        const family = modelFamily
            || vscode.workspace.getConfiguration('issueManager').get<string>('llm.modelFamily')
            || 'copilot/gpt-5-mini';
        return ModelRegistry.getById(family);
    }

    /**
     * 构建 API Key 在 SecretStorage 中的 key 名。
     * 同服务商不同端点使用不同 key（通过 base64(endpoint) 前 12 位区分）。
     * @param provider - 提供方标识
     * @param endpoint - API endpoint URL（可选）
     * @returns SecretStorage 中的 key 名
     */
    static buildApiKeyName(provider: string, endpoint?: string): string {
        return endpoint
            ? `${provider}-${Buffer.from(endpoint).toString('base64').slice(0, 12)}`
            : provider;
    }

    /**
     * 将 API Key 写入 VS Code SecretStorage。
     * Key 格式："issueManager.llm.apiKey.<provider>"
     * @param provider - 提供方标识（如 'openai', 'anthropic'）
     * @param key - API Key 明文
     */
    static async saveApiKey(provider: string, key: string): Promise<void> {
        if (!ModelRegistry._secrets) { throw new Error('ModelRegistry 未初始化，请先调用 ModelRegistry.init()'); }
        await ModelRegistry._secrets.store(`issueManager.llm.apiKey.${provider}`, key);
    }

    /**
     * 从 SecretStorage 读取 API Key。
     * @param provider - 提供方标识
     * @returns API Key 明文，未设置时返回 undefined
     */
    static async getApiKey(provider: string): Promise<string | undefined> {
        if (!ModelRegistry._secrets) { return undefined; }
        return ModelRegistry._secrets.get(`issueManager.llm.apiKey.${provider}`);
    }

    /**
     * 读取 API Key 并返回脱敏字符串（首 6 位 + *** + 末 4 位）。
     * @param provider - 提供方标识
     * @param endpoint - API endpoint URL（可选，用于构造 key 名）
     * @returns 脱敏 key 字符串，未配置时返回 undefined
     */
    static async getApiKeyMasked(provider: string, endpoint?: string): Promise<string | undefined> {
        const keyName = ModelRegistry.buildApiKeyName(provider, endpoint);
        const raw = await ModelRegistry.getApiKey(keyName);
        if (!raw) { return undefined; }
        if (raw.length <= 10) { return '****'; }
        return `${raw.slice(0, 6)}${'*'.repeat(Math.min(raw.length - 10, 20))}${raw.slice(-4)}`;
    }

    /**
     * 删除指定提供方的 API Key。
     * @param provider - 提供方标识
     */
    static async deleteApiKey(provider: string): Promise<void> {
        if (!ModelRegistry._secrets) { return; }
        await ModelRegistry._secrets.delete(`issueManager.llm.apiKey.${provider}`);
    }

    /**
     * 将指定模型 ID 设置为全局默认模型。
     * @param modelId - 格式 "<provider>/<modelId>" 的模型 ID
     */
    static async setDefaultModel(modelId: string): Promise<void> {
        await vscode.workspace.getConfiguration('issueManager')
            .update('llm.modelFamily', modelId, vscode.ConfigurationTarget.Global);
    }

    /**
     * 切换指定模型的禁用状态（toggle）。
     * Copilot 模型的禁用通过 issueManager.llm.disabledCopilotModels 列表管理。
     * @param modelId - 要切换的模型 ID
     */
    static async toggleDisabled(modelId: string): Promise<void> {
        const all = await ModelRegistry.getAll();
        const descriptor = all.find(m => m.id === modelId);
        if (!descriptor) { return; }

        if (descriptor.provider === 'copilot') {
            const config = vscode.workspace.getConfiguration('issueManager');
            const blocked = config.get<string[]>('llm.disabledCopilotModels') ?? [];
            const familyOrId = descriptor.model;
            const newBlocked = blocked.includes(familyOrId)
                ? blocked.filter(x => x !== familyOrId)
                : [...blocked, familyOrId];
            await config.update('llm.disabledCopilotModels', newBlocked, vscode.ConfigurationTarget.Global);
        } else {
            const config = vscode.workspace.getConfiguration('issueManager');
            const customs = config.get<CustomModelSetting[]>('llm.customModels') ?? [];
            const updated = customs.map(m => {
                if (m.id === modelId) { return { ...m, disabled: !m.disabled }; }
                return m;
            });
            await config.update('llm.customModels', updated, vscode.ConfigurationTarget.Global);
        }
    }

    /**
     * 将新自定义模型追加到 issueManager.llm.customModels 设置中。
     * @param setting - 要追加的自定义模型配置
     */
    static async addCustomModel(setting: CustomModelSetting): Promise<void> {
        const config = vscode.workspace.getConfiguration('issueManager');
        const customs = config.get<CustomModelSetting[]>('llm.customModels') ?? [];
        const filtered = customs.filter(m => m.id !== setting.id);
        await config.update('llm.customModels', [...filtered, setting], vscode.ConfigurationTarget.Global);
    }

    /**
     * 从 issueManager.llm.customModels 中删除指定 ID 的自定义模型。
     * @param modelId - 要删除的模型 ID
     */
    static async deleteCustomModel(modelId: string): Promise<void> {
        const config = vscode.workspace.getConfiguration('issueManager');
        const customs = config.get<CustomModelSetting[]>('llm.customModels') ?? [];
        const updated = customs.filter(m => m.id !== modelId);
        await config.update('llm.customModels', updated, vscode.ConfigurationTarget.Global);
    }

    /**
     * 通过 HTTP 请求远程端点的 /v1/models，返回可用模型 ID 列表。
     * 适用于 OpenAI 兼容 API；Ollama 也支持此端点。
     * @param baseUrl - 服务基础 URL（如 https://api.openai.com/v1 或 http://localhost:11434）
     * @param apiKey - API Key，Ollama 等本地服务可传空字符串
     * @returns 模型 ID 与上下文窗口列表，请求失败时返回空数组
     */
    static async fetchRemoteModels(baseUrl: string, apiKey: string): Promise<Array<{ id: string; context_window?: number }>> {
        try {
            const clean = baseUrl.replace(/\/$/, '');
            const modelsUrl = clean.endsWith('/v1') ? `${clean}/models` : `${clean}/v1/models`;
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            if (apiKey) { headers['Authorization'] = `Bearer ${apiKey}`; }
            const resp = await fetch(modelsUrl, { headers, signal: AbortSignal.timeout(8000) });
            if (!resp.ok) { return []; }
            const data = await resp.json() as { data?: Array<{ id: string; context_window?: number }> };
            return data.data ?? [];
        } catch {
            return [];
        }
    }

    // ─── 内部方法 ─────────────────────────────────────────────

    /** 从 vscode.lm API 枚举 Copilot 模型，按 family 去重，合并静态元数据 */
    private static async _getCopilotModels(): Promise<ModelDescriptor[]> {
        try {
            const raw = await vscode.lm.selectChatModels({ vendor: 'copilot' });
            const familyMap = new Map<string, vscode.LanguageModelChat>();
            for (const m of raw) {
                const ex = familyMap.get(m.family);
                if (!ex || m.maxInputTokens > ex.maxInputTokens) {
                    familyMap.set(m.family, m);
                }
            }
            const config = vscode.workspace.getConfiguration('issueManager');
            const disabledList = config.get<string[]>('llm.disabledCopilotModels') ?? [];

            return [...familyMap.values()]
                .sort((a, b) => a.family.localeCompare(b.family))
                .map(m => {
                    const meta = COPILOT_MODEL_METADATA[m.family];
                    const caps: ModelCapabilities = {
                        supportsVision: meta?.vision ?? false,
                        supportsTools: true,
                        supportsThinking: meta?.thinking ?? false,
                        requestMultiplier: meta?.multiplier,
                    };
                    return {
                        id: `copilot/${m.family}`,
                        displayName: m.family,
                        provider: 'copilot' as ModelProvider,
                        model: m.family,
                        // 优先使用运行时 maxInputTokens，静态表作后备
                        contextWindow: m.maxInputTokens || meta?.contextWindow,
                        capabilities: caps,
                        disabled: disabledList.includes(m.family),
                    };
                });
        } catch {
            return [];
        }
    }

    /**
     * 从 settings 读取自定义模型列表（公开版本）。
     * 供 IssueManagerLMProvider 等外部模块直接读取，无需触发 Copilot 模型枚举。
     * @returns 自定义模型描述符列表（含禁用项）
     */
    static getCustomModelDescriptors(): ModelDescriptor[] {
        return ModelRegistry._getCustomModels();
    }

    /** 从 settings 读取自定义模型列表，推断能力标志 */
    private static _getCustomModels(): ModelDescriptor[] {
        const config = vscode.workspace.getConfiguration('issueManager');
        const raw = config.get<CustomModelSetting[]>('llm.customModels') ?? [];
        return raw
            .filter(m => m.id && m.provider && m.model)
            .map(m => {
                const modelLower = m.model.toLowerCase();
                const supportsThinking = m.thinkingBudget !== undefined
                    || /o1|o3|o4|thinking|r1|reasoner/.test(modelLower);
                // supportsVision: 优先用向导写入的静态值，回退到模型名正则推断
                const visionByName = /vision|vl|4o|claude|gemini|gpt-4/.test(modelLower);
                const caps: ModelCapabilities = {
                    supportsVision: m.supportsVision ?? visionByName,
                    supportsTools: true,
                    supportsThinking,
                    thinkingBudget: m.thinkingBudget,
                };
                return {
                    id: m.id,
                    displayName: m.displayName || m.model,
                    provider: m.provider,
                    endpoint: m.endpoint,
                    model: m.model,
                    contextWindow: m.contextWindow,
                    capabilities: caps,
                    disabled: m.disabled ?? false,
                };
            });
    }
}
