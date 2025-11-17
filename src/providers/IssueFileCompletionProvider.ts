import * as vscode from 'vscode';
import * as path from 'path';
import { readTree, IssueTreeNode } from '../data/treeManager';
import { TitleCacheService } from '../services/TitleCacheService';
import { extractFilterKeyword, isDocumentInDirectory } from '../utils/completionUtils';
import { getIssueDir } from '../config';
import { getIssueNodeIconPath, readFocused } from '../data/focusedManager';
import { ParaCategoryCache } from '../services/ParaCategoryCache';

/**
 * 扁平化的树节点（带父节点路径）
 */
interface FlatNode extends IssueTreeNode {
    parentPath: IssueTreeNode[];
    treeIndex: number; // 添加树中的原始顺序索引
}

/**
 * 带节点信息的补全项
 */
interface CompletionItemWithNode extends vscode.CompletionItem {
    node: FlatNode;
    iconPath?: vscode.ThemeIcon;
}

/**
 * Issue 文件补全提供器
 * 复用 searchIssuesInFocused 的逻辑，从问题总览树获取数据
 */
export class IssueFileCompletionProvider implements vscode.CompletionItemProvider {
    private paraCategoryCache: ParaCategoryCache;

    constructor(context: vscode.ExtensionContext) {
        this.paraCategoryCache = ParaCategoryCache.getInstance(context);
    }
    
    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): Promise<vscode.CompletionItem[] | vscode.CompletionList | undefined> {
        
        // 检查文档语言
        if (document.languageId !== 'markdown') {
            return undefined;
        }

        // 检查是否在 issueDir 下
        const issueDir = getIssueDir();
        if (!issueDir || !isDocumentInDirectory(document, issueDir)) {
            return undefined;
        }

        // 获取配置
        const config = vscode.workspace.getConfiguration('issueManager.completion');
        const triggers = config.get<string[]>('triggers', ['[[']);
        const maxItems = config.get<number>('maxItems', 200);
        const maxFilterLength = config.get<number>('maxFilterLength', 200);

        // 提取过滤关键字
        const filterResult = extractFilterKeyword(document, position, triggers, maxFilterLength);

        try {
            // 读取问题树
            const treeData = await readTree();
            
            // 扁平化树节点（复用 searchIssues 的逻辑）
            const flatNodes = this.flattenTree(treeData.rootNodes || [], [], { index: 0 });
            
            // 保持树中的原始顺序（不按 mtime 排序）
            // flatNodes 已经按照遍历顺序（即 tree.json 中的顺序）排列
            
            // 过滤节点
            let filteredNodes = flatNodes;
            if (filterResult.keyword) {
                filteredNodes = await this.filterNodes(flatNodes, filterResult.keyword);
                // 过滤后按 treeIndex 排序，保持树的原始顺序
                filteredNodes.sort((a, b) => a.treeIndex - b.treeIndex);
            }
            
            // 限制数量
            if (filteredNodes.length > maxItems) {
                filteredNodes = filteredNodes.slice(0, maxItems);
            }
            
            // 转换为补全项
            const items = await Promise.all(
                filteredNodes.map(node => this.createCompletionItem(node, document, filterResult.hasTrigger))
            );
            
            return items;
        } catch (error) {
            console.error('补全提供器错误:', error);
            return undefined;
        }
    }

    /**
     * 递归扁平化树节点（与 searchIssues 一致）
     * 保持树中的原始顺序
     */
    private flattenTree(nodes: IssueTreeNode[], parentNodes: IssueTreeNode[] = [], currentIndexRef: { index: number }): FlatNode[] {
        const result: FlatNode[] = [];
        
        for (const node of nodes) {
            result.push({
                ...node,
                parentPath: [...parentNodes],
                treeIndex: currentIndexRef.index++
            });
            
            if (node.children && node.children.length > 0) {
                const childNodes = this.flattenTree(node.children, [...parentNodes, node], currentIndexRef);
                result.push(...childNodes);
            }
        }
        
        return result;
    }

    /**
     * 过滤节点（包含匹配）
     */
    private async filterNodes(nodes: FlatNode[], query: string): Promise<FlatNode[]> {
        const queryLower = query.toLowerCase();
        const results: FlatNode[] = [];
        
        for (const node of nodes) {
            // 获取节点标题
            const cachedTitle = await TitleCacheService.getInstance().get(node.filePath);
            const title = cachedTitle || path.basename(node.filePath, '.md');
            const titleLower = title.toLowerCase();
            
            // 获取父级路径
            const parentTitles = await TitleCacheService.getInstance().getMany(
                node.parentPath.map(n => n.filePath)
            );
            const fullPath = [...parentTitles, title].join(' ').toLowerCase();
            
            // 文件名
            const filename = path.basename(node.filePath).toLowerCase();
            
            // 只要标题、路径或文件名包含关键字就匹配
            if (titleLower.includes(queryLower) || 
                fullPath.includes(queryLower) || 
                filename.includes(queryLower)) {
                results.push(node);
            }
        }
        
        return results;
    }

    /**
     * 创建补全项（与 searchIssues 的显示格式一致）
     */
    private async createCompletionItem(
        node: FlatNode,
        document: vscode.TextDocument,
        hasTrigger: boolean
    ): Promise<CompletionItemWithNode> {
        const config = vscode.workspace.getConfiguration('issueManager.completion');
        const insertMode = config.get<string>('insertMode', 'relativePath');

        // 获取节点标题
        const cachedTitle = await TitleCacheService.getInstance().get(node.filePath);
        const title = cachedTitle || path.basename(node.filePath, '.md');
        
        // 获取图标（与问题总览一致）
        const focusedData = await readFocused();
        const focusIndex = focusedData.focusList.indexOf(node.id);
        const { paraCategory } = this.paraCategoryCache.getParaMetadata(node.id);
        const iconPath = getIssueNodeIconPath(focusIndex !== -1 ? focusIndex : undefined, paraCategory);
        
        // 构建显示标题：路径反序显示（最具体的节点在前）
        // 例如：/学习/node/vue -> vue/node/学习
        // 一级节点直接显示：test -> test
        let displayTitle: string;
        if (node.parentPath.length > 0) {
            const parentTitles = await TitleCacheService.getInstance().getMany(
                node.parentPath.map(n => n.filePath)
            );
            // 反序：当前节点在前，父节点在后
            const reversedPath = [title, ...parentTitles.reverse()].join('/');
            displayTitle = iconPath ? `$(${iconPath.id}) ${reversedPath}` : reversedPath;
        } else {
            // 一级节点直接显示
            displayTitle = iconPath ? `$(${iconPath.id}) ${title}` : title;
        }
        
        // 计算相对路径（相对于当前文档所在目录）
        const currentDir = path.dirname(document.uri.fsPath);
        const issueDir = getIssueDir();
        const absolutePath = issueDir ? path.join(issueDir, node.filePath) : node.filePath;
        const relativePath = path.relative(currentDir, absolutePath);
        
        // 创建补全项
        const item = new vscode.CompletionItem(
            displayTitle,
            vscode.CompletionItemKind.Reference
        ) as CompletionItemWithNode;
        
        // 保存节点信息，用于后续操作
        item.node = node;

        // 设置排序键（基于树的顺序，而不是字母顺序）
        // 使用 treeIndex 生成排序键，确保按照树的原始顺序显示
        item.sortText = node.treeIndex.toString().padStart(6, '0');
        
        // 设置过滤文本（包含完整路径，支持通过任意层级路径过滤）
        // 包含：文件名、节点标题、完整路径（正序和反序）
        if (node.parentPath.length > 0) {
            const parentTitles = await TitleCacheService.getInstance().getMany(
                node.parentPath.map(n => n.filePath)
            );
            // 包含正序路径（学习/node/vue）和反序路径（vue/node/学习），以及各个部分
            const forwardPath = [...parentTitles, title].join('/');
            const reversedPath = [title, ...parentTitles.reverse()].join('/');
            item.filterText = `${path.basename(node.filePath)} ${title} ${forwardPath} ${reversedPath}`;
        } else {
            item.filterText = `${path.basename(node.filePath)} ${title}`;
        }

        // 设置详情（显示相对路径）
        item.detail = relativePath;

        // 设置文档说明
        const docParts = [`**${title}**`];
        if (node.parentPath.length > 0) {
            const parentTitles = await TitleCacheService.getInstance().getMany(
                node.parentPath.map(n => n.filePath)
            );
            docParts.push(`路径: ${parentTitles.join(' → ')} → ${title}`);
        }
        item.documentation = new vscode.MarkdownString(docParts.join('\n\n'));

        // 根据插入模式设置插入文本
        switch (insertMode) {
            case 'markdownLink':
                if (hasTrigger) {
                    // 如果有触发前缀（如 [[），插入 wiki 风格链接
                    item.insertText = `${title}]]`;
                } else {
                    // 普通 markdown 链接
                    item.insertText = `[${title}](${relativePath})`;
                }
                break;
            
            case 'filename':
                item.insertText = path.basename(node.filePath);
                break;
            
            case 'relativePath':
            default:
                item.insertText = relativePath;
                break;
        }

        return item;
    }
}
