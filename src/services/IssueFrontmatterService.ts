import * as vscode from 'vscode';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { getIssueDir } from '../config';
import { getIssueMarkdownFrontmatter, FrontmatterData } from '../data/IssueMarkdowns';

/**
 * 扩展的 Frontmatter 数据结构，包含 issue_ 前缀字段
 */
export interface IssueFrontmatterData extends FrontmatterData {
    issue_root?: string;
    issue_parent?: string | null;
    issue_children?: string[];
}

/**
 * Issue Frontmatter 管理服务
 * 专门负责处理 markdown 文件的 issue_ 前缀字段
 */
export class IssueFrontmatterService {
    private static instance: IssueFrontmatterService;

    private constructor() {}

    public static getInstance(): IssueFrontmatterService {
        if (!IssueFrontmatterService.instance) {
            IssueFrontmatterService.instance = new IssueFrontmatterService();
        }
        return IssueFrontmatterService.instance;
    }

    /**
     * 读取文件的 issue_ 前缀字段
     */
    public async getIssueFrontmatter(fileName: string): Promise<IssueFrontmatterData | null> {
        try {
            const issueDir = getIssueDir();
            if (!issueDir) {
                return null;
            }

            const filePath = path.join(issueDir, fileName);
            const fileUri = vscode.Uri.file(filePath);

            const frontmatter = await getIssueMarkdownFrontmatter(fileUri);
            return frontmatter as IssueFrontmatterData;
        } catch (error) {
            console.error(`读取 issue frontmatter 失败 (${fileName}):`, error);
            return null;
        }
    }

    /**
     * 批量读取多个文件的 issue_ 前缀字段
     */
    public async getIssueFrontmatterBatch(fileNames: string[]): Promise<Map<string, IssueFrontmatterData | null>> {
        const results = new Map<string, IssueFrontmatterData | null>();
        
        await Promise.all(
            fileNames.map(async (fileName) => {
                const frontmatter = await this.getIssueFrontmatter(fileName);
                results.set(fileName, frontmatter);
            })
        );

        return results;
    }

    /**
     * 更新文件的 issue_ 前缀字段
     */
    public async updateIssueFields(
        fileName: string,
        updates: Partial<IssueFrontmatterData>
    ): Promise<boolean> {
        try {
            const issueDir = getIssueDir();
            if (!issueDir) {
                return false;
            }

            const filePath = path.join(issueDir, fileName);
            const fileUri = vscode.Uri.file(filePath);

            // 读取文件内容
            const document = await vscode.workspace.openTextDocument(fileUri);
            const content = document.getText();

            // 更新 frontmatter
            const updatedContent = this.updateFrontmatterInContent(content, updates);

            if (updatedContent && updatedContent !== content) {
                // 创建编辑操作
                const edit = new vscode.WorkspaceEdit();
                const fullRange = new vscode.Range(
                    0, 0,
                    document.lineCount, 0
                );
                edit.replace(fileUri, fullRange, updatedContent);

                // 应用编辑并保存
                const success = await vscode.workspace.applyEdit(edit);
                if (success) {
                    const doc = await vscode.workspace.openTextDocument(fileUri);
                    if (doc.isDirty) {
                        await doc.save();
                    }
                    console.log(`已更新 ${fileName} 的 issue_ 字段`);
                    return true;
                }
            }

            return false;
        } catch (error) {
            console.error(`更新 issue_ 字段失败 (${fileName}):`, error);
            return false;
        }
    }

