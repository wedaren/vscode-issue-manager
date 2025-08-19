/**
 * 测试 RSS Service 的 getItemMarkdown 性能优化
 */

const { RSSService } = require('./dist/services/RSSService');

async function testPerformance() {
    console.log('开始测试 RSS Service getItemMarkdown 性能优化...');
    
    try {
        // 获取 RSSService 实例
        const rssService = RSSService.getInstance();
        
        // 等待初始化完成
        await rssService.waitForInitialization();
        
        console.log('RSS Service 初始化完成');
        
        // 获取所有文章
        const allItems = rssService.getAllItems();
        console.log(`总文章数: ${allItems.length}`);
        
        if (allItems.length === 0) {
            console.log('没有文章可供测试');
            return;
        }
        
        // 测试性能 - 选择一个文章ID进行测试
        const testItemId = allItems[0].id;
        console.log(`测试文章ID: ${testItemId}`);
        
        // 执行多次查找以测试性能
        const iterations = 1000;
        const startTime = Date.now();
        
        for (let i = 0; i < iterations; i++) {
            const markdown = rssService.getItemMarkdown(testItemId);
            if (i === 0) {
                console.log(`首次查找结果: ${markdown ? '成功' : '失败'}`);
                if (markdown) {
                    console.log(`Markdown 长度: ${markdown.length} 字符`);
                }
            }
        }
        
        const endTime = Date.now();
        const totalTime = endTime - startTime;
        const averageTime = totalTime / iterations;
        
        console.log(`\n性能测试结果:`);
        console.log(`- 总迭代次数: ${iterations}`);
        console.log(`- 总耗时: ${totalTime}ms`);
        console.log(`- 平均每次查找耗时: ${averageTime.toFixed(3)}ms`);
        console.log(`- 每秒可处理查找次数: ${Math.round(1000 / averageTime)}`);
        
    } catch (error) {
        console.error('测试过程中出现错误:', error);
    }
}

// 运行测试
testPerformance().then(() => {
    console.log('测试完成');
}).catch(error => {
    console.error('测试失败:', error);
});
