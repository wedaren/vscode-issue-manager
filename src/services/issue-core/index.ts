/**
 * issue-core 服务层的组合根。
 *
 * 用法:
 *   - 扩展端: `new IssueCoreServices(new VscodeStorage(), getIssueDir()!)`
 *   - MCP server: `new IssueCoreServices(new NodeFsStorage(), process.env.ISSUE_MANAGER_DIR!)`
 */

import type { Storage } from "./Storage";
import { IssueRepository } from "./IssueRepository";
import { IssueTreeRepository } from "./IssueTreeRepository";
import { IssueQuery } from "./IssueQuery";
import { KnowledgeBaseService } from "./KnowledgeBase";

export class IssueCoreServices {
    readonly issues: IssueRepository;
    readonly tree: IssueTreeRepository;
    readonly query: IssueQuery;
    readonly kb: KnowledgeBaseService;

    constructor(storage: Storage, issueDir: string) {
        this.issues = new IssueRepository(storage, issueDir);
        this.tree = new IssueTreeRepository(storage, issueDir);
        this.query = new IssueQuery(this.issues);
        this.kb = new KnowledgeBaseService(this.issues);
    }
}

// Re-export 关键类型与类,方便上层 import
export { IssueRepository } from "./IssueRepository";
export { IssueTreeRepository } from "./IssueTreeRepository";
export { IssueQuery } from "./IssueQuery";
export { KnowledgeBaseService } from "./KnowledgeBase";
export type { Storage } from "./Storage";
export type {
    FrontmatterData,
    TermDefinition,
    IssueMarkdownCore,
    LinkedFileParseResult,
    IndexedTypeKey,
} from "./types";
export type { PersistedIssueNode, PersistedTreeData } from "./IssueTreeRepository";
export type { SearchHit, SearchResult, LibraryStats, SearchScope } from "./IssueQuery";
export type {
    IngestMode,
    IngestOptions,
    IngestResult,
    CompileReport,
    LinkScanReport,
    HealthReport,
    KbQueryHit,
} from "./KnowledgeBase";
