import * as vscode from 'vscode';
import { TreeDataProvider, Event, EventEmitter } from 'vscode';
import { AssociationManager } from '../associations/associationManager';
import { AssociationNode, AssociationError } from '../associations/types';
import { debounce } from '../utils/debounce';

/**
 * 关联视图的 TreeDataProvider
 * 显示当前活动文件与问题总览中节点的关联关系
 */
export class AssociationProvider implements TreeDataProvider<AssociationNode> {
  private _onDidChangeTreeData: EventEmitter<AssociationNode | undefined | void> = new EventEmitter<AssociationNode | undefined | void>();
  readonly onDidChangeTreeData: Event<AssociationNode | undefined | void> = this._onDidChangeTreeData.event;

  private associationManager: AssociationManager;
  private currentFileUri: vscode.Uri | null = null;
  private associationNodes: AssociationNode[] = [];
  private statusBarItem: vscode.StatusBarItem;
  private isLoading: boolean = false;
  private loadingTimer: NodeJS.Timeout | null = null;
  private currentLoadingStep: number = 0;
  private isViewVisible: boolean = false;
  private pendingRefresh: boolean = false;
  private loadingSteps: string[] = [
    '📊 正在扫描问题总览结构',
    '⏳ 正在构建关联路径', 
    '🔧 正在优化显示结构',
    '📈 正在计算关联权重',
    '✨ 正在完成最后处理'
  ];
  
  // 防抖处理的刷新方法
  private debouncedRefresh = debounce(async () => {
    await this.refreshAssociations(false);
  }, 500);

  constructor(context: vscode.ExtensionContext) {
    this.associationManager = new AssociationManager();
    
    // 初始化状态栏项
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusBarItem.command = 'issueManager.associations.refresh';
    context.subscriptions.push(this.statusBarItem);
    
    // 监听活动编辑器变化
    vscode.window.onDidChangeActiveTextEditor(this.onActiveEditorChanged, this, context.subscriptions);
    
    // 监听树数据变化
    this.associationManager.onTreeDataChanged(() => {
      this.debouncedRefresh();
    }, null, context.subscriptions);
    
    // 监听视图可见性变化
    context.subscriptions.push(
      vscode.window.onDidChangeVisibleTextEditors(() => this.handleVisibilityChange())
    );
    
    // 初始化当前文件
    if (vscode.window.activeTextEditor) {
      this.updateCurrentFile(vscode.window.activeTextEditor.document.uri);
    }
  }

  /**
   * 活动编辑器变化处理
   */
  private async onActiveEditorChanged(editor: vscode.TextEditor | undefined) {
    if (editor) {
      await this.updateCurrentFile(editor.document.uri);
    } else {
      this.currentFileUri = null;
      this.associationNodes = [];
      this._onDidChangeTreeData.fire();
    }
  }

  /**
   * 更新当前文件并刷新关联
   */
  async updateCurrentFile(fileUri: vscode.Uri): Promise<void> {
    this.currentFileUri = fileUri;
    await this.refreshAssociations();
  }

  /**
   * 刷新关联数据
   * @param force 是否强制刷新，忽略视图可见性
   */
  async refreshAssociations(force: boolean = true): Promise<void> {
    // 如果视图不可见且不是强制刷新，则标记为待刷新并返回
    if (!force && !this.isViewVisible) {
      this.pendingRefresh = true;
      return;
    }
    
    if (!this.currentFileUri) {
      this.associationNodes = [];
      this.updateStatusBar('idle');
      this._onDidChangeTreeData.fire();
      return;
    }

    // 重置待刷新标记
    this.pendingRefresh = false;

    // 设置加载状态
    this.isLoading = true;
    this.associationNodes = this.createLoadingNodes();
    this.updateStatusBar('loading');
    this.startLoadingAnimation();
    this._onDidChangeTreeData.fire();

    try {
      const result = await this.associationManager.getAssociations(this.currentFileUri);
      
      if (Array.isArray(result)) {
        // 成功获取关联节点
        this.associationNodes = result.length > 0 ? result : this.createEmptyNodes();
        this.updateStatusBar(result.length > 0 ? 'success' : 'empty', result.length);
      } else {
        // 处理错误情况
        this.associationNodes = this.createErrorNodes(result as AssociationError);
        this.updateStatusBar('error');
      }
    } catch (error) {
      console.error('刷新关联数据失败:', error);
      this.associationNodes = this.createErrorNodes({
        type: 'DATA_LOAD_FAILED' as any,
        message: '加载关联数据时发生错误'
      });
      this.updateStatusBar('error');
    } finally {
      this.isLoading = false;
      this.stopLoadingAnimation();
    }

    this._onDidChangeTreeData.fire();
  }



