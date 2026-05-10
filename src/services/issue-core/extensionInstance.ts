/**
 * 扩展端 IssueCoreServices 单例访问器。
 *
 * 这是 issue-core 服务层在 VS Code 扩展进程内的入口。MCP server 不应该 import 此文件
 * (它走自己的 NodeFsStorage 实例)。
 *
 * issueDir 来自 `vscode.workspace.getConfiguration("issueManager")`,可能在运行时变更。
 * 此处对 issueDir 做了 memoization,只在变化时重建 services 实例。
 */
import { getIssueDir } from "../../config";
import { IssueCoreServices } from "./index";
import { VscodeStorage } from "./storage/VscodeStorage";

let _services: IssueCoreServices | null = null;
let _lastIssueDir: string | null = null;

/**
 * 获取 IssueCoreServices 实例。issueDir 未配置时返回 null。
 *
 * 调用方负责 null check;通常工具的入口已经先检查过 `getIssueDir()`,
 * 这里返回 null 仅作为最后一道兜底。
 */
export function getIssueCoreServices(): IssueCoreServices | null {
    const issueDir = getIssueDir();
    if (!issueDir) {
        _services = null;
        _lastIssueDir = null;
        return null;
    }
    if (issueDir !== _lastIssueDir) {
        _services = new IssueCoreServices(new VscodeStorage(), issueDir);
        _lastIssueDir = issueDir;
    }
    return _services;
}

/** 测试用:重置单例,强制下次访问时重建。 */
export function resetIssueCoreServicesForTest(): void {
    _services = null;
    _lastIssueDir = null;
}
