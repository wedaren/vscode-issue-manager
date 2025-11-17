import * as vscode from 'vscode';
import * as path from 'path';

/**
 * 过滤关键字提取结果
 */
export interface FilterKeywordResult {
    /** 提取的关键字 */
    keyword: string;
    /** 是否检测到触发前缀 */
    hasTrigger: boolean;
    /** 触发前缀名称（如果有） */
    triggerName?: string;
}

/**
 * 从光标位置提取过滤关键字
 * 规则：
 * 1. 如果检测到触发前缀（如 [[ 或 @issue:），则从触发前缀之后开始提取
 * 2. 否则从最后一个空白字符之后开始提取
 * 3. 清理两端标点符号
 * 
 * @param document 文档
 * @param position 光标位置
 * @param triggers 触发前缀列表（可选）
 * @param maxLength 最大关键字长度（默认 200）
 */
export function extractFilterKeyword(
    document: vscode.TextDocument,
    position: vscode.Position,
    triggers: string[] = ['[['],
    maxLength: number = 200
): FilterKeywordResult {
    // 获取当前行文本
    const lineText = document.lineAt(position.line).text;
    // 获取光标之前的文本
    const prefix = lineText.slice(0, position.character);

    // 检查是否有触发前缀
    for (const trigger of triggers) {
        const triggerIndex = prefix.lastIndexOf(trigger);
        if (triggerIndex !== -1) {
            // 找到触发前缀，提取其后的文本
            let keyword = prefix.slice(triggerIndex + trigger.length);
            keyword = cleanKeyword(keyword, maxLength);
            return {
                keyword,
                hasTrigger: true,
                triggerName: trigger
            };
        }
    }

    // 没有触发前缀，使用默认规则：找到最后一个空白字符
    const lastWhitespaceMatch = prefix.match(/\s(?=\S*$)/);
    const lastWhitespaceIndex = lastWhitespaceMatch ? lastWhitespaceMatch.index! + 1 : 0;
    
    let keyword = prefix.slice(lastWhitespaceIndex);
    keyword = cleanKeyword(keyword, maxLength);

    return {
        keyword,
        hasTrigger: false
    };
}

/**
 * 清理关键字：去除两端空白和标点
 */
function cleanKeyword(keyword: string, maxLength: number): string {
    // 去除两端空白
    keyword = keyword.trim();

    // 截断过长的关键字
    if (keyword.length > maxLength) {
        keyword = keyword.slice(0, maxLength);
    }

    // 去除起始的常见标点符号
    keyword = keyword.replace(/^[([<`"']+/, '');
    
    // 去除结尾的常见标点符号
    keyword = keyword.replace(/[)\]>`"']+$/, '');

    return keyword;
}

/**
 * 判断文档是否在指定目录下
 */
export function isDocumentInDirectory(
    document: vscode.TextDocument,
    directory: string
): boolean {
    if (!document.uri.fsPath || !directory) {
        return false;
    }

    const relativePath = path.relative(directory, document.uri.fsPath);
    
    return !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}
