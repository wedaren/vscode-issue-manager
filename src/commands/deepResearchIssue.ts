import * as vscode from 'vscode';
import * as path from 'path';
import { LLMService } from '../llm/LLMService';
import {
    createIssueMarkdown,
    updateIssueMarkdownBody,
    updateIssueMarkdownFrontmatter,
    type FrontmatterData,
} from '../data/IssueMarkdowns';
import { Logger } from '../core/utils/Logger';
import { getIssueDir } from '../config';
import { createIssueNodes, type IssueNode } from '../data/issueTreeManager';

export type ResearchOutputKind = '调研报告' | '技术方案' | '对比分析' | '学习笔记';
export type ResearchSourceMode = 'local' | 'llmOnly';

interface DeepResearchPlan {
    researchTitle: string;
    keyQuestions: string[];
    localSearchQueries: string[];
    outline: string[];
    goals?: string[];
    nonGoals?: string[];
    constraints?: string[];
    acceptanceCriteria?: string[];
    measurementPlan?: string[];
    dataScaleAssumptions?: string[];
    deliverables?: string[];
    glossary?: string[];
    openQuestions?: string[];
    assumptions: string[];
    risks: string[];
}

interface LocalSource {
    title?: string;
    filePath: string;
    excerpt: string;
    truncated: boolean;
}

interface EditorContext {
    filePath: string;
    languageId: string;
    excerpt: string;
    truncated: boolean;
}

interface DeepResearchReviewResult {
    reviewNotes: string;
    finalMarkdown: string;
}

function toAbortSignal(token: vscode.CancellationToken): AbortSignal {
    const controller = new AbortController();
    token.onCancellationRequested(() => controller.abort());
    if (token.isCancellationRequested) {
        controller.abort();
    }
    return controller.signal;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function extractJsonObject(text: string): unknown {
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/i);
    const candidate = jsonMatch?.[1] ? jsonMatch[1] : text;

    const firstBrace = candidate.indexOf('{');
    const lastBrace = candidate.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
        throw new Error('未在模型响应中找到 JSON 对象');
    }

    const jsonString = candidate.substring(firstBrace, lastBrace + 1);
    return JSON.parse(jsonString) as unknown;
}

function getStringArray(obj: Record<string, unknown>, key: string): string[] {
    const v = obj[key];
    if (!Array.isArray(v)) {
        return [];
    }
    return v
        .filter((x): x is string => typeof x === 'string')
        .map(s => s.trim())
        .filter(Boolean);
}

function getString(obj: Record<string, unknown>, key: string): string | undefined {
    const v = obj[key];
    if (typeof v !== 'string') {
        return undefined;
    }
    const trimmed = v.trim();
    return trimmed ? trimmed : undefined;
}

function isDeepResearchPlan(value: unknown): value is DeepResearchPlan {
    if (!isRecord(value)) {
        return false;
    }

    const researchTitle = getString(value, 'researchTitle');
    if (!researchTitle) {
        return false;
    }

    const keyQuestions = getStringArray(value, 'keyQuestions');
    const outline = getStringArray(value, 'outline');

    if (keyQuestions.length === 0) {
        return false;
    }
    if (outline.length === 0) {
        return false;
    }

    return true;
}

function formatOptionalList(title: string, items: string[] | undefined): string {
    if (!items || items.length === 0) {
        return `${title}\n（无）`;
    }
    return `${title}\n${items.map(i => `- ${i}`).join('\n')}`;
}

function isDeepResearchReviewResult(value: unknown): value is DeepResearchReviewResult {
    if (!isRecord(value)) {
        return false;
    }
    const reviewNotes = getString(value, 'reviewNotes');
    const finalMarkdown = getString(value, 'finalMarkdown');
    return !!reviewNotes && !!finalMarkdown;
}

function ensureH1(markdown: string, title: string): string {
    const trimmed = markdown.trimStart();
    if (trimmed.startsWith('# ')) {
        return markdown;
    }
    return `# ${title}\n\n${markdown}`;
}

function clampExcerpt(text: string, maxChars: number): { excerpt: string; truncated: boolean } {
    const normalized = text.replace(/\r\n/g, '\n');
    if (normalized.length <= maxChars) {
        return { excerpt: normalized, truncated: false };
    }
    return { excerpt: normalized.slice(0, maxChars) + '\n\n（已截断）\n', truncated: true };
}

function fileNameFromUri(uri: vscode.Uri): string {
    return path.basename(uri.fsPath);
}

function buildFileWikiLink(absFilePath: string, label?: string): string {
    const link = `[[file:${absFilePath}]]`;
    return label ? `${label}：${link}` : link;
}

async function readTextFile(filePath: string): Promise<string | null> {
    try {
        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
        return Buffer.from(bytes).toString('utf8');
    } catch (e) {
        Logger.getInstance().warn(`[deepResearch] 读取文件失败: ${filePath}`, e);
        return null;
    }
}

