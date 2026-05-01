import * as vscode from 'vscode';
import { getAllIssueMarkdowns } from '../data/IssueMarkdowns';

/**
 * Wiki 状态栏:展示今日 raw/wiki 增量 + 一键打开 Today 视图。
 *
 * 显示规则:
 *   - 今日有数据: `$(book) 今日 +N raw / +M wiki`
 *   - 今日为空但近 7 天有数据: `$(book) wiki 沉睡中(7天 +X)`
 *   - 完全空: 隐藏(避免噪音)
 */

export class WikiStatusBar {
    private item: vscode.StatusBarItem;
    private refreshTimer?: ReturnType<typeof setTimeout>;

    constructor() {
        this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
        this.item.command = 'issueManager.views.wikiToday.focus';
    }

    async refresh(): Promise<void> {
        try {
            const all = await getAllIssueMarkdowns({});
            const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
            const todayMs = startOfToday.getTime();
            const weekAgoMs = todayMs - 6 * 24 * 60 * 60 * 1000;

            let rawToday = 0, wikiToday = 0, weekTotal = 0;
            for (const i of all) {
                const t = i.title;
                if (typeof t !== 'string') { continue; }
                const isRaw = t.startsWith('raw/');
                const isWiki = t.startsWith('wiki/');
                if (!isRaw && !isWiki) { continue; }
                if (i.mtime >= todayMs) {
                    if (isRaw) { rawToday++; } else { wikiToday++; }
                }
                if (i.mtime >= weekAgoMs) { weekTotal++; }
            }

            if (rawToday > 0 || wikiToday > 0) {
                this.item.text = `$(book) 今日 +${rawToday} raw / +${wikiToday} wiki`;
                this.item.tooltip = '点击打开 Wiki 今日视图';
                this.item.show();
            } else if (weekTotal > 0) {
                this.item.text = `$(book) wiki 沉睡中(7天 +${weekTotal})`;
                this.item.tooltip = '今日没有新增 wiki/raw,点击查看最近 7 天';
                this.item.show();
            } else {
                this.item.hide();
            }
        } catch {
            this.item.hide();
        }
    }

    /** 防抖刷新 */
    scheduleRefresh(): void {
        if (this.refreshTimer) { clearTimeout(this.refreshTimer); }
        this.refreshTimer = setTimeout(() => { void this.refresh(); }, 500);
    }

    dispose(): void {
        if (this.refreshTimer) { clearTimeout(this.refreshTimer); }
        this.item.dispose();
    }
}
