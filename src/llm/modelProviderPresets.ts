/**
 * 模型服务商预设配置
 *
 * 内置主流 OpenAI 兼容服务商的端点与展示信息，
 * 供"新增模型向导"快速填充 URL，避免用户手动输入错误。
 */

export interface ProviderPreset {
    /** 显示名称 */
    label: string;
    /** 服务商标识 */
    provider: 'openai' | 'ollama' | 'custom';
    /** API 基础 URL（不含 /v1/chat/completions） */
    baseUrl: string;
    /** 是否需要 API Key */
    requiresKey: boolean;
    /** 官网或文档链接，用于 tooltip */
    docsUrl?: string;
    /** API Key 管理后台（直达获取 Key 的页面） */
    dashboardUrl?: string;
    /** 补充说明 */
    description?: string;
}

/**
 * 各厂商知名模型的静态元数据表（上下文窗口 token 数 + 是否支持视觉）。
 * 用于在 wizard 选择模型后自动填充 contextWindow / supportsVision，
 * 避免依赖 /v1/models 端点（部分厂商不返回这些字段）。
 * 模型 ID 全小写匹配（toLowerCase）。
 */
export interface ModelStaticMeta {
    contextWindow: number;
    vision: boolean;
}

export const KNOWN_MODEL_META: Record<string, ModelStaticMeta> = {
    // ── OpenAI ────────────────────────────────────────────────
    'gpt-4o':                        { contextWindow: 128_000,  vision: true  },
    'gpt-4o-mini':                   { contextWindow: 128_000,  vision: true  },
    'gpt-4.1':                       { contextWindow: 1_047_576, vision: true  },
    'gpt-4.1-mini':                  { contextWindow: 1_047_576, vision: true  },
    'gpt-4.1-nano':                  { contextWindow: 1_047_576, vision: true  },
    'gpt-4-turbo':                   { contextWindow: 128_000,  vision: true  },
    'gpt-3.5-turbo':                 { contextWindow: 16_385,   vision: false },
    'o1':                            { contextWindow: 200_000,  vision: true  },
    'o1-mini':                       { contextWindow: 128_000,  vision: false },
    'o3':                            { contextWindow: 200_000,  vision: true  },
    'o3-mini':                       { contextWindow: 200_000,  vision: false },
    'o4-mini':                       { contextWindow: 200_000,  vision: true  },
    // ── Anthropic ─────────────────────────────────────────────
    'claude-opus-4-5':               { contextWindow: 200_000,  vision: true  },
    'claude-sonnet-4-5':             { contextWindow: 200_000,  vision: true  },
    'claude-haiku-4-5':              { contextWindow: 200_000,  vision: true  },
    'claude-3-5-sonnet-20241022':    { contextWindow: 200_000,  vision: true  },
    'claude-3-5-haiku-20241022':     { contextWindow: 200_000,  vision: true  },
    'claude-3-opus-20240229':        { contextWindow: 200_000,  vision: true  },
    // ── DeepSeek ──────────────────────────────────────────────
    'deepseek-chat':                 { contextWindow: 64_000,   vision: false },
    'deepseek-reasoner':             { contextWindow: 64_000,   vision: false },
    'deepseek-v3':                   { contextWindow: 64_000,   vision: false },
    'deepseek-v3-0324':              { contextWindow: 64_000,   vision: false },
    'deepseek-v2.5':                 { contextWindow: 128_000,  vision: false },
    'deepseek-r1':                   { contextWindow: 64_000,   vision: false },
    // ── Groq ──────────────────────────────────────────────────
    'llama3-70b-8192':               { contextWindow: 8_192,    vision: false },
    'llama-3.3-70b-versatile':       { contextWindow: 128_000,  vision: false },
    'llama-3.1-8b-instant':          { contextWindow: 128_000,  vision: false },
    'mixtral-8x7b-32768':            { contextWindow: 32_768,   vision: false },
    'gemma2-9b-it':                  { contextWindow: 8_192,    vision: false },
    // ── Moonshot (Kimi) ───────────────────────────────────────
    'moonshot-v1-8k':                { contextWindow: 8_000,    vision: false },
    'moonshot-v1-32k':               { contextWindow: 32_000,   vision: false },
    'moonshot-v1-128k':              { contextWindow: 128_000,  vision: false },
    'kimi-k2':                       { contextWindow: 128_000,  vision: false },
    // ── Together AI ───────────────────────────────────────────
    'meta-llama/llama-4-maverick-17b-128e-instruct-fp8': { contextWindow: 524_288, vision: true },
    'meta-llama/llama-4-scout-17b-16e-instruct':         { contextWindow: 131_072, vision: true },
    'meta-llama/llama-3.3-70b-instruct-turbo':           { contextWindow: 131_072, vision: false },
    // ── OpenRouter (常见转发) ─────────────────────────────────
    'google/gemini-2.5-pro-preview': { contextWindow: 1_048_576, vision: true },
    'google/gemini-2.0-flash-001':   { contextWindow: 1_048_576, vision: true },
    'mistralai/mistral-large':       { contextWindow: 128_000,  vision: false },
    'qwen/qwen3-235b-a22b':          { contextWindow: 40_960,   vision: false },
};

