import * as vscode from "vscode";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import { getIssueDir } from "../config";
import { LLMService } from "../llm/LLMService";
import { getAllIssueMarkdowns } from "../data/IssueMarkdowns";
import { 
    DeepResearchMode, 
    DeepResearchTask, 
    DeepResearchDocument,
    addDeepResearchDocument,
    removeDeepResearchDocument
} from "../data/deepResearchManager";
import { DeepResearchViewProvider } from "../views/DeepResearchViewProvider";
import { Logger } from "../core/utils/Logger";

/**
 * 生成文件名（基于时间戳）
 */
function generateFileName(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const seconds = String(now.getSeconds()).padStart(2, "0");
    const ms = String(now.getMilliseconds()).padStart(3, "0");
    return `${year}${month}${day}-${hours}${minutes}${seconds}-${ms}.md`;
}

/**
 * 创建深度调研文档
 */
async function createDeepResearchDocument(
    topic: string,
    content: string,
    mode: DeepResearchMode
): Promise<string | null> {
    const issueDir = getIssueDir();
    if (!issueDir) {
        vscode.window.showErrorMessage("问题目录未配置，无法创建深度调研文档。");
        return null;
    }

    const fileName = generateFileName();
    const filePath = path.join(issueDir, fileName);

    // 构建文档内容
    const documentContent = `# ${topic}

> 深度调研报告 | 模式: ${getModeLabel(mode)} | 生成时间: ${new Date().toLocaleString()}

---

${content}
`;

    try {
        await vscode.workspace.fs.writeFile(
            vscode.Uri.file(filePath),
            Buffer.from(documentContent, "utf8")
        );

        // 保存到历史记录
        const document: DeepResearchDocument = {
            id: uuidv4(),
            topic,
            filePath,
            createdAt: Date.now(),
            lastModified: Date.now(),
            mode
        };
        await addDeepResearchDocument(document);

        return filePath;
    } catch (error) {
        Logger.getInstance().error("创建深度调研文档失败", error);
        vscode.window.showErrorMessage(`创建深度调研文档失败: ${error}`);
        return null;
    }
}

function getModeLabel(mode: DeepResearchMode): string {
    switch (mode) {
        case "auto": return "自动";
        case "local": return "本地笔记";
        case "llmOnly": return "纯 LLM";
        default: return mode;
    }
}

/**
 * 执行深度调研（本地笔记模式）
 */
async function performDeepResearchLocal(
    topic: string,
    abortSignal?: AbortSignal
): Promise<string> {
    // 获取所有本地笔记
    const allIssues = await getAllIssueMarkdowns();
    
    // 构建提示词
    const prompt = `你是一个专业的调研助手。请针对以下主题进行深度调研分析：

**调研主题**: ${topic}

**可用的本地笔记库**：
${JSON.stringify(
    allIssues.map(i => ({ 
        title: i.title, 
        filePath: i.uri.fsPath,
        briefSummary: i.frontmatter?.issue_brief_summary 
    })),
    null,
    2
)}

请完成以下任务：
1. 分析该主题的核心问题和关键要点
2. 从本地笔记库中找出所有相关的笔记
3. 综合这些笔记的内容，形成一份全面的调研报告
4. 提供清晰的结构和见解

请以 Markdown 格式输出，包含以下部分：
## 调研概述
## 核心发现
## 相关笔记引用
## 深度分析
## 结论与建议

在"相关笔记引用"部分，请列出所有参考的笔记及其路径。
`;

    const messages = [
        vscode.LanguageModelChatMessage.User(prompt)
    ];

    const result = await LLMService._request(messages, { signal: abortSignal });
    if (!result) {
        throw new Error("LLM 请求失败");
    }

    return result.text;
}

/**
 * 执行深度调研（纯 LLM 模式）
 */
async function performDeepResearchLlmOnly(
    topic: string,
    abortSignal?: AbortSignal
): Promise<string> {
    const prompt = `你是一个专业的调研助手。请针对以下主题进行深度调研分析：

**调研主题**: ${topic}

请完成以下任务：
1. 系统性地分析该主题的各个方面
2. 提供深入的见解和观点
3. 列举关键要点和最佳实践
4. 给出实用的建议和结论

请以 Markdown 格式输出，包含清晰的结构和详细的分析。建议包含以下部分：
## 调研概述
## 核心内容
## 深度分析
## 关键要点
## 最佳实践
## 结论与建议
`;

    const messages = [
        vscode.LanguageModelChatMessage.User(prompt)
    ];

    const result = await LLMService._request(messages, { signal: abortSignal });
    if (!result) {
        throw new Error("LLM 请求失败");
    }

    return result.text;
}

/**
 * 执行深度调研任务
 */
