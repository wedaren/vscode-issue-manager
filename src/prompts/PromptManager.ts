import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';

export interface PromptFile {
    uri: vscode.Uri;
    label: string;
    description?: string;
    template: string;
    systemPrompt?: string;
}

async function ensureDir(uri: vscode.Uri): Promise<void> {
    try {
        await vscode.workspace.fs.stat(uri);
    } catch (err) {
        await vscode.workspace.fs.createDirectory(uri);
    }
}

function parseFrontmatter(text: string): { attrs: Record<string, string>, body: string } {
    const fmMatch = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
    const attrs: Record<string, string> = {};
    let body = text;
    if (fmMatch) {
        const fm = fmMatch[1];
        body = text.slice(fmMatch[0].length);
        const lines = fm.split(/\r?\n/);
        for (const line of lines) {
            const m = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
            if (m) {
                let val = m[2].trim();
                // remove surrounding quotes
                if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                    val = val.slice(1, -1);
                }
                attrs[m[1]] = val;
            }
        }
    }
    return { attrs, body };
}

async function getPromptDir(): Promise<vscode.Uri> {
    const config = vscode.workspace.getConfiguration('issueManager');
    const issueDir = config.get<string>('issueDir') || '';

    if (issueDir && issueDir.trim().length > 0) {
        // place prompts directly under the issue dir as `copilot-prompts`
        return vscode.Uri.file(path.join(issueDir, 'copilot-prompts'));
    }

    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
        // prefer workspace-root/copilot-prompts
        return vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, 'copilot-prompts');
    }

    // fallback to user home
    return vscode.Uri.file(path.join(os.homedir(), '.copilot-prompts'));
}

export async function loadPrompts(): Promise<PromptFile[]> {
    const dir = await getPromptDir();
    await ensureDir(dir);
    const res: PromptFile[] = [];
    try {
        const entries = await vscode.workspace.fs.readDirectory(dir);
        for (const [name, type] of entries) {
            if (type === vscode.FileType.File && name.toLowerCase().endsWith('.md')) {
                const fileUri = vscode.Uri.joinPath(dir, name);
                try {
                    const data = await vscode.workspace.fs.readFile(fileUri);
                    const text = Buffer.from(data).toString('utf8');
                    const { attrs, body } = parseFrontmatter(text);
                    const label = attrs['label'] || name.replace(/\.md$/i, '');
                    const description = attrs['description'] || undefined;
                    const systemPrompt = attrs['systemPrompt'] || undefined;
                    res.push({ uri: fileUri, label, description, template: body.trim(), systemPrompt });
                } catch (err) {
                    // ignore individual file read errors
                    console.error('loadPrompts: failed read', fileUri.toString(), err);
                }
            }
        }
    } catch (err) {
        // directory may be empty; ensureDir already created it
    }
    return res;
}

function yamlEscape(s: string): string {
    const safe = s.replace(/"/g, '\\"');
    return `"${safe}"`;
}

function slugify(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'prompt';
}

export async function savePrompt(label: string, description: string | undefined, template: string, systemPrompt?: string): Promise<vscode.Uri> {
    const dir = await getPromptDir();
    await ensureDir(dir);
    const name = `${slugify(label)}-${Date.now()}.md`;
    const fileUri = vscode.Uri.joinPath(dir, name);
    const fmLines = [
        '---',
        `label: ${yamlEscape(label)}`
    ];
    if (description) fmLines.push(`description: ${yamlEscape(description)}`);
    if (systemPrompt) fmLines.push(`systemPrompt: ${yamlEscape(systemPrompt)}`);
    fmLines.push('---', '', template.trim(), '');
    const content = fmLines.join('\n');
    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf8'));
    return fileUri;
}

export default {
    loadPrompts,
    savePrompt
};
