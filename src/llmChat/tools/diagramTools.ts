/**
 * 图表渲染与校验工具
 *
 * - render_diagram：将 LLM 生成的 SVG XML 保存为文件，自动补齐 xmlns，
 *   基础结构校验不过时拒绝保存并返回可行动的错误信息。
 * - verify_diagram：对已保存的 SVG 做静态结构分析（viewBox、元素统计、
 *   rect/text 溢出检测），给 LLM 一个确定性的"这张图哪里不对"反馈。
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import { ImageStorageService } from '../../services/storage/ImageStorageService';
import { Logger } from '../../core/utils/Logger';
import type { ToolCallResult } from './types';

const logger = Logger.getInstance();

// ─── Schema ──────────────────────────────────────────────────────────────────

export const DIAGRAM_TOOLS: vscode.LanguageModelChatTool[] = [
    {
        name: 'render_diagram',
        description:
            '将 SVG XML 源码保存为图片文件，返回可在 Markdown 中直接引用的路径。\n' +
            '保存前自动校验 XML 结构并补齐 xmlns；校验不通过时返回错误信息，请据此修复后重试。\n' +
            '成功后建议立即调用 verify_diagram 做结构自检。',
        inputSchema: {
            type: 'object',
            properties: {
                code: {
                    type: 'string',
                    description: 'SVG XML 源码，以 <svg ...>...</svg> 为根元素',
                },
                filename: {
                    type: 'string',
                    description: '可选文件名前缀（不含扩展名），如 "architecture"、"flow_chart"',
                },
            },
            required: ['code'],
        },
    },
    {
        name: 'verify_diagram',
        description:
            '对刚保存的 SVG 图表做静态结构分析，返回校验报告。\n' +
            '检查项：XML 结构平衡、xmlns、viewBox、元素统计、rect/text 是否溢出 viewBox。\n' +
            '建议在 render_diagram 成功后立即调用一次；若报告发现问题，修复 SVG 代码并重新 render_diagram。',
        inputSchema: {
            type: 'object',
            properties: {
                relativePath: {
                    type: 'string',
                    description: 'render_diagram 返回的相对路径，如 ImageDir/diag_xxx.svg',
                },
            },
            required: ['relativePath'],
        },
    },
];

// ─── Handlers ────────────────────────────────────────────────────────────────

export const DIAGRAM_HANDLERS: Record<
    string,
    (input: Record<string, unknown>, ctx?: import('./types').ToolExecContext) => Promise<ToolCallResult>
> = {
    render_diagram: async (input) => {
        const code = input.code as string;
        const prefix = (input.filename as string | undefined) ?? 'diag';

        if (!code?.trim()) {
            return { success: false, content: '缺少图表代码（code 参数为空）' };
        }

        const prepared = prepareSvg(code);
        if (!prepared.ok) {
            return { success: false, content: `SVG 结构校验失败：${prepared.reason}\n\n请修正后重新调用 render_diagram。` };
        }

        try {
            const buf = Buffer.from(prepared.svg, 'utf8');
            const result = await ImageStorageService.save(buf, 'image/svg+xml', prefix);
            if (!result) {
                return { success: false, content: '保存图表失败：请先配置 issueManager.imageDir' };
            }
            const note = prepared.autoPatched.length > 0
                ? `\n\n已自动修正：${prepared.autoPatched.join('、')}`
                : '';
            return {
                success: true,
                content:
                    `图表已保存：${result.relativePath}${note}\n\n` +
                    `在回复中使用 ![图表](${result.relativePath}) 插入图表。\n` +
                    `建议立即调用 verify_diagram("${result.relativePath}") 做结构自检。`,
            };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error(`[render_diagram] error: ${msg}`);
            return { success: false, content: `保存失败：${msg}` };
        }
    },

    verify_diagram: async (input) => {
        const rel = input.relativePath as string;
        if (!rel?.trim()) {
            return { success: false, content: '缺少 relativePath 参数' };
        }
        const uri = ImageStorageService.resolve(rel);
        if (!uri) {
            return { success: false, content: `无法解析路径：${rel}（请确认是 render_diagram 返回的 ImageDir/... 相对路径）` };
        }
        let svg: string;
        try {
            svg = await fs.promises.readFile(uri.fsPath, 'utf8');
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { success: false, content: `读取文件失败：${msg}` };
        }

        const report = analyzeSvg(svg);
        const lines: string[] = [];
        lines.push(`**SVG 校验报告：${rel}**`);
        lines.push('');
        lines.push(`- 文件大小：${(svg.length / 1024).toFixed(1)} KB`);
        lines.push(`- 结构平衡：${report.wellFormed ? '✓' : '❌ 开合标签数量不匹配'}`);
        lines.push(`- xmlns：${report.hasXmlns ? '✓' : '❌ 缺失（会导致部分渲染器拒绝）'}`);
        lines.push(`- viewBox：${report.viewBox ? `✓ \`${report.viewBox}\`` : '⚠️ 缺失（推荐补上以保证缩放正确）'}`);
        lines.push(`- 元素统计：${report.elementCounts || '（无可识别元素）'}`);

        const hasProblems =
            !report.wellFormed ||
            !report.hasXmlns ||
            report.overflowWarnings.length > 0;

        if (report.overflowWarnings.length > 0) {
            lines.push('');
            lines.push(`⚠️ **检测到 ${report.overflowWarnings.length} 处可能溢出 viewBox 的元素**：`);
            for (const w of report.overflowWarnings.slice(0, 10)) {
                lines.push(`  - ${w}`);
            }
            if (report.overflowWarnings.length > 10) {
                lines.push(`  - …还有 ${report.overflowWarnings.length - 10} 处（仅展示前 10）`);
            }
        }

        lines.push('');
        if (hasProblems) {
            lines.push('> 建议：修复上述问题后重新调用 render_diagram，然后再次 verify_diagram 确认。');
        } else {
            lines.push('> 整体结构通过静态检查，可以在回复中引用该图表。');
        }

        return { success: true, content: lines.join('\n') };
    },
};

// ─── SVG 预处理（render_diagram 保存前） ─────────────────────────────────────

interface PrepareSvgResult {
    ok: boolean;
    svg: string;
    reason?: string;
    /** 自动修正项（如 "补齐 xmlns"），用于返回给 LLM 提示 */
    autoPatched: string[];
}