    /**
     * 批量更新多个文件的 issue_ 前缀字段
     * 确保原子操作：要么全部成功，要么全部失败
     */
    public async updateIssueFieldsBatch(
        updates: Map<string, Partial<IssueFrontmatterData>>
    ): Promise<boolean> {
        const issueDir = getIssueDir();
        if (!issueDir) {
            return false;
        }

        // 准备所有编辑操作
        const edits: Array<{ uri: vscode.Uri; content: string; originalContent: string }> = [];

        try {
            // 第一阶段：准备所有编辑
            for (const [fileName, fieldsToUpdate] of updates.entries()) {
                const filePath = path.join(issueDir, fileName);
                const fileUri = vscode.Uri.file(filePath);

                const document = await vscode.workspace.openTextDocument(fileUri);
                const originalContent = document.getText();

                const updatedContent = this.updateFrontmatterInContent(originalContent, fieldsToUpdate);

                if (updatedContent && updatedContent !== originalContent) {
                    edits.push({ uri: fileUri, content: updatedContent, originalContent });
                }
            }

            // 第二阶段：应用所有编辑
            if (edits.length === 0) {
                return true; // 没有需要更新的内容
            }

            const workspaceEdit = new vscode.WorkspaceEdit();
            for (const edit of edits) {
                const document = await vscode.workspace.openTextDocument(edit.uri);
                const fullRange = new vscode.Range(
                    0, 0,
                    document.lineCount, 0
                );
                workspaceEdit.replace(edit.uri, fullRange, edit.content);
            }

            // 应用所有编辑
            const success = await vscode.workspace.applyEdit(workspaceEdit);
            
            if (success) {
                // 保存所有修改的文件
                for (const edit of edits) {
                    const doc = await vscode.workspace.openTextDocument(edit.uri);
                    if (doc.isDirty) {
                        await doc.save();
                    }
                }
                console.log(`批量更新了 ${edits.length} 个文件的 issue_ 字段`);
                return true;
            }

            return false;
        } catch (error) {
            console.error('批量更新 issue_ 字段失败:', error);
            return false;
        }
    }

    /**
     * 删除文件的所有 issue_ 前缀字段
     */
    public async removeAllIssueFields(fileName: string): Promise<boolean> {
        try {
            const issueDir = getIssueDir();
            if (!issueDir) {
                return false;
            }

            const filePath = path.join(issueDir, fileName);
            const fileUri = vscode.Uri.file(filePath);

            const document = await vscode.workspace.openTextDocument(fileUri);
            const content = document.getText();

            const updatedContent = this.removeIssueFieldsFromContent(content);

            if (updatedContent && updatedContent !== content) {
                const edit = new vscode.WorkspaceEdit();
                const fullRange = new vscode.Range(
                    0, 0,
                    document.lineCount, 0
                );
                edit.replace(fileUri, fullRange, updatedContent);

                const success = await vscode.workspace.applyEdit(edit);
                if (success) {
                    const doc = await vscode.workspace.openTextDocument(fileUri);
                    if (doc.isDirty) {
                        await doc.save();
                    }
                    console.log(`已删除 ${fileName} 的所有 issue_ 字段`);
                    return true;
                }
            }

            return false;
        } catch (error) {
            console.error(`删除 issue_ 字段失败 (${fileName}):`, error);
            return false;
        }
    }

    /**
     * 批量删除多个文件的所有 issue_ 前缀字段
     */
    public async removeAllIssueFieldsBatch(fileNames: string[]): Promise<boolean> {
        const issueDir = getIssueDir();
        if (!issueDir) {
            return false;
        }

        const edits: Array<{ uri: vscode.Uri; content: string }> = [];

        try {
            // 准备所有编辑
            for (const fileName of fileNames) {
                const filePath = path.join(issueDir, fileName);
                const fileUri = vscode.Uri.file(filePath);

                const document = await vscode.workspace.openTextDocument(fileUri);
                const originalContent = document.getText();

                const updatedContent = this.removeIssueFieldsFromContent(originalContent);

                if (updatedContent && updatedContent !== originalContent) {
                    edits.push({ uri: fileUri, content: updatedContent });
                }
            }

            if (edits.length === 0) {
                return true;
            }

            const workspaceEdit = new vscode.WorkspaceEdit();
            for (const edit of edits) {
                const document = await vscode.workspace.openTextDocument(edit.uri);
                const fullRange = new vscode.Range(
                    0, 0,
                    document.lineCount, 0
                );
                workspaceEdit.replace(edit.uri, fullRange, edit.content);
            }

            const success = await vscode.workspace.applyEdit(workspaceEdit);
            
            if (success) {
                for (const edit of edits) {
                    const doc = await vscode.workspace.openTextDocument(edit.uri);
                    if (doc.isDirty) {
                        await doc.save();
                    }
                }
                console.log(`批量删除了 ${edits.length} 个文件的所有 issue_ 字段`);
                return true;
            }

            return false;
        } catch (error) {
            console.error('批量删除 issue_ 字段失败:', error);
            return false;
        }
    }