  /**
   * 从文件路径提取显示标签
   * @param filePath 文件路径
   * @returns 显示标签
   */
  private extractLabelFromPath(filePath: string): string {
    if (!filePath || typeof filePath !== 'string') {
      return '未知文件';
    }

    try {
      const trimmedPath = filePath.trim();
      if (!trimmedPath) {
        return '未知文件';
      }

      const parts = trimmedPath.split('/');
      const fileName = parts[parts.length - 1];
      
      // 移除 .md 扩展名
      if (fileName.endsWith('.md')) {
        return fileName.slice(0, -3);
      }
      
      return fileName || trimmedPath;
    } catch (error) {
      console.error('提取文件标签时出错:', error);
      return '未知文件';
    }
  }

  /**
   * 创建加载状态节点
   */
  private createLoadingNodes(): AssociationNode[] {
    const fileName = this.currentFileUri ? 
      this.extractLabelFromPath(this.currentFileUri.fsPath) : '当前文件';
    
    return [{
      id: 'loading',
      type: 'loading',
      label: `🔍 正在分析 "${fileName}" 的关联关系...`,
      children: [{
        id: 'loading-scan',
        type: 'loading',
        label: '📊 正在扫描问题总览结构',
        children: []
      }, {
        id: 'loading-build',
        type: 'loading',
        label: '⏳ 正在构建关联路径',
        children: []
      }, {
        id: 'loading-optimize',
        type: 'loading',
        label: '🔧 正在优化显示结构',
        children: []
      }, {
        id: 'loading-progress',
        type: 'loading',
        label: '📈 正在计算关联权重',
        children: []
      }, {
        id: 'loading-final',
        type: 'loading',
        label: '✨ 正在完成最后处理',
        children: []
      }, {
        id: 'loading-tip',
        type: 'loading',
        label: '💡 提示：复杂结构可能需要更多时间',
        children: []
      }, {
        id: 'loading-status',
        type: 'loading',
        label: '⏱️ 预计完成时间：几秒钟',
        children: []
      }]
    }];
  }

  /**
   * 创建空状态节点
   */
  private createEmptyNodes(): AssociationNode[] {
    const fileName = this.currentFileUri ? 
      this.extractLabelFromPath(this.currentFileUri.fsPath) : '当前文件';
    
    return [{
      id: 'no-associations',
      type: 'empty',
      label: `📄 ${fileName}`,
      children: [{
        id: 'empty-status',
        type: 'empty',
        label: '🔗 暂无关联关系',
        children: []
      }, {
        id: 'empty-reason',
        type: 'empty',
        label: '📋 此文件尚未在问题总览中建立关联',
        children: []
      }, {
        id: 'empty-suggestion',
        type: 'empty',
        label: '💡 建议：在问题总览中添加此文件的引用',
        children: []
      }, {
        id: 'empty-action',
        type: 'empty',
        label: '➕ 点击添加到问题总览',
        children: []
      }, {
        id: 'empty-help',
        type: 'empty',
        label: '📖 了解如何建立问题关联',
        children: []
      }]
    }];
  }

  /**
   * 创建错误节点
   */
  private createErrorNodes(error: AssociationError): AssociationNode[] {
    const errorNodes: AssociationNode[] = [{
      id: 'error',
      type: 'error',
      label: '⚠️ ' + error.message,
      children: []
    }];

    // 根据错误类型添加具体的帮助信息
    switch (error.type) {
      case 'FILE_NOT_IN_ISSUE_DIR':
        errorNodes[0].children.push({
          id: 'error-help-dir',
          type: 'error',
          label: '💡 请确保文件位于配置的问题目录内',
          children: []
        });
        break;
      case 'ISSUE_DIR_NOT_CONFIGURED':
        errorNodes[0].children.push({
          id: 'error-help-config',
          type: 'error',
          label: '⚙️ 点击配置问题目录',
          children: []
        });
        break;
      case 'DATA_LOAD_FAILED':
        errorNodes[0].children.push({
          id: 'error-help-retry',
          type: 'error',
          label: '🔄 点击重试加载',
          children: []
        });
        break;
      default:
        errorNodes[0].children.push({
          id: 'error-help-general',
          type: 'error',
          label: '📞 如问题持续，请查看输出面板',
          children: []
        });
    }

    if (error.details) {
      errorNodes[0].children.push({
        id: 'error-details',
        type: 'error',
        label: `💬 ${error.details}`,
        children: []
      });
    }

    return errorNodes;
  }

