/**
 * 浏览工具：fetch_url
 */
import * as vscode from 'vscode';
import * as https from 'https';
import * as http from 'http';
import * as cheerio from 'cheerio';
import { Logger } from '../../core/utils/Logger';
import type { ToolCallResult } from './types';

const logger = Logger.getInstance();

// ─── 工具 schema ─────────────────────────────────────────────

/** 浏览器工具（browsing 工具包） */
export const BROWSING_TOOLS: vscode.LanguageModelChatTool[] = [
    {
        name: 'fetch_url',
        description: '抓取指定 URL 的网页内容，自动转为 Markdown 格式返回。' +
            '适合读取文档、博客、GitHub README、技术规范等静态页面。' +
            '注意：不支持需要 JavaScript 渲染的 SPA 页面（如 Twitter、某些 React 应用）。',
        inputSchema: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: '要抓取的完整 URL（包含 http:// 或 https://）',
                },
                maxLength: {
                    type: 'number',
                    description: '返回内容的最大字符数，默认 20000，最大 50000',
                },
            },
            required: ['url'],
        },
    },
];

// ─── 辅助函数 ────────────────────────────────────────────────

/** 发起 HTTP(S) GET，返回响应体文本 */
function httpGet(url: string, timeoutMs: number): Promise<{ body: string; contentType: string; statusCode: number }> {
    return new Promise((resolve, reject) => {
        const mod = url.startsWith('https') ? https : http;
        const req = mod.get(url, { timeout: timeoutMs }, (res) => {
            // 跟随重定向（最多 5 次）
            if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308)
                && res.headers.location) {
                req.destroy();
                httpGet(res.headers.location, timeoutMs).then(resolve).catch(reject);
                return;
            }
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => resolve({
                body: Buffer.concat(chunks).toString('utf-8'),
                contentType: res.headers['content-type'] || '',
                statusCode: res.statusCode || 0,
            }));
            res.on('error', reject);
        });
        req.on('timeout', () => { req.destroy(); reject(new Error(`请求超时（${timeoutMs / 1000}s）`)); });
        req.on('error', reject);
    });
}

/** HTML → Markdown（cheerio 提取正文，转为简洁 Markdown） */
function htmlToMarkdown(html: string, url: string): string {
    const $ = cheerio.load(html);

    // 去除无意义元素
    $('script, style, noscript, nav, footer, header, aside, iframe, [role="navigation"], [role="banner"], [role="complementary"]').remove();
    $('[class*="sidebar"], [class*="menu"], [class*="cookie"], [class*="popup"], [class*="modal"], [class*="ad-"], [id*="sidebar"]').remove();

    // 优先取正文区域
    const mainSelectors = ['article', 'main', '[role="main"]', '.content', '#content', '.post', '.article', '.markdown-body', '.readme'];
    let contentSelector = 'body';
    for (const sel of mainSelectors) {
        if ($(sel).length) { contentSelector = sel; break; }
    }

    // 标题
    const title = $('title').text().trim() || $('h1').first().text().trim();

    // 转换块级元素为 Markdown
    const lines: string[] = [];
    if (title) { lines.push(`# ${title}`, ''); }
    lines.push(`> 来源: ${url}`, '');

    $(`${contentSelector} h1, ${contentSelector} h2, ${contentSelector} h3, ${contentSelector} h4, ${contentSelector} h5, ${contentSelector} h6, ${contentSelector} p, ${contentSelector} li, ${contentSelector} pre, ${contentSelector} code, ${contentSelector} blockquote, ${contentSelector} td, ${contentSelector} th`).each((_, el) => {
        const tag = (el as { tagName?: string }).tagName?.toLowerCase() ?? '';
        const text = $(el).text().replace(/\s+/g, ' ').trim();
        if (!text) { return; }

        if (tag === 'h1') { lines.push(`# ${text}`, ''); }
        else if (tag === 'h2') { lines.push(`## ${text}`, ''); }
        else if (tag === 'h3') { lines.push(`### ${text}`, ''); }
        else if (tag === 'h4' || tag === 'h5' || tag === 'h6') { lines.push(`#### ${text}`, ''); }
        else if (tag === 'li') { lines.push(`- ${text}`); }
        else if (tag === 'blockquote') { lines.push(`> ${text}`, ''); }
        else if (tag === 'pre' || tag === 'code') { lines.push('```', text, '```', ''); }
        else if (tag === 'p') { lines.push(text, ''); }
        else if (tag === 'td' || tag === 'th') { lines.push(`| ${text}`); }
    });

    // 去除连续空行
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ─── 工具实现 ────────────────────────────────────────────────

async function executeFetchUrl(input: Record<string, unknown>): Promise<ToolCallResult> {
    const url = String(input.url || '').trim();
    if (!url) { return { success: false, content: '请提供 URL' }; }
    if (!/^https?:\/\//i.test(url)) { return { success: false, content: 'URL 必须以 http:// 或 https:// 开头' }; }

    const maxLength = Math.min(Number(input.maxLength) || 20000, 50000);
    const timeoutMs = 15000;

    try {
        const { body, contentType, statusCode } = await httpGet(url, timeoutMs);

        if (statusCode >= 400) {
            return { success: false, content: `HTTP ${statusCode}：请求失败` };
        }

        let content: string;
        if (contentType.includes('text/html')) {
            content = htmlToMarkdown(body, url);
        } else {
            // 纯文本/JSON/Markdown 直接返回
            content = body;
        }

        if (content.length > maxLength) {
            content = content.slice(0, maxLength) + `\n\n...[内容已截断，原始长度 ${content.length} 字符，可增大 maxLength 获取更多]`;
        }

        return { success: true, content };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { success: false, content: `抓取失败: ${msg}` };
    }
}

// ─── 导出 ────────────────────────────────────────────────────

export const BROWSING_HANDLERS: Record<string, (input: Record<string, unknown>) => Promise<ToolCallResult>> = {
    fetch_url: executeFetchUrl,
};
