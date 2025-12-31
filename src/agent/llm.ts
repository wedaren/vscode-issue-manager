// 使用仓库内置的 LLMService 作为适配层，调用 Copilot / vscode.lm 接口
import { LLMService } from '../llm/LLMService';

export interface LLMOptions {
  // 目前保留占位字段，LLMService 使用 vscode 配置选择模型
  provider?: string;
  apiKey?: string;
}

export async function callLLM(prompt: string, opts?: LLMOptions): Promise<string> {
  // 将用户 prompt 直接转发给 LLMService.rewriteContent 以获取简洁回答
  try {
    const res = await LLMService.rewriteContent(prompt);
    return res || '';
  } catch (err) {
    console.error('callLLM error:', err);
    return '';
  }
}