async function generatePlan(topic: string, kind: ResearchOutputKind, signal: AbortSignal): Promise<DeepResearchPlan> {
    const kindQualityGate =
        kind === '学习笔记'
            ? `
质量门禁（学习笔记专用，必须满足）：
- 计划必须包含：学习目标（用 goals 表达）/关键问题/大纲/术语表（glossary）/交付物（deliverables，例如练习题、自测清单、复习卡片）/待验证问题（openQuestions）。
- 不要强行输出“数据规模假设/验收标准/量化指标/回归方案”。如果你觉得需要，也只能写成“待定/待验证”并说明验证方法。
`.trim()
            : `
质量门禁（必须满足）：
- 计划必须包含：目标/非目标/约束/验收标准（允许定性或步骤化验收，禁止无依据数字）/度量与观测方案/数据规模假设（可以是占位符与范围，必须标注待验证）/交付物清单/待验证问题。
- 所有条目都应“可执行、可验收、可落地”，避免泛泛而谈。
`.trim();

    const prompt = `
你是一名“深度调研写作助手”，需要为用户的调研主题制定可执行的调研计划。
约束：
- 当前环境不联网，不要假装浏览网页或引用不可得的外部链接。
- 你可以建议“检索本地问题库/笔记”来获取证据与上下文（后续由工具执行）。

${kindQualityGate}

请只输出 JSON（不要输出其它文本），结构为：
{
  "researchTitle": "最终文档标题（中文，专业、具体）",
  "keyQuestions": ["关键问题1","关键问题2"],
  "localSearchQueries": ["用于检索本地笔记的查询词/短语（3-6个）"],
  "outline": ["一级大纲1","一级大纲2","一级大纲3"],
    "goals": ["目标1（可验收）"],
    "nonGoals": ["非目标1（明确不做什么）"],
    "constraints": ["约束1（例如不联网/接口限制/兼容性等）"],
    "acceptanceCriteria": ["验收标准1（量化或明确可验证）"],
    "measurementPlan": ["度量/观测方案1（需要埋点/日志/指标/复现步骤）"],
    "dataScaleAssumptions": ["数据规模假设1（例如节点数量/文件数量/频率等）"],
    "deliverables": ["交付物1（例如终稿、对比表、行动清单、待验证清单等）"],
    "glossary": ["术语=解释（用于统一口径）"],
    "openQuestions": ["待验证问题1（明确后续如何验证）"],
  "assumptions": ["假设/缺口1"],
  "risks": ["风险1"]
}

调研主题：${topic}
输出类型：${kind}
`.trim();

    const resp = await LLMService._request([vscode.LanguageModelChatMessage.User(prompt)], { signal });
    if (!resp) {
        return {
            researchTitle: `深度调研：${topic}`,
            keyQuestions: ['问题的本质是什么？', '有哪些可行方案与取舍？'],
            localSearchQueries: [topic],
            outline: ['概述', '背景与现状', '关键问题拆解', '方案与对比', '风险与建议', '参考资料（本地）'],
            assumptions: [],
            risks: [],
        };
    }

    try {
        const parsed = extractJsonObject(resp.text);
        if (isDeepResearchPlan(parsed)) {
            const record = parsed as unknown as Record<string, unknown>;
            const localSearchQueries = getStringArray(record, 'localSearchQueries');
            const goals = getStringArray(record, 'goals');
            const nonGoals = getStringArray(record, 'nonGoals');
            const constraints = getStringArray(record, 'constraints');
            const acceptanceCriteria = getStringArray(record, 'acceptanceCriteria');
            const measurementPlan = getStringArray(record, 'measurementPlan');
            const dataScaleAssumptions = getStringArray(record, 'dataScaleAssumptions');
            const deliverables = getStringArray(record, 'deliverables');
            const glossary = getStringArray(record, 'glossary');
            const openQuestions = getStringArray(record, 'openQuestions');
            const assumptions = getStringArray(record, 'assumptions');
            const risks = getStringArray(record, 'risks');

            return {
                researchTitle: parsed.researchTitle,
                keyQuestions: parsed.keyQuestions,
                localSearchQueries: localSearchQueries.length > 0 ? localSearchQueries : [topic],
                outline: parsed.outline,
                goals: goals.length > 0 ? goals : undefined,
                nonGoals: nonGoals.length > 0 ? nonGoals : undefined,
                constraints: constraints.length > 0 ? constraints : undefined,
                acceptanceCriteria: acceptanceCriteria.length > 0 ? acceptanceCriteria : undefined,
                measurementPlan: measurementPlan.length > 0 ? measurementPlan : undefined,
                dataScaleAssumptions: dataScaleAssumptions.length > 0 ? dataScaleAssumptions : undefined,
                deliverables: deliverables.length > 0 ? deliverables : undefined,
                glossary: glossary.length > 0 ? glossary : undefined,
                openQuestions: openQuestions.length > 0 ? openQuestions : undefined,
                assumptions,
                risks,
            };
        }
    } catch (e) {
        Logger.getInstance().warn('[deepResearch] 计划 JSON 解析失败，使用兜底计划', e);
    }

    return {
        researchTitle: `深度调研：${topic}`,
        keyQuestions: ['问题的本质是什么？', '有哪些可行方案与取舍？'],
        localSearchQueries: [topic],
        outline: [
            '执行摘要（结论先行）',
            '目标 / 非目标 / 约束',
            '现状与问题画像（症状→原因→证据）',
            '方案选型与对比（含取舍表）',
            '推荐方案设计（数据结构/流程/接口/并发/取消）',
            '实施步骤（分阶段）',
            '验收标准与回归方案（可量化）',
            '风险与待验证清单',
        ],
        goals: ['输出一份可落地、可验收的技术方案文档'],
        nonGoals: ['不提供无法验证的外部事实/数据', '不依赖联网查询'],
        constraints: ['不联网', '必须基于可实现的 VS Code 扩展能力'],
        acceptanceCriteria: ['包含可量化的验收标准', '包含可执行的行动清单与回归方法'],
        measurementPlan: ['建议补充埋点/日志/复现步骤，用于对比优化前后收益'],
        dataScaleAssumptions: ['给出至少 2 档规模假设，并说明策略如何随规模变化'],
        deliverables: ['终稿 Markdown', '方案对比表', '行动清单', '待验证清单'],
        assumptions: [],
        risks: [],
    };
}

