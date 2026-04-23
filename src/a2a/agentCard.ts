/**
 * Agent Card 构造：从 ChatRoleInfo + A2A 暴露配置生成符合 A2A v1.0 spec 的 agent card。
 *
 * v1.0 变更：顶层 `url` 改为 `supportedInterfaces` 数组（§4.4.6），每个接口声明
 * `protocolBinding`（JSONRPC）与 `protocolVersion`（1.0）。
 * 未设置 `a2a.expose: true` 的角色会被 listExposedRoles() 排除。
 */
import type { ChatRoleInfo, A2AExposeConfig } from '../llmChat/types';
import { getAllChatRoles } from '../llmChat/llmChatDataManager';

/** A2A spec 中 agent skill 字段形状（用于对外输出） */
interface AgentSkillCard {
    id: string;
    name: string;
    description: string;
    tags?: string[];
    examples?: string[];
}

/** A2A v1.0 §4.4.6 - AgentInterface */
interface AgentInterface {
    url: string;
    protocolBinding: string;
    protocolVersion: string;
}

/** A2A v1.0 §4.4.3 - AgentCapabilities */
interface AgentCapabilities {
    streaming: boolean;
    pushNotifications: boolean;
    extendedAgentCard?: boolean;
}

/** A2A v1.0 §4.4.1 - AgentCard */
export interface AgentCard {
    name: string;
    description: string;
    /** v1.0：使用 supportedInterfaces 替代顶层 url */
    supportedInterfaces: AgentInterface[];
    version: string;
    capabilities: AgentCapabilities;
    securitySchemes: Record<string, unknown>;
    security: Array<Record<string, string[]>>;
    defaultInputModes: string[];
    defaultOutputModes: string[];
    skills: AgentSkillCard[];
    provider?: { organization: string; url: string };
}

const CARD_VERSION = '1.0.0';
const DEFAULT_INPUT_MODES = ['text/plain'];
const DEFAULT_OUTPUT_MODES = ['text/plain'];

/** 扫描所有角色，返回 a2a.expose === true 的部分（带 A2A 配置引用）。 */
export function listExposedRoles(): Array<ChatRoleInfo & { a2a: A2AExposeConfig }> {
    const result: Array<ChatRoleInfo & { a2a: A2AExposeConfig }> = [];
    for (const role of getAllChatRoles()) {
        if (role.a2a?.expose === true) {
            result.push(role as ChatRoleInfo & { a2a: A2AExposeConfig });
        }
    }
    return result;
}

/** 查找单个暴露角色；若不存在或未 expose 返回 undefined。 */
export function findExposedRole(roleId: string): (ChatRoleInfo & { a2a: A2AExposeConfig }) | undefined {
    return listExposedRoles().find(r => getExternalAgentId(r) === roleId);
}

/** 对外 agent id：优先用 a2a.id，否则回退到 role id。 */
export function getExternalAgentId(role: ChatRoleInfo & { a2a: A2AExposeConfig }): string {
    return role.a2a.id ?? role.id;
}

/** 构造 agent card。baseUrl 来自 A2AServer.baseUrl（如 "http://127.0.0.1:12345"）。 */
export function buildAgentCard(
    role: ChatRoleInfo & { a2a: A2AExposeConfig },
    baseUrl: string,
): AgentCard {
    const agentId = getExternalAgentId(role);
    const skills: AgentSkillCard[] = (role.a2a.skills ?? []).map(s => ({
        id: s.id,
        name: s.name,
        description: s.description,
        tags: s.tags,
        examples: s.examples,
    }));

    return {
        name: role.a2a.name ?? role.name,
        description: role.a2a.description ?? role.description ?? role.name,
        supportedInterfaces: [
            {
                url: `${baseUrl}/agents/${encodeURIComponent(agentId)}/rpc`,
                protocolBinding: 'JSONRPC',
                protocolVersion: '1.0',
            },
        ],
        version: CARD_VERSION,
        capabilities: {
            streaming: true,          // 支持 SendStreamingMessage SSE
            pushNotifications: false, // 不计划支持
        },
        securitySchemes: {
            httpBearer: { type: 'http', scheme: 'bearer' },
        },
        security: [{ httpBearer: [] }],
        defaultInputModes: role.a2a.inputModes ?? DEFAULT_INPUT_MODES,
        defaultOutputModes: role.a2a.outputModes ?? DEFAULT_OUTPUT_MODES,
        skills,
    };
}
