import * as vscode from 'vscode';
import * as path from 'path';
import { getFlatTree, FlatTreeNode, FocusedData } from '../data/issueTreeManager';
import { extractFilterKeyword, isDocumentInDirectory } from '../utils/completionUtils';
import { getIssueDir } from '../config';
import { getIssueNodeIconPath, readFocused } from '../data/focusedManager';
import { ParaCategoryCache } from '../services/ParaCategoryCache';

/**
 * 带节点信息的补全项
 */
interface CompletionItemWithNode extends vscode.CompletionItem {
    node: FlatTreeNode;
    iconPath?: vscode.ThemeIcon;
}

/**
 * Issue 文件补全提供器
 * 复用 searchIssuesInFocused 的逻辑，从问题总览树获取数据
 */
export class IssueNodeCompletionProvider implements vscode.CompletionItemProvider {
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
            // 获取扁平化的树结构（已包含标题）
            const flatNodes = await getFlatTree();
            
            // 过滤节点（过滤后自动保持原始数组顺序）
            let filteredNodes = flatNodes;
            if (filterResult.keyword) {
                filteredNodes = await this.filterNodes(flatNodes, filterResult.keyword);
            }
            
            // 限制数量
            if (filteredNodes.length > maxItems) {
                filteredNodes = filteredNodes.slice(0, maxItems);
            }
            
            // 只获取一次配置和聚焦数据，避免在循环中重复读取
            const insertMode = config.get<string>('insertMode', 'relativePath');
            const focusedData = await readFocused();
            
            // 尝试推断当前上下文的 parentId（如果文档对应某个节点，则使用该节点作为父节点）
            let inferredParentId: string | null = null;
            try {
                const issueDirPath = getIssueDir();
                if (issueDirPath) {
                    const docRel = path.relative(issueDirPath, document.uri.fsPath);
                    const matched = flatNodes.find(n => n.filePath === docRel);
                    if (matched) {
                        // 使用当前文档对应的节点作为父节点（即在该节点下创建新问题）
                        inferredParentId = matched.id;
                    }
                }
            } catch (e) {
                inferredParentId = null;
            }

            // 转换为补全项
            const items = await Promise.all(
                filteredNodes.map((node, index) => 
                    this.createCompletionItem(node, document, filterResult.hasTrigger, insertMode, focusedData, index+2)
                )
            );

            // 在数组前插入两条常驻项：前台创建 & 后台创建（调用现有 quickCreateIssue QuickPick）
            const createItem = new vscode.CompletionItem('新建问题', vscode.CompletionItemKind.Keyword);
            createItem.detail = '快速新建问题';
            createItem.insertText = '';
            createItem.sortText = '000000';
            createItem.filterText = filterResult.keyword ?? '';
            // 直接调用专门的 completion 命令（避免弹出 QuickPick）
            createItem.command = { command: 'issueManager.createIssueFromCompletion', title: '快速新建问题', arguments: [inferredParentId, filterResult.keyword ?? undefined, false, insertMode, filterResult.hasTrigger] };

            const createBackground = new vscode.CompletionItem('新建问题（后台）', vscode.CompletionItemKind.Keyword);
            createBackground.detail = '后台创建并由 AI 填充（不打开）';
            createBackground.insertText = '';
            createBackground.sortText = '000001';
            createBackground.filterText = filterResult.keyword ?? '';
            // 这里也复用 quickCreateIssue，QuickPick 会根据用户选择走后台路径；保留未来可直接调用后台命令的空间
            // 直接在后台创建，不弹出 QuickPick
            createBackground.command = { command: 'issueManager.createIssueFromCompletion', title: '快速新建问题（后台）', arguments: [inferredParentId, filterResult.keyword ?? undefined, true, insertMode, filterResult.hasTrigger] };

            return [createItem, createBackground, ...items];
        } catch (error) {
            console.error('补全提供器错误:', error);
            return undefined;
        }
    }

    /**
     * 过滤节点（包含匹配）
     * 直接使用节点的 title 属性进行过滤
     */
    private async filterNodes(nodes: FlatTreeNode[], query: string): Promise<FlatTreeNode[]> {
        const queryLower = query.toLowerCase();
        const results: FlatTreeNode[] = [];
        
        // 遍历节点进行过滤（现在是同步操作）
        for (const node of nodes) {
            // 直接使用节点的标题属性
            const titleLower = node.title.toLowerCase();
            
            const parentTitles = node.parentPath.map(n => n.title);
            const fullPath = [...parentTitles, node.title].join(' ').toLowerCase();
            
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
        node: FlatTreeNode,
        document: vscode.TextDocument,
        hasTrigger: boolean,
        insertMode: string,
        focusedData: FocusedData,
        sortIndex: number
    ): Promise<CompletionItemWithNode> {
        // 直接使用节点的 title 属性
        const title = node.title;
        
        // 获取图标（与问题总览一致）
        const focusIndex = focusedData.focusList.indexOf(node.id);
        const { paraCategory } = this.paraCategoryCache.getParaMetadata(node.id);
        const iconPath = getIssueNodeIconPath(focusIndex !== -1 ? focusIndex : undefined, paraCategory);
        
        // 构建显示标题：路径反序显示（最具体的节点在前）
        // 例如：/学习/node/vue -> vue/node/学习
        // 一级节点直接显示：test -> test
        let displayTitle: string;
        if (node.parentPath.length > 0) {
            const parentTitles = node.parentPath.map(n => n.title);
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
        
        // 创建补全项，优先把父路径放到 label.description 以便在紧凑视图中展示
        const parentPathStr = node.parentPath && node.parentPath.length > 0 ? node.parentPath.map(n => n.title).join(' / ') : undefined;
        const labelObj: vscode.CompletionItemLabel = { label: displayTitle, description: parentPathStr };

        const item = new vscode.CompletionItem(
            labelObj,
            vscode.CompletionItemKind.Reference
        ) as CompletionItemWithNode;
        
        // 保存节点信息，用于后续操作
        item.node = node;

        // 设置排序键（基于 filteredNodes 的数组顺序）
        item.sortText = sortIndex.toString().padStart(6, '0');
        
        // 设置过滤文本（包含完整路径，支持通过任意层级路径过滤）
        // 包含：文件名、节点标题、完整路径（正序和反序）
        if (node.parentPath.length > 0) {
            const parentTitles = node.parentPath.map(n => n.title);
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
            const parentTitles = node.parentPath.map(n => n.title);
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
                    // 普通 markdown 链接：恢复为相对路径并带 issueId 查询
                    item.insertText = `[${title}](${relativePath}?issueId=${encodeURIComponent(node.id)})`;
                    // 在用户接受该补全项后，在侧边打开对应的 markdown 文件
                    item.command = { command: 'issueManager.openUriBeside', title: '在侧边打开', arguments: [absolutePath, node.id] };
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