async function collectLocalSources(
    queries: string[],
    maxSources: number,
    maxCharsPerSource: number,
    signal: AbortSignal
): Promise<LocalSource[]> {
    const seen = new Set<string>();
    const candidates: Array<{ title?: string; filePath: string }> = [];

    for (const q of queries) {
        if (signal.aborted) {
            throw new Error('请求已取消');
        }

        const matches = await LLMService.searchIssueMarkdowns(q, { signal });
        for (const m of matches) {
            const key = m.filePath;
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            candidates.push({ title: m.title, filePath: m.filePath });
            if (candidates.length >= maxSources) {
                break;
            }
        }

        if (candidates.length >= maxSources) {
            break;
        }
    }

    const sources: LocalSource[] = [];
    for (const c of candidates.slice(0, maxSources)) {
        if (signal.aborted) {
            throw new Error('请求已取消');
        }

        const content = await readTextFile(c.filePath);
        if (!content) {
            continue;
        }

        const { excerpt, truncated } = clampExcerpt(content, maxCharsPerSource);
        sources.push({ title: c.title, filePath: c.filePath, excerpt, truncated });
    }

    return sources;
}

function getEditorContext(maxChars: number): EditorContext | null {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return null;
    }

    const doc = editor.document;
    const selectedText = editor.selection && !editor.selection.isEmpty ? doc.getText(editor.selection) : '';
    const raw = selectedText.trim() ? selectedText : doc.getText();

    const { excerpt, truncated } = clampExcerpt(raw, maxChars);

    return {
        filePath: doc.uri.fsPath,
        languageId: doc.languageId,
        excerpt,
        truncated,
    };
}

async function generateDocument(
    topic: string,
    kind: ResearchOutputKind,
    plan: DeepResearchPlan,
    sources: LocalSource[],
    editorCtx: EditorContext | null,
    signal: AbortSignal
): Promise<string> {
    const sourcesBlock =
        sources.length === 0
            ? '（未检索到可用的本地笔记来源）'
            : sources
                  .map((s, idx) => {
                      const display = s.title?.trim() ? s.title : path.basename(s.filePath);
                      const trunc = s.truncated ? '（节选已截断）' : '';
                      return `【来源 ${idx + 1}】${display}\n路径：${s.filePath}\n摘录${trunc}：\n${s.excerpt}`;
                  })
                  .join('\n\n---\n\n');

    const editorBlock = editorCtx
        ? `文件：${editorCtx.filePath}\n语言：${editorCtx.languageId}\n内容节选${editorCtx.truncated ? '（已截断）' : ''}：\n${editorCtx.excerpt}`
        : '（未包含当前编辑器上下文）';

    const prompt = `
你是一名资深研究员与技术写作者。请基于“本地资料（来源摘录）+ 用户主题 + 当前编辑器上下文”，产出一份专业 Markdown 文档。
重要约束：
- 不联网：不要声称“查阅网页/论文/官方文档”等；如需外部信息，用“待验证/建议后续查证”表达。
- 必须基于来源摘录进行论证；当引用某条来源的事实/观点时，在句末用 [来源N] 标注。
- 文中所有“具体数字/阈值/样本量/比例/性能指标/行业案例”必须能在来源摘录中找到并标注对应 [来源N]；否则必须改写为“待验证/待定/假设”并进入“待验证清单”。
- 输出必须是 Markdown 正文，不要把整篇包在 \`\`\` 代码块中。

主题：${topic}
输出类型：${kind}
建议标题：${plan.researchTitle}

关键问题：
${plan.keyQuestions.map(q => `- ${q}`).join('\n')}

文档大纲（必须覆盖这些一级标题，允许你在其下扩展二级标题）：
${plan.outline.map(h => `- ${h}`).join('\n')}

假设/缺口：
${plan.assumptions.length ? plan.assumptions.map(a => `- ${a}`).join('\n') : '（无）'}

风险：
${plan.risks.length ? plan.risks.map(r => `- ${r}`).join('\n') : '（无）'}

本地资料（来源摘录）：
${sourcesBlock}

当前编辑器上下文：
${editorBlock}

请输出一篇最终可交付的文档，建议包含：
- 执行摘要/结论（可直接复述给老板/同事）
- 方案对比表（如果适用）
- 明确的下一步行动清单（可执行）
- “参考资料（本地）”：列出来源路径，并说明其用于支持哪些结论
`.trim();

    const resp = await LLMService._request([vscode.LanguageModelChatMessage.User(prompt)], { signal });
    if (!resp) {
        return `# ${plan.researchTitle}\n\n（生成失败：未找到可用 Copilot 模型或请求失败）\n`;
    }

    return resp.text;
}

