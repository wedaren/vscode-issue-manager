import * as vscode from 'vscode';
import { createIssueMarkdown, getAllIssueMarkdowns, getIssueMarkdownContent, updateIssueMarkdownFrontmatter, type IssueMarkdown } from '../data/IssueMarkdowns';
import { getRelativeToNoteRoot } from '../utils/pathUtils';
import { LLMService } from '../llm/LLMService';

export function registerOpenReviewPlanQuickPick(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('issueManager.openReviewPlanQuickPick', async () => {
      try {
        const all = await getAllIssueMarkdowns({ sortBy: 'mtime' });
        if (!all || all.length === 0) {
          vscode.window.showInformationMessage('未找到任何 IssueMarkdown，无法生成回顾。');
          return;
        }

        function toDateKey(ts: number) {
          const d = new Date(ts);
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          return `${y}-${m}-${day}`;
        }

        function isoWeekKey(ts: number) {
          const d = new Date(ts);
          const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
          const dayNum = tmp.getUTCDay() || 7;
          tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
          const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(),0,1));
          const weekNum = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1)/7);
          return `${tmp.getUTCFullYear()}-W${String(weekNum).padStart(2,'0')}`;
        }

        function monthKey(ts: number) {
          const d = new Date(ts);
          return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        }

        const days = new Map<string, IssueMarkdown[]>();
        const weeks = new Map<string, IssueMarkdown[]>();
        const months = new Map<string, IssueMarkdown[]>();

        for (const md of all) {
          const dk = toDateKey(md.mtime);
          const wk = isoWeekKey(md.mtime);
          const mk = monthKey(md.mtime);
          if (!days.has(dk)) days.set(dk, []);
          if (!weeks.has(wk)) weeks.set(wk, []);
          if (!months.has(mk)) months.set(mk, []);
          days.get(dk)!.push(md);
          weeks.get(wk)!.push(md);
          months.get(mk)!.push(md);
        }

        const todayKey = toDateKey(Date.now());
        const yesterdayKey = toDateKey(Date.now() - 24*3600*1000);
        const thisWeekKey = isoWeekKey(Date.now());
        const lastWeekKey = isoWeekKey(Date.now() - 7*24*3600*1000);
        const thisMonthKey = monthKey(Date.now());

        type PeriodQuickPickItem = vscode.QuickPickItem & { period?: { type: 'day'|'week'|'month', key: string } };
        const items: PeriodQuickPickItem[] = [];

        // Today（仅在有数据时）
        if (days.has(todayKey)) {
          items.push({ label: '回顾今天', description: `(${todayKey})`, period: { type: 'day', key: `day_${todayKey.replace(/-/g,'_')}` } });
        }

        // 始终显示“回顾昨天”选项（若无数据，选择后会提示范围内无问题）
        items.push({ label: '回顾昨天', description: `(${yesterdayKey})`, period: { type: 'day', key: `day_${yesterdayKey.replace(/-/g,'_')}` } });

        // 本周其他天（排除今天/昨天）
        const weekDaysSet = new Set<string>();
        for (const d of days.keys()) {
          const wk = isoWeekKey(new Date(d).getTime());
          if (wk === thisWeekKey) weekDaysSet.add(d);
        }
        const weekDays = Array.from(weekDaysSet).sort().reverse();
        for (const d of weekDays) {
          if (d === todayKey || d === yesterdayKey) continue;
          items.push({ label: `回顾本周 ${d}`, description: '', period: { type: 'day', key: `day_${d.replace(/-/g,'_')}` } });
        }

        if (weeks.has(thisWeekKey)) items.push({ label: '回顾本周', description: `(${thisWeekKey})`, period: { type: 'week', key: `week_${thisWeekKey}` } });
        if (weeks.has(lastWeekKey)) items.push({ label: '回顾上周', description: `(${lastWeekKey})`, period: { type: 'week', key: `week_${lastWeekKey}` } });
        if (months.has(thisMonthKey)) items.push({ label: '回顾本月', description: `(${thisMonthKey})`, period: { type: 'month', key: `month_${thisMonthKey}` } });

        const pick = await vscode.window.showQuickPick(items as readonly PeriodQuickPickItem[], { placeHolder: '选择回顾时间范围' }) as PeriodQuickPickItem | undefined;
        if (!pick || !pick.period) return;

        // determine selected files
        let selected: IssueMarkdown[] = [];
        if (pick.period.type === 'day') {
          const k = pick.period.key.replace(/^day_/, '').replace(/_/g,'-');
          selected = days.get(k) ?? [];
        } else if (pick.period.type === 'week') {
          const k = pick.period.key.replace(/^week_/, '');
          selected = weeks.get(k) ?? [];
        } else if (pick.period.type === 'month') {
          const k = pick.period.key.replace(/^month_/, '');
          selected = months.get(k) ?? [];
        }

        if (!selected || selected.length === 0) {
          vscode.window.showInformationMessage('所选范围内无问题。');
          return;
        }

        const periodKey = pick.period.key;
        const title = pick.label;

        const lines: string[] = [];
        lines.push(`# ${title}`);
        lines.push('');

        for (const md of selected) {
          const rel = getRelativeToNoteRoot(md.uri.fsPath) ?? md.uri.fsPath;
          const fm = md.frontmatter ?? {};
          const issueTitle = (fm.issue_title && (typeof fm.issue_title === 'string' ? fm.issue_title : (Array.isArray(fm.issue_title) ? fm.issue_title[0] : undefined))) ?? md.title;
          const summary = fm.issue_brief_summary ? (typeof fm.issue_brief_summary === 'string' ? fm.issue_brief_summary : (Array.isArray(fm.issue_brief_summary) ? fm.issue_brief_summary[0] : undefined)) : undefined;

          lines.push(`[${issueTitle}](${rel})`);
          if (summary && summary.trim()) {
            lines.push(summary);
          } else {
            lines.push('（生成中）');
          }
          lines.push(`<!-- issue:${md.uri.fsPath} -->`);
          lines.push('');
        }

        const body = lines.join('\n');
        const uri = await createIssueMarkdown({ frontmatter: { review_period: periodKey, issue_title: title }, markdownBody: body });
        if (!uri) {
          vscode.window.showErrorMessage('生成回顾报告失败。');
          return;
        }

        await vscode.window.showTextDocument(uri, { preview: false });

        // 异步补全标题/摘要并更新回顾文档占位
        (async () => {
          for (const md of selected) {
            const fm = md.frontmatter ?? {};
            const needSummary = !(fm.issue_brief_summary && ((typeof fm.issue_brief_summary === 'string' && fm.issue_brief_summary.trim()) || (Array.isArray(fm.issue_brief_summary) && fm.issue_brief_summary.length > 0)));
            const needTitle = !((fm.issue_title && ((typeof fm.issue_title === 'string' && fm.issue_title.trim()) || (Array.isArray(fm.issue_title) && fm.issue_title.length > 0))));

            try {
              const content = await getIssueMarkdownContent(md.uri);
              if (needTitle) {
                const generatedTitle = await LLMService.generateTitleOptimized(content);
                if (generatedTitle && generatedTitle.trim()) {
                  await updateIssueMarkdownFrontmatter(md.uri, { issue_title: generatedTitle });
                }
              }
              if (needSummary) {
                const generated = await LLMService.generateBriefSummary(content);
                if (generated && generated.trim()) {
                  await updateIssueMarkdownFrontmatter(md.uri, { issue_brief_summary: generated });
                }
              }

              // update report doc placeholder
              try {
                const reportBytes = await vscode.workspace.fs.readFile(uri);
                let reportText = Buffer.from(reportBytes).toString('utf8');
                const marker = `<!-- issue:${md.uri.fsPath} -->`;
                const idx = reportText.indexOf(marker);
                if (idx !== -1) {
                  const before = reportText.substring(0, idx);
                  const after = reportText.substring(idx);
                  const parts = before.split('\n');
                  let i = parts.length - 1;
                  while (i >= 0 && parts[i].trim() === '') i--;
                  if (i >= 0) {
                    const fm2 = (await getAllIssueMarkdowns()).find(x => x.uri.fsPath === md.uri.fsPath)?.frontmatter ?? fm;
                    const summ = fm2.issue_brief_summary;
                    let rep = '(无摘要)';
                    if (typeof summ === 'string') rep = summ;
                    else if (Array.isArray(summ) && summ.length>0) rep = summ[0];
                    parts[i] = rep;
                  }
                  const newReport = parts.join('\n') + after;
                  await vscode.workspace.fs.writeFile(uri, Buffer.from(newReport, 'utf8'));
                }
              } catch (e) {
                try { console.error('更新回顾报告失败', e); } catch {}
              }
            } catch (err) {
              try { console.error('异步生成摘要/标题失败', err); } catch {}
            }
          }
          void vscode.commands.executeCommand('issueManager.refreshAllViews');
        })();

      } catch (err) {
        vscode.window.showErrorMessage('打开回顾选择失败');
        console.error(err);
      }
    })
  );
}
