// 轻量级 cron 表达式匹配器
//
// 格式：minute hour dayOfMonth month dayOfWeek
//
// 支持：
//   数字       0 22 * * *         每天 22:00
//   范围       0 9 * * 1-5        周一至周五 09:00
//   列表       0 8,12,18 * * *    08:00/12:00/18:00
//   步进       */15 * * * *       每 15 分钟
//   通配       * * * * *          每分钟
//   组合       0 9 * * 1          周一 09:00（0=日 1=一 ... 6=六）
//
// 不支持：L、W、#、年份字段、非标准扩展

/**
 * 判断给定时间是否匹配 cron 表达式。
 * 仅匹配到分钟精度（忽略秒）。
 */
export function matchCron(expr: string, date: Date): boolean {
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== 5) { return false; }

    const fields = [
        date.getMinutes(),      // 0-59
        date.getHours(),        // 0-23
        date.getDate(),         // 1-31
        date.getMonth() + 1,    // 1-12
        date.getDay(),          // 0-6 (0=Sunday)
    ];

    return parts.every((part, i) => matchField(part, fields[i]));
}

/** 匹配单个 cron 字段 */
function matchField(pattern: string, value: number): boolean {
    // 逗号分隔的列表：任一匹配即可
    if (pattern.includes(',')) {
        return pattern.split(',').some(p => matchSingle(p.trim(), value));
    }
    return matchSingle(pattern, value);
}

// 匹配单个子表达式（支持 *、N/S、N-M、纯数字）
function matchSingle(token: string, value: number): boolean {
    if (token === '*') { return true; }

    // 步进：*/N 或 N-M/S
    if (token.includes('/')) {
        const [range, stepStr] = token.split('/');
        const step = parseInt(stepStr, 10);
        if (isNaN(step) || step <= 0) { return false; }

        if (range === '*') {
            return value % step === 0;
        }
        // N-M/S
        if (range.includes('-')) {
            const [a, b] = range.split('-').map(Number);
            return value >= a && value <= b && (value - a) % step === 0;
        }
        return false;
    }

    // 范围：N-M
    if (token.includes('-')) {
        const [a, b] = token.split('-').map(Number);
        return value >= a && value <= b;
    }

    // 纯数字
    return parseInt(token, 10) === value;
}

/**
 * 验证 cron 表达式格式是否合法。
 * 不做语义检查（如 31 2 = 2月31日），仅检查结构。
 */
export function isValidCron(expr: string): boolean {
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== 5) { return false; }

    const ranges = [
        [0, 59],    // minute
        [0, 23],    // hour
        [1, 31],    // day of month
        [1, 12],    // month
        [0, 6],     // day of week
    ];

    return parts.every((part, i) => {
        const [min, max] = ranges[i];
        // 逗号分隔的列表
        const tokens = part.split(',');
        return tokens.every(token => isValidToken(token.trim(), min, max));
    });
}

function isValidToken(token: string, min: number, max: number): boolean {
    if (token === '*') { return true; }

    if (token.includes('/')) {
        const [range, stepStr] = token.split('/');
        const step = parseInt(stepStr, 10);
        if (isNaN(step) || step <= 0) { return false; }
        if (range === '*') { return true; }
        if (range.includes('-')) {
            const [a, b] = range.split('-').map(Number);
            return !isNaN(a) && !isNaN(b) && a >= min && b <= max && a <= b;
        }
        return false;
    }

    if (token.includes('-')) {
        const [a, b] = token.split('-').map(Number);
        return !isNaN(a) && !isNaN(b) && a >= min && b <= max && a <= b;
    }

    const n = parseInt(token, 10);
    return !isNaN(n) && n >= min && n <= max;
}
