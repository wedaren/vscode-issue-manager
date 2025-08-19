import { RSSMarkdownConverter } from '../src/services/converters/RSSMarkdownConverter';
import { RSSItem, RSSFeed } from '../src/services/types/RSSTypes';

// 测试RSS内容处理功能重构
async function testContentProcessing() {
    console.log('=== RSS内容处理功能测试 ===\n');

    // 模拟RSS文章数据
    const mockItem: RSSItem = {
        id: 'test-item-1',
        feedId: 'test-feed-1',
        title: '测试文章标题',
        link: 'https://example.com/article',
        description: '这是一个包含<strong>HTML标签</strong>的描述内容，用于测试内容处理功能。这个描述比较长，用来测试长度裁剪功能是否正常工作。',
        pubDate: new Date('2025-08-19T10:00:00Z'),
        content: `
            <h2>文章主要内容</h2>
            <p>这是文章的主要内容，包含了<em>各种HTML标签</em>和<a href="https://example.com">链接</a>。</p>
            <script>alert('这是危险的脚本');</script>
            <p>还有更多的内容用于测试处理器的效果。</p>
            <img src="https://example.com/image.jpg" alt="测试图片" />
        `,
        author: '测试作者',
        categories: ['技术', '测试']
    };

    const mockFeed: RSSFeed = {
        id: 'test-feed-1',
        name: '测试订阅源',
        url: 'https://example.com/rss',
        enabled: true,
        updateInterval: 60
    };

    console.log('1. 测试默认转换（使用内容处理）：');
    const defaultMarkdown = RSSMarkdownConverter.convertToMarkdown(mockItem, mockFeed, true);
    console.log(defaultMarkdown);
    console.log('\n' + '='.repeat(50) + '\n');

    console.log('2. 测试禁用内容处理：');
    const rawMarkdown = RSSMarkdownConverter.convertToMarkdown(mockItem, mockFeed, false);
    console.log(rawMarkdown);
    console.log('\n' + '='.repeat(50) + '\n');

    console.log('3. 测试自定义处理选项：');
    const customMarkdown = RSSMarkdownConverter.convertToMarkdown(mockItem, mockFeed, true, {
        preset: 'clean',
        options: {
            preserveHtml: true,
            preserveImages: true,
            preserveLinks: true,
            removeTags: ['script', 'style']
        }
    });
    console.log(customMarkdown);
    console.log('\n' + '='.repeat(50) + '\n');

    console.log('4. 测试摘要模式：');
    const summaryMarkdown = RSSMarkdownConverter.convertToMarkdown(mockItem, mockFeed, true, {
        preset: 'summary'
    });
    console.log(summaryMarkdown);
    console.log('\n' + '='.repeat(50) + '\n');

    console.log('5. 测试预览功能：');
    const previewMarkdown = RSSMarkdownConverter.generatePreviewMarkdown(mockItem, mockFeed, true);
    console.log('预览内容与转换内容是否一致:', previewMarkdown === defaultMarkdown);
    
    console.log('\n=== 测试完成 ===');
}

// 如果直接运行此文件，执行测试
if (require.main === module) {
    testContentProcessing().catch(console.error);
}

export { testContentProcessing };
