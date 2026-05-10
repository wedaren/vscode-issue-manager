/**
 * 添加自定义模型向导
 *
 * 通过多步 QuickPick + InputBox 引导用户选择服务商、输入 URL 与 API Key，
 * 自动从远端 /v1/models 拉取可用模型列表供选择，最后写入 settings 与 SecretStorage。
 */
import * as vscode from 'vscode';
import { ModelRegistry, type CustomModelSetting, type ThinkingBudget, type ModelDescriptor } from './ModelRegistry';
import { ModelAuthErrorRegistry } from './ModelAuthErrorRegistry';
import { PROVIDER_PRESETS, KNOWN_MODEL_META, type ProviderPreset } from './modelProviderPresets';

// ─── 主入口 ────────────────────────────────────────────────────

/**
 * 启动"新增自定义模型"向导（多步 QuickPick + InputBox）。
 * 完成后将模型写入 settings，API Key 存入 SecretStorage。
 * @returns 是否真正保存（用于决定是否刺新树视图）
 */
export async function runAddModelWizard(): Promise<boolean> {
    // ── 步骤 1：选择服务商 ─────────────────────────────────────
    type PresetItem = vscode.QuickPickItem & { preset: ProviderPreset };
    const presetItems: PresetItem[] = PROVIDER_PRESETS.map(p => ({
        label: `$(plug) ${p.label}`,
        description: p.description,
        detail: p.baseUrl || undefined,
        preset: p,
    }));
    const selectedPreset = await vscode.window.showQuickPick(presetItems, {
        title: '新增 AI 模型 — 选择服务商',
        placeHolder: '选择已知服务商快速配置，或手动输入 URL',
        matchOnDescription: true,
    });
    if (!selectedPreset) { return false; }
    const preset = selectedPreset.preset;

    // 提前计算步骤编号（思考档位步在知道 modelId 后动态决定是否出现）
    const needsKey = preset.requiresKey;
    const sUrl   = 2;
    const sKey   = needsKey ? 3 : 0;
    const sModel = needsKey ? 4 : 3;
    const sName  = needsKey ? 5 : 4;
    const baseTotal = sName; // 基础步骤数（不含可选思考步）

    // ── 步骤 2：输入 Base URL ──────────────────────────────────
    const baseUrl = await vscode.window.showInputBox({
        title: `新增 AI 模型 (${sUrl}) — API 地址`,
        prompt: '输入 API 基础 URL（到 /v1 为止）',
        value: preset.baseUrl,
        placeHolder: 'https://api.openai.com/v1',
        validateInput: (v) => {
            const t = v.trim();
            if (!t) { return '地址不能为空'; }
            if (!t.startsWith('https://') && !t.startsWith('http://localhost') && !t.startsWith('http://127.0.0.1')) {
                return '安全限制：仅允许 https:// 或本地地址（http://localhost / http://127.0.0.1）';
            }
            return undefined;
        },
    });
    if (baseUrl === undefined) { return false; }
    const cleanUrl = baseUrl.trim();

    // ── 步骤 3：输入 API Key（按需）───────────────────────────
    let apiKey = '';
    if (needsKey) {
        const dashHint = preset.dashboardUrl ? `  在此获取 Key: ${preset.dashboardUrl}` : '';
        const keyInput = await vscode.window.showInputBox({
            title: `新增 AI 模型 (${sKey}) — API Key`,
            prompt: `输入 ${preset.label} 的 API Key（安全存储于 VS Code SecretStorage，不写入 settings）${dashHint}`,
            placeHolder: 'sk-...',
            password: true,
        });
        if (keyInput === undefined) { return false; }
        apiKey = keyInput.trim();
    }

    // ── 拉取模型列表（独立 progress，完成后再弹 QuickPick）────
    let remoteModels: Array<{ id: string; context_window?: number }> = [];
    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: '正在拉取模型列表…', cancellable: false },
        async () => {
            remoteModels = await ModelRegistry.fetchRemoteModels(cleanUrl, apiKey);
        },
    );

    // ── 步骤 4：选择/输入模型 ID ──────────────────────────────
    let modelId = '';
    let contextWindow: number | undefined;
    let supportsVision: boolean | undefined;

    if (remoteModels.length > 0) {
        type ModelItem = vscode.QuickPickItem & { modelData: { id: string; context_window?: number } };
        const modelItems: ModelItem[] = remoteModels.map(m => {
            const staticMeta = KNOWN_MODEL_META[m.id.toLowerCase()];
            const ctx = m.context_window ?? staticMeta?.contextWindow;
            const vision = staticMeta?.vision;
            const tags: string[] = [];
            if (ctx) { tags.push(`${(ctx / 1000).toFixed(0)}k`); }
            if (vision) { tags.push('视觉'); }
            return {
                label: m.id,
                description: tags.length > 0 ? tags.join(' · ') : undefined,
                modelData: m,
            };
        });
        modelItems.push({ label: '$(edit) 手动输入模型 ID…', description: '如果列表中没有目标模型', modelData: { id: '' } });

        const selectedModel = await vscode.window.showQuickPick(modelItems, {
            title: `新增 AI 模型 (${sModel}/${baseTotal}+) — 选择模型`,
            placeHolder: `从 ${cleanUrl} 获取到 ${remoteModels.length} 个模型`,
            matchOnDescription: true,
        });
        if (!selectedModel) { return false; }

        if (selectedModel.modelData.id === '') {
            const manualId = await vscode.window.showInputBox({
                title: `新增 AI 模型 (${sModel}) — 手动输入模型 ID`,
                prompt: '输入模型 ID（与 API 中的 model 字段一致）',
                placeHolder: 'gpt-4o / deepseek-chat / qwen3:14b',
            });
            if (!manualId) { return false; }
            modelId = manualId.trim();
        } else {
            modelId = selectedModel.modelData.id;
            const staticMeta = KNOWN_MODEL_META[modelId.toLowerCase()];
            contextWindow = selectedModel.modelData.context_window ?? staticMeta?.contextWindow;
            supportsVision = staticMeta?.vision;
        }
    } else {
        // 拉取失败：若提供了 API Key 则提示可能无效
        if (needsKey && apiKey) {
            const action = await vscode.window.showWarningMessage(
                `无法从 ${cleanUrl} 获取模型列表（API Key 可能无效，或服务不支持 /v1/models 接口）`,
                '继续手动输入', '取消',
            );
            if (action !== '继续手动输入') { return false; }
        }
        const manualId = await vscode.window.showInputBox({
            title: `新增 AI 模型 (${sModel}) — 输入模型 ID`,
            prompt: '无法自动获取模型列表，请手动输入模型 ID',
            placeHolder: 'gpt-4o / deepseek-chat / qwen3:14b',
        });
        if (!manualId) { return false; }
        modelId = manualId.trim();
    }

    // 静态表补全（手动输入路径下的 contextWindow / vision）
    if (modelId && contextWindow === undefined) {
        const meta = KNOWN_MODEL_META[modelId.toLowerCase()];
        if (meta) { contextWindow = meta.contextWindow; supportsVision = meta.vision; }
    }

    // 知道 modelId 后才能确定总步骤数
    const likelyThinking = /o1|o3|o4|thinking|r1|reasoner|deepseek-r/.test(modelId.toLowerCase());
    const total = baseTotal + (likelyThinking ? 1 : 0);

    // ── 步骤 5：显示名称 ───────────────────────────────────────
    const nameInput = await vscode.window.showInputBox({
        title: `新增 AI 模型 (${sName}/${total}) — 显示名称`,
        prompt: '在树视图中显示的名称（回车使用模型 ID 作为名称）',
        value: modelId,
    });
    if (nameInput === undefined) { return false; }
    const displayName = nameInput.trim() || modelId;

    // ── 步骤 6（可选）：思考档位 ──────────────────────────────
    let thinkingBudget: ThinkingBudget | undefined;
    if (likelyThinking) {
        const thinkingStep = sName + 1;
        type BudgetItem = vscode.QuickPickItem & { value: ThinkingBudget | null };
        const budgetItems: BudgetItem[] = [
            { label: '$(arrow-down) low', description: '最小思考预算，响应更快', value: 'low' },
            { label: '$(circle-filled) medium', description: '平衡质量与速度（推荐）', value: 'medium' },
            { label: '$(arrow-up) high', description: '最大思考预算，回答更深入', value: 'high' },
            { label: '$(dash) 不设置', description: '稍后可在设置中修改', value: null },
        ];
        const budgetSel = await vscode.window.showQuickPick(budgetItems, {
            title: `新增 AI 模型 (${thinkingStep}/${total}) — 思考档位`,
            placeHolder: '该模型支持推理模式，选择默认思考预算档位',
        });
        if (budgetSel === undefined) { return false; } // Escape = 取消向导
        if (budgetSel.value !== null) { thinkingBudget = budgetSel.value; }
    }

    // ── 保存 ───────────────────────────────────────────────────
    // ID 格式：<provider>/<hostname-brand>/<modelId>，兼顾可读性与唯一性。
    // hostname-brand 规则：localhost/IP 带端口（区分 Ollama:11434 vs LM Studio:1234）；
    // 域名取倒数第二段（api.deepseek.com → deepseek）。
    // 对于具名预设且 URL 未改动，直接用 provider（保持简洁）。
    // modelId 中的 '/' 替换为 '--' 确保 ID 格式合法（Together AI 等模型 ID 含斜杠）。
    const safeModelId = modelId.replace(/\//g, '--');
    const needsHostSegment = preset.provider === 'custom' || cleanUrl !== preset.baseUrl;
    const providerId = needsHostSegment
        ? `${preset.provider}/${_endpointBrand(cleanUrl)}/${safeModelId}`
        : `${preset.provider}/${safeModelId}`;

    const setting: CustomModelSetting = {
        id: providerId,
        displayName,
        provider: preset.provider,
        endpoint: cleanUrl,
        model: modelId,
        contextWindow,
        thinkingBudget,
        supportsVision,
    };
    await ModelRegistry.addCustomModel(setting);

    // API Key：按 provider + endpoint 区分存储，支持同服务商多端点
    if (apiKey) {
        await ModelRegistry.saveApiKey(ModelRegistry.buildApiKeyName(preset.provider, cleanUrl), apiKey);
    }

    vscode.window.showInformationMessage(`模型 "${displayName}" 已添加！`, '设为默认').then(action => {
        if (action === '设为默认') { return ModelRegistry.setDefaultModel(providerId); }
        return undefined;
    });
    return true;
}

