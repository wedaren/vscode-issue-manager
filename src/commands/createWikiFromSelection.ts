/**
 * 简要描述：实现基于编辑器选中文本创建 Wiki（issueMarkdown）的命令。
 * 原理：将选中文本替换为 wiki-link `[[Title]]`，创建 issue Markdown 并由后台 LLM 填充内容。
 */
import * as vscode from 'vscode';
import { createIssueMarkdown, getPromptDir, getIssueMarkdown } from '../data/IssueMarkdowns';
import { createIssueNodes } from '../data/issueTreeManager';
import { backgroundFillIssue } from '../llm/backgroundFill';
import { backgroundFillIssueRefine } from '../llm/refinePipeline';
import { openIssueNode } from './openIssueNode';

/**
 * 注册命令：从选中文本创建 Wiki（issueMarkdown）。
 * - 将选中文本替换为 `[[Title]]`
 * - 新建 issueMarkdown，frontmatter 标记为 wiki
 * - 在后台调用 LLM 填充内容并打开新笔记
 */
export function registerCreateWikiFromSelectionCommand(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand('issueManager.createWikiFromSelection', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showInformationMessage('请在编辑器中选中要作为 Wiki 的文本。');
            return;
        }

        const selection = editor.selection;
        let selected = editor.document.getText(selection).trim();
        if (!selected) {
            // 尝试用光标处单词作为回退
            const wordRange = editor.document.getWordRangeAtPosition(selection.active);
            if (wordRange) {
                selected = editor.document.getText(wordRange).trim();
            }
        }

        if (!selected) {
            vscode.window.showInformationMessage('未检测到选中文本或光标单词。');
            return;
        }

        // 1) 在编辑器中替换为 [[Title]] 标记
        await editor.edit((eb) => {
            eb.replace(selection, `[[${selected}]]`);
        });

        // 2) 创建 issueMarkdown 文件，frontmatter 标记为 wiki
        try {
            const fm = { issue_type: 'wiki', issue_title: selected } as Record<string, unknown>;
            const markdownBody = `# ${selected}\n\n`;
            const uri = await createIssueMarkdown({ frontmatter: fm, markdownBody });
            if (!uri) {
                vscode.window.showErrorMessage('创建 Wiki 文件失败。');
                return;
            }

            // 3) 将文件加入树并触发后台填充
            const added = await createIssueNodes([uri]);
            const newNodeId = added && added.length > 0 ? added[0].id : undefined;

            // 后台填充并打开新创建的笔记（后台填充会做冲突检测）
            // 使用多轮 refine 流程生成更可靠的 wiki 正文
            backgroundFillIssueRefine(uri, selected, selected, newNodeId, { timeoutMs: 120000 }).catch(() => {});

            // 打开新创建的笔记在旁边
            if (newNodeId) {
                await openIssueNode(newNodeId, { viewColumn: vscode.ViewColumn.Beside, preview: true, preserveFocus: false });
            } else {
                await vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.Beside, preview: true });
            }

        } catch (err) {
            console.error('createWikiFromSelection error:', err);
            vscode.window.showErrorMessage('创建 Wiki 失败。');
        }
    });

    context.subscriptions.push(disposable);
}

/**
 * 注册命令：点击或调用时，打开已有 Wiki 或按标题创建并打开。
 * @param context
 */
export function registerOpenOrCreateWikiCommand(context: vscode.ExtensionContext) {
    const disposable = vscode.commands.registerCommand('issueManager.openOrCreateWiki', async (title: string) => {
        if (!title || typeof title !== 'string') return;
        const { getFlatTree } = await import('../data/issueTreeManager');
        try {
            const flat = await getFlatTree();
            const match = flat.find(n => n.title === title) || flat.find(n => n.title?.toLowerCase() === title.toLowerCase());
            if (match) {
                // 检查匹配的 IssueMarkdown 是否为 wiki 类型，若不是则视为未找到并继续创建流程
                try {
                    const issue = await getIssueMarkdown(match.resourceUri);
                    if (issue && issue.frontmatter && (issue.frontmatter as any).issue_type === 'wiki') {
                        await openIssueNode(match.id);
                        return;
                    }
                    // 否则 fallthrough 到创建流程
                } catch (e) {
                    // 无法读取元数据，继续走创建流程
                }
            }

            // 未找到则创建新的 issueMarkdown 并后台填充
            const fm = { issue_type: 'wiki', issue_title: title } as Record<string, unknown>;
            const markdownBody = `# ${title}\n\n`;
            const uri = await createIssueMarkdown({ frontmatter: fm, markdownBody });
            if (!uri) {
                vscode.window.showErrorMessage('创建 Wiki 文件失败。');
                return;
            }
            const added = await createIssueNodes([uri]);
            const newNodeId = added && added.length > 0 ? added[0].id : undefined;
            backgroundFillIssueRefine(uri, title, '', newNodeId, { timeoutMs: 120000 }).catch(() => {});
            if (newNodeId) {
                await openIssueNode(newNodeId);
            } else {
                await vscode.window.showTextDocument(uri);
            }
        } catch (e) {
            console.error('openOrCreateWiki error:', e);
            vscode.window.showErrorMessage('打开或创建 Wiki 失败。');
        }
    });

    context.subscriptions.push(disposable);
}

export default registerCreateWikiFromSelectionCommand;

async function loadCreateWikiPrompt(title: string, selection: string): Promise<string> {
    // 尝试从 issueDir 下的 copilot-prompts 目录加载自定义 prompt
    try {
        const promptDir = await getPromptDir();
        const promptUri = vscode.Uri.joinPath(promptDir, 'create-wiki-prompt.md');
        try {
            const bytes = await vscode.workspace.fs.readFile(promptUri);
            const text = Buffer.from(bytes).toString('utf8');
            return interpolatePrompt(text, title, selection);
        } catch (e) {
            // 忽略读取错误，回退到 workspace 根路径下的 copilot-prompts
        }
    } catch (e) {
        // ignore
    }

    // 尝试 workspace 根目录下的 copilot-prompts
    try {
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length > 0) {
            const root = folders[0].uri;
            const candidate = vscode.Uri.joinPath(root, 'copilot-prompts', 'create-wiki-prompt.md');
            try {
                const bytes = await vscode.workspace.fs.readFile(candidate);
                const text = Buffer.from(bytes).toString('utf8');
                return interpolatePrompt(text, title, selection);
            } catch (e) {
                // ignore
            }
        }
    } catch (e) {
        // ignore
    }

    // 回退内置默认 prompt（与 resources/copilot-prompts/create-wiki-prompt.md 内容一致）
    const defaultPrompt = `请基于下面的标题和上下文生成 issue 的 Markdown 正文（不要输出 frontmatter）。\n\n- 输出内容仅为 Markdown 正文（可以包含 H1 标题），不要包含 YAML frontmatter 或额外的解释。\n- 正文建议包含：H1 标题、简要摘要、背景/要点/后续步骤/参考等小节，语言为中文。\n\n输入占位符：\n- 标题：{{title}}\n- 选中文本/上下文：\n\`\`\`\n{{selection}}\n\`\`\`\n\n请将生成结果写成可直接写入文件的 Markdown 正文（不含 frontmatter），并保持语言为中文。`;

    return interpolatePrompt(defaultPrompt, title, selection);
}

function interpolatePrompt(template: string, title: string, selection: string): string {
    return template.replace(/{{\s*title\s*}}/g, title).replace(/{{\s*selection\s*}}/g, selection);
}