async function generateDocumentLlmOnly(
    topic: string,
    kind: ResearchOutputKind,
    plan: DeepResearchPlan,
    editorCtx: EditorContext | null,
    signal: AbortSignal
): Promise<{ draft: string; review: DeepResearchReviewResult }> {
    const editorBlock = editorCtx
        ? `文件：${editorCtx.filePath}\n语言：${editorCtx.languageId}\n内容节选${editorCtx.truncated ? '（已截断）' : ''}：\n${editorCtx.excerpt}`
        : '（未包含当前编辑器上下文）';

    const kindWritingTemplate =
        kind === '学习笔记'
            ? `
输出要求（学习笔记专用）：
- 目标：帮助读者真正“学会并能复述/应用”，而不是写成项目方案。
- 推荐结构（可按大纲微调）：概念地图/核心概念与机制/术语表/易混淆点与常见误区/对比（与相邻概念或替代方案）/自测题（含答案提纲）/复习清单/开放问题与下一步资料线索。
- 不要硬塞“验收标准/回归方案/数据规模假设/量化 KPI”。如果涉及数字，只能写“待定/待验证/假设”，并解释如何验证。
`.trim()
            : kind === '对比分析'
              ? `
输出要求（对比分析专用）：
- 以对比为中心：至少提供 1 张多维对比表（维度建议：目标、输入/依赖、实现复杂度、风险、可观测性、适用边界、迁移成本）。
- 给出明确结论：推荐方案 + 不推荐的原因 + 触发条件（何时需要切换方案）。
- 行动清单必须可执行：每条包含产出物或验证方法。
`.trim()
              : kind === '技术方案'
                ? `
输出要求（技术方案专用）：
- 结构要能指导落地：目标/非目标/约束/总体设计（架构、关键模块职责）/关键数据结构与接口/并发与取消/失败恢复与回滚/可观测性（日志、指标、追踪）/验收与回归（允许定性或步骤化验收，禁止无依据数字）/风险与权衡/里程碑。
- 至少 1 张对比表（候选方案 vs 取舍）。
`.trim()
                : `
输出要求（调研报告专用）：
- 结论先行：开头给出可直接转述的结论/建议（1-2 段）。
- 覆盖背景、现状、关键问题、候选路径、对比与建议、风险与待验证清单。
- 至少 1 张对比表 + 可执行行动清单。
`.trim();

    const hardNoFabricationRules = `
硬规则（必须遵守）：
- 不联网：不要声称“查阅网页/论文/官方文档”等。
- 禁止编造外部事实：包括具体数字/阈值/样本量/比例/性能指标/时间线/真实公司或行业案例/事故与统计。
- 如果为了说明需要提到数字或案例：只能写成“待验证/待定/假设”，且不得出现真实机构名；并把该点放入“待验证清单”，给出验证路径（要查什么、如何测、如何复现）。
`.trim();

    const draftPrompt = `
你是一名资深研究员与技术写作者。请完全基于你的多步骤思考与整合能力（不检索本地笔记、也不联网），为用户主题产出一份专业 Markdown 文档。
${hardNoFabricationRules}

通用约束：
- 输出必须是 Markdown 正文，不要把整篇包在 \`\`\` 代码块中。

${kindWritingTemplate}

主题：${topic}
输出类型：${kind}
建议标题：${plan.researchTitle}

关键问题：
${plan.keyQuestions.map(q => `- ${q}`).join('\n')}

文档大纲（必须覆盖这些一级标题，允许你在其下扩展二级标题）：
${plan.outline.map(h => `- ${h}`).join('\n')}

${kind === '学习笔记' ? '' : formatOptionalList('目标：', plan.goals)}

${kind === '学习笔记' ? '' : formatOptionalList('非目标：', plan.nonGoals)}

${kind === '学习笔记' ? '' : formatOptionalList('约束：', plan.constraints)}

假设/缺口：
${plan.assumptions.length ? plan.assumptions.map(a => `- ${a}`).join('\n') : '（无）'}

风险：
${plan.risks.length ? plan.risks.map(r => `- ${r}`).join('\n') : '（无）'}

${kind === '学习笔记' ? '' : formatOptionalList('数据规模假设：', plan.dataScaleAssumptions)}

${kind === '学习笔记' ? '' : formatOptionalList('验收标准：', plan.acceptanceCriteria)}

${kind === '学习笔记' ? '' : formatOptionalList('度量与观测方案：', plan.measurementPlan)}

当前编辑器上下文：
${editorBlock}

请输出一篇最终可交付的文档，并在文末包含一个“待验证清单”（列出所有依赖外部事实/数据的点，以及验证路径）。
`.trim();

    const draftResp = await LLMService._request([vscode.LanguageModelChatMessage.User(draftPrompt)], {
        signal,
    });
    const draft = draftResp?.text ?? `# ${plan.researchTitle}\n\n（生成失败：未找到可用 Copilot 模型或请求失败）\n`;

        const reviewPrompt = `
你现在是严苛的审阅者与改写者。请基于下方“初稿”做一次系统性审阅，并输出 JSON（不要输出其它文本）。
重要约束：
- 不要输出逐步推理细节（不要暴露思维链），只输出可审计的结论与修改依据要点。
- 不联网，不要声称查阅外部资料。
- 删除或改写任何可能“伪造引用/伪造外部事实”的句子；不确定就标记“待验证”。
- 补齐结构缺口：必须覆盖原大纲的一级标题。
- 让结论、对比、行动清单更具体可执行。

审阅清单（必须逐条过一遍，并在 reviewNotes 中明确指出缺口与修改）：
- 是否有明确的目标/非目标/约束/假设/数据规模假设？
- 是否有可验证的验收与回归思路（允许定性/步骤化验收；禁止无依据数字）？
- 是否把关键机制说清楚到“可以照着实现”（数据结构、关键函数职责、并发/取消、缓存失效）？
- 是否避免泛泛描述（每段至少给出一个可操作点/策略/验证方式）？
- 是否把“待验证点”集中管理，并给出验证路径？

请输出 JSON 结构：
{
    "reviewNotes": "审阅要点（Markdown，要包含：缺口清单 + 关键改动点 + 待验证点与验证路径）",
    "finalMarkdown": "改写后的最终 Markdown 文档正文（不要用代码块包裹整篇）"
}

初稿：
${draft}
`.trim();

    const finalResp = await LLMService._request([vscode.LanguageModelChatMessage.User(reviewPrompt)], {
        signal,
    });

    const fallbackReview: DeepResearchReviewResult = {
        reviewNotes: '- （解析失败）未能从审阅阶段拿到结构化审阅要点；已直接使用审阅响应或初稿作为最终稿。',
        finalMarkdown: finalResp?.text ?? draft,
    };

    if (!finalResp?.text) {
        return { draft, review: fallbackReview };
    }

    try {
        const parsed = extractJsonObject(finalResp.text);
        if (isDeepResearchReviewResult(parsed)) {
            return {
                draft,
                review: {
                    reviewNotes: parsed.reviewNotes,
                    finalMarkdown: parsed.finalMarkdown,
                },
            };
        }
    } catch (e) {
        Logger.getInstance().warn('[deepResearch] 审阅 JSON 解析失败，使用兜底输出', e);
    }

    return { draft, review: fallbackReview };
}