    /**
     * 在文件内容中更新 issue_ 前缀字段
     */
    private updateFrontmatterInContent(
        content: string,
        updates: Partial<IssueFrontmatterData>
    ): string | null {
        try {
            const lines = content.split(/\r?\n/);

            // 检查是否有 frontmatter
            if (lines.length < 2 || lines[0] !== '---') {
                // 如果没有 frontmatter，创建一个
                const frontmatterData: IssueFrontmatterData = { ...updates };
                const frontmatterContent = yaml.dump(frontmatterData, {
                    flowLevel: -1,
                    lineWidth: -1
                });
                return `---\n${frontmatterContent.trim()}\n---\n${content}`;
            }

            // 找到 frontmatter 结束位置
            const frontmatterEndIndex = lines.indexOf('---', 1);

            if (frontmatterEndIndex === -1) {
                return null;
            }

            // 提取 frontmatter 内容
            const frontmatterLines = lines.slice(1, frontmatterEndIndex);
            const frontmatterContent = frontmatterLines.join('\n');

            // 解析 YAML
            let frontmatterData: IssueFrontmatterData;
            try {
                const parsed = yaml.load(frontmatterContent) || {};
                if (typeof parsed !== 'object' || Array.isArray(parsed)) {
                    console.warn('Frontmatter 不是有效的键值对象');
                    return null;
                }
                frontmatterData = parsed as IssueFrontmatterData;
            } catch (error) {
                console.error('解析 frontmatter YAML 时出错:', error);
                return null;
            }

            // 更新字段
            for (const [key, value] of Object.entries(updates)) {
                frontmatterData[key] = value;
            }

            // 转换回 YAML
            const updatedFrontmatterContent = yaml.dump(frontmatterData, {
                flowLevel: -1,
                lineWidth: -1
            });

            // 重建文件内容
            const newLines = [
                '---',
                ...updatedFrontmatterContent.trim().split('\n'),
                '---',
                ...lines.slice(frontmatterEndIndex + 1)
            ];

            return newLines.join('\n');
        } catch (error) {
            console.error('更新文件内容中的 frontmatter 时出错:', error);
            return null;
        }
    }

    /**
     * 从文件内容中删除所有 issue_ 前缀字段
     */
    private removeIssueFieldsFromContent(content: string): string | null {
        try {
            const lines = content.split(/\r?\n/);

            // 检查是否有 frontmatter
            if (lines.length < 2 || lines[0] !== '---') {
                return content; // 没有 frontmatter，无需修改
            }

            // 找到 frontmatter 结束位置
            const frontmatterEndIndex = lines.indexOf('---', 1);

            if (frontmatterEndIndex === -1) {
                return null;
            }

            // 提取 frontmatter 内容
            const frontmatterLines = lines.slice(1, frontmatterEndIndex);
            const frontmatterContent = frontmatterLines.join('\n');

            // 解析 YAML
            let frontmatterData: IssueFrontmatterData;
            try {
                const parsed = yaml.load(frontmatterContent) || {};
                if (typeof parsed !== 'object' || Array.isArray(parsed)) {
                    console.warn('Frontmatter 不是有效的键值对象');
                    return null;
                }
                frontmatterData = parsed as IssueFrontmatterData;
            } catch (error) {
                console.error('解析 frontmatter YAML 时出错:', error);
                return null;
            }

            // 删除所有 issue_ 前缀字段
            delete frontmatterData.issue_root;
            delete frontmatterData.issue_parent;
            delete frontmatterData.issue_children;

            // 如果 frontmatter 为空，完全删除它
            if (Object.keys(frontmatterData).length === 0) {
                return lines.slice(frontmatterEndIndex + 1).join('\n');
            }

            // 转换回 YAML
            const updatedFrontmatterContent = yaml.dump(frontmatterData, {
                flowLevel: -1,
                lineWidth: -1
            });

            // 重建文件内容
            const newLines = [
                '---',
                ...updatedFrontmatterContent.trim().split('\n'),
                '---',
                ...lines.slice(frontmatterEndIndex + 1)
            ];

            return newLines.join('\n');
        } catch (error) {
            console.error('删除文件内容中的 issue_ 字段时出错:', error);
            return null;
        }
    }

