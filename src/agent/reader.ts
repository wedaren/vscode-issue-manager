import { segmentText } from './segment';

export async function fetchArticle(url: string): Promise<{ title: string; html: string; text: string }> {
  // 运行时环境可能需要安装 node-fetch；这里尽量使用全局 fetch，如果没有则动态导入 node-fetch
  // TODO: 在 production 中使用更健壮的抓取与错误处理（超时、重试、User-Agent 等）
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fetchImpl: any = (globalThis as any).fetch ?? (await import('node-fetch')).default;
  const res = await fetchImpl(url);
  const html = await res.text();
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : url;
  const text = extractText(html);
  return { title, html, text };
}

export function extractText(html: string): string {
  // 非严格的 HTML -> 文本抽取，去掉 script/style 并移除标签
  const withoutScripts = html.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');
  const withoutStyles = withoutScripts.replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '');
  const text = withoutStyles.replace(/<[^>]+>/g, ' ');
  // 将多个空白折叠并按段落拆分
  return text.replace(/\s+/g, ' ').trim();
}

export function getSegments(text: string, maxChars = 1200) {
  return segmentText(text, maxChars);
}