/** 内置服务商预设列表 */
export const PROVIDER_PRESETS: ProviderPreset[] = [
    {
        label: 'OpenAI',
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        requiresKey: true,
        docsUrl: 'https://platform.openai.com/docs',
        dashboardUrl: 'https://platform.openai.com/api-keys',
        description: 'GPT-4o / GPT-5 等官方模型',
    },
    {
        label: 'DeepSeek',
        provider: 'custom',
        baseUrl: 'https://api.deepseek.com/v1',
        requiresKey: true,
        docsUrl: 'https://api-docs.deepseek.com/',
        dashboardUrl: 'https://platform.deepseek.com/api_keys',
        description: 'DeepSeek-V3 / R1（含思考模式）',
    },
    {
        label: 'Groq（超快推理）',
        provider: 'custom',
        baseUrl: 'https://api.groq.com/openai/v1',
        requiresKey: true,
        docsUrl: 'https://console.groq.com/docs/openai',
        dashboardUrl: 'https://console.groq.com/keys',
        description: 'LLaMA / Mixtral 等，极低延迟',
    },
    {
        label: 'Together AI',
        provider: 'custom',
        baseUrl: 'https://api.together.xyz/v1',
        requiresKey: true,
        docsUrl: 'https://docs.together.ai/',
        dashboardUrl: 'https://api.together.ai/settings/api-keys',
        description: '多种开源模型托管服务',
    },
    {
        label: 'Moonshot（月之暗面）',
        provider: 'custom',
        baseUrl: 'https://api.moonshot.cn/v1',
        requiresKey: true,
        docsUrl: 'https://platform.moonshot.cn/docs',
        dashboardUrl: 'https://platform.moonshot.cn/console/api-keys',
        description: 'Kimi 系列模型，长上下文',
    },
    {
        label: 'OpenRouter',
        provider: 'custom',
        baseUrl: 'https://openrouter.ai/api/v1',
        requiresKey: true,
        docsUrl: 'https://openrouter.ai/docs',
        dashboardUrl: 'https://openrouter.ai/settings/keys',
        description: '聚合路由：200+ 模型统一接口',
    },
    {
        label: 'Azure OpenAI',
        provider: 'openai',
        baseUrl: 'https://<your-resource>.openai.azure.com/openai/deployments/<deployment>',
        requiresKey: true,
        docsUrl: 'https://learn.microsoft.com/azure/ai-services/openai/',
        dashboardUrl: 'https://portal.azure.com/#view/Microsoft_Azure_ProjectOxford/CognitiveServicesHub',
        description: '企业部署，需替换 <your-resource> 和 <deployment>',
    },
    {
        label: 'Ollama（本地）',
        provider: 'ollama',
        baseUrl: 'http://localhost:11434',
        requiresKey: false,
        docsUrl: 'https://ollama.ai/',
        description: '本地运行，无需 API Key',
    },
    {
        label: 'LM Studio（本地）',
        provider: 'custom',
        baseUrl: 'http://localhost:1234/v1',
        requiresKey: false,
        docsUrl: 'https://lmstudio.ai/',
        description: '本地 OpenAI 兼容服务器',
    },
    {
        label: '手动输入 URL…',
        provider: 'custom',
        baseUrl: '',
        requiresKey: true,
        description: '自定义任意 OpenAI 兼容端点',
    },
];