async function promptTopic(): Promise<string | null> {
    const topic = (
        await vscode.window.showInputBox({
            prompt: '请输入要“深度调研”的问题/主题（取消将中止）',
            placeHolder: '例如：如何为最近问题视图做更稳定的树渲染与性能优化？',
        })
    )?.trim();

    return topic && topic.length > 0 ? topic : null;
}

async function promptKind(): Promise<ResearchOutputKind | null> {
    const kindItems: Array<vscode.QuickPickItem & { value: ResearchOutputKind }> = [
        { label: '调研报告', value: '调研报告' },
        { label: '技术方案', value: '技术方案' },
        { label: '对比分析', value: '对比分析' },
        { label: '学习笔记', value: '学习笔记' },
    ];

    const pickedKind = await vscode.window.showQuickPick(kindItems, {
        title: '选择输出类型',
        canPickMany: false,
    });

    return pickedKind ? pickedKind.value : null;
}

async function promptSourceMode(): Promise<ResearchSourceMode | null> {
    const modeItems: Array<vscode.QuickPickItem & { value: ResearchSourceMode }> = [
        {
            label: '本地笔记 + LLM（推荐）',
            description: '会检索本地 issue 笔记并基于摘录写作（带 [来源N] 标注）',
            value: 'local',
        },
        {
            label: '纯 LLM 深度思考（不检索本地）',
            description: '完全基于多步骤推理与整合（不联网，不伪造引用）',
            value: 'llmOnly',
        },
    ];

    const pickedMode = await vscode.window.showQuickPick(modeItems, {
        title: '选择资料来源模式',
        canPickMany: false,
    });

    return pickedMode ? pickedMode.value : null;
}