  /**
   * 获取树项
   * 设置节点的显示标题和图标，实现一级节点的 description 路径显示
   * 配置节点的展开/折叠状态，设置节点的点击命令和上下文菜单
   */
  async getTreeItem(element: AssociationNode): Promise<vscode.TreeItem> {
    // 根据节点类型和是否有子节点决定折叠状态
    let collapsibleState: vscode.TreeItemCollapsibleState;
    
    if (element.children.length > 0) {
      // 一级节点默认展开，其他节点默认折叠
      collapsibleState = element.type === 'path' 
        ? vscode.TreeItemCollapsibleState.Expanded 
        : vscode.TreeItemCollapsibleState.Collapsed;
    } else {
      collapsibleState = vscode.TreeItemCollapsibleState.None;
    }

    const item = new vscode.TreeItem(element.label, collapsibleState);
    item.id = element.id;

    if (element.type === 'path') {
      // 路径节点（根节点）- 显示路径信息在 description 中
      if (element.pathIndex !== undefined && element.children.length > 0) {
        // 构建路径描述字符串 - 从子节点中提取路径信息
        const pathLabels: string[] = [];
        let currentNode: AssociationNode | null = element.children[0]; // 从第一个子节点开始
        
        while (currentNode) {
          const label = this.extractLabelFromPath(currentNode.filePath || '');
          if (label && label !== '未知文件') {
            // 移除 (当前) 标记用于路径显示
            const cleanLabel = label.replace(' (当前)', '');
            pathLabels.push(cleanLabel);
          }
          // 移动到下一个子节点（如果存在）
          currentNode = currentNode.children.length > 0 ? currentNode.children[0] : null;
        }
        
        if (pathLabels.length > 0) {
          item.description = pathLabels.join(' / ');
          item.tooltip = `完整路径: ${pathLabels.join(' / ')}`;
        }
      }
      
      // 设置路径节点图标
      item.iconPath = new vscode.ThemeIcon('folder-opened');
      item.contextValue = 'associationPath';
      
      // 路径节点点击时定位到问题总览
      if (element.treeNodeId) {
        item.command = {
          command: 'issueManager.locateInOverview',
          title: '在问题总览中定位',
          arguments: [element.treeNodeId]
        };
      }
    } else if (element.type === 'issue') {
      // 问题节点
      // 检查是否为当前问题节点（路径的最后一个节点）
      const isCurrentIssue = element.label.includes('(当前)');
      
      // 根据是否为当前问题设置不同的图标和颜色
      if (isCurrentIssue) {
        // 当前问题使用高亮图标和颜色
        item.iconPath = new vscode.ThemeIcon('star-full', new vscode.ThemeColor('charts.yellow'));
        item.description = '📍 当前文件';
        // 添加高亮背景色和特殊样式
        item.resourceUri = element.resourceUri;
        // 设置特殊的上下文值以便应用不同的样式
        item.contextValue = 'currentIssueHighlight';
        // 添加更明显的视觉标识和动态效果
        item.label = `⭐ ${element.label}`;
        // 添加更丰富的工具提示
        item.tooltip = new vscode.MarkdownString(`**🎯 当前活动文件**\n\n📁 路径: \`${element.filePath}\`\n\n💡 这是您当前正在查看的文件，在关联树中以高亮显示`);
        item.tooltip.isTrusted = true;
      } else {
        // 其他问题使用普通图标，根据层级使用不同颜色
        const depth = this.getNodeDepth(element);
        const iconColor = depth === 0 ? 'symbolIcon.classForeground' : 
                         depth === 1 ? 'symbolIcon.methodForeground' : 
                         'symbolIcon.propertyForeground';
        item.iconPath = new vscode.ThemeIcon('file', new vscode.ThemeColor(iconColor));
        
        // 为关联文件添加更详细的工具提示
        if (element.filePath) {
          item.tooltip = new vscode.MarkdownString(`**🔗 关联文件**\n\n📁 路径: \`${element.filePath}\`\n\n💡 点击打开此文件`);
          item.tooltip.isTrusted = true;
        }
      }
      
      // 设置工具提示
      if (element.filePath) {
        const tooltip = isCurrentIssue 
          ? `当前文件: ${element.filePath}` 
          : `关联文件: ${element.filePath}`;
        item.tooltip = tooltip;
      }
      
      // 设置上下文值（用于菜单显示条件）
      item.contextValue = isCurrentIssue ? 'currentIssue' : 'associationIssue';
      
      // 设置点击命令 - 打开对应文件
      if (element.resourceUri) {
        item.resourceUri = element.resourceUri;
        item.command = {
          command: 'issueManager.openAssociationFile',
          title: '打开文件',
          arguments: [element.resourceUri, element.label]
        };
      }
    } else if (element.type === 'loading') {
      // 加载状态节点
      item.iconPath = new vscode.ThemeIcon('loading~spin');
      item.contextValue = 'loadingNode';
      // 加载节点不可点击
      item.command = undefined;
    } else if (element.type === 'error') {
      // 错误状态节点
      item.iconPath = new vscode.ThemeIcon('error');
      item.contextValue = 'errorNode';
      
      // 为特定错误类型添加点击命令
      if (element.id === 'error-help-config') {
        item.command = {
          command: 'workbench.action.openSettings',
          title: '打开设置',
          arguments: ['issueManager.issueDirectory']
        };
      } else if (element.id === 'error-help-retry') {
        item.command = {
          command: 'issueManager.associations.refresh',
          title: '重试加载'
        };
      }
    } else if (element.type === 'empty') {
      // 空状态节点
      item.iconPath = new vscode.ThemeIcon('info');
      item.contextValue = 'emptyNode';
      
      // 为帮助节点添加点击命令
      if (element.id === 'empty-help') {
        item.command = {
          command: 'vscode.open',
          title: '查看帮助',
          arguments: [vscode.Uri.parse('https://github.com/your-repo/wiki/associations')]
        };
      } else if (element.id === 'empty-action') {
        item.command = {
          command: 'issueManager.addToOverview',
          title: '添加到问题总览',
          arguments: [this.currentFileUri]
        };
      }
    }

    return item;
  }

