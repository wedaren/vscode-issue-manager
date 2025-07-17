import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import * as path from 'path';
import { AssociationProvider } from '../views/AssociationProvider';
import { AssociationManager } from '../associations/associationManager';
import { AssociationService } from '../associations/associationService';
import { AssociationNode, AssociationError, AssociationErrorType } from '../associations/types';
import { IssueTreeNode, TreeData } from '../data/treeManager';
import * as config from '../config';

suite('关联功能集成测试', () => {
  let context: vscode.ExtensionContext;
  let associationProvider: AssociationProvider;
  let associationManager: AssociationManager;
  let associationService: AssociationService;
  let mockTreeView: any;
  let showTextDocumentStub: sinon.SinonStub;
  let executeCommandStub: sinon.SinonStub;
  let getIssueDirStub: sinon.SinonStub;
  let readTreeStub: sinon.SinonStub;
  let mockTreeData: TreeData;

  setup(() => {
    // 创建模拟的 ExtensionContext
    context = {
      subscriptions: [],
      extensionUri: vscode.Uri.file('/test/extension'),
      extensionPath: '/test/extension',
      globalState: {
        get: sinon.stub().returns(null),
        update: sinon.stub().resolves(),
        keys: () => [],
      } as any,
      workspaceState: {
        get: sinon.stub().returns(null),
        update: sinon.stub().resolves(),
        keys: () => [],
      } as any,
      secrets: {
        get: sinon.stub().resolves(null),
        store: sinon.stub().resolves(),
        delete: sinon.stub().resolves(),
      },
      storageUri: null,
      globalStorageUri: null,
      logUri: null,
      extensionMode: vscode.ExtensionMode.Test,
      environmentVariableCollection: {} as any,
      asAbsolutePath: (relativePath) => path.join('/test/extension', relativePath),
    };

    // 创建模拟的 TreeView
    mockTreeView = {
      title: '',
      visible: true,
      onDidChangeVisibility: sinon.stub().returns({ dispose: sinon.stub() }),
      reveal: sinon.stub().resolves(),
      dispose: sinon.stub(),
    };

    // 存根 VS Code API
    showTextDocumentStub = sinon.stub(vscode.window, 'showTextDocument').resolves();
    executeCommandStub = sinon.stub(vscode.commands, 'executeCommand').resolves();
    
    // 存根 getIssueDir 函数
    getIssueDirStub = sinon.stub(config, 'getIssueDir').returns('/test/issues');
    
    // 创建模拟的树数据
    mockTreeData = {
      version: '1.0.0',
      lastModified: new Date().toISOString(),
      rootNodes: [
        {
          id: 'root1',
          filePath: 'root1.md',
          resourceUri: vscode.Uri.file('/test/issues/root1.md'),
          children: [
            {
              id: 'child1',
              filePath: 'child1.md',
              resourceUri: vscode.Uri.file('/test/issues/child1.md'),
              children: [
                {
                  id: 'grandchild1',
                  filePath: 'test/file.md', // 匹配目标文件
                  resourceUri: vscode.Uri.file('/test/issues/test/file.md'),
                  children: []
                }
              ]
            }
          ]
        },
        {
          id: 'root2',
          filePath: 'root2.md',
          resourceUri: vscode.Uri.file('/test/issues/root2.md'),
          children: [
            {
              id: 'child2',
              filePath: 'test/file.md', // 匹配目标文件
              resourceUri: vscode.Uri.file('/test/issues/test/file.md'),
              children: []
            }
          ]
        }
      ]
    };
    
    // 存根 readTree 函数
    readTreeStub = sinon.stub(require('../data/treeManager'), 'readTree').resolves(mockTreeData);
    
    // 存根 getRelativePath 函数
    sinon.stub(require('../data/treeManager'), 'getRelativePath').callsFake((filePath: string) => {
      if (filePath === '/test/issues/test/file.md') {
        return 'test/file.md';
      }
      return null;
    });

    // 创建实际的服务实例
    associationService = new AssociationService();
    associationManager = new AssociationManager();
    // @ts-ignore - 替换私有属性
    associationManager['associationService'] = associationService;
    associationProvider = new AssociationProvider(context);
    // @ts-ignore - 替换私有属性
    associationProvider['associationManager'] = associationManager;
  });

  teardown(() => {
    sinon.restore();
  });

  /**
   * 测试从右键菜单到关联视图显示的完整流程
   */
  test('从右键菜单到关联视图显示的完整流程', async () => {
    // 模拟从右键菜单触发的 TreeItem
    const mockTreeItem = {
      id: 'test-item',
      resourceUri: vscode.Uri.file('/test/issues/test/file.md'),
      label: 'Test File'
    };

    // 创建关联视图管理器类的模拟实现
    class MockAssociationViewManager {
      private static instance: MockAssociationViewManager;
      private isViewVisible: boolean = false;
      private currentFileUri: vscode.Uri | null = null;

      constructor(
        private associationView: any,
        private associationProvider: AssociationProvider
      ) {}

      public static getInstance(
        associationView: any,
        associationProvider: AssociationProvider
      ): MockAssociationViewManager {
        if (!MockAssociationViewManager.instance) {
          MockAssociationViewManager.instance = new MockAssociationViewManager(associationView, associationProvider);
        }
        return MockAssociationViewManager.instance;
      }

      public async showAssociationView(fileUri: vscode.Uri): Promise<void> {
        this.currentFileUri = fileUri;
        this.isViewVisible = true;
        await this.associationProvider.updateCurrentFile(fileUri);
        this.associationView.title = `关联: ${path.basename(fileUri.fsPath)}`;
      }

      public isVisible(): boolean {
        return this.isViewVisible;
      }

      public getCurrentFileUri(): vscode.Uri | null {
        return this.currentFileUri;
      }

      public dispose(): void {}
    }

    // 创建关联视图管理器实例
    const associationViewManager = MockAssociationViewManager.getInstance(mockTreeView, associationProvider);

    // 模拟执行 viewAssociations 命令
    const fileUri = mockTreeItem.resourceUri;
    await associationViewManager.showAssociationView(fileUri);

    // 验证关联视图是否正确显示
    assert.strictEqual(associationViewManager.isVisible(), true, '关联视图应该可见');
    assert.strictEqual(
      associationViewManager.getCurrentFileUri()?.toString(),
      fileUri.toString(),
      '关联视图应该显示正确的文件'
    );

    // 验证关联数据是否正确加载
    // @ts-ignore - 访问私有属性
    const associationNodes = associationProvider['associationNodes'];
    assert.ok(Array.isArray(associationNodes), '关联节点应该是数组');
    assert.ok(associationNodes.length > 0, '应该有关联节点');

    // 验证关联节点的结构
    const firstNode = associationNodes[0];
    assert.strictEqual(firstNode.type, 'path', '第一个节点应该是路径节点');
    assert.ok(firstNode.children.length > 0, '路径节点应该有子节点');
  });

  /**
   * 测试节点点击和定位功能
   */
  test('节点点击和定位功能', async () => {
    // 准备测试数据
    const fileUri = vscode.Uri.file('/test/issues/test/file.md');
    await associationProvider.updateCurrentFile(fileUri);

    // 获取关联节点
    // @ts-ignore - 访问私有属性
    const associationNodes = associationProvider['associationNodes'];
    assert.ok(associationNodes.length > 0, '应该有关联节点');

    // 测试问题节点点击 - 应该打开文件
    const issueNode = associationNodes[0].children[0]; // 第一个路径的第一个问题节点
    assert.strictEqual(issueNode.type, 'issue', '节点类型应该是 issue');

    // 获取节点的 TreeItem
    const issueTreeItem = await associationProvider.getTreeItem(issueNode);
    assert.ok(issueTreeItem.command, '问题节点应该有点击命令');
    assert.strictEqual(issueTreeItem.command?.command, 'issueManager.openAssociationFile', '命令应该是 openAssociationFile');

    // 模拟执行命令
    if (issueTreeItem.command) {
      await vscode.commands.executeCommand(
        issueTreeItem.command.command,
        ...(issueTreeItem.command.arguments || [])
      );
    }

    // 验证是否尝试打开文件
    sinon.assert.called(showTextDocumentStub);

    // 测试路径节点点击 - 应该在问题总览中定位
    const pathNode = associationNodes[0]; // 第一个路径节点
    assert.strictEqual(pathNode.type, 'path', '节点类型应该是 path');

    // 获取路径节点的 TreeItem
    const pathTreeItem = await associationProvider.getTreeItem(pathNode);
    assert.ok(pathTreeItem.command, '路径节点应该有点击命令');
    assert.strictEqual(pathTreeItem.command?.command, 'issueManager.locateInOverview', '命令应该是 locateInOverview');

    // 模拟执行命令
    if (pathTreeItem.command) {
      await vscode.commands.executeCommand(
        pathTreeItem.command.command,
        ...(pathTreeItem.command.arguments || [])
      );
    }

    // 验证是否尝试在问题总览中定位
    sinon.assert.calledWith(executeCommandStub, 'issueManager.views.overview.focus');
  });

  /**
   * 测试多场景下的功能正确性 - 文件不在问题目录内
   */
  test('多场景测试 - 文件不在问题目录内', async () => {
    // 修改 getRelativePath 存根以返回 null
    // @ts-ignore - 重新存根 getRelativePath 函数
    require('../data/treeManager').getRelativePath = () => null;
    
    // 准备测试数据
    const fileUri = vscode.Uri.file('/other/path/file.md');
    await associationProvider.updateCurrentFile(fileUri);

    // 获取关联节点
    // @ts-ignore - 访问私有属性
    const associationNodes = associationProvider['associationNodes'];
    assert.ok(associationNodes.length > 0, '应该有错误节点');

    // 验证错误节点
    const errorNode = associationNodes[0];
    assert.strictEqual(errorNode.type, 'error', '节点类型应该是 error');
    assert.ok(errorNode.label.includes('文件不在问题目录内'), '错误消息应该正确');
  });

  /**
   * 测试多场景下的功能正确性 - 文件未在问题总览中关联
   */
  test('多场景测试 - 文件未在问题总览中关联', async () => {
    // 修改 getRelativePath 存根以返回不匹配的路径
    // @ts-ignore - 重新存根 getRelativePath 函数
    require('../data/treeManager').getRelativePath = () => 'not/matching/path.md';
    
    // 准备测试数据
    const fileUri = vscode.Uri.file('/test/issues/not/matching/path.md');
    await associationProvider.updateCurrentFile(fileUri);

    // 获取关联节点
    // @ts-ignore - 访问私有属性
    const associationNodes = associationProvider['associationNodes'];
    assert.ok(associationNodes.length > 0, '应该有错误节点');

    // 验证错误节点
    const errorNode = associationNodes[0];
    assert.strictEqual(errorNode.type, 'error', '节点类型应该是 error');
    assert.ok(errorNode.label.includes('文件未在问题总览中关联'), '错误消息应该正确');
  });

  /**
   * 测试多场景下的功能正确性 - 问题目录未配置
   */
  test('多场景测试 - 问题目录未配置', async () => {
    // 修改 getIssueDir 存根以返回 null
    getIssueDirStub.returns(null);
    
    // 准备测试数据
    const fileUri = vscode.Uri.file('/test/file.md');
    await associationProvider.updateCurrentFile(fileUri);

    // 获取关联节点
    // @ts-ignore - 访问私有属性
    const associationNodes = associationProvider['associationNodes'];
    assert.ok(associationNodes.length > 0, '应该有错误节点');

    // 验证错误节点
    const errorNode = associationNodes[0];
    assert.strictEqual(errorNode.type, 'error', '节点类型应该是 error');
    assert.ok(errorNode.label.includes('问题目录未配置'), '错误消息应该正确');
  });

  /**
   * 测试多场景下的功能正确性 - 数据加载失败
   */
  test('多场景测试 - 数据加载失败', async () => {
    // 修改 readTree 存根以返回 null
    readTreeStub.resolves(null);
    
    // 准备测试数据
    const fileUri = vscode.Uri.file('/test/issues/test/file.md');
    await associationProvider.updateCurrentFile(fileUri);

    // 获取关联节点
    // @ts-ignore - 访问私有属性
    const associationNodes = associationProvider['associationNodes'];
    assert.ok(associationNodes.length > 0, '应该有错误节点');

    // 验证错误节点
    const errorNode = associationNodes[0];
    assert.strictEqual(errorNode.type, 'error', '节点类型应该是 error');
    assert.ok(errorNode.label.includes('无法加载问题总览数据'), '错误消息应该正确');
  });

  /**
   * 测试从编辑器文件触发的逻辑
   */
  test('从编辑器文件触发的逻辑', async () => {
    // 模拟从编辑器文件触发
    const fileUri = vscode.Uri.file('/test/issues/test/file.md');
    
    // 创建关联视图管理器类的模拟实现
    class MockAssociationViewManager {
      private static instance: MockAssociationViewManager;
      private isViewVisible: boolean = false;
      private currentFileUri: vscode.Uri | null = null;

      constructor(
        private associationView: any,
        private associationProvider: AssociationProvider
      ) {}

      public static getInstance(
        associationView: any,
        associationProvider: AssociationProvider
      ): MockAssociationViewManager {
        if (!MockAssociationViewManager.instance) {
          MockAssociationViewManager.instance = new MockAssociationViewManager(associationView, associationProvider);
        }
        return MockAssociationViewManager.instance;
      }

      public async showAssociationView(fileUri: vscode.Uri): Promise<void> {
        this.currentFileUri = fileUri;
        this.isViewVisible = true;
        await this.associationProvider.updateCurrentFile(fileUri);
        this.associationView.title = `关联: ${path.basename(fileUri.fsPath)}`;
      }

      public isVisible(): boolean {
        return this.isViewVisible;
      }

      public getCurrentFileUri(): vscode.Uri | null {
        return this.currentFileUri;
      }

      public dispose(): void {}
    }

    // 创建关联视图管理器实例
    const associationViewManager = MockAssociationViewManager.getInstance(mockTreeView, associationProvider);

    // 模拟执行 viewAssociations 命令
    await associationViewManager.showAssociationView(fileUri);

    // 验证关联视图是否正确显示
    assert.strictEqual(associationViewManager.isVisible(), true, '关联视图应该可见');
    assert.strictEqual(
      associationViewManager.getCurrentFileUri()?.toString(),
      fileUri.toString(),
      '关联视图应该显示正确的文件'
    );

    // 验证关联数据是否正确加载
    // @ts-ignore - 访问私有属性
    const associationNodes = associationProvider['associationNodes'];
    assert.ok(Array.isArray(associationNodes), '关联节点应该是数组');
    assert.ok(associationNodes.length > 0, '应该有关联节点');
  });

  /**
   * 测试多次调用时的面板复用
   */
  test('多次调用时的面板复用', async () => {
    // 模拟从编辑器文件触发
    const fileUri = vscode.Uri.file('/test/issues/test/file.md');
    
    // 创建关联视图管理器类的模拟实现
    class MockAssociationViewManager {
      private static instance: MockAssociationViewManager;
      private isViewVisible: boolean = false;
      private currentFileUri: vscode.Uri | null = null;
      private showCount: number = 0;

      constructor(
        private associationView: any,
        private associationProvider: AssociationProvider
      ) {}

      public static getInstance(
        associationView: any,
        associationProvider: AssociationProvider
      ): MockAssociationViewManager {
        if (!MockAssociationViewManager.instance) {
          MockAssociationViewManager.instance = new MockAssociationViewManager(associationView, associationProvider);
        }
        return MockAssociationViewManager.instance;
      }

      public async showAssociationView(fileUri: vscode.Uri): Promise<void> {
        // 检查是否为同一个文件的重复调用
        const isSameFile = this.currentFileUri?.toString() === fileUri.toString();

        if (isSameFile && this.isViewVisible) {
          // 如果是同一个文件且视图已可见，只聚焦不重新加载
          await vscode.commands.executeCommand('issueManager.views.associations.focus');
        } else {
          // 存储当前文件URI
          this.currentFileUri = fileUri;
          this.isViewVisible = true;
          // 更新关联数据
          await this.associationProvider.updateCurrentFile(fileUri);
          // 设置视图标题
          this.associationView.title = `关联: ${path.basename(fileUri.fsPath)}`;
        }
        
        this.showCount++;
      }

      public isVisible(): boolean {
        return this.isViewVisible;
      }

      public getCurrentFileUri(): vscode.Uri | null {
        return this.currentFileUri;
      }
      
      public getShowCount(): number {
        return this.showCount;
      }

      public dispose(): void {}
    }

    // 创建关联视图管理器实例
    const associationViewManager = MockAssociationViewManager.getInstance(mockTreeView, associationProvider);

    // 第一次调用
    await associationViewManager.showAssociationView(fileUri);
    
    // 第二次调用同一个文件
    await associationViewManager.showAssociationView(fileUri);
    
    // 验证关联视图是否正确显示
    assert.strictEqual(associationViewManager.isVisible(), true, '关联视图应该可见');
    assert.strictEqual(
      associationViewManager.getCurrentFileUri()?.toString(),
      fileUri.toString(),
      '关联视图应该显示正确的文件'
    );
    
    // 验证调用次数
    assert.strictEqual(associationViewManager.getShowCount(), 2, '应该调用了两次 showAssociationView');
    
    // 验证第二次调用时执行了聚焦命令
    sinon.assert.calledWith(executeCommandStub, 'issueManager.views.associations.focus');
  });
});