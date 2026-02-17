import { LLMService } from './LLMService';
import { Logger } from '../core/utils/Logger';

export interface AgentOptions {
    chunkSize?: number; // 以字符计
    overlap?: number; // 重叠字符数
    concurrency?: number;
}

function defaultOptions(): AgentOptions {
    return { chunkSize: 20000, overlap: 2000, concurrency: 2 };
}

function splitIntoChunks(text: string, chunkSize: number, overlap: number): string[] {
    if (!text) return [];
    const paragraphs = text.split(/\n\n+/);
    const chunks: string[] = [];
    let current = '';

    for (const p of paragraphs) {
        if ((current + '\n\n' + p).length <= chunkSize || current.length === 0) {
            current = current ? `${current}\n\n${p}` : p;
        } else {
            chunks.push(current);
            // build next starting with overlap
            const overlapText = current.slice(Math.max(0, current.length - overlap));
            current = overlapText + '\n\n' + p;
        }
    }
    if (current) chunks.push(current);
    return chunks;
}

function buildGlossary(text: string, maxTerms = 40): string {
    // 简单高频词提取：按词统计，排除常见停用词
    const stop = new Set(['the','and','is','in','to','of','a','for','with','that','this','on','it','as','are','by','an','be','or']);
    const words = text
        .replace(/[^\p{L}\p{N}_\s]+/gu, ' ')
        .split(/\s+/)
        .map(w => w.trim())
        .filter(Boolean)
        .map(w => w.toLowerCase());
    const freq = new Map<string, number>();
    for (const w of words) {
        if (stop.has(w) || w.length <= 2) continue;
        freq.set(w, (freq.get(w) || 0) + 1);
    }
    const arr = Array.from(freq.entries()).sort((a,b) => b[1]-a[1]).slice(0, maxTerms);
    return arr.map(a => a[0]).join(', ');
}

export async function translateWithAgent(
    text: string,
    targetLang: string,
    opts?: AgentOptions & { signal?: AbortSignal }
): Promise<string> {
    const options = { ...defaultOptions(), ...(opts || {}) };
    if (!text || !text.trim()) return '';

    const glossary = buildGlossary(text, 60);
    const chunks = splitIntoChunks(text, options.chunkSize!, options.overlap!);
    Logger.getInstance().info(`translationAgent: split into ${chunks.length} chunks`);

    const results: string[] = new Array(chunks.length).fill('');

    // 简单并发控制
    const concurrency = Math.max(1, options.concurrency || 1);
    let idx = 0;

    async function worker(): Promise<void> {
        while (true) {
            const i = idx++;
            if (i >= chunks.length) break;
            const chunk = chunks[i];
            if (opts?.signal?.aborted) throw new Error('cancelled');

            // 构建增强上下文：术语表 + 简短前文提示
            const previous = i > 0 ? (results[i-1] ? results[i-1].slice(-1000) : '') : '';
            const sendText = `术语表: ${glossary}\n前文摘要(如果有): ${previous}\n---\n${chunk}`;

            try {
                const translated = await LLMService.translate(sendText, targetLang, { signal: opts?.signal });
                results[i] = translated || '';
                Logger.getInstance().info(`translationAgent: chunk ${i} translated (${results[i].length} chars)`);
            } catch (err) {
                Logger.getInstance().error('translationAgent chunk translate error:', err);
                results[i] = '';
            }
        }
    }

    const workers: Promise<void>[] = [];
    for (let w = 0; w < concurrency; w++) workers.push(worker());
    await Promise.all(workers);

    // 简单拼接并返回
    const assembled = results.join('\n\n');

    // 可选：调用 LLM 进行最终润色（这里省略过多处理，直接返回拼接结果）
    return assembled;
}
