import * as vscode from 'vscode';
import { LLMService } from '../llm/LLMService';
import { getIssueMarkdown, isIssueMarkdown } from '../data/IssueMarkdowns';

/**
 * 简要描述：注册基于 LLM 的拼音注释命令。
 * 设计思路：使用已封装的 `LLMService` 调用 Copilot/语言模型，生成与选中文本对应的拼音注释，
 * 然后将拼音以可读格式追加到文档中。
 */
export function registerAnnotatePinyinWithLLMCommand(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand('issueManager.annotatePinyinWithLLM', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('请在活动编辑器中选中文本后执行本命令。');
                return;
            }

            const uri = editor.document.uri;
            // 仅限 IssueMarkdown 文件
            try {
                if (!(await isIssueMarkdown(await getIssueMarkdown(uri)))) {
                    vscode.window.showInformationMessage('仅支持在 IssueMarkdown 文件中运行此命令。');
                    return;
                }
            } catch {
                // ignore and continue
            }

            const sel = editor.selection;
            if (sel.isEmpty) {
                vscode.window.showInformationMessage('请先选中文本');
                return;
            }

            const text = editor.document.getText(sel).trim();
            if (!text) {
                vscode.window.showInformationMessage('选中文本为空');
                return;
            }

            await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: '正在调用 LLM 生成拼音注释...', cancellable: true }, async (progress, token) => {
                const ac = new AbortController();
                token.onCancellationRequested(() => ac.abort());

                const prompt = `请将以下中文文本逐字或逐词转写为标准汉语拼音，必须包含声调符号（例如：zhōng xīn），不要使用数字标注声调。仅返回一行纯文本的拼音，词或字之间用空格分隔，不要添加任何解释或额外说明。\n文本："${text}"`;

                try {
                    const resp = await LLMService.chat([vscode.LanguageModelChatMessage.User(prompt)], { signal: ac.signal });
                    if (!resp || !resp.text) {
                        vscode.window.showErrorMessage('LLM 未返回拼音结果');
                        return;
                    }

                    let pinyin = resp.text.trim();
                    // 移除代码块或 JSON 包裹
                    const codeBlockMatch = pinyin.match(/```(?:\w+)?\n([\s\S]*?)\n```/);
                    if (codeBlockMatch && codeBlockMatch[1]) {
                        pinyin = codeBlockMatch[1].trim();
                    } else {
                        // 尝试只保留首行有字母/空格的部分
                        const lines = pinyin.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
                        if (lines.length > 0) pinyin = lines[0];
                    }

                    // 如果 LLM 返回的是数字声调（如 zhong1 xin1），尝试转换为带声调符号
                    const hasDigitTone = /[1-5]\b/.test(pinyin);
                    if (hasDigitTone) {
                        pinyin = convertNumericPinyinToDiacritics(pinyin);
                    }

                    if (!pinyin) {
                        vscode.window.showErrorMessage('未能解析出拼音结果');
                        return;
                    }

                    const insertText = ` （拼音: ${pinyin}）`;
                    const edit = new vscode.WorkspaceEdit();
                    edit.insert(editor.document.uri, sel.end, insertText);
                    const ok = await vscode.workspace.applyEdit(edit);
                    if (!ok) {
                        vscode.window.showErrorMessage('插入拼音失败');
                        return;
                    }

                    const doc = await vscode.workspace.openTextDocument(editor.document.uri);
                    if (doc.isDirty) await doc.save();
                    vscode.window.showInformationMessage('已追加 LLM 生成的拼音注释');
                } catch (e) {
                    if (ac.signal.aborted) {
                        vscode.window.showInformationMessage('已取消 LLM 请求');
                        return;
                    }
                    console.error(e);
                    vscode.window.showErrorMessage('调用 LLM 生成拼音失败');
                }
            });
        })
    );
}

export default registerAnnotatePinyinWithLLMCommand;

/**
 * 将数字声调拼音（如 zhong1）转换为带声调符号的拼音（如 zhōng）。
 * 简单实现：对每个以数字结尾的音节应用拼音声调规则（优先在 a,o,e 上标注，特殊组合 iu/ui 标在后一元音）。
 */
function convertNumericPinyinToDiacritics(input: string): string {
    const toneMap: Record<string, string[]> = {
        a: ['ā','á','ǎ','à'],
        o: ['ō','ó','ǒ','ò'],
        e: ['ē','é','ě','è'],
        i: ['ī','í','ǐ','ì'],
        u: ['ū','ú','ǔ','ù'],
        ü: ['ǖ','ǘ','ǚ','ǜ'],
        v: ['ǖ','ǘ','ǚ','ǜ']
    };

    return input.split(/(\s+)/).map(token => {
        // 保留空白
        if (/^\s+$/.test(token)) return token;
        // 处理诸如 'zhong1' 或 'zhong1,' 等
        const m = token.match(/^([A-Za-züÜvV:]+?)([1-5])([,.;:?!)"']*)$/);
        if (!m) return token;
        let syl = m[1];
        const tone = parseInt(m[2], 10);
        const trailing = m[3] || '';
        if (tone === 5 || tone === 0) return syl + trailing; // 轻声或无调

        // 规范化 v 或 : 为 ü
        syl = syl.replace(/V/ig, 'v').replace(/:/g, 'ü');
        syl = syl.replace(/v/g, 'ü');

        // 找到应标注的元音位置
        const lower = syl.toLowerCase();
        // 特殊规则：如果包含 'iu' 标在 u，'ui' 标在 i
        let targetIdx = -1;
        if (/(iu)/i.test(lower)) {
            targetIdx = lower.indexOf('u');
        } else if (/(ui)/i.test(lower)) {
            targetIdx = lower.indexOf('i');
        } else {
            for (const vowel of ['a','o','e','i','u','ü']) {
                const idx = lower.indexOf(vowel);
                if (idx !== -1) { targetIdx = idx; break; }
            }
        }

        if (targetIdx === -1) return syl + trailing; // 没找到元音，返回原样

        const ch = syl[targetIdx];
        const key = ch.toLowerCase();
        const arr = toneMap[key];
        if (!arr) return syl + trailing;
        const toneChar = arr[tone - 1];
        // 保持原字符大小写
        const finalChar = (ch === ch.toUpperCase()) ? toneChar.toUpperCase() : toneChar;
        const res = syl.slice(0, targetIdx) + finalChar + syl.slice(targetIdx + 1);
        return res + trailing;
    }).join('');
}
