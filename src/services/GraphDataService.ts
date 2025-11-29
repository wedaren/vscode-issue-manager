import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { G6GraphData, G6Node, G6Edge } from '../webview/types';

/**
 * 图数据服务
 * 负责将问题文件数据转换为 G6 图数据格式
 */
export class GraphDataService {
    private static instance: GraphDataService;

    private constructor() { }

    public static getInstance(): GraphDataService {
        if (!GraphDataService.instance) {
            GraphDataService.instance = new GraphDataService();
        }
        return GraphDataService.instance;
    }

    /**
     * 获取指定文件的关系图数据
     */
    public async getGraphData(filePath: string): Promise<G6GraphData> {
        const nodes: G6Node[] = [];
        const edges: G6Edge[] = [];
        const visitedFiles = new Set<string>();

        // 递归解析文件及其关联
        await this.parseFileRecursive(filePath, nodes, edges, visitedFiles);

        return { nodes, edges };
    }

    /**
     * 递归解析文件及其链接
     */
    private async parseFileRecursive(
        filePath: string,
        nodes: G6Node[],
        edges: G6Edge[],
        visitedFiles: Set<string>,
        depth: number = 0
    ): Promise<void> {
        // 防止无限递归
        if (depth > 3 || visitedFiles.has(filePath)) {
            return;
        }

        visitedFiles.add(filePath);

        try {
            // 读取文件内容
            const content = await fs.readFile(filePath, 'utf-8');

            // 提取标题
            const title = this.extractTitle(content, filePath);

            // 添加节点
            const nodeId = this.getNodeId(filePath);
            nodes.push({
                id: nodeId,
                label: title,
                filePath: filePath,
                type: depth === 0 ? 'root' : 'default'
            });

            // 提取 Markdown 链接
            const links = this.extractMarkdownLinks(content, filePath);

            // 处理每个链接
            for (const linkedPath of links) {
                if (await this.fileExists(linkedPath)) {
                    const linkedNodeId = this.getNodeId(linkedPath);

                    // 添加边
                    edges.push({
                        source: nodeId,
                        target: linkedNodeId
                    });

                    // 递归解析链接的文件
                    await this.parseFileRecursive(linkedPath, nodes, edges, visitedFiles, depth + 1);
                }
            }

        } catch (error) {
            console.error(`解析文件失败: ${filePath}`, error);
        }
    }

    /**
     * 从文件内容中提取标题
     */
    private extractTitle(content: string, filePath: string): string {
        // 查找第一个一级标题
        const match = content.match(/^#\s+(.+)$/m);
        if (match) {
            return match[1].trim();
        }

        // 如果没有标题,使用文件名
        return path.basename(filePath, '.md');
    }

    /**
     * 提取 Markdown 链接
     */
    private extractMarkdownLinks(content: string, currentFilePath: string): string[] {
        const links: string[] = [];
        const dir = path.dirname(currentFilePath);

        // 匹配 Markdown 链接: [text](path)
        const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
        let match;

        while ((match = linkRegex.exec(content)) !== null) {
            const linkPath = match[2];

            // 跳过 URL 链接
            if (linkPath.startsWith('http://') || linkPath.startsWith('https://')) {
                continue;
            }

            // 跳过锚点链接
            if (linkPath.startsWith('#')) {
                continue;
            }

            // 解析相对路径
            const absolutePath = path.resolve(dir, linkPath);

            // 只处理 .md 文件
            if (absolutePath.endsWith('.md')) {
                links.push(absolutePath);
            }
        }

        return links;
    }

    /**
     * 生成节点 ID
     */
    private getNodeId(filePath: string): string {
        // 使用文件路径的哈希作为 ID
        return path.basename(filePath, '.md');
    }

    /**
     * 检查文件是否存在
     */
    private async fileExists(filePath: string): Promise<boolean> {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * 获取思维导图数据 (树形结构)
     */
    public async getMindMapData(filePath: string): Promise<any> {
        const content = await fs.readFile(filePath, 'utf-8');
        const fileName = path.basename(filePath, '.md');

        // 解析 Markdown 标题
        const lines = content.split('\n');
        const root = {
            id: 'root',
            label: fileName,
            children: [] as any[]
        };

        const stack: { level: number; node: any }[] = [{ level: 0, node: root }];

        for (const line of lines) {
            const match = line.match(/^(#+)\s+(.*)/);
            if (match) {
                const level = match[1].length;
                const text = match[2].trim();
                const node = {
                    id: `node-${Math.random().toString(36).substr(2, 9)}`,
                    label: text,
                    children: []
                };

                // 找到父节点
                while (stack.length > 0 && stack[stack.length - 1].level >= level) {
                    stack.pop();
                }

                const parent = stack[stack.length - 1].node;
                parent.children.push(node);
                stack.push({ level, node });
            }
        }

        return root;
    }
}