  /**
   * 获取子节点
   */
  getChildren(element?: AssociationNode): Thenable<AssociationNode[]> {
    if (!element) {
      return Promise.resolve(this.associationNodes);
    }
    return Promise.resolve(element.children);
  }

  /**
   * 更新状态栏显示
   */
  private updateStatusBar(status: 'idle' | 'loading' | 'success' | 'empty' | 'error', count?: number): void {
    const fileName = this.currentFileUri ? 
      this.extractLabelFromPath(this.currentFileUri.fsPath) : '当前文件';
    
    switch (status) {
      case 'loading':
        this.statusBarItem.text = '$(loading~spin) 分析关联中...';
        this.statusBarItem.tooltip = `正在分析 "${fileName}" 的关联关系\n\n💡 提示：复杂结构可能需要更多时间\n🔄 点击可手动刷新`;
        this.statusBarItem.backgroundColor = undefined;
        this.statusBarItem.color = new vscode.ThemeColor('issueManager.loadingState.foreground');
        this.statusBarItem.show();
        break;
      case 'success':
        this.statusBarItem.text = `$(link) ${count || 0} 个关联`;
        this.statusBarItem.tooltip = `✅ 成功找到 ${count || 0} 个关联关系\n\n📄 文件: "${fileName}"\n🔄 点击刷新 | 💡 双击查看详情`;
        this.statusBarItem.backgroundColor = undefined;
        this.statusBarItem.color = new vscode.ThemeColor('issueManager.associationPath.foreground');
        this.statusBarItem.show();
        break;
      case 'empty':
        this.statusBarItem.text = '$(info) 无关联';
        this.statusBarItem.tooltip = `📄 "${fileName}" 暂无关联关系\n\n💡 建议：在问题总览中添加此文件的引用\n🔄 点击刷新`;
        this.statusBarItem.backgroundColor = undefined;
        this.statusBarItem.color = undefined;
        this.statusBarItem.show();
        break;
      case 'error':
        this.statusBarItem.text = '$(error) 关联错误';
        this.statusBarItem.tooltip = `❌ 加载 "${fileName}" 的关联关系时出错\n\n🔄 点击重试 | 📋 查看输出面板获取详细信息`;
        this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        this.statusBarItem.color = new vscode.ThemeColor('issueManager.errorState.foreground');
        this.statusBarItem.show();
        break;
      case 'idle':
      default:
        this.statusBarItem.hide();
        break;
    }
  }

  /**
   * 获取当前加载状态
   */
  public getLoadingState(): boolean {
    return this.isLoading;
  }

  /**
   * 获取当前关联数量
   */
  public getAssociationCount(): number {
    if (this.associationNodes.length === 0) {
      return 0;
    }
    
    // 过滤掉加载、错误和空状态节点，只计算实际的关联节点
    return this.associationNodes.filter(node => 
      node.type === 'path' && 
      node.id !== 'loading' && 
      node.id !== 'error' && 
      node.id !== 'no-associations'
    ).length;
  }

