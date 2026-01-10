import * as vscode from 'vscode';
import { readTree, writeTree, IssueNode, stripFocusedId, isAncestor } from '../data/issueTreeManager';
import { pickTargetWithQuickCreate } from './moveHelpers';
import { v4 as uuidv4 } from 'uuid';

function cloneNodeWithNewIds(node: IssueNode): IssueNode {
    return {
        id: uuidv4(),
        filePath: node.filePath,
        resourceUri: node.resourceUri,
        children: node.children ? node.children.map(c => cloneNodeWithNewIds(c)) : []
    };
}

export async function attachIssuesTo(selectedNodes: (IssueNode)[]) {
    if (selectedNodes.length === 0) {
        return;
    }

    selectedNodes.forEach(i => i.id = stripFocusedId(i.id));

    // 当 source 包含 IssueNode 时，若存在子节点，询问是否同时关联子节点
    let includeChildren = true;
    if (selectedNodes.length > 0) {
        const hasChildren = selectedNodes.some(n => n.children && n.children.length > 0);
        if (hasChildren) {
            const choice = await vscode.window.showWarningMessage(
                '所选问题包含子问题，是否同时将子问题一起关联到目标？',
                { modal: true },
                '是',
                '否'
            );
            if (!choice) return; // 取消
            includeChildren = choice === '是';
        }
    }

    const pick = await pickTargetWithQuickCreate(selectedNodes);
    if (!pick) return;
    
    const tree = await readTree();
    // 额外校验：确保目标不是自身或其子节点（双重保险）
    if (pick.node) {
        const targetId = stripFocusedId(pick.node.id);
        for (const sel of selectedNodes) {
            const selId = sel.id;
            if (selId === targetId || isAncestor(tree, selId, targetId)) {
                vscode.window.showWarningMessage('不能将节点关联到自身或其子节点，请选择其他目标。');
                return;
            }
        }
        if(pick.node?.children){
            pick.node.children.unshift(...selectedNodes.map(n=>cloneNodeWithNewIds(n)));
        } else  {
            pick.node.children = selectedNodes.map(n=>cloneNodeWithNewIds(n));
        }
        await writeTree(tree);
        vscode.commands.executeCommand('issueManager.refreshAllViews');
        vscode.window.showInformationMessage('节点已成功关联。');
    }
}
