/**
 * RSS服务历史功能测试
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import { RSSService } from '../services/RSSService';

suite('RSSService History Tests', () => {

    let rssService: RSSService;

    setup(() => {
        rssService = RSSService.getInstance();
    });

    teardown(() => {
        if (rssService) {
            rssService.dispose();
        }
    });

    test('应该能够获取历史统计信息', async () => {
        // 添加一个测试订阅源
        await rssService.addFeed('test-feed', 'https://example.com/rss.xml');
        
        // 获取历史统计
        const stats = rssService.getHistoryStats();
        
        assert.strictEqual(typeof stats.totalItems, 'number');
        assert.strictEqual(typeof stats.itemsByFeed, 'object');
        assert.strictEqual(stats.totalItems, 0); // 初始状态应该为0
    });

    test('应该能够清理旧的文章记录', async () => {
        // 添加一个测试订阅源
        await rssService.addFeed('test-feed', 'https://example.com/rss.xml');
        
        // 清理旧记录
        const result = await rssService.cleanupOldItems(30);
        
        assert.strictEqual(typeof result.removedCount, 'number');
        assert.strictEqual(result.removedCount, 0); // 初始状态应该没有记录被清理
    });

    test('应该能够正确管理订阅源', async () => {
        // 测试添加订阅源
        await rssService.addFeed('test-feed', 'https://example.com/rss.xml');
        
        const feeds = rssService.getFeeds();
        assert.strictEqual(feeds.length, 1);
        assert.strictEqual(feeds[0].name, 'test-feed');
        assert.strictEqual(feeds[0].url, 'https://example.com/rss.xml');
        assert.strictEqual(feeds[0].enabled, true);
        
        // 测试删除订阅源
        await rssService.removeFeed(feeds[0].id);
        
        const feedsAfterRemoval = rssService.getFeeds();
        assert.strictEqual(feedsAfterRemoval.length, 0);
    });

    test('应该能够切换订阅源启用状态', async () => {
        // 添加一个测试订阅源
        await rssService.addFeed('test-feed', 'https://example.com/rss.xml');
        
        const feeds = rssService.getFeeds();
        const feedId = feeds[0].id;
        
        // 禁用订阅源
        await rssService.toggleFeed(feedId, false);
        
        const updatedFeeds = rssService.getFeeds();
        assert.strictEqual(updatedFeeds[0].enabled, false);
        
        // 重新启用订阅源
        await rssService.toggleFeed(feedId, true);
        
        const reEnabledFeeds = rssService.getFeeds();
        assert.strictEqual(reEnabledFeeds[0].enabled, true);
    });
});
