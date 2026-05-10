/**
 * MCP server 端共享的 markdown 渲染辅助函数。
 * 与扩展端的 `src/llmChat/tools/shared.ts` 输出格式一致(决策 #7)。
 */

import { formatAge, getTypeTag } from "../../services/issue-core/searchUtils";
import type { IssueMarkdownCore, FrontmatterData } from "../../services/issue-core";

/** 生成 markdown 链接,使用 IssueDir/ 约定(消费方按需替换为真实路径) */
export function issueLink(title: string, fileName: string): string {
    return `[\`${title}\`](IssueDir/${fileName})`;
}

/** 渲染 IssueMarkdownCore 列表(常用于搜索 / stats 结果) */
export function renderIssueList(items: IssueMarkdownCore[], opts: { showTag?: boolean } = {}): string {
    return items
        .map((issue, i) => {
            const tag = opts.showTag ? ` \`${getTypeTag(issue.frontmatter as Record<string, unknown> | null)}\`` : "";
            const age = formatAge(issue.mtime);
            return `${i + 1}. ${issueLink(issue.title, issue.fileName)}${tag} (${age})`;
        })
        .join("\n");
}

/** 把 frontmatter 暴露为 `Record<string, unknown> | null` 以便 getTypeTag 识别 */
export function fmAsRecord(fm: FrontmatterData | null | undefined): Record<string, unknown> | null {
    return fm as Record<string, unknown> | null ?? null;
}
