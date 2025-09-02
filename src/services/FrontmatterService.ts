import * as vscode from 'vscode';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { getFrontmatter, FrontmatterData } from '../utils/markdown';
import { getIssueDir } from '../config';

/**
 * Frontmatter 管理服务
 * 负责处理 markdown 文件的 frontmatter 自动维护
 */
export class FrontmatterService {
    
    /**
     * 自动将新文件添加到父文件的 children_files 中
     */
    public static async addChildToParent(childFileName: string, parentFileName: string): Promise<boolean> {
        try {
            const issueDir = getIssueDir();
            if (!issueDir) {
                return false;
            }

            const parentFilePath = path.join(issueDir, parentFileName);
            const parentFileUri = vscode.Uri.file(parentFilePath);

            // 检查父文件是否存在
            try {
                await vscode.workspace.fs.stat(parentFileUri);
            } catch {
                console.warn(`父文件不存在: ${parentFileName}`);
                return false;
            }

            // 读取父文件的 frontmatter
            const parentFrontmatter = await getFrontmatter(parentFileUri);
            if (!parentFrontmatter) {
                console.warn(`父文件 ${parentFileName} 没有有效的 frontmatter`);
                return false;
            }

            // 检查是否已经包含该子文件
            const currentChildren = parentFrontmatter.children_files || [];
            if (currentChildren.includes(childFileName)) {
                console.log(`${childFileName} 已经在 ${parentFileName} 的 children_files 中`);
                return true;
            }

            // 添加子文件到 children_files
            const success = await this.updateFrontmatterField(
                parentFileName,
                'children_files',
                [...currentChildren, childFileName]
            );

            if (success) {
                console.log(`已自动将 ${childFileName} 添加到 ${parentFileName} 的 children_files`);
                
                // 显示用户通知
                const selection = await vscode.window.showInformationMessage(  
                    `已自动将 "${childFileName}" 添加到 "${parentFileName}" 的子文件列表`,  
                    '了解更多'  
                );  
                if (selection === '了解更多') {  
                    await vscode.window.showInformationMessage(  
                        '当创建新文件时，系统会自动将其添加到当前活动文件的子文件列表中，保持结构完整性。'  
                    );  
                }  
            }

            return success;

        } catch (error) {
            console.error(`添加子文件到父文件时出错:`, error);
            return false;
        }
    }

    /**
     * 自动从父文件的 children_files 中移除子文件
     */
    public static async removeChildFromParent(childFileName: string, parentFileName: string): Promise<boolean> {
        try {
            const issueDir = getIssueDir();
            if (!issueDir) {
                return false;
            }

            const parentFilePath = path.join(issueDir, parentFileName);
            const parentFileUri = vscode.Uri.file(parentFilePath);

            // 检查父文件是否存在
            try {
                await vscode.workspace.fs.stat(parentFileUri);
            } catch {
                console.warn(`父文件不存在: ${parentFileName}`);
                return false;
            }

            // 读取父文件的 frontmatter
            const parentFrontmatter = await getFrontmatter(parentFileUri);
            if (!parentFrontmatter) {
                console.warn(`父文件 ${parentFileName} 没有有效的 frontmatter`);
                return false;
            }

            // 从 children_files 中移除子文件
            const currentChildren = parentFrontmatter.children_files || [];
            const updatedChildren = currentChildren.filter((child: string) => child !== childFileName);

            // 如果没有变化，直接返回成功
            if (updatedChildren.length === currentChildren.length) {
                console.log(`${childFileName} 不在 ${parentFileName} 的 children_files 中`);
                return true;
            }

            const success = await this.updateFrontmatterField(
                parentFileName,
                'children_files',
                updatedChildren
            );

            if (success) {
                console.log(`已自动从 ${parentFileName} 的 children_files 中移除 ${childFileName}`);
                
                // 显示用户通知
                vscode.window.showInformationMessage(
                    `已自动从 "${parentFileName}" 的子文件列表中移除 "${childFileName}"`
                );
            }

            return success;

        } catch (error) {
            console.error(`从父文件移除子文件时出错:`, error);
            return false;
        }
    }

    /**
     * 设置文件的 parent_file 字段
     */
    public static async setParentFile(childFileName: string, parentFileName: string): Promise<boolean> {
        try {
            const success = await this.updateFrontmatterField(
                childFileName,
                'parent_file',
                parentFileName
            );

            if (success) {
                console.log(`已自动设置 ${childFileName} 的 parent_file 为 ${parentFileName}`);
            }

            return success;

        } catch (error) {
            console.error(`设置 parent_file 时出错:`, error);
            return false;
        }
    }

