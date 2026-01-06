import * as vscode from 'vscode';
import { quickCreateIssue } from './quickCreateIssue';
import { getIssueNodeById } from '../data/issueTreeManager';
import { MarkerManager } from '../marker/MarkerManager';

/**  
 * 快速创建一个新任务（问题），并提供将当前标记任务归档并关联到新问题的选项。  
 * @param markerManager MarkerManager 实例，用于处理标记任务。  
 * @param parentId 可选的父问题 ID，新问题将作为其子问题。  
 * @returns 返回创建的问题 ID，如果创建失败或取消则返回 null。  
 */  
export async function quickCreateTask(markerManager: MarkerManager | undefined, parentId: string | null = null): Promise<string | null> {
    const createdId = await quickCreateIssue(parentId);
    if (!createdId) { return null; }

    try {
        const node = await getIssueNodeById(createdId);
        if (node) {
            await vscode.commands.executeCommand('issueManager.openAndRevealIssue', node, 'overview');
        } else {
            vscode.commands.executeCommand('issueManager.refreshAllViews');
        }
    } catch (error) {
        console.error('打开新建问题失败', error);
    }

    if (!markerManager) { return createdId; }

    try {
        const currentTask = markerManager.getCurrentTask();
        if (currentTask && currentTask.markers && currentTask.markers.length > 0) {
            const choice = await vscode.window.showInformationMessage(
                '当前标记任务中有标记。是否归档当前任务并将其关联到新建的问题？',
                { modal: true },
                '归档并关联',
            );

            if (choice === '归档并关联') {
                await markerManager.archiveCurrentTask();
                await markerManager.associateIssueToCurrentTask(createdId);
            }
        } 
    } catch (e) {
        console.error('处理标记视图归档/关联时出错', e);
    }

    return createdId;
}