async function executeDeepResearchTask(
    task: DeepResearchTask,
    viewProvider: DeepResearchViewProvider
): Promise<void> {
    try {
        viewProvider.updateTaskStatus(task.id, "running");
        
        let content: string;
        
        if (task.mode === "local") {
            content = await performDeepResearchLocal(task.topic, task.abortController?.signal);
        } else if (task.mode === "llmOnly") {
            content = await performDeepResearchLlmOnly(task.topic, task.abortController?.signal);
        } else {
            // auto 模式：默认使用本地笔记模式
            content = await performDeepResearchLocal(task.topic, task.abortController?.signal);
        }

        // 创建文档
        const filePath = await createDeepResearchDocument(task.topic, content, task.mode);
        
        if (filePath) {
            viewProvider.completeTask(task.id);
            
            // 打开文档
            const doc = await vscode.workspace.openTextDocument(filePath);
            await vscode.window.showTextDocument(doc);
            
            vscode.window.showInformationMessage(`深度调研完成: ${task.topic}`);
        } else {
            viewProvider.updateTaskStatus(task.id, "failed", "创建文档失败");
        }
    } catch (error: unknown) {
        if (error instanceof Error && error.message === "请求已取消") {
            viewProvider.cancelTask(task.id);
        } else {
            const errorMessage = error instanceof Error ? error.message : String(error);
            Logger.getInstance().error("深度调研任务失败", error);
            viewProvider.updateTaskStatus(task.id, "failed", errorMessage);
            vscode.window.showErrorMessage(`深度调研失败: ${errorMessage}`);
        }
    }
}

/**
 * 注册深度调研命令
 */
export function registerDeepResearchCommands(
    context: vscode.ExtensionContext,
    viewProvider: DeepResearchViewProvider
): void {
    // 深度调研（自动模式）
    context.subscriptions.push(
        vscode.commands.registerCommand("issueManager.deepResearchIssue", async () => {
            const topic = await vscode.window.showInputBox({
                prompt: "请输入调研主题",
                placeHolder: "例如：如何优化 TypeScript 性能"
            });

            if (!topic) {
                return;
            }

            const task: DeepResearchTask = {
                id: uuidv4(),
                topic,
                mode: "auto",
                status: "pending",
                createdAt: Date.now(),
                updatedAt: Date.now(),
                abortController: new AbortController()
            };

            viewProvider.addActiveTask(task);
            await executeDeepResearchTask(task, viewProvider);
        })
    );

    // 深度调研（本地笔记模式）
    context.subscriptions.push(
        vscode.commands.registerCommand("issueManager.deepResearchIssueLocal", async () => {
            const topic = await vscode.window.showInputBox({
                prompt: "请输入调研主题（将基于本地笔记进行调研）",
                placeHolder: "例如：如何优化 TypeScript 性能"
            });

            if (!topic) {
                return;
            }

            const task: DeepResearchTask = {
                id: uuidv4(),
                topic,
                mode: "local",
                status: "pending",
                createdAt: Date.now(),
                updatedAt: Date.now(),
                abortController: new AbortController()
            };

            viewProvider.addActiveTask(task);
            await executeDeepResearchTask(task, viewProvider);
        })
    );

    // 深度调研（纯 LLM 模式）
    context.subscriptions.push(
        vscode.commands.registerCommand("issueManager.deepResearchIssueLlmOnly", async () => {
            const topic = await vscode.window.showInputBox({
                prompt: "请输入调研主题（将使用纯 LLM 模式，不参考本地笔记）",
                placeHolder: "例如：如何优化 TypeScript 性能"
            });

            if (!topic) {
                return;
            }

            const task: DeepResearchTask = {
                id: uuidv4(),
                topic,
                mode: "llmOnly",
                status: "pending",
                createdAt: Date.now(),
                updatedAt: Date.now(),
                abortController: new AbortController()
            };

            viewProvider.addActiveTask(task);
            await executeDeepResearchTask(task, viewProvider);
        })
    );

    // 新建深度调研任务（本地笔记）
    context.subscriptions.push(
        vscode.commands.registerCommand("issueManager.deepResearch.addTaskLocal", async () => {
            await vscode.commands.executeCommand("issueManager.deepResearchIssueLocal");
        })
    );

    // 新建深度调研任务（纯 LLM）
    context.subscriptions.push(
        vscode.commands.registerCommand("issueManager.deepResearch.addTaskLlmOnly", async () => {
            await vscode.commands.executeCommand("issueManager.deepResearchIssueLlmOnly");
        })
    );

    // 取消深度调研任务
    context.subscriptions.push(
        vscode.commands.registerCommand("issueManager.deepResearch.cancelTask", async (node: any) => {
            if (node && node.task) {
                const task = node.task as DeepResearchTask;
                viewProvider.cancelTask(task.id);
                vscode.window.showInformationMessage(`已取消调研任务: ${task.topic}`);
            }
        })
    );

    // 删除深度调研文档
    context.subscriptions.push(
        vscode.commands.registerCommand("issueManager.deepResearch.deleteDoc", async (node: any) => {
            if (!node || !node.document) {
                return;
            }

            const document = node.document as DeepResearchDocument;
            const answer = await vscode.window.showWarningMessage(
                `确定要删除深度调研文档"${document.topic}"吗？`,
                { modal: true },
                "删除"
            );

            if (answer !== "删除") {
                return;
            }

            try {
                // 删除物理文件
                await vscode.workspace.fs.delete(vscode.Uri.file(document.filePath));
                
                // 从历史记录中移除
                await removeDeepResearchDocument(document.id);
                
                // 刷新视图
                viewProvider.refresh();
                
                vscode.window.showInformationMessage(`已删除深度调研文档: ${document.topic}`);
            } catch (error) {
                Logger.getInstance().error("删除深度调研文档失败", error);
                vscode.window.showErrorMessage(`删除失败: ${error}`);
            }
        })
    );
}
