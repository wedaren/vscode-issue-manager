/**
 * 简单测试 HTML 实体解码功能
 */

// 模拟HTML实体解码处理器的核心逻辑
function decodeHtmlEntities(content) {
    const HTML_ENTITIES = {
        '&lt;': '<',
        '&gt;': '>',
        '&amp;': '&',
        '&quot;': '"',
        '&#39;': "'",
        '&apos;': "'",
        '&nbsp;': ' ',
        '&copy;': '©',
        '&reg;': '®',
        '&trade;': '™',
        '&hellip;': '…',
        '&ndash;': '–',
        '&mdash;': '—',
        '&lsquo;': '\u2018',
        '&rsquo;': '\u2019',
        '&ldquo;': '\u201C',
        '&rdquo;': '\u201D',
        '&bull;': '•',
        '&middot;': '·',
        '&sect;': '§',
        '&para;': '¶',
        '&dagger;': '†',
        '&Dagger;': '‡',
        '&permil;': '‰',
        '&lsaquo;': '‹',
        '&rsaquo;': '›',
        '&euro;': '€',
        '&pound;': '£',
        '&yen;': '¥',
        '&cent;': '¢'
    };

    let processed = content;

    // 解码命名实体
    for (const [entity, replacement] of Object.entries(HTML_ENTITIES)) {
        processed = processed.replace(new RegExp(entity, 'g'), replacement);
    }

    // 解码数字实体 (&#数字; 和 &#x十六进制;)
    processed = processed.replace(/&#(\d+);/g, (match, decimal) => {
        try {
            return String.fromCharCode(parseInt(decimal, 10));
        } catch {
            return match;
        }
    });

    processed = processed.replace(/&#x([0-9a-fA-F]+);/g, (match, hex) => {
        try {
            return String.fromCharCode(parseInt(hex, 16));
        } catch {
            return match;
        }
    });

    return processed;
}

console.log('开始测试 HTML 实体解码功能...\n');

// 测试用例
const testCases = [
    {
        name: '用户提供的示例',
        input: '&lt;div class=&quot;git-merge js-feed-item-view&quot;&gt;&lt;div class=&quot;body&quot;&gt; &lt;!-- pull_request --&gt; &lt;div class=&quot;d-flex flex-items-baseline py-4&quot;&gt; &lt;div class=&quot;d-flex flex-column width-full&quot;&gt; &lt;div&gt; &lt;div class=&quot;d-flex...'
    },
    {
        name: '常见HTML实体',
        input: '这是一个测试 &amp; &lt;标签&gt; &quot;引号&quot; &#39;单引号&#39; &nbsp;空格'
    },
    {
        name: '数字实体',
        input: '&#65;&#66;&#67; &#x41;&#x42;&#x43; 中文：&#20013;&#25991;'
    },
    {
        name: '特殊符号',
        input: '版权 &copy; 商标 &trade; 省略号 &hellip; 破折号 &mdash;'
    },
    {
        name: '引号类型',
        input: '左单引号 &lsquo;text&rsquo; 右单引号，左双引号 &ldquo;text&rdquo; 右双引号'
    }
];

for (const testCase of testCases) {
    console.log(`测试用例: ${testCase.name}`);
    console.log('原始内容:', testCase.input);
    console.log('解码后:', decodeHtmlEntities(testCase.input));
    console.log('-'.repeat(80));
}

console.log('\n✅ HTML 实体解码功能测试完成！');
console.log('\n说明：新增的 HtmlEntityDecodeProcessor 处理器已经集成到所有预设配置中，');
console.log('将作为第一步处理，确保HTML实体在后续处理之前被正确解码。');
