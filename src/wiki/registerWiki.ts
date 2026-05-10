import * as vscode from 'vscode';
import { getIssueDir } from '../config';
import { Logger } from '../core/utils/Logger';
import { getIssueCoreServices } from '../services/issue-core/extensionInstance';
import { onTitleUpdate } from '../data/IssueMarkdowns';
import { WikiTodayProvider } from '../views/WikiTodayProvider';
import { WikiBacklinkIndex } from './wikiBacklinkIndex';
import { WikiHoverProvider, WikiLinkProvider } from './wikiLinkProvider';
import { WikiStatusBar } from './wikiStatusBar';

const logger = Logger.getInstance();
const TODAY_VIEW_ID = 'issueManager.views.wikiToday';

/**
 * Wiki 模块注册入口。
 * 一处调用即把 Wiki Today TreeView、链接/Hover Provider、状态栏、
 * "保存选中到 raw/" 命令、刷新命令全部装好。
 *
 * 调用时机:扩展激活后,issueDir 已确认有效。
 */
export function registerWikiModule(context: vscode.ExtensionContext): void {
    // ── 数据索引(供 Link / Hover 共用) ────────────────────────
    const backlinkIndex = new WikiBacklinkIndex();

    // ── Today TreeView ──────────────────────────────────────
    const todayProvider = new WikiTodayProvider(context);
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider(TODAY_VIEW_ID, todayProvider),
    );

    // ── Link & Hover Provider(限定 markdown 文件) ───────────
    const mdSelector: vscode.DocumentSelector = { language: 'markdown', scheme: 'file' };
    context.subscriptions.push(
        vscode.languages.registerDocumentLinkProvider(mdSelector, new WikiLinkProvider(backlinkIndex)),
        vscode.languages.registerHoverProvider(mdSelector, new WikiHoverProvider(backlinkIndex)),
    );

    // ── 状态栏 ────────────────────────────────────────────────
    const statusBar = new WikiStatusBar();
    context.subscriptions.push({ dispose: () => statusBar.dispose() });
    void statusBar.refresh();

    // ── 命令: 刷新 / 保存选中到 raw/ ───────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('issueManager.wiki.refresh', () => {
            backlinkIndex.invalidate();
            todayProvider.refresh();
            void statusBar.refresh();
        }),
        vscode.commands.registerCommand('issueManager.wiki.saveSelectionToRaw', saveSelectionToRaw),
    );

    // ── 数据变化时的自动刷新(防抖由 onTitleUpdate 内部 200ms 包住) ─
    context.subscriptions.push(
        onTitleUpdate(() => {
            backlinkIndex.invalidate();
            todayProvider.refresh();
            statusBar.scheduleRefresh();
        }),
    );
}

// ── "保存选中文本到 raw/" 命令 ────────────────────────────────

async function saveSelectionToRaw(): Promise<void> {
    if (!getIssueDir()) {
        vscode.window.showWarningMessage('请先配置 issueDir');
        return;
    }
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showInformationMessage('没有活动编辑器,无法保存选中文本');
        return;
    }
    const sel = editor.document.getText(editor.selection);
    if (!sel.trim()) {
        vscode.window.showInformationMessage('请先选中要保存的文本');
        return;
    }

    const category = await vscode.window.showInputBox({
        prompt: 'raw/ 分类(如 articles, observations, snippets)',
        placeHolder: 'observations',
        value: 'observations',
    });
    if (category === undefined) { return; } // 取消

    const title = await vscode.window.showInputBox({
        prompt: '标题',
        placeHolder: '一句话概括这段内容',
        validateInput: v => v.trim() ? undefined : '标题不能为空',
    });
    if (!title) { return; }

    const services = getIssueCoreServices();
    if (!services) {
        vscode.window.showErrorMessage('issue-core service 未就绪');
        return;
    }

    const issueTitle = `raw/${category.trim() || 'uncategorized'}/${title.trim()}`;
    const sourceUri = editor.document.uri.toString();
    const sourceLine = editor.selection.start.line + 1; // 1-based
    const fullBody = [
        `> 来源: \`${sourceUri}\`#L${sourceLine}`,
        `> 保存时间: ${new Date().toISOString()}`,
        '',
        sel.trim(),
    ].join('\n');

    try {
        const created = await services.issues.create({
            frontmatter: { issue_title: issueTitle },
            body: fullBody,
        });
        await vscode.commands.executeCommand('issueManager.refreshAllViews');
        const action = await vscode.window.showInformationMessage(
            `✓ 已保存到 raw/${category}/${title}`,
            '打开',
        );
        if (action === '打开') {
            await vscode.window.showTextDocument(vscode.Uri.file(created.absPath));
        }
    } catch (err) {
        logger.error('saveSelectionToRaw 失败', err);
        vscode.window.showErrorMessage(`保存失败: ${err instanceof Error ? err.message : String(err)}`);
    }
}