/**
 * 右键"模型根节点"时触发：启动向导，完成后刷新树视图。
 * @param treeRefresh - 刷新树视图的回调
 */
export async function addModelFromTree(treeRefresh: () => void): Promise<void> {
    const saved = await runAddModelWizard();
    if (saved) { treeRefresh(); }
}

/**
 * 右键"模型条目"时设为全局默认。
 * @param modelId - 要设为默认的模型 ID
 * @param displayName - 显示名称（用于提示信息）
 * @param treeRefresh - 刷新树视图的回调
 */
export async function setDefaultModelFromTree(modelId: string, displayName: string, treeRefresh: () => void): Promise<void> {
    await ModelRegistry.setDefaultModel(modelId);
    vscode.window.showInformationMessage(`已将 "${displayName}" 设为默认模型`);
    treeRefresh();
}

/**
 * 右键"模型条目"时切换禁用状态。
 * @param modelId - 要切换的模型 ID
 * @param treeRefresh - 刷新树视图的回调
 */
export async function toggleModelDisabledFromTree(modelId: string, treeRefresh: () => void): Promise<void> {
    await ModelRegistry.toggleDisabled(modelId);
    treeRefresh();
}

/**
 * 右键"自定义模型条目"时更新 API Key（密码输入框）。
 * @param descriptor - 目标模型描述符
 * @param treeRefresh - 刷新树视图的回调
 */