    /**
     * 同步子文件的 parent_file 字段与父文件的 children_files 保持一致
     */
    public static async syncChildParentReference(childFileName: string, newParentFileName: string): Promise<boolean> {
        try {
            const issueDir = getIssueDir();
            if (!issueDir) {
                return false;
            }

            const childFilePath = path.join(issueDir, childFileName);
            const childFileUri = vscode.Uri.file(childFilePath);

            // 检查子文件是否存在
            try {
                await vscode.workspace.fs.stat(childFileUri);
            } catch {
                console.warn(`子文件不存在: ${childFileName}`);
                return false;
            }

            // 获取子文件当前的 frontmatter
            const childFrontmatter = await getFrontmatter(childFileUri);
            if (!childFrontmatter) {
                console.warn(`子文件 ${childFileName} 没有有效的 frontmatter`);
                return false;
            }

            // 如果 parent_file 已经是正确的，无需修改
            if (childFrontmatter.parent_file === newParentFileName) {
                return true;
            }

            // 更新子文件的 parent_file
            const success = await this.updateFrontmatterField(
                childFileName,
                'parent_file',
                newParentFileName
            );

            if (success) {
                console.log(`已自动同步 ${childFileName} 的 parent_file 为 ${newParentFileName}`);
                
                // 显示通知给用户
                const selection = await vscode.window.showInformationMessage(  
                    `已自动同步 "${childFileName}" 的 parent_file 为 "${newParentFileName}"`,  
                    '了解更多'  
                );  
                if (selection === '了解更多') {  
                    await vscode.window.showInformationMessage(  
                        '当手动修改文件的结构关系时，系统会自动同步相关文件的 frontmatter，保持结构一致性。'  
                    );  
                }  
            }

            return success;

        } catch (error) {
            console.error(`同步子文件 parent_file 时出错:`, error);
            return false;
        }
    }

    /**
     * 确保父文件的 children_files 包含指定的子文件
     */
    public static async ensureChildInParent(childFileName: string, parentFileName: string): Promise<boolean> {
        try {
            const issueDir = getIssueDir();
            if (!issueDir) {
                return false;
            }

            const parentFilePath = path.join(issueDir, parentFileName);
            const parentFileUri = vscode.Uri.file(parentFilePath);

            // 检查父文件是否存在
            try {
                await vscode.workspace.fs.stat(parentFileUri);
            } catch {
                console.warn(`父文件不存在: ${parentFileName}`);
                return false;
            }

            // 获取父文件的 frontmatter
            const parentFrontmatter = await getFrontmatter(parentFileUri);
            if (!parentFrontmatter) {
                console.warn(`父文件 ${parentFileName} 没有有效的 frontmatter`);
                return false;
            }

            const currentChildren = parentFrontmatter.children_files || [];
            
            // 如果已经包含，无需操作
            if (currentChildren.includes(childFileName)) {
                return true;
            }

            // 添加子文件到 children_files
            return await this.addChildToParent(childFileName, parentFileName);

        } catch (error) {
            console.error(`确保子文件在父文件中时出错:`, error);
            return false;
        }
    }

    /**
     * 批量同步文件的结构关系
     */
    public static async syncFileStructureRelations(fileName: string, newFrontmatter: FrontmatterData): Promise<void> {
        try {
            const newChildrenFiles = newFrontmatter.children_files || [];
            const newParentFile = newFrontmatter.parent_file;

            // 同步 children_files 的变化
            await this.syncChildrenFilesChanges(fileName, newChildrenFiles);

            // 同步 parent_file 的变化
            if (newParentFile) {
                await this.syncParentFileChanges(fileName, newParentFile);
            }

        } catch (error) {
            console.error(`批量同步文件结构关系时出错:`, error);
        }
    }

    /**
     * 同步 children_files 的变化
     * 确保子文件的 parent_file 字段与父文件的 children_files 保持一致
     */
    private static async syncChildrenFilesChanges(parentFileName: string, newChildrenFiles: string[]): Promise<void> {
        try {
            const issueDir = getIssueDir();
            if (!issueDir) {
                return;
            }

            // 为每个子文件检查并更新其 parent_file 字段
            for (const childFileName of newChildrenFiles) {
                const childFilePath = path.join(issueDir, childFileName);
                const childFileUri = vscode.Uri.file(childFilePath);

                try {
                    // 检查子文件是否存在
                    await vscode.workspace.fs.stat(childFileUri);
                    
                    const childFrontmatter = await getFrontmatter(childFileUri);
                    if (childFrontmatter && childFrontmatter.parent_file !== parentFileName) {
                        // 子文件的 parent_file 不匹配，需要同步
                        await this.syncChildParentReference(childFileName, parentFileName);
                    }
                } catch {
                    // 子文件不存在或无法访问，跳过
                    continue;
                }
            }

        } catch (error) {
            console.error(`同步 children_files 变化时出错:`, error);
        }
    }

    /**
     * 同步 parent_file 的变化
     * 确保父文件的 children_files 包含当前文件
     */
    private static async syncParentFileChanges(childFileName: string, newParentFileName: string): Promise<void> {
        try {
            const issueDir = getIssueDir();
            if (!issueDir) {
                return;
            }

            const parentFilePath = path.join(issueDir, newParentFileName);
            const parentFileUri = vscode.Uri.file(parentFilePath);

            try {
                // 检查父文件是否存在
                await vscode.workspace.fs.stat(parentFileUri);
                
                const parentFrontmatter = await getFrontmatter(parentFileUri);
                if (parentFrontmatter) {
                    const currentChildren = parentFrontmatter.children_files || [];
                    
                    // 如果父文件的 children_files 中没有当前文件，添加它
                    if (!currentChildren.includes(childFileName)) {
                        await this.addChildToParent(childFileName, newParentFileName);
                    }
                }
            } catch {
                // 父文件不存在或无法访问，跳过
            }

        } catch (error) {
            console.error(`同步 parent_file 变化时出错:`, error);
        }
    }

