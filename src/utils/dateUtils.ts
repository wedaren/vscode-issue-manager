/**
 * 日期工具函数模块
 */

/**
 * 标准化日期（只保留年月日）
 * @param date 输入日期
 * @returns 标准化后的日期
 */
export function normalizeDate(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * 格式化日期为本地化字符串
 * @param date 输入日期
 * @returns 格式化后的日期字符串
 */
export function formatDate(date: Date): string {
    const options: Intl.DateTimeFormatOptions = { 
        month: 'long', 
        day: 'numeric', 
        weekday: 'long' 
    };
    return new Intl.DateTimeFormat(undefined, options).format(date);
}

/**
 * 将日期转换为标准化的键值字符串（YYYY-MM-DD）
 * @param date 输入日期
 * @returns 标准化的日期字符串
 */
export function dateToKey(date: Date): string {
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}

/**
 * 获取相对日期的分组键
 * @param itemDate 文章日期
 * @param today 今天的日期（可选，默认为当前日期）
 * @returns 分组键（'今天'、'昨天'、标准化日期字符串或'更早'）
 */
export function getDateGroupKey(itemDate: Date, today: Date = new Date()): string {
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    const normalizedItemDate = normalizeDate(itemDate);
    const normalizedToday = normalizeDate(today);
    const normalizedYesterday = normalizeDate(yesterday);
    const normalizedOneWeekAgo = normalizeDate(oneWeekAgo);
    
    const todayKey = dateToKey(normalizedToday);
    const yesterdayKey = dateToKey(normalizedYesterday);
    const itemKey = dateToKey(normalizedItemDate);
    
    if (itemKey === todayKey) {
        return '今天';
    } else if (itemKey === yesterdayKey) {
        return '昨天';
    } else if (normalizedItemDate >= normalizedOneWeekAgo) {
        return itemKey; // 一周内用标准化日期字符串
    } else {
        return '更早';
    }
}

/**
 * 获取有序的日期分组键列表
 * @param groups 按分组键分组的Map
 * @returns 排序后的分组键数组
 */
export function getOrderedGroupKeys(groups: Map<string, any[]>): string[] {
    const orderedKeys = ['今天', '昨天'];
    const result: string[] = [];
    
    // 添加今天和昨天
    for (const key of orderedKeys) {
        if (groups.has(key)) {
            result.push(key);
        }
    }
    
    // 一周内的日期分组（标准化日期字符串），按日期倒序
    const weekDateKeys: string[] = [];
    for (const [key] of groups.entries()) {
        if (key !== '今天' && key !== '昨天' && key !== '更早') {
            weekDateKeys.push(key);
        }
    }
    weekDateKeys.sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
    
    result.push(...weekDateKeys);
    
    // 添加更早的文章
    if (groups.has('更早')) {
        result.push('更早');
    }
    
    return result;
}

/**
 * 将标准化日期字符串转换为显示标签
 * @param dateKey 标准化日期字符串（YYYY-MM-DD）
 * @returns 格式化的显示标签
 */
export function dateKeyToLabel(dateKey: string): string {
    if (dateKey === '今天' || dateKey === '昨天' || dateKey === '更早') {
        return dateKey;
    }
    
    const date = new Date(dateKey);
    return formatDate(date);
}

function isSameDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * 格式化为中文相对时间文案（如“3 分钟前 / 刚刚”）
 */
export function formatRelativeTime(date: Date, now: Date = new Date()): string {
    const diffMs = now.getTime() - date.getTime();
    const isFuture = diffMs < 0;
    const diffAbsMs = Math.abs(diffMs);

    const seconds = Math.floor(diffAbsMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    const suffix = isFuture ? '后' : '前';

    if (seconds < 30) {
        return isFuture ? '即将' : '刚刚';
    }
    if (minutes < 60) {
        return `${minutes} 分钟${suffix}`;
    }
    if (hours < 24) {
        return `${hours} 小时${suffix}`;
    }
    if (days < 30) {
        return `${days} 天${suffix}`;
    }

    const years = Math.floor(days / 365);
    if (years >= 1) {
        return `${years} 年${suffix}`;
    }

    const months = Math.floor(days / 30);
    return `${months} 个月${suffix}`;
}

/**
 * 用于列表展示的紧凑绝对时间：
 * - 同一天：HH:mm
 * - 同一年：MM-DD
 * - 其他：YYYY-MM-DD
 */
export function formatCompactDateTime(date: Date, now: Date = new Date()): string {
    let options: Intl.DateTimeFormatOptions;
    if (isSameDay(date, now)) {
        options = {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        };
    } else if (date.getFullYear() === now.getFullYear()) {
        options = {
            month: '2-digit',
            day: '2-digit',
        };
    } else {
        options = {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        };
    }

    return new Intl.DateTimeFormat('zh-CN', options).format(date);
}
