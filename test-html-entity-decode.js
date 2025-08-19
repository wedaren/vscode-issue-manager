/**
 * 测试 HTML 实体解码功能
 */

// 模拟 CommonJS 环境
const fs = require('fs');
const path = require('path');

// 手动导入编译后的类
const { RSSMarkdownConverter } = require('./dist/services/converters/RSSMarkdownConverter');
const { RSSItem } = require('./dist/services/types/RSSTypes');

async function testHtmlEntityDecoding() {
    console.log('开始测试 HTML 实体解码功能...\n');

    // 创建包含HTML实体的测试内容
    const testContent = `&lt;div class=&quot;git-merge js-feed-item-view&quot;&gt;&lt;div class=&quot;body&quot;&gt; &lt;!-- pull_request --&gt; &lt;div class=&quot;d-flex flex-items-baseline py-4&quot;&gt; &lt;div class=&quot;d-flex flex-column width-full&quot;&gt; &lt;div&gt; &lt;div class=&quot;d-flex...`;

    // 创建测试的RSS项目
    const testItem = {
        id: 'test-html-entity-1',
        feedId: 'test-feed',
        title: 'HTML实体解码测试 &amp; &quot;引号&quot; &lt;标签&gt;',
        link: 'https://example.com/test',
        description: '这是一个包含HTML实体的描述：&amp; &lt; &gt; &quot; &#39; &nbsp;',
        content: testContent,
        pubDate: new Date(),
        author: '测试作者 &amp; 开发者'
    };

    const testFeed = {
        id: 'test-feed',
        name: '测试订阅源 &amp; HTML实体',
        url: 'https://example.com/feed'
    };

    try {
        console.log('原始内容:');
        console.log('标题:', testItem.title);
        console.log('描述:', testItem.description);
        console.log('内容前100字符:', testItem.content.substring(0, 100));
        console.log('作者:', testItem.author);
        console.log('\n' + '='.repeat(80) + '\n');

        // 测试不同的处理预设
        const presets = ['concise', 'summary', 'clean', 'plain'];

        for (const preset of presets) {
            console.log(`测试预设: ${preset}`);
            console.log('-'.repeat(40));

            const markdown = RSSMarkdownConverter.convertToMarkdown(
                testItem, 
                testFeed, 
                true, 
                { preset: preset }
            );

            console.log('转换后的Markdown（前300字符）:');
            console.log(markdown.substring(0, 300));
            console.log('...\n');
        }

        // 测试直接使用HTML实体解码处理器
        console.log('测试仅使用HTML实体解码处理器:');
        console.log('-'.repeat(40));

        const entityOnlyMarkdown = RSSMarkdownConverter.convertToMarkdown(
            testItem,
            testFeed,
            true,
            {
                processors: ['html-entity-decode'],
                options: {}
            }
        );

        console.log('仅解码HTML实体后的结果（前300字符）:');
        console.log(entityOnlyMarkdown.substring(0, 300));
        console.log('...\n');

        console.log('✅ HTML实体解码功能测试完成');

    } catch (error) {
        console.error('❌ 测试过程中出现错误:', error);
    }
}

// 运行测试
testHtmlEntityDecoding().then(() => {
    console.log('\n测试完成');
}).catch(error => {
    console.error('测试失败:', error);
});
