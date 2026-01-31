import * as vscode from "vscode";
import * as path from "path";
import { getIssueDir } from "../config";
import { getAllIssueMarkdowns, getIssueFilePath } from "../data/IssueMarkdowns";
import { getAssociatedFiles, getIssueNodeById, readTree } from "../data/issueTreeManager";
import {
    applyOperations,
    buildTreeSnapshot,
    proposeOperationsWithLlm,
    RelationOperation,
    summarizeOperations,
} from "../commands/organizeIssueRelationsAgent";

type RelationOrganizerNodeType =
    | "section"
    | "duplicateGroup"
    | "issueRef"
    | "orphanFile"
    | "planOperation";

interface RelationOrganizerNodeBase {
    type: RelationOrganizerNodeType;
    key: string;
}

interface SectionNode extends RelationOrganizerNodeBase {
    type: "section";
    section: "scan" | "duplicates" | "orphans" | "plan";
    label: string;
}

interface DuplicateGroupNode extends RelationOrganizerNodeBase {
    type: "duplicateGroup";
    filePath: string;
    count: number;
    nodeIds: string[];
}

interface IssueRefNode extends RelationOrganizerNodeBase {
    type: "issueRef";
    nodeId: string;
    filePath: string;
    title: string;
}

interface OrphanFileNode extends RelationOrganizerNodeBase {
    type: "orphanFile";
    filePath: string;
    title: string;
}

interface PlanOperationNode extends RelationOrganizerNodeBase {
    type: "planOperation";
    index: number;
    op: RelationOperation;
}

export type RelationOrganizerNode =
    | SectionNode
    | DuplicateGroupNode
    | IssueRefNode
    | OrphanFileNode
    | PlanOperationNode;