async function promptIncludeEditor(): Promise<boolean | null> {
    const includeEditorItems: Array<vscode.QuickPickItem & { value: boolean }> = [
        { label: '包含', description: '将当前编辑器（或选中文本）作为调研上下文', value: true },
        { label: '不包含', description: '不读取当前编辑器内容', value: false },
    ];

    const includeEditor = await vscode.window.showQuickPick(includeEditorItems, {
        title: '是否包含当前编辑器上下文？',
        canPickMany: false,
    });

    return includeEditor ? includeEditor.value : null;
}

export async function runDeepResearchFlow(params: {
    topic: string;
    kind: ResearchOutputKind;
    sourceMode: ResearchSourceMode;
    includeEditor: boolean;
    progress: vscode.Progress<{ message?: string; increment?: number }>;
    token: vscode.CancellationToken;
}): Promise<void> {
    const { topic, kind, sourceMode, includeEditor, progress, token } = params;
    const signal = toAbortSignal(token);

    progress.report({ message: '生成调研计划...' });
    const plan = await generatePlan(topic, kind, signal);

    const title = plan.researchTitle?.trim() ? plan.researchTitle.trim() : `深度调研：${topic}`;

    progress.report({ message: '整理编辑器上下文...' });
    const editorCtx = includeEditor ? getEditorContext(8000) : null;

    // local 模式：保持原逻辑（单文档落盘）
    if (sourceMode === 'local') {
        let sources: LocalSource[] = [];
        progress.report({ message: '检索本地问题库（笔记）...' });
        const queries = Array.from(new Set([topic, ...plan.localSearchQueries].map(s => s.trim()).filter(Boolean))).slice(0, 6);
        sources = await collectLocalSources(queries, 6, 8000, signal);

        progress.report({ message: '生成专业调研文档...' });
        const rawMarkdown = await generateDocument(topic, kind, plan, sources, editorCtx, signal);
        const markdownBody = ensureH1(rawMarkdown, title);

        progress.report({ message: '创建文档并打开...' });

        const frontmatter: Partial<FrontmatterData> = {
            title,
            issue_prompt: true,
            issue_deep_research: true,
            issue_research_topic: topic,
            issue_research_kind: kind,
            issue_research_source_mode: sourceMode,
            issue_research_source_paths: sources.map(s => s.filePath),
        };

        const uri = await createIssueMarkdown({ markdownBody, frontmatter });
        if (!uri) {
            vscode.window.showErrorMessage('创建调研文档失败：无法写入 issueDir。');
            return;
        }

        // 将新文档加入 IssueNode 树，便于在总览/最近问题等视图中出现
        try {
            await createIssueNodes([uri]);
        } catch (e) {
            Logger.getInstance().warn('[deepResearch] createIssueNodes 失败（local）', e);
        }

        await vscode.window.showTextDocument(uri);
        void vscode.commands.executeCommand('issueManager.refreshAllViews');
        return;
    }

    // llmOnly 模式：记录全过程（计划/初稿/审阅/终稿），并用 issue_*_file 字段建立层级
    const issueDir = getIssueDir();
    if (!issueDir) {
        vscode.window.showErrorMessage('问题目录（issueManager.issueDir）未配置，无法创建调研文档。');
        return;
    }

    progress.report({ message: '创建终稿根文档（容器）...' });
    const rootFrontmatter: Partial<FrontmatterData> = {
        title,
        issue_prompt: true,
        issue_deep_research: true,
        issue_research_topic: topic,
        issue_research_kind: kind,
        issue_research_source_mode: sourceMode,
        issue_research_status: 'running',
        issue_children_files: [],
    };
    const rootPlaceholderBody = `# ${title}\n\n（生成中...）\n`;
    const rootUri = await createIssueMarkdown({ markdownBody: rootPlaceholderBody, frontmatter: rootFrontmatter });
    if (!rootUri) {
        vscode.window.showErrorMessage('创建调研文档失败：无法写入 issueDir。');
        return;
    }

    // 先把根文档写入 IssueNode 树，后续子文档挂在它下面
    let rootNodeId: string | undefined;
    try {
        const nodes = (await createIssueNodes([rootUri])) as IssueNode[] | null;
        if (nodes && nodes.length > 0) {
            rootNodeId = nodes[0].id;
        }
    } catch (e) {
        Logger.getInstance().warn('[deepResearch] createIssueNodes 失败（root）', e);
    }

    const rootFileName = fileNameFromUri(rootUri);
    await updateIssueMarkdownFrontmatter(rootUri, {
        issue_root_file: rootFileName,
        issue_parent_file: null,
        issue_children_files: [],
        issue_research_root_file: rootFileName,
    });

    const createdChildFiles: string[] = [];
    const createdChildUris: vscode.Uri[] = [];
    const safeFinalizeRoot = async (updates: Partial<FrontmatterData>, body?: string) => {
        try {
            await updateIssueMarkdownFrontmatter(rootUri, updates);
            if (typeof body === 'string') {
                await updateIssueMarkdownBody(rootUri, body);
            }
        } catch (e) {
            Logger.getInstance().warn('[deepResearch] 更新根文档失败', e);
        }
    };

    try {
        progress.report({ message: '生成初稿与审阅改写（纯 LLM）...' });
        const { draft, review } = await generateDocumentLlmOnly(topic, kind, plan, editorCtx, signal);

        progress.report({ message: '落盘：计划文档...' });
        const planBody = `# ${title}（调研计划）\n\n## 计划 JSON\n\n\`\`\`json\n${JSON.stringify(plan, null, 2)}\n\`\`\`\n\n## 关键问题\n${plan.keyQuestions.map(q => `- ${q}`).join('\n')}\n\n## 大纲\n${plan.outline.map(h => `- ${h}`).join('\n')}\n\n## 目标\n${plan.goals && plan.goals.length ? plan.goals.map(g => `- ${g}`).join('\n') : '（无）'}\n\n## 非目标\n${plan.nonGoals && plan.nonGoals.length ? plan.nonGoals.map(g => `- ${g}`).join('\n') : '（无）'}\n\n## 约束\n${plan.constraints && plan.constraints.length ? plan.constraints.map(g => `- ${g}`).join('\n') : '（无）'}\n\n## 数据规模假设\n${plan.dataScaleAssumptions && plan.dataScaleAssumptions.length ? plan.dataScaleAssumptions.map(g => `- ${g}`).join('\n') : '（无）'}\n\n## 验收标准\n${plan.acceptanceCriteria && plan.acceptanceCriteria.length ? plan.acceptanceCriteria.map(g => `- ${g}`).join('\n') : '（无）'}\n\n## 度量与观测方案\n${plan.measurementPlan && plan.measurementPlan.length ? plan.measurementPlan.map(g => `- ${g}`).join('\n') : '（无）'}\n\n## 交付物\n${plan.deliverables && plan.deliverables.length ? plan.deliverables.map(g => `- ${g}`).join('\n') : '（无）'}\n\n## 术语表\n${plan.glossary && plan.glossary.length ? plan.glossary.map(g => `- ${g}`).join('\n') : '（无）'}\n\n## 待验证问题\n${plan.openQuestions && plan.openQuestions.length ? plan.openQuestions.map(g => `- ${g}`).join('\n') : '（无）'}\n\n## 假设/缺口\n${plan.assumptions.length ? plan.assumptions.map(a => `- ${a}`).join('\n') : '（无）'}\n\n## 风险\n${plan.risks.length ? plan.risks.map(r => `- ${r}`).join('\n') : '（无）'}\n`;
        const planUri = await createIssueMarkdown({
            markdownBody: planBody,
            frontmatter: {
                title: `${title}（调研计划）`,
                issue_prompt: false,
                issue_research_step: 'plan',
                issue_research_topic: topic,
                issue_research_kind: kind,
                issue_research_source_mode: sourceMode,
                issue_research_root_file: rootFileName,
                issue_root_file: rootFileName,
                issue_parent_file: rootFileName,
            },
        });
        if (planUri) {
            createdChildUris.push(planUri);
            createdChildFiles.push(fileNameFromUri(planUri));

            if (rootNodeId) {
                try {
                    await createIssueNodes([planUri], rootNodeId);
                } catch (e) {
                    Logger.getInstance().warn('[deepResearch] createIssueNodes 失败（plan child）', e);
                }
            }
        }

        progress.report({ message: '落盘：初稿文档...' });
        const draftBody = ensureH1(draft, `${title}（初稿）`);
        const draftUri = await createIssueMarkdown({
            markdownBody: draftBody,
            frontmatter: {
                title: `${title}（初稿）`,
                issue_prompt: false,
                issue_research_step: 'draft',
                issue_research_topic: topic,
                issue_research_kind: kind,
                issue_research_source_mode: sourceMode,
                issue_research_root_file: rootFileName,
                issue_root_file: rootFileName,
                issue_parent_file: rootFileName,
            },
        });
        if (draftUri) {
            createdChildUris.push(draftUri);
            createdChildFiles.push(fileNameFromUri(draftUri));

            if (rootNodeId) {
                try {
                    await createIssueNodes([draftUri], rootNodeId);
                } catch (e) {
                    Logger.getInstance().warn('[deepResearch] createIssueNodes 失败（draft child）', e);
                }
            }
        }

        progress.report({ message: '落盘：审阅记录...' });
        const reviewBody = `# ${title}（审阅记录）\n\n## 审阅要点\n\n${review.reviewNotes.trim()}\n\n## 产出说明\n\n- 本文档记录“审阅阶段的要点与修改依据”。\n- 终稿已写回根文档（便于在结构视图中集中查看）。\n`;
        const reviewUri = await createIssueMarkdown({
            markdownBody: reviewBody,
            frontmatter: {
                title: `${title}（审阅记录）`,
                issue_prompt: false,
                issue_research_step: 'review',
                issue_research_topic: topic,
                issue_research_kind: kind,
                issue_research_source_mode: sourceMode,
                issue_research_root_file: rootFileName,
                issue_root_file: rootFileName,
                issue_parent_file: rootFileName,
            },
        });
        if (reviewUri) {
            createdChildUris.push(reviewUri);
            createdChildFiles.push(fileNameFromUri(reviewUri));

            if (rootNodeId) {
                try {
                    await createIssueNodes([reviewUri], rootNodeId);
                } catch (e) {
                    Logger.getInstance().warn('[deepResearch] createIssueNodes 失败（review child）', e);
                }
            }
        }

        const finalMarkdownBody = ensureH1(review.finalMarkdown, title);
        const linksBlock = createdChildUris
            .map(u => buildFileWikiLink(u.fsPath, path.basename(u.fsPath)))
            .map(s => `- ${s}`)
            .join('\n');
        const enrichedFinalBody = `${finalMarkdownBody}\n\n---\n\n## 过程文档（可审计）\n\n${linksBlock || '（无）'}\n`;

        progress.report({ message: '写回：终稿内容 + 层级关系...' });
        await safeFinalizeRoot(
            {
                issue_children_files: createdChildFiles,
                issue_research_status: 'done',
                issue_research_generated_at: new Date().toISOString(),
            },
            enrichedFinalBody
        );

        progress.report({ message: '打开终稿并刷新视图...' });
        await vscode.window.showTextDocument(rootUri);
        void vscode.commands.executeCommand('issueManager.refreshAllViews');
    } catch (e) {
        const isCancelled = token.isCancellationRequested || signal.aborted;
        await safeFinalizeRoot(
            {
                issue_research_status: isCancelled ? 'cancelled' : 'failed',
                issue_children_files: createdChildFiles,
            },
            `# ${title}\n\n（生成${isCancelled ? '已取消' : '失败'}）\n\n## 已落盘的过程文档\n\n${createdChildUris
                .map(u => `- ${buildFileWikiLink(u.fsPath, path.basename(u.fsPath))}`)
                .join('\n') || '（无）'}\n`
        );
        throw e;
    }
}