/**
 * 对 LLM 生成的 SVG 做保存前的最小必要校验与自动修正：
 *   1. 剥离代码块围栏（LLM 偶尔会多包一层 ```svg）
 *   2. 必须存在 <svg 开标签与 </svg> 闭标签
 *   3. 开合标签数量大致平衡（宽松检查，不强制）
 *   4. 缺失 xmlns 时自动补齐
 */
function prepareSvg(raw: string): PrepareSvgResult {
    const autoPatched: string[] = [];
    let svg = raw.trim();

    // 剥离 ```svg ... ``` 或 ``` ... ``` 围栏
    const fenceMatch = /^```(?:\w+)?\n([\s\S]*?)\n```$/.exec(svg);
    if (fenceMatch) {
        svg = fenceMatch[1].trim();
        autoPatched.push('去掉 markdown 代码围栏');
    }

    if (!/<svg\b/i.test(svg)) {
        return { ok: false, svg, reason: '未找到 <svg ...> 根元素', autoPatched };
    }
    if (!/<\/svg\s*>/i.test(svg)) {
        return { ok: false, svg, reason: '未找到 </svg> 闭合标签', autoPatched };
    }

    // 宽松的开合平衡：忽略自闭合、注释和 CDATA
    const stripped = svg
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
        .replace(/<\?[\s\S]*?\?>/g, '')
        .replace(/<[a-zA-Z][^>]*\/\s*>/g, ''); // 去掉所有自闭合
    const openCount = (stripped.match(/<[a-zA-Z][^>]*>/g) || []).length;
    const closeCount = (stripped.match(/<\/[a-zA-Z]/g) || []).length;
    if (openCount !== closeCount) {
        return {
            ok: false,
            svg,
            reason: `开合标签数量不平衡（open=${openCount}, close=${closeCount}），可能存在未闭合的 <g>/<text> 等`,
            autoPatched,
        };
    }

    // 自动补齐 xmlns
    if (!/xmlns\s*=\s*["']http:\/\/www\.w3\.org\/2000\/svg["']/.test(svg)) {
        svg = svg.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
        autoPatched.push('补齐 xmlns 属性');
    }

    return { ok: true, svg, autoPatched };
}

// ─── SVG 静态分析（verify_diagram） ──────────────────────────────────────────

interface SvgReport {
    wellFormed: boolean;
    hasXmlns: boolean;
    viewBox?: string;
    elementCounts: string;
    overflowWarnings: string[];
}

function analyzeSvg(svg: string): SvgReport {
    const hasXmlns = /xmlns\s*=\s*["']http:\/\/www\.w3\.org\/2000\/svg["']/.test(svg);

    // 结构平衡（同 prepareSvg 的宽松检查）
    const stripped = svg
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
        .replace(/<\?[\s\S]*?\?>/g, '')
        .replace(/<[a-zA-Z][^>]*\/\s*>/g, '');
    const openCount = (stripped.match(/<[a-zA-Z][^>]*>/g) || []).length;
    const closeCount = (stripped.match(/<\/[a-zA-Z]/g) || []).length;
    const wellFormed = openCount === closeCount;

    // viewBox 解析
    let viewBoxStr: string | undefined;
    let vbX = 0, vbY = 0, vbW = 0, vbH = 0;
    const vbMatch = /viewBox\s*=\s*["']([^"']+)["']/.exec(svg);
    if (vbMatch) {
        const parts = vbMatch[1].trim().split(/[\s,]+/).map(Number);
        if (parts.length === 4 && parts.every(n => Number.isFinite(n))) {
            [vbX, vbY, vbW, vbH] = parts;
            viewBoxStr = `${vbX} ${vbY} ${vbW} ${vbH}`;
        }
    }

    // 元素统计
    const countedTags = ['rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path', 'text', 'g', 'defs', 'marker'];
    const counts: string[] = [];
    for (const t of countedTags) {
        const re = new RegExp(`<${t}\\b`, 'g');
        const n = (svg.match(re) || []).length;
        if (n > 0) { counts.push(`${n} ${t}`); }
    }

    // 溢出检测（仅 rect/text 的直接坐标；忽略 transform、嵌套 g 的场景，避免过度推断）
    const overflowWarnings: string[] = [];
    if (viewBoxStr) {
        for (const m of svg.matchAll(/<rect\b([^>]*?)\/?>/g)) {
            const attrs = m[1];
            const x = parseAttrNumber(attrs, 'x') ?? 0;
            const y = parseAttrNumber(attrs, 'y') ?? 0;
            const w = parseAttrNumber(attrs, 'width') ?? 0;
            const h = parseAttrNumber(attrs, 'height') ?? 0;
            if (x < vbX || y < vbY || x + w > vbX + vbW || y + h > vbY + vbH) {
                overflowWarnings.push(`rect (x=${x},y=${y},w=${w},h=${h}) 超出 viewBox`);
            }
        }
        for (const m of svg.matchAll(/<text\b([^>]*?)>([\s\S]*?)<\/text>/g)) {
            const attrs = m[1];
            const body = m[2];
            const x = parseAttrNumber(attrs, 'x');
            const y = parseAttrNumber(attrs, 'y');
            if (x === undefined || y === undefined) { continue; }
            const sample = body.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 30);
            if (x < vbX || x > vbX + vbW || y < vbY || y > vbY + vbH) {
                overflowWarnings.push(`text "${sample}" at (${x},${y}) 超出 viewBox`);
            }
        }
    }

    return {
        wellFormed,
        hasXmlns,
        viewBox: viewBoxStr,
        elementCounts: counts.join(', '),
        overflowWarnings,
    };
}

/** 从属性串中解析数值属性；支持带或不带单位（取首段数字）。 */
function parseAttrNumber(attrs: string, name: string): number | undefined {
    const m = new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`).exec(attrs);
    if (!m) { return undefined; }
    const numMatch = /-?\d+(\.\d+)?/.exec(m[1]);
    if (!numMatch) { return undefined; }
    const n = Number(numMatch[0]);
    return Number.isFinite(n) ? n : undefined;
}