    /**
     * 递归收集节点及其所有后代的文件路径
     */
    public async collectDescendants(fileName: string): Promise<string[]> {
        const descendants: string[] = [];
        const visited = new Set<string>();

        const collect = async (currentFile: string): Promise<void> => {
            if (visited.has(currentFile)) {
                console.warn(`检测到循环引用: ${currentFile} 已在遍历路径中`);
                return; // 防止循环引用
            }
            visited.add(currentFile);

            const frontmatter = await this.getIssueFrontmatter(currentFile);
            if (frontmatter && frontmatter.issue_children) {
                for (const child of frontmatter.issue_children) {
                    descendants.push(child);
                    await collect(child); // 递归收集
                }
            }
        };

        await collect(fileName);
        return descendants;
    }

    /**
     * 扫描所有文件，找到引用了指定路径的文件
     */
    public async findReferencingFiles(targetPath: string): Promise<Array<{ fileName: string; field: 'issue_root' | 'issue_parent' | 'issue_children' }>> {
        const issueDir = getIssueDir();
        if (!issueDir) {
            return [];
        }

        const allFiles = await vscode.workspace.findFiles(
            new vscode.RelativePattern(issueDir, '**/*.md'),
            '**/.issueManager/**'
        );

        const references: Array<{ fileName: string; field: 'issue_root' | 'issue_parent' | 'issue_children' }> = [];

        // 批量读取所有文件的 frontmatter
        const fileNames = allFiles.map(fileUri => path.relative(issueDir, fileUri.fsPath).replace(/\\/g, '/'));
        const frontmatterMap = await this.getIssueFrontmatterBatch(fileNames);

        for (const [fileName, frontmatter] of frontmatterMap.entries()) {
            if (frontmatter) {
                if (frontmatter.issue_root === targetPath) {
                    references.push({ fileName, field: 'issue_root' });
                }
                if (frontmatter.issue_parent === targetPath) {
                    references.push({ fileName, field: 'issue_parent' });
                }
                if (frontmatter.issue_children && frontmatter.issue_children.includes(targetPath)) {
                    references.push({ fileName, field: 'issue_children' });
                }
            }
        }

        return references;
    }

    /**
     * 更新所有引用了旧路径的文件，将引用更新为新路径
     */
    public async updatePathReferences(oldPath: string, newPath: string): Promise<boolean> {
        const references = await this.findReferencingFiles(oldPath);
        
        if (references.length === 0) {
            return true; // 没有需要更新的引用
        }

        const updates = new Map<string, Partial<IssueFrontmatterData>>();

        for (const ref of references) {
            const frontmatter = await this.getIssueFrontmatter(ref.fileName);
            if (!frontmatter) {
                continue;
            }

            const update: Partial<IssueFrontmatterData> = {};

            if (ref.field === 'issue_root' && frontmatter.issue_root === oldPath) {
                update.issue_root = newPath;
            } else if (ref.field === 'issue_parent' && frontmatter.issue_parent === oldPath) {
                update.issue_parent = newPath;
            } else if (ref.field === 'issue_children' && frontmatter.issue_children) {
                update.issue_children = frontmatter.issue_children.map(child =>
                    child === oldPath ? newPath : child
                );
            }

            if (Object.keys(update).length > 0) {
                updates.set(ref.fileName, update);
            }
        }

        return await this.updateIssueFieldsBatch(updates);
    }
}
