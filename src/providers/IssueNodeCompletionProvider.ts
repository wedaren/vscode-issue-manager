import * as vscode from 'vscode';
import * as path from 'path';
import { getFlatTree, FlatTreeNode, FocusedData } from '../data/issueTreeManager';
import { extractFilterKeyword, isDocumentInDirectory } from '../utils/completionUtils';
import { getIssueDir } from '../config';
import { readFocused } from '../data/focusedManager';
import { getIssueNodeIconPath } from '../data/issueTreeManager';
import { getIssueFilePath } from '../data/IssueMarkdowns';

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

    constructor(context: vscode.ExtensionContext) {
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
            // 获取当前行文本
            const lineText = document.lineAt(position.line).text;
            // 获取光标之前的文本
            const prefix = lineText.slice(0, position.character);

            // 在数组前插入两条常驻项：前台创建 & 后台创建（调用现有 quickCreateIssue QuickPick）
            const createItem = new vscode.CompletionItem('新建问题', vscode.CompletionItemKind.Keyword);
            createItem.detail = `快速新建问题:${prefix ?? ''}`;
            createItem.insertText = prefix  ?? '';
            createItem.keepWhitespace = true;
            createItem.sortText = '\u0000';
            createItem.preselect = true;
            createItem.filterText = prefix ?? '';
            // 直接调用专门的 completion 命令（避免弹出 QuickPick）
            createItem.command = { command: 'issueManager.createIssueFromCompletion', title: '快速新建问题', arguments: [inferredParentId, prefix ?? undefined, false, insertMode, false] };

            const createBackground = new vscode.CompletionItem('新建问题（后台）', vscode.CompletionItemKind.Keyword);
            createBackground.detail = `后台创建并由 AI 填充（不打开）:${prefix ?? ''}`;
            createBackground.insertText = prefix  ?? '';
            createBackground.keepWhitespace = true;
            createBackground.sortText = '\u0001';
            createBackground.preselect = true;
            createBackground.filterText = prefix ?? '';
            // 这里也复用 quickCreateIssue，QuickPick 会根据用户选择走后台路径；保留未来可直接调用后台命令的空间
            // 直接在后台创建，不弹出 QuickPick
            createBackground.command = { command: 'issueManager.createIssueFromCompletion', title: '快速新建问题（后台）', arguments: [inferredParentId, prefix ?? undefined, true, insertMode, false] };

            // 说明：
            // - 我们需要两个目标同时满足：确保这两项（“新建问题” / “新建问题（后台）”）在补全列表中被识别为匹配项以便靠前显示，
            //   同时尽量避免直接删除用户已输入的有效文本。为此采取了下面的折衷：
            //   * 把 replacing 范围扩大为从行首到当前位置，这样编辑器在计算匹配/权重时能把当前行的内容考虑在内，
            //     有助于提高这些固定项的相关性评分（避免被其他按关键字匹配的候选压到后面）。
            //   * 把 inserting 设置为行首的零长度范围，表明插入点在行首位置（在 replace 模式下会用 replacing 覆盖），
            //     但我们实际把补全的插入动作交给绑定的 `command` 来执行（`createIssueFromCompletion`），在命令中会在下一行插入内容。
            // - 代价与注意事项：接受补全时编辑器会首先以 `insertText`（此处我们通常设置为触发关键字或空字符串）替换从行首到光标的文本，
            //   随后补全的 `command` 会运行并在下一行插入新内容。如果你希望“完全不修改当前行”，应把 `insertText = ''` 并由 `command` 负责把关键字写回，
            //   或改走 QuickPick 流程来避免补全机制的替换/排序影响。当前实现是为了兼顾匹配优先级与插入可控性。
            const lineStart = new vscode.Position(position.line, 0);
            const replacingRange = new vscode.Range(lineStart, position);
            const insertingAtLineStart = new vscode.Range(lineStart, lineStart);
            createItem.range = { inserting: insertingAtLineStart, replacing: replacingRange };
            createBackground.range = { inserting: insertingAtLineStart, replacing: replacingRange };

            // 返回 CompletionList 并设置 isIncomplete=true，确保用户继续输入时会重新构建 items
            return new vscode.CompletionList([createItem, createBackground, ...items], true);
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
        // const iconPath = await getIssueNodeIconPath(node.id);
        
        // 构建显示标题：路径反序显示（最具体的节点在前）
        // 例如：/学习/node/vue -> vue/node/学习
        // 一级节点直接显示：test -> test
        let displayTitle: string;
        if (node.parentPath.length > 0) {
            const parentTitles = node.parentPath.map(n => n.title);
            // 反序：当前节点在前，父节点在后
            const reversedPath = [title, ...parentTitles.reverse()].join('/');
            displayTitle = reversedPath;
        } else {
            // 一级节点直接显示
            displayTitle = title;
        }
        
        const issueDir = getIssueDir();
        const absolutePath = issueDir ? path.join(issueDir, node.filePath) : node.filePath;
        const relativePath = node.filePath;
        
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
        // 包含：文件名、节点标题、完整路径（正序和反序）以及带空格的分词版本，改善中文或无分隔符字符串的中间匹配
        const spacefy = (s: string) => s.split('').join(' ');
        const parts: string[] = [];
        const basename = path.basename(node.filePath);
        parts.push(basename, title);

        if (node.parentPath.length > 0) {
            const parentTitles = node.parentPath.map(n => n.title);
            const forwardPath = [...parentTitles, title].join('/');
            const reversedPath = [title, ...[...parentTitles].reverse()].join('/');
            parts.push(forwardPath, reversedPath);
            // 带空格的变体，帮助 VS Code 对中文或连续字符的匹配（例如：'问题标记' -> '问 题 标 记'）
            parts.push(spacefy(title), spacefy(basename), spacefy(forwardPath), spacefy(reversedPath));
        } else {
            parts.push(spacefy(title), spacefy(basename));
        }

        item.filterText = parts.join(' ');

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
