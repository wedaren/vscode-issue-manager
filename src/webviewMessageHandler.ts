import * as vscode from 'vscode';
import { fetchArticle, getSegments } from './agent/reader';
import { callLLM } from './agent/llm';
import { getCache, setCache } from './cache/articleCache';

export async function handleWebviewMessage(panel: vscode.WebviewPanel, msg: any, context: vscode.ExtensionContext) {
  const cmd = msg?.command;
  if (cmd === 'fetchArticle') {
    const url = msg.url;
    if (!url) {
      panel.webview.postMessage({ type: 'error', message: '缺少 url 参数' });
      return;
    }
    const cacheKey = `article:${url}`;
    let article = getCache<{ title: string; html: string; text: string }>(cacheKey);
    if (!article) {
      try {
        article = await fetchArticle(url);
        setCache(cacheKey, article, 60 * 30);
      } catch (err: any) {
        panel.webview.postMessage({ type: 'error', message: String(err) });
        return;
      }
    }
    const segments = getSegments(article.text);
    panel.webview.postMessage({ type: 'article', payload: { ...article, segments } });
  } else if (cmd === 'llm') {
    const userText = msg.prompt || '';
    // 结构化 prompt：要求返回 JSON，仅返回 JSON
    const structuredPrompt = `请把下面的英文段落翻译成中文，并给出逐句或段落级别的解释，同时提取3个要点。仅返回一个 JSON 对象，格式如下：\n{\n  "translation": "<中文翻译>",\n  "explanation": "<解释文本>",\n  "keyPoints": ["要点1", "要点2", "要点3"],\n  "difficulty": "easy|medium|hard"\n}\n不要添加任何额外说明或注释。原文：\n${userText}`;

    const res = await callLLM(structuredPrompt, { provider: msg.provider, apiKey: msg.apiKey });

    // 尝试从返回文本中提取 JSON
    let candidate = String(res || '');
    // 优先提取 ```json ``` 区块
    const jsonBlock = candidate.match(/```json\s*([\s\S]*?)\s*```/i);
    if (jsonBlock && jsonBlock[1]) {
      candidate = jsonBlock[1];
    } else {
      // 回退：找到第一个 { 和最后一个 }
      const first = candidate.indexOf('{');
      const last = candidate.lastIndexOf('}');
      if (first !== -1 && last !== -1 && last > first) {
        candidate = candidate.substring(first, last + 1);
      }
    }

    try {
      const parsed = JSON.parse(candidate);
      panel.webview.postMessage({ type: 'llmResult', payload: parsed });
    } catch (err) {
      // 无法解析则返回原始文本，前端显示为普通文本
      panel.webview.postMessage({ type: 'llmResult', payload: String(res) });
    }
  } else {
    console.warn('Unknown webview command', cmd);
  }
}
