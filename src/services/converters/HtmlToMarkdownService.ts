import * as cheerio from 'cheerio';

/**
 * HTML 到 Markdown 转换服务
 * 负责将 HTML 内容转换为阅读友好的 Markdown 格式
 */
export class HtmlToMarkdownService {
    /**
     * 将 HTML 转换为 Markdown
     * @param html HTML 字符串
     * @param options 转换选项
     * @returns Markdown 字符串
     */
    public static convertToMarkdown(html: string, options: ConversionOptions = {}): string {
        const $ = cheerio.load(html);

        // 移除脚本和样式标签
        $('script, style, noscript').remove();

        // 从 body 或根元素开始转换
        const rootElement = $('body').length > 0 ? $('body') : $.root();
        
        let markdown = this.processNode(rootElement, $, 0, options);

        // 清理多余的空行
        markdown = markdown.replace(/\n{3,}/g, '\n\n').trim();

        return markdown;
    }

    /**
     * 递归处理 DOM 节点
     */
    private static processNode(
        node: cheerio.Cheerio<any>,
        $: cheerio.CheerioAPI,
        depth: number,
        options: ConversionOptions
    ): string {
        let result = '';

        node.contents().each((_, elem) => {
            const $elem = $(elem);
            
            if (elem.type === 'text') {
                // 处理文本节点
                const text = $elem.text().replace(/\s+/g, ' ');
                result += text;
            } else if (elem.type === 'tag') {
                // 处理元素节点
                result += this.convertElement($elem, $, depth, options);
            }
        });

        return result;
    }

    /**
     * 转换单个 HTML 元素
     */
    private static convertElement(
        $elem: cheerio.Cheerio<any>,
        $: cheerio.CheerioAPI,
        depth: number,
        options: ConversionOptions
    ): string {
        const tagName = $elem.prop('tagName')?.toLowerCase();
        
        if (!tagName) {
            return '';
        }

        switch (tagName) {
            case 'h1':
                return `\n\n# ${this.getTextContent($elem, $)}\n\n`;
            case 'h2':
                return `\n\n## ${this.getTextContent($elem, $)}\n\n`;
            case 'h3':
                return `\n\n### ${this.getTextContent($elem, $)}\n\n`;
            case 'h4':
                return `\n\n#### ${this.getTextContent($elem, $)}\n\n`;
            case 'h5':
                return `\n\n##### ${this.getTextContent($elem, $)}\n\n`;
            case 'h6':
                return `\n\n###### ${this.getTextContent($elem, $)}\n\n`;
            
            case 'p':
                return `\n\n${this.processNode($elem, $, depth, options)}\n\n`;
            
            case 'br':
                return '  \n';
            
            case 'hr':
                return '\n\n---\n\n';
            
            case 'strong':
            case 'b':
                return `**${this.getTextContent($elem, $)}**`;
            
            case 'em':
            case 'i':
                return `*${this.getTextContent($elem, $)}*`;
            
            case 'code':
                if ($elem.parent().prop('tagName')?.toLowerCase() === 'pre') {
                    // 如果在 pre 标签内，由 pre 处理
                    return this.getTextContent($elem, $);
                }
                return `\`${this.getTextContent($elem, $)}\``;
            
            case 'pre':
                const codeContent = this.getTextContent($elem, $);
                const language = this.detectLanguage($elem);
                return `\n\n\`\`\`${language}\n${codeContent}\n\`\`\`\n\n`;
            
            case 'a':
                const href = $elem.attr('href') || '';
                const linkText = this.getTextContent($elem, $);
                if (options.preserveLinks !== false) {
                    return `[${linkText}](${href})`;
                }
                return linkText;
            
            case 'img':
                if (options.preserveImages !== false) {
                    const src = $elem.attr('src') || '';
                    const alt = $elem.attr('alt') || '';
                    return `\n\n![${alt}](${src})\n\n`;
                }
                return '';
            
            case 'ul':
                return this.convertList($elem, $, depth, options, false);
            
            case 'ol':
                return this.convertList($elem, $, depth, options, true);
            
            case 'li':
                // li 的处理由 ul/ol 负责
                return this.processNode($elem, $, depth + 1, options);
            
            case 'blockquote':
                const quoteContent = this.processNode($elem, $, depth, options);
                return '\n\n' + quoteContent.split('\n').map(line => `> ${line}`).join('\n') + '\n\n';
            
            case 'table':
                return this.convertTable($elem, $, options);
            
            case 'div':
            case 'section':
            case 'article':
            case 'main':
            case 'aside':
            case 'header':
            case 'footer':
            case 'nav':
                // 块级元素，递归处理内容
                return `\n${this.processNode($elem, $, depth, options)}\n`;
            
            case 'span':
            case 'label':
                // 内联元素，直接处理内容
                return this.processNode($elem, $, depth, options);
            
            default:
                // 其他元素，递归处理内容
                return this.processNode($elem, $, depth, options);
        }
    }