export async function updateApiKeyFromTree(descriptor: ModelDescriptor, treeRefresh: () => void): Promise<void> {
    const newKey = await vscode.window.showInputBox({
        title: `更新 API Key — ${descriptor.displayName}`,
        prompt: '输入新的 API Key（输入内容不可见）',
        password: true,
        placeHolder: 'sk-...',
    });
    if (!newKey) { return; }
    await ModelRegistry.saveApiKey(ModelRegistry.buildApiKeyName(descriptor.provider, descriptor.endpoint), newKey);
    ModelAuthErrorRegistry.clearError(descriptor.id);
    vscode.window.showInformationMessage(`${descriptor.displayName} 的 API Key 已更新`);
    treeRefresh();
}

/**
 * 右键"自定义模型条目"时删除（二次确认）。
 * 删除 settings 条目的同时清理 SecretStorage 中的 API Key。
 * @param descriptor - 要删除的模型描述符（含 endpoint，用于构造 SecretStorage key）
 * @param treeRefresh - 刷新树视图的回调
 */
export async function deleteModelFromTree(descriptor: ModelDescriptor, treeRefresh: () => void): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
        `确定删除模型 "${descriptor.displayName}"？此操作不可撤销。`,
        { modal: true },
        '删除',
    );
    if (confirm !== '删除') { return; }
    await ModelRegistry.deleteCustomModel(descriptor.id);
    // 同步清理 SecretStorage 中的 API Key，避免孤立 secret
    await ModelRegistry.deleteApiKey(ModelRegistry.buildApiKeyName(descriptor.provider, descriptor.endpoint));
    ModelAuthErrorRegistry.clearError(descriptor.id);
    vscode.window.showInformationMessage(`模型 "${descriptor.displayName}" 已删除`);
    treeRefresh();
}

// ─── 内部工具 ──────────────────────────────────────────────────

/**
 * 从 endpoint URL 提取人类可读的品牌短名，用于生成无碰撞的模型 ID。
 * - localhost / IP：附加端口（区分 Ollama:11434 与 LM Studio:1234）
 * - 域名：取倒数第二段（api.deepseek.com → deepseek）
 */
function _endpointBrand(endpoint: string): string {
    try {
        const u = new URL(endpoint);
        const host = u.hostname;
        // localhost 或纯 IP：加端口区分不同服务
        if (host === 'localhost' || host === '127.0.0.1' || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
            return u.port ? `${host}:${u.port}` : host;
        }
        // 域名：取倒数第二段作品牌名（api.deepseek.com → deepseek）
        const parts = host.split('.');
        return parts.length >= 2 ? parts[parts.length - 2] : host;
    } catch {
        return 'custom';
    }
}