export function registerDeepResearchIssueCommand(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('issueManager.deepResearchIssue', async () => {
            const topic = await promptTopic();
            if (!topic) {
                return;
            }

            const kind = await promptKind();
            if (!kind) {
                return;
            }

            const sourceMode = await promptSourceMode();
            if (!sourceMode) {
                return;
            }

            const includeEditor = await promptIncludeEditor();
            if (includeEditor === null) {
                return;
            }

            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Issue Manager：深度调研中',
                    cancellable: true,
                },
                async (progress, token) =>
                    runDeepResearchFlow({
                        topic,
                        kind,
                        sourceMode,
                        includeEditor,
                        progress,
                        token,
                    })
            );
        })
    );
}

export function registerDeepResearchIssueLocalCommand(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('issueManager.deepResearchIssueLocal', async () => {
            const topic = await promptTopic();
            if (!topic) {
                return;
            }

            const kind = await promptKind();
            if (!kind) {
                return;
            }

            const includeEditor = await promptIncludeEditor();
            if (includeEditor === null) {
                return;
            }

            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Issue Manager：深度调研（本地笔记）',
                    cancellable: true,
                },
                async (progress, token) =>
                    runDeepResearchFlow({
                        topic,
                        kind,
                        sourceMode: 'local',
                        includeEditor,
                        progress,
                        token,
                    })
            );
        })
    );
}

export function registerDeepResearchIssueLlmOnlyCommand(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('issueManager.deepResearchIssueLlmOnly', async () => {
            const topic = await promptTopic();
            if (!topic) {
                return;
            }

            const kind = await promptKind();
            if (!kind) {
                return;
            }

            const includeEditor = await promptIncludeEditor();
            if (includeEditor === null) {
                return;
            }

            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Issue Manager：深度调研（纯 LLM）',
                    cancellable: true,
                },
                async (progress, token) =>
                    runDeepResearchFlow({
                        topic,
                        kind,
                        sourceMode: 'llmOnly',
                        includeEditor,
                        progress,
                        token,
                    })
            );
        })
    );
}
