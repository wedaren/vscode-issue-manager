import * as vscode from 'vscode';
import { createIssueMarkdown, type FrontmatterData } from '../data/IssueMarkdowns';

let didRegisterReviewPlanCommands = false;

interface CreateIssueFromReviewTaskArgs {
  title: string;
  body?: string;
  frontmatter?: Partial<FrontmatterData>;
}

interface SaveReviewPlanAsDocArgs {
  title: string;
  markdown: string;
  frontmatter?: Partial<FrontmatterData>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getStringProp(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === 'string' ? v : undefined;
}

function getFrontmatterProp(obj: Record<string, unknown>, key: string): Partial<FrontmatterData> | undefined {
  const v = obj[key];
  if (!isRecord(v)) {
    return undefined;
  }
  return v as Partial<FrontmatterData>;
}

function ensureH1(markdown: string, title: string): string {
  const trimmed = markdown.trimStart();
  if (trimmed.startsWith('# ')) {
    return markdown;
  }
  return `# ${title}\n\n${markdown}`;
}

export function registerReviewPlanCommands(context: vscode.ExtensionContext): void {
  if (didRegisterReviewPlanCommands) {
    return;
  }
  didRegisterReviewPlanCommands = true;

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'issueManager.createIssueFromReviewTask',
      async (args: unknown) => {
        if (!isRecord(args)) {
          vscode.window.showErrorMessage('参数错误：无法从 Review 任务创建问题。');
          return;
        }

        const title = getStringProp(args, 'title')?.trim() ?? '';
        if (!title) {
          vscode.window.showErrorMessage('参数错误：缺少标题，无法创建问题。');
          return;
        }

        const body = getStringProp(args, 'body') ?? '';
        const frontmatter = getFrontmatterProp(args, 'frontmatter');

        const markdownBody = ensureH1(body, title);
        const uri = await createIssueMarkdown({
          markdownBody,
          frontmatter: { issue_title: title, ...(frontmatter ?? {}) },
        });

        if (!uri) {
          vscode.window.showErrorMessage('创建问题失败。');
          return;
        }

        await vscode.window.showTextDocument(uri);
        void vscode.commands.executeCommand('issueManager.refreshAllViews');
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'issueManager.saveReviewPlanAsDoc',
      async (args: unknown) => {
        if (!isRecord(args)) {
          vscode.window.showErrorMessage('参数错误：无法保存 Review 计划。');
          return;
        }

        const title = getStringProp(args, 'title')?.trim() ?? '';
        const markdown = getStringProp(args, 'markdown') ?? '';
        if (!title || !markdown.trim()) {
          vscode.window.showErrorMessage('参数错误：缺少 title/markdown，无法保存。');
          return;
        }

        const frontmatter = getFrontmatterProp(args, 'frontmatter');
        const markdownBody = ensureH1(markdown, title);

        const uri = await createIssueMarkdown({
          markdownBody,
          frontmatter: { issue_title: title, ...(frontmatter ?? {}) },
        });

        if (!uri) {
          vscode.window.showErrorMessage('保存 Review 计划失败。');
          return;
        }

        await vscode.window.showTextDocument(uri);
        void vscode.commands.executeCommand('issueManager.refreshAllViews');
      }
    )
  );
}