    /**
     * 更新文件的 frontmatter 字段
     */
    private static async updateFrontmatterField(
        fileName: string,
        fieldName: string,
        fieldValue: any
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
            const updatedContent = await this.updateFrontmatterInContent(
                content, 
                fieldName, 
                fieldValue
            );

            if (updatedContent && updatedContent !== content) {
                // 创建编辑操作
                const edit = new vscode.WorkspaceEdit();
                const fullRange = new vscode.Range(
                    0, 0, 
                    document.lineCount, 0
                );
                edit.replace(fileUri, fullRange, updatedContent);

                // 应用编辑
                const success = await vscode.workspace.applyEdit(edit);
                if (success) {
                    console.log(`已更新 ${fileName} 的 ${fieldName} 字段`);
                    return true;
                }
            }

            return false;

        } catch (error) {
            console.error(`更新 frontmatter 字段时出错:`, error);
            return false;
        }
    }

    /**
     * 在文件内容中更新 frontmatter 字段
     */
    private static async updateFrontmatterInContent(
        content: string,
        fieldName: string,
        fieldValue: any
    ): Promise<string | null> {
        try {
            const lines = content.split('\n');
            
            // 检查是否有 frontmatter
            if (lines.length < 2 || lines[0] !== '---') {
                return null;
            }

            // 找到 frontmatter 结束位置
            let frontmatterEndIndex = -1;
            for (let i = 1; i < lines.length; i++) {
                if (lines[i] === '---') {
                    frontmatterEndIndex = i;
                    break;
                }
            }

            if (frontmatterEndIndex === -1) {
                return null;
            }

            // 提取 frontmatter 内容
            const frontmatterLines = lines.slice(1, frontmatterEndIndex);
            const frontmatterContent = frontmatterLines.join('\n');

            // 解析 YAML
            let frontmatterData: FrontmatterData;
            try {
                frontmatterData = (yaml.load(frontmatterContent) || {}) as FrontmatterData;
            } catch {
                return null;
            }

            // 更新字段
            frontmatterData[fieldName] = fieldValue;

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
            console.error(`更新文件内容中的 frontmatter 时出错:`, error);
            return null;
        }
    }

    /**
     * 检查文件是否有有效的 frontmatter
     */
    public static async hasValidFrontmatter(fileName: string): Promise<boolean> {
        try {
            const issueDir = getIssueDir();
            if (!issueDir) {
                return false;
            }

            const filePath = path.join(issueDir, fileName);
            const fileUri = vscode.Uri.file(filePath);

            const frontmatter = await getFrontmatter(fileUri);
            return frontmatter !== null;

        } catch (error) {
            console.error(`检查 frontmatter 有效性时出错:`, error);
            return false;
        }
    }

    /**
     * 为新文件创建基础的 frontmatter
     */
    public static async createBasicFrontmatter(
        fileName: string,
        title: string,
        rootFile: string,
        parentFile?: string
    ): Promise<boolean> {
        try {
            const issueDir = getIssueDir();
            if (!issueDir) {
                return false;
            }

            const filePath = path.join(issueDir, fileName);
            const fileUri = vscode.Uri.file(filePath);

            // 检查文件是否已经存在并有内容
            try {
                const document = await vscode.workspace.openTextDocument(fileUri);
                const content = document.getText().trim();
                
                // 如果文件已有内容，不覆盖
                if (content.length > 0) {
                    return false;
                }
            } catch {
                // 文件不存在，继续创建
            }

            // 创建基础 frontmatter
            const frontmatterData: FrontmatterData = {
                title,
                date: new Date().toISOString().split('T')[0],
                root_file: rootFile,
                children_files: []
            };

            if (parentFile) {
                frontmatterData.parent_file = parentFile;
            }

            const frontmatterContent = yaml.dump(frontmatterData, {
                flowLevel: -1,
                lineWidth: -1
            });

            const fileContent = `---\n${frontmatterContent.trim()}\n---\n\n# ${title}\n\n`;

            // 创建或更新文件
            const edit = new vscode.WorkspaceEdit();
            edit.createFile(fileUri, { ignoreIfExists: true });
            
            const document = await vscode.workspace.openTextDocument(fileUri);
            const fullRange = new vscode.Range(
                0, 0, 
                document.lineCount, 0
            );
            edit.replace(fileUri, fullRange, fileContent);

            const success = await vscode.workspace.applyEdit(edit);
            if (success) {
                console.log(`已为 ${fileName} 创建基础 frontmatter`);
            }

            return success;

        } catch (error) {
            console.error(`创建基础 frontmatter 时出错:`, error);
            return false;
        }
    }
}