  /**
   * 获取当前视图状态
   */
  public getViewState(): 'loading' | 'success' | 'empty' | 'error' | 'idle' {
    if (this.isLoading) {
      return 'loading';
    }
    
    if (this.associationNodes.length === 0) {
      return 'idle';
    }
    
    const firstNode = this.associationNodes[0];
    if (firstNode.type === 'error') {
      return 'error';
    } else if (firstNode.type === 'empty') {
      return 'empty';
    } else if (firstNode.type === 'path') {
      return 'success';
    }
    
    return 'idle';
  }

  /**
   * 获取当前文件信息
   */
  public getCurrentFileInfo(): { fileName: string; filePath: string } | null {
    if (!this.currentFileUri) {
      return null;
    }
    
    return {
      fileName: this.extractLabelFromPath(this.currentFileUri.fsPath),
      filePath: this.currentFileUri.fsPath
    };
  }

  /**
   * 开始加载动画
   */
  private startLoadingAnimation(): void {
    this.currentLoadingStep = 0;
    this.updateLoadingStep();
    
    // 每1.5秒更新一次加载步骤
    this.loadingTimer = setInterval(() => {
      this.currentLoadingStep = (this.currentLoadingStep + 1) % this.loadingSteps.length;
      this.updateLoadingStep();
    }, 1500);
  }

  /**
   * 停止加载动画
   */
  private stopLoadingAnimation(): void {
    if (this.loadingTimer) {
      clearInterval(this.loadingTimer);
      this.loadingTimer = null;
    }
    this.currentLoadingStep = 0;
  }

  /**
   * 更新加载步骤显示
   */
  private updateLoadingStep(): void {
    if (!this.isLoading || this.associationNodes.length === 0) {
      return;
    }

    const loadingNode = this.associationNodes[0];
    if (loadingNode && loadingNode.type === 'loading' && loadingNode.children.length > 0) {
      // 更新当前步骤的显示状态
      loadingNode.children.forEach((child, index) => {
        if (index < this.loadingSteps.length) {
          if (index === this.currentLoadingStep) {
            // 当前步骤显示为活跃状态
            child.label = `✨ ${this.loadingSteps[index]}`;
          } else if (index < this.currentLoadingStep) {
            // 已完成的步骤显示为完成状态
            child.label = `✅ ${this.loadingSteps[index]}`;
          } else {
            // 未开始的步骤显示为等待状态
            child.label = `⏸️ ${this.loadingSteps[index]}`;
          }
        }
      });

      // 更新进度提示
      const progressPercent = Math.round((this.currentLoadingStep / this.loadingSteps.length) * 100);
      const tipChild = loadingNode.children.find(child => child.id === 'loading-tip');
      const statusChild = loadingNode.children.find(child => child.id === 'loading-status');
      
      if (tipChild) {
        tipChild.label = `💡 进度: ${progressPercent}% - 复杂结构可能需要更多时间`;
      }
      
      if (statusChild) {
        const remainingSteps = this.loadingSteps.length - this.currentLoadingStep;
        const estimatedTime = remainingSteps * 1.5;
        statusChild.label = `⏱️ 预计剩余时间：${estimatedTime.toFixed(1)}秒`;
      }

      // 触发视图更新
      this._onDidChangeTreeData.fire();
    }
  }

  /**
   * 获取节点深度（用于设置不同层级的视觉样式）
   */
  private getNodeDepth(element: AssociationNode): number {
    if (!element.pathIndex) {
      return 0;
    }
    
    // 通过路径索引和节点ID计算深度
    const idParts = element.id.split('_');
    if (idParts.length >= 3) {
      const nodeIndex = parseInt(idParts[2]);
      return isNaN(nodeIndex) ? 0 : nodeIndex;
    }
    
    return 0;
  }

  /**
   * 手动刷新
   */
  async refresh(): Promise<void> {
    await this.associationManager.refresh();
    await this.refreshAssociations();
  }

  /**
   * 处理视图可见性变化
   */
  private handleVisibilityChange(): void {
    // 检查关联视图是否可见
    const isVisible = vscode.window.visibleTextEditors.some(editor => 
      editor.document.uri.scheme === 'associations' || 
      editor.viewColumn === vscode.ViewColumn.Beside
    );
    
    // 视图可见性状态变化
    if (this.isViewVisible !== isVisible) {
      this.isViewVisible = isVisible;
      
      // 如果视图变为可见且有待刷新的数据，则执行刷新
      if (isVisible && this.pendingRefresh) {
        this.refreshAssociations();
      }
    }
  }

  /**
   * 销毁资源
   */
  dispose(): void {
    this.statusBarItem.dispose();
    this.stopLoadingAnimation();
  }
}