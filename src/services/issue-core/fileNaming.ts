/**
 * 文件名生成与时间戳解析的纯工具函数。
 * 与 `src/utils/fileUtils.ts` 中的同名函数行为一致;
 * 这里独立成文件,避免 service 层间接 import 带 vscode 依赖的模块。
 */

/**
 * 解析文件名中的时间戳,兼容 `YYYYMMDD-HHmmss` 和 `YYYYMMDD-HHmmss-SSS`。
 */
export function parseFileNameTimestamp(fileName: string): Date | null {
    const timeRegex = /(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(?:-(\d{3}))?/;
    const match = fileName.match(timeRegex);
    if (!match) {
        return null;
    }
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1;
    const day = parseInt(match[3], 10);
    const hour = parseInt(match[4], 10);
    const min = parseInt(match[5], 10);
    const sec = parseInt(match[6], 10);
    const ms = match[7] ? parseInt(match[7], 10) : 0;
    return new Date(year, month, day, hour, min, sec, ms);
}

/**
 * 生成基于时间戳的文件名,格式 `YYYYMMDD-HHmmss-SSS.md`。
 */
export function generateFileName(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const seconds = String(now.getSeconds()).padStart(2, "0");
    const milliseconds = String(now.getMilliseconds()).padStart(3, "0");
    return `${year}${month}${day}-${hours}${minutes}${seconds}-${milliseconds}.md`;
}

/**
 * 从文件名中提取时间戳(毫秒),失败返回 null。
 */
export function getTimestampFromFileName(fileName: string): number | null {
    const date = parseFileNameTimestamp(fileName);
    return date ? date.getTime() : null;
}