    /**
     * 转换列表
     */
    private static convertList(
        $elem: cheerio.Cheerio<any>,
        $: cheerio.CheerioAPI,
        depth: number,
        options: ConversionOptions,
        ordered: boolean
    ): string {
        let result = '\n\n';
        const indent = '  '.repeat(depth);
        
        $elem.children('li').each((index, li) => {
            const $li = $(li);
            const content = this.processNode($li, $, depth, options).trim();
            const marker = ordered ? `${index + 1}.` : '-';
            result += `${indent}${marker} ${content}\n`;
        });
        
        return result + '\n';
    }

    /**
     * 转换表格
     */
    private static convertTable(
        $elem: cheerio.Cheerio<any>,
        $: cheerio.CheerioAPI,
        options: ConversionOptions
    ): string {
        let result = '\n\n';
        const rows: string[][] = [];
        
        // 提取表头
        const $thead = $elem.find('thead');
        if ($thead.length > 0) {
            $thead.find('tr').each((_, tr) => {
                const $tr = $(tr);
                const row: string[] = [];
                $tr.find('th, td').each((_, cell) => {
                    row.push(this.getTextContent($(cell), $).trim());
                });
                rows.push(row);
            });
        }
        
        // 提取表体
        const $tbody = $elem.find('tbody');
        const bodyRows = $tbody.length > 0 ? $tbody : $elem;
        bodyRows.find('tr').each((_, tr) => {
            const $tr = $(tr);
            // 跳过已经在 thead 中处理的行
            if ($thead.length > 0 && $tr.parent().prop('tagName')?.toLowerCase() === 'thead') {
                return;
            }
            const row: string[] = [];
            $tr.find('td, th').each((_, cell) => {
                row.push(this.getTextContent($(cell), $).trim());
            });
            if (row.length > 0) {
                rows.push(row);
            }
        });
        
        if (rows.length === 0) {
            return '';
        }
        
        // 生成 Markdown 表格
        const maxCols = Math.max(1, ...rows.map(r => r.length));
        
        // 表头
        if (rows.length > 0) {
            result += '| ' + rows[0].map(cell => cell || ' ').join(' | ') + ' |\n';
            result += '| ' + Array(maxCols).fill('---').join(' | ') + ' |\n';
            
            // 表体
            for (let i = 1; i < rows.length; i++) {
                result += '| ' + rows[i].map(cell => cell || ' ').join(' | ') + ' |\n';
            }
        }
        
        return result + '\n';
    }

    /**
     * 获取元素的纯文本内容
     */
    private static getTextContent($elem: cheerio.Cheerio<any>, $: cheerio.CheerioAPI): string {
        // 对于某些元素，需要递归处理以保留内联格式
        const tagName = $elem.prop('tagName')?.toLowerCase();
        if (tagName === 'a' || tagName === 'code' || tagName === 'pre') {
            return $elem.text().trim();
        }
        
        // 处理包含内联格式的文本
        let text = '';
        $elem.contents().each((_, node) => {
            if (node.type === 'text') {
                text += $(node).text();
            } else if (node.type === 'tag') {
                const $node = $(node);
                const childTag = $node.prop('tagName')?.toLowerCase();
                
                if (childTag === 'strong' || childTag === 'b') {
                    text += `**${$node.text().trim()}**`;
                } else if (childTag === 'em' || childTag === 'i') {
                    text += `*${$node.text().trim()}*`;
                } else if (childTag === 'code') {
                    text += `\`${$node.text().trim()}\``;
                } else if (childTag === 'br') {
                    text += '  \n';
                } else {
                    text += this.getTextContent($node, $);
                }
            }
        });
        
        return text.trim();
    }

    /**
     * 检测代码块语言
     */
    private static detectLanguage($elem: cheerio.Cheerio<any>): string {
        // 尝试从 class 属性中提取语言
        const classAttr = $elem.attr('class') || '';
        const languageMatch = classAttr.match(/language-(\w+)/);
        if (languageMatch) {
            return languageMatch[1];
        }
        
        // 检查子元素的 class
        const $code = $elem.find('code');
        if ($code.length > 0) {
            const codeClass = $code.attr('class') || '';
            const codeLangMatch = codeClass.match(/language-(\w+)/);
            if (codeLangMatch) {
                return codeLangMatch[1];
            }
        }
        
        return '';
    }
}

/**
 * HTML 到 Markdown 转换选项
 */
export interface ConversionOptions {
    /**
     * 是否保留链接（默认 true）
     */
    preserveLinks?: boolean;
    
    /**
     * 是否保留图片（默认 true）
     */
    preserveImages?: boolean;
    
    /**
     * 是否移除空白元素（默认 true）
     */
    removeEmptyElements?: boolean;
}
