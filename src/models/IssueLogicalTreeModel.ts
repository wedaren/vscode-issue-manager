import * as vscode from 'vscode';
import * as path from 'path';
import { getIssueDir } from '../config';
import { IssueFrontmatterService, IssueFrontmatterData } from '../services/IssueFrontmatterService';
import { titleCache } from '../data/titleCache';

/**
 * Issue 逻辑树节点
 */
export interface IssueLogicalTreeNode {
    fileName: string; // 相对路径
    title: string;
    children: IssueLogicalTreeNode[];
    isRoot: boolean;
    isCurrentFile: boolean; // 是否是当前活动文件
    resourceUri?: vscode.Uri;
}

/**
 * Issue 逻辑树模型
 * 负责数据的获取、构建和查找
 */
export class IssueLogicalTreeModel {
    private rootNodes: IssueLogicalTreeNode[] = [];
    private currentActiveFile: string | null = null;
    private currentRootFile: string | null = null; // 跟踪当前的根文件

    constructor() {}

    public get nodes(): IssueLogicalTreeNode[] {
        return this.rootNodes;
    }

    public get activeFile(): string | null {
        return this.currentActiveFile;
    }

    public get rootFile(): string | null {
        return this.currentRootFile;
    }

    public set activeFile(value: string | null) {
        this.currentActiveFile = value;
    }

    public set rootFile(value: string | null) {
        this.currentRootFile = value;
    }

    /**
     * 清除数据
     */
    public clear(): void {
        this.rootNodes = [];
        this.currentActiveFile = null;
        this.currentRootFile = null;
    }

    /**
     * 在树中更新当前文件标志
     */
    public updateCurrentFileInTree(oldFile: string | null, newFile: string): void {
        this.updateCurrentFileRecursive(this.rootNodes, oldFile, newFile);
        this.currentActiveFile = newFile;
    }

    private updateCurrentFileRecursive(nodes: IssueLogicalTreeNode[], oldFile: string | null, newFile: string): void {
        for (const node of nodes) {
            if (oldFile && node.fileName === oldFile) {
                node.isCurrentFile = false;
            }
            if (node.fileName === newFile) {
                node.isCurrentFile = true;
            }
            if (node.children.length > 0) {
                this.updateCurrentFileRecursive(node.children, oldFile, newFile);
            }
        }
    }

    /**
     * 构建逻辑树 - 显示当前活动文件所属的完整层级结构
     */
    public async buildTree(activeFile: string): Promise<void> {
        const issueDir = getIssueDir();
        if (!issueDir) {
            this.rootNodes = [];
            return;
        }

        this.currentActiveFile = activeFile;

        try {
            const service = IssueFrontmatterService.getInstance();
            
            // 读取当前文件的 frontmatter
            const currentFrontmatter = await service.getIssueFrontmatter(activeFile);
            
            if (!currentFrontmatter || !currentFrontmatter.issue_root) {
                // 如果没有 issue_root，显示空树
                this.rootNodes = [];
                return;
            }

            // 获取根文件名
            const rootFileName = currentFrontmatter.issue_root;
            
            // 更新当前根文件
            this.currentRootFile = rootFileName;

            // 收集需要读取的所有文件
            const filesToLoad = new Set<string>();

            // 递归收集所有相关文件
            const collectFiles = async (fileName: string) => {
                if (filesToLoad.has(fileName)) {
                    return;
                }
                filesToLoad.add(fileName);

                const fm = await service.getIssueFrontmatter(fileName);
                if (fm && fm.issue_children) {
                    for (const child of fm.issue_children) {
                        await collectFiles(child);
                    }
                }
            };

            await collectFiles(rootFileName);

            // 批量读取所有相关文件的 frontmatter
            const frontmatterMap = await service.getIssueFrontmatterBatch(Array.from(filesToLoad));
            const fileMap = new Map<string, IssueFrontmatterData>();
            for (const [fileName, frontmatter] of frontmatterMap.entries()) {
                if (frontmatter) {
                    fileMap.set(fileName, frontmatter);
                }
            }

            // 构建根节点
            const rootNode = await this.buildNodeTree(rootFileName, fileMap, issueDir, true);
            this.rootNodes = rootNode ? [rootNode] : [];

        } catch (error) {
            console.error('构建逻辑树失败:', error);
            this.rootNodes = [];
        }
    }

    /**
     * 递归构建节点树
     */
    private async buildNodeTree(
        fileName: string,
        fileMap: Map<string, IssueFrontmatterData>,
        issueDir: string,
        isRoot: boolean
    ): Promise<IssueLogicalTreeNode | null> {
        const frontmatter = fileMap.get(fileName);
        if (!frontmatter) {
            return null;
        }

        // 获取标题
        const title = await titleCache.get(fileName);

        // 构建子节点
        const children: IssueLogicalTreeNode[] = [];
        const childrenFiles = frontmatter.issue_children || [];
        
        for (const childFileName of childrenFiles) {
            const childNode = await this.buildNodeTree(childFileName, fileMap, issueDir, false);
            if (childNode) {
                children.push(childNode);
            }
        }

        return {
            fileName,
            title,
            children,
            isRoot,
            isCurrentFile: fileName === this.currentActiveFile, // 标记是否是当前活动文件
            resourceUri: vscode.Uri.file(path.join(issueDir, fileName))
        };
    }


    /**
     * 在树中查找节点
     */
    public findNode(fileName: string): IssueLogicalTreeNode | null {
        return this.findNodeRecursive(fileName, this.rootNodes);
    }

    private findNodeRecursive(
        fileName: string, 
        nodes: IssueLogicalTreeNode[]
    ): IssueLogicalTreeNode | null {
        for (const node of nodes) {
            if (node.fileName === fileName) {
                return node;
            }
            const found = this.findNodeRecursive(fileName, node.children);
            if (found) {
                return found;
            }
        }
        return null;
    }
}

