import * as vscode from 'vscode';
import { NoteMappingService } from '../services/noteMapping/NoteMappingService';
import { QuickPickNoteSelector } from '../ui/QuickPickNoteSelector';
import { getIssueDir } from '../config';
import { generateMappingId } from '../data/noteMappingStorage';

// 工作区级别映射的默认模式
const WORKSPACE_PATTERN = '**/*';

/**
 * 绑定工作区级别的笔记映射
 */
export async function bindWorkspaceNote(): Promise<void> {
  const issueDir = getIssueDir();
  if (!issueDir) {
    vscode.window.showWarningMessage('请先配置问题目录。');
    return;
  }

  const mappingService = NoteMappingService.getInstance();

  // 询问用户是要创建新映射还是编辑现有映射
  const action = await vscode.window.showQuickPick(
    [
      { label: '$(add) 创建新的工作区映射', value: 'create' },
      { label: '$(edit) 编辑现有映射', value: 'edit' },
      { label: '$(trash) 删除现有映射', value: 'delete' }
    ],
    { placeHolder: '选择操作' }
  );

  if (!action) {
    return;
  }

  if (action.value === 'create') {
    await createWorkspaceMapping(mappingService);
  } else if (action.value === 'edit') {
    await editWorkspaceMapping(mappingService);
  } else if (action.value === 'delete') {
    await deleteWorkspaceMapping(mappingService);
  }
}

/**
 * 创建工作区映射
 */
async function createWorkspaceMapping(mappingService: NoteMappingService): Promise<void> {
  // 选择 issue 文件
  const selector = new QuickPickNoteSelector();
  const issueIds = await selector.selectMultiple();

  if (!issueIds || issueIds.length === 0) {
    return;
  }

  // 询问优先级
  const priorityInput = await vscode.window.showInputBox({
    prompt: '设置优先级（数值越大优先级越高）',
    value: '10',
    validateInput: (value) => {
      const num = parseInt(value, 10);
      if (isNaN(num)) {
        return '请输入有效的数字';
      }
      return null;
    }
  });

  if (!priorityInput) {
    return;
  }

  const priority = parseInt(priorityInput, 10);

  // 创建映射
  await mappingService.addOrUpdate({
    id: generateMappingId(),
    scope: 'workspace',
    pattern: WORKSPACE_PATTERN, // 工作区级别匹配所有文件
    targets: issueIds,
    priority: priority,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  vscode.window.showInformationMessage('已创建工作区级别的笔记映射。');
}

/**
 * 编辑工作区映射
 */
async function editWorkspaceMapping(mappingService: NoteMappingService): Promise<void> {
  const allMappings = await mappingService.getAll();
  const workspaceMappings = allMappings.filter(m => m.scope === 'workspace');

  if (workspaceMappings.length === 0) {
    vscode.window.showInformationMessage('没有工作区级别的映射。');
    return;
  }

  // 选择要编辑的映射
  const items = workspaceMappings.map(m => ({
    label: `优先级: ${m.priority}`,
    description: `目标: ${m.targets.join(', ')}`,
    detail: `创建时间: ${m.createdAt}`,
    mapping: m
  }));

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: '选择要编辑的映射'
  });

  if (!selected) {
    return;
  }

  // 编辑优先级
  const priorityInput = await vscode.window.showInputBox({
    prompt: '修改优先级（数值越大优先级越高）',
    value: selected.mapping.priority.toString(),
    validateInput: (value) => {
      const num = parseInt(value, 10);
      if (isNaN(num)) {
        return '请输入有效的数字';
      }
      return null;
    }
  });

  if (!priorityInput) {
    return;
  }

  // 更新映射
  selected.mapping.priority = parseInt(priorityInput, 10);
  await mappingService.addOrUpdate(selected.mapping);

  vscode.window.showInformationMessage('已更新映射。');
}

/**
 * 删除工作区映射
 */
async function deleteWorkspaceMapping(mappingService: NoteMappingService): Promise<void> {
  const allMappings = await mappingService.getAll();
  const workspaceMappings = allMappings.filter(m => m.scope === 'workspace');

  if (workspaceMappings.length === 0) {
    vscode.window.showInformationMessage('没有工作区级别的映射。');
    return;
  }

  // 选择要删除的映射
  const items = workspaceMappings.map(m => ({
    label: `优先级: ${m.priority}`,
    description: `目标: ${m.targets.join(', ')}`,
    detail: `创建时间: ${m.createdAt}`,
    mapping: m
  }));

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: '选择要删除的映射'
  });

  if (!selected) {
    return;
  }

  // 确认删除
  const confirm = await vscode.window.showWarningMessage(
    '确定要删除此映射吗？',
    '删除',
    '取消'
  );

  if (confirm !== '删除') {
    return;
  }

  await mappingService.remove(selected.mapping.id);
  vscode.window.showInformationMessage('已删除映射。');
}

/**
 * 注册命令
 */
export function registerBindWorkspaceNoteCommand(context: vscode.ExtensionContext): void {
  const command = vscode.commands.registerCommand(
    'issueManager.bindWorkspaceNote',
    bindWorkspaceNote
  );
  context.subscriptions.push(command);
}