export class RelationOrganizerProvider implements vscode.TreeDataProvider<RelationOrganizerNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<RelationOrganizerNode | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private snapshot: ReturnType<typeof buildTreeSnapshot> | null = null;
    private orphanFiles: Array<{ filePath: string; title: string }> = [];
    private planOperations: RelationOperation[] = [];

    public refresh(): void {
        void this.reload();
    }

    public async reload(): Promise<void> {
        await this.rebuildSnapshot();
        await this.rebuildOrphans();
        this._onDidChangeTreeData.fire();
    }

    public async runAgentPlan(): Promise<void> {
        const instruction = await vscode.window.showInputBox({
            title: "关系整理（TreeView）",
            prompt: "请输入整理目标（Agent 会输出 move/attach/disassociate 计划）",
            placeHolder: "例如：把所有标题含“登录”的问题移动到“认证”下面",
            ignoreFocusOut: true,
        });

        if (!instruction || !instruction.trim()) {
            return;
        }

        if (!this.snapshot) {
            await this.rebuildSnapshot();
        }

        if (!this.snapshot) {
            vscode.window.showWarningMessage("无法读取问题树快照，请先配置 issueDir。");
            return;
        }

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "关系整理 Agent：生成计划",
                cancellable: true,
            },
            async (progress, token) => {
                progress.report({ message: "生成计划中..." });
                let ops: RelationOperation[] = [];
                try {
                    ops = await proposeOperationsWithLlm(instruction.trim(), this.snapshot);
                } catch (error) {
                    const msg = error instanceof Error ? error.message : String(error);
                    vscode.window.showErrorMessage(
                        `生成计划失败：${msg}。建议缩小指令范围（加入更具体的标题关键词/文件名片段）。`
                    );
                    return;
                }
                if (token.isCancellationRequested) {
                    return;
                }

                if (ops.length === 0) {
                    vscode.window.showInformationMessage(
                        "Agent 未生成可执行计划（可能是指令不够明确、或树结构过大已自动裁剪导致信息不足）。\n建议：在指令里写明确的标题关键词/文件名片段，或先在树中把目标节点移动到同一父节点后再运行。"
                    );
                    return;
                }

                this.planOperations = ops;
                this._onDidChangeTreeData.fire();

                const summary = summarizeOperations(ops, this.snapshot);
                vscode.window.showInformationMessage(`已生成 ${ops.length} 条计划。可在“Agent 计划”中逐条应用。\n\n${summary}`);
            }
        );
    }

    public async applyPlan(all: boolean, index?: number): Promise<void> {
        if (this.planOperations.length === 0) {
            vscode.window.showInformationMessage("当前没有可应用的计划。");
            return;
        }

        const opsToApply: RelationOperation[] = all
            ? [...this.planOperations]
            : typeof index === "number" && this.planOperations[index]
                ? [this.planOperations[index]]
                : [];

        if (opsToApply.length === 0) {
            vscode.window.showWarningMessage("未找到要应用的操作。");
            return;
        }

        const preview = this.snapshot ? summarizeOperations(opsToApply, this.snapshot) : `共 ${opsToApply.length} 条操作`;
        const confirm = await vscode.window.showWarningMessage(
            `确认应用以下操作？\n\n${preview}`,
            { modal: true },
            "应用",
            "取消"
        );

        if (confirm !== "应用") {
            return;
        }

        const result = await applyOperations(opsToApply);

        // 应用后刷新快照
        await this.reload();

        // 若是应用全部，清空计划；若是单条，则移除该条
        if (all) {
            this.planOperations = [];
        } else if (typeof index === "number") {
            this.planOperations.splice(index, 1);
        }

        this._onDidChangeTreeData.fire();

        if (result.warnings.length > 0) {
            vscode.window.showWarningMessage(
                `已应用 ${result.applied} 条，跳过 ${result.skipped} 条。\n- ${result.warnings.join("\n- ")}`
            );
            return;
        }

        vscode.window.showInformationMessage(`✅ 已应用 ${result.applied} 条操作。`);
    }

    public clearPlan(): void {
        this.planOperations = [];
        this._onDidChangeTreeData.fire();
    }

    public removeOperation(index: number): void {
        if (!Number.isInteger(index) || index < 0 || index >= this.planOperations.length) {
            return;
        }
        this.planOperations.splice(index, 1);
        this._onDidChangeTreeData.fire();
    }

    public async openIssue(nodeId: string): Promise<void> {
        const issueNode = await getIssueNodeById(nodeId);
        if (!issueNode) {
            vscode.window.showWarningMessage("未找到对应的 IssueNode。");
            return;
        }

        const issueDir = getIssueDir();
        if (!issueDir) {
            vscode.window.showWarningMessage("issueDir 未配置。");
            return;
        }

        const uri = vscode.Uri.file(path.join(issueDir, issueNode.filePath)).with({
            query: `issueId=${encodeURIComponent(issueNode.id)}`,
        });

        await vscode.commands.executeCommand("issueManager.openAndViewRelatedIssues", uri);
    }

    public async addOrphanFileToTree(filePath: string): Promise<void> {
        const issueDir = getIssueDir();
        if (!issueDir) {
            vscode.window.showWarningMessage("issueDir 未配置。");
            return;
        }
        const uri = vscode.Uri.file(path.join(issueDir, filePath));
        await vscode.commands.executeCommand("issueManager.addIssueToTree", { resourceUri: uri, label: path.basename(filePath) });
    }

    async getTreeItem(element: RelationOrganizerNode): Promise<vscode.TreeItem> {
        if (element.type === "section") {
            const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
            item.contextValue = `relationOrganizer.section.${element.section}`;
            item.iconPath = new vscode.ThemeIcon("symbol-folder");
            return item;
        }

        if (element.type === "duplicateGroup") {
            const item = new vscode.TreeItem(
                `${element.filePath}（${element.count} 处引用）`,
                vscode.TreeItemCollapsibleState.Collapsed
            );
            item.contextValue = "relationOrganizer.duplicateGroup";
            item.iconPath = new vscode.ThemeIcon("copy");
            return item;
        }

        if (element.type === "issueRef") {
            const item = new vscode.TreeItem(element.title, vscode.TreeItemCollapsibleState.None);
            item.description = element.filePath;
            item.contextValue = "relationOrganizer.issueRef";
            item.iconPath = new vscode.ThemeIcon("note");
            item.command = {
                command: "issueManager.relationOrganizer.openIssue",
                title: "打开",
                arguments: [element.nodeId],
            };
            return item;
        }

        if (element.type === "orphanFile") {
            const item = new vscode.TreeItem(element.title, vscode.TreeItemCollapsibleState.None);
            item.description = element.filePath;
            item.contextValue = "relationOrganizer.orphanFile";
            item.iconPath = new vscode.ThemeIcon("circle-outline");
            const issueDir = getIssueDir();
            if (issueDir) {
                item.resourceUri = vscode.Uri.file(path.join(issueDir, element.filePath));
            }
            item.command = item.resourceUri
                ? {
                    command: "vscode.open",
                    title: "打开",
                    arguments: [item.resourceUri],
                }
                : undefined;
            return item;
        }

        // planOperation
        const op = element.op;
        const label = (() => {
            if (op.action === "move") {
                return `move: ${op.sourceId} -> ${op.targetParentId ?? "<根>"}`;
            }
            if (op.action === "attach") {
                return `attach: ${op.sourceId} -> ${op.targetParentId ?? "<根>"}${op.includeChildren ? "（含子）" : ""}`;
            }
            return `disassociate: ${op.nodeId}`;
        })();

        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
        item.contextValue = "relationOrganizer.planOperation";
        item.description = op.reason ?? "";
        item.iconPath = new vscode.ThemeIcon("tools");
        item.command = {
            command: "issueManager.relationOrganizer.applyOperation",
            title: "应用操作",
            arguments: [element.index],
        };
        return item;
    }

    getChildren(element?: RelationOrganizerNode): vscode.ProviderResult<RelationOrganizerNode[]> {
        if (!element) {
            return [
                { type: "section", key: "scan", section: "scan", label: "扫描结果" },
                { type: "section", key: "plan", section: "plan", label: "Agent 计划" },
            ];
        }

        if (element.type === "section") {
            if (element.section === "scan") {
                const children: RelationOrganizerNode[] = [
                    { type: "section", key: "duplicates", section: "duplicates", label: "重复引用（同一文件多处出现）" },
                    { type: "section", key: "orphans", section: "orphans", label: "未关联文件（文件存在但不在树中）" },
                ];
                return children;
            }

            if (element.section === "duplicates") {
                if (!this.snapshot) {
                    return [];
                }
                return this.snapshot.duplicatesByFilePath.map(d => ({
                    type: "duplicateGroup",
                    key: `dup:${d.filePath}`,
                    filePath: d.filePath,
                    count: d.count,
                    nodeIds: d.nodeIds,
                }));
            }

            if (element.section === "orphans") {
                return this.orphanFiles.map(o => ({
                    type: "orphanFile",
                    key: `orphan:${o.filePath}`,
                    filePath: o.filePath,
                    title: o.title,
                }));
            }

            if (element.section === "plan") {
                return this.planOperations.map((op, index) => ({
                    type: "planOperation",
                    key: `op:${index}`,
                    index,
                    op,
                }));
            }
        }

        if (element.type === "duplicateGroup") {
            if (!this.snapshot) {
                return [];
            }

            const byId = new Map(this.snapshot.nodes.map(n => [n.id, n] as const));
            return element.nodeIds
                .map(id => byId.get(id))
                .filter((n): n is NonNullable<typeof n> => !!n)
                .map(n => ({
                    type: "issueRef",
                    key: `ref:${n.id}`,
                    nodeId: n.id,
                    filePath: n.filePath,
                    title: n.title,
                }));
        }

        return [];
    }

    private async rebuildSnapshot(): Promise<void> {
        const tree = await readTree();
        this.snapshot = buildTreeSnapshot(tree.rootNodes, { version: tree.version, lastModified: tree.lastModified });
    }

    private async rebuildOrphans(): Promise<void> {
        const associated = await getAssociatedFiles();
        const all = await getAllIssueMarkdowns();

        const result: Array<{ filePath: string; title: string }> = [];
        for (const issue of all) {
            const filePath = getIssueFilePath(issue.uri);
            if (!filePath) {
                continue;
            }
            if (!associated.has(filePath)) {
                result.push({ filePath, title: issue.title });
            }
        }

        // 稳定排序：先 title 再 filePath
        result.sort((a, b) => {
            const t = a.title.localeCompare(b.title, "zh-CN");
            if (t !== 0) {
                return t;
            }
            return a.filePath.localeCompare(b.filePath, "zh-CN");
        });

        this.orphanFiles = result;
    }
}
