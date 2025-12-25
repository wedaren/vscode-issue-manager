import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';

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
    const attrs: Record<string, string> = {};
    let body = text;

    if (!text.startsWith('---')) {
        return { attrs, body };
    }

    const lines = text.split(/\r?\n/);
    let endIndex = -1;
    for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === '---') {
            endIndex = i;
            break;
        }
    }

    if (endIndex === -1) {
        return { attrs, body };
    }

    const yamlContent = lines.slice(1, endIndex).join('\n');
    body = lines.slice(endIndex + 1).join('\n');

    try {
        const parsed = yaml.load(yamlContent);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
                if (v === undefined || v === null) continue;
                if (typeof v === 'string') attrs[k] = v;
                else if (typeof v === 'number' || typeof v === 'boolean') attrs[k] = String(v);
                else attrs[k] = JSON.stringify(v);
            }
        }
    } catch (err) {
        console.error('parseFrontmatter: failed to parse yaml', err);
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
    // 保留兼容接口，但实际存储使用 js-yaml 序列化，因此这里直接返回原始字符串
    return s;
}

function slugify(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'prompt';
}

export async function savePrompt(label: string, description: string | undefined, template: string, systemPrompt?: string): Promise<vscode.Uri> {
    const dir = await getPromptDir();
    await ensureDir(dir);
    const name = `${slugify(label)}-${Date.now()}.md`;
    const fileUri = vscode.Uri.joinPath(dir, name);

    const fmObj: Record<string, unknown> = { label };
    if (description) fmObj.description = description;
    if (systemPrompt) fmObj.systemPrompt = systemPrompt;

    // 使用 js-yaml 生成可靠的 frontmatter
    const yamlStr = yaml.dump(fmObj, { lineWidth: -1 }).trimEnd();
    const content = ['---', yamlStr, '---', '', template.trim(), ''].join('\n');

    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf8'));
    return fileUri;
}

