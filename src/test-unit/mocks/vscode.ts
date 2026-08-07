import * as path from 'path';

/**
 * 最小 vscode 模块 stub，仅供纯 node + mocha 单元测试使用。
 * 只实现被测模块（PerfMetrics / issueMarkdownCacheStorage / wikiBacklinkIndex /
 * config / Logger）实际用到的 API 面。
 */

// ---------------------------------------------------------------------------
// EventEmitter
// ---------------------------------------------------------------------------

export type Listener<T> = (e: T) => unknown;

export class EventEmitter<T> {
    private listeners: Listener<T>[] = [];

    public readonly event = (listener: Listener<T>): { dispose: () => void } => {
        this.listeners.push(listener);
        return {
            dispose: () => {
                this.listeners = this.listeners.filter(l => l !== listener);
            },
        };
    };

    public fire(data: T): void {
        for (const listener of [...this.listeners]) {
            listener(data);
        }
    }

    public dispose(): void {
        this.listeners = [];
    }
}

export type Event<T> = (listener: Listener<T>) => { dispose: () => void };

// ---------------------------------------------------------------------------
// Uri
// ---------------------------------------------------------------------------

export class Uri {
    private constructor(
        public readonly scheme: string,
        public readonly fsPath: string,
    ) { }

    public get path(): string {
        return this.fsPath;
    }

    public static file(fsPath: string): Uri {
        return new Uri('file', path.normalize(fsPath));
    }

    public toString(): string {
        return `${this.scheme}://${this.fsPath}`;
    }
}

// ---------------------------------------------------------------------------
// 内存文件系统（workspace.fs）
// ---------------------------------------------------------------------------

function fileNotFound(fsPath: string): Error & { code: string } {
    const err = new Error(`FileNotFound: ${fsPath}`) as Error & { code: string };
    err.code = 'FileNotFound';
    err.name = 'FileNotFound';
    return err;
}

export interface MockFileStat {
    type: number; // 1 = File, 2 = Directory
    ctime: number;
    mtime: number;
    size: number;
}

/** 内存文件：fsPath → 内容（Buffer） */
const files = new Map<string, Buffer>();
/** 已创建的目录集合 */
const directories = new Set<string>();
/** readFile 时被强制抛错的路径集合（用于模拟损坏文件） */
const readFailures = new Set<string>();

function toFsPath(uri: Uri | string): string {
    return typeof uri === 'string' ? path.normalize(uri) : uri.fsPath;
}

export const workspace = {
    fs: {
        async readFile(uri: Uri): Promise<Uint8Array> {
            const p = toFsPath(uri);
            if (readFailures.has(p)) {
                throw fileNotFound(p);
            }
            const content = files.get(p);
            if (content === undefined) {
                throw fileNotFound(p);
            }
            return new Uint8Array(content);
        },
        async writeFile(uri: Uri, content: Uint8Array): Promise<void> {
            files.set(toFsPath(uri), Buffer.from(content));
        },
        async stat(uri: Uri): Promise<MockFileStat> {
            const p = toFsPath(uri);
            const content = files.get(p);
            if (content !== undefined) {
                return { type: 1, ctime: 0, mtime: 0, size: content.length };
            }
            if (directories.has(p)) {
                return { type: 2, ctime: 0, mtime: 0, size: 0 };
            }
            throw fileNotFound(p);
        },
        async createDirectory(uri: Uri): Promise<void> {
            directories.add(toFsPath(uri));
        },
        async delete(uri: Uri): Promise<void> {
            const p = toFsPath(uri);
            if (!files.delete(p)) {
                throw fileNotFound(p);
            }
        },
    },

    getConfiguration(section?: string) {
        return {
            get<T>(key: string, defaultValue?: T): T | undefined {
                const store = configStore.get(section ?? '') ?? {};
                const fullKey = key;
                if (fullKey in store) {
                    return store[fullKey] as T;
                }
                return defaultValue;
            },
        };
    },
};

// ---------------------------------------------------------------------------
// 可注入配置（workspace.getConfiguration）
// ---------------------------------------------------------------------------

/** section → (key → value) */
const configStore = new Map<string, Record<string, unknown>>();

/** 测试辅助：注入配置值，例如 setMockConfig('issueManager', { issueDir: '/tmp/x' }) */
export function setMockConfig(section: string, values: Record<string, unknown>): void {
    configStore.set(section, { ...values });
}

/** 测试辅助：清空所有注入的配置 */
export function resetMockConfig(): void {
    configStore.clear();
}

// ---------------------------------------------------------------------------
// window（Logger / config 的提示信息兜底）
// ---------------------------------------------------------------------------

export const window = {
    createOutputChannel() {
        return {
            appendLine: () => undefined,
            show: () => undefined,
            dispose: () => undefined,
        };
    },
    showWarningMessage: () => undefined,
    showErrorMessage: () => undefined,
};

// ---------------------------------------------------------------------------
// 测试辅助：内存文件系统操作
// ---------------------------------------------------------------------------

/** 测试辅助：读取内存文件系统中的文件内容（utf8），不存在返回 undefined */
export function readMockFile(fsPath: string): string | undefined {
    const content = files.get(path.normalize(fsPath));
    return content === undefined ? undefined : content.toString('utf8');
}

/** 测试辅助：让指定路径的 readFile 抛 FileNotFound（模拟损坏文件） */
export function failMockRead(fsPath: string): void {
    readFailures.add(path.normalize(fsPath));
}

/** 测试辅助：清空内存文件系统与失败注入 */
export function resetMockFs(): void {
    files.clear();
    directories.clear();
    readFailures.clear();
}
