/**
 * 具有 cancel 方法的防抖函数接口
 */
export interface DebouncedFunction<T extends (...args: any[]) => any> {
    (...args: Parameters<T>): void;
    cancel(): void;
}

/**
 * 防抖函数：在指定延迟时间内，如果函数被多次调用，则只执行最后一次调用。
 * @param func 要防抖的函数。
 * @param delay 延迟时间（毫秒）。
 * @returns 防抖后的函数，包含 cancel 方法用于取消待处理的调用。
 */
export function debounce<T extends (...args: any[]) => any>(func: T, delay: number): DebouncedFunction<T> {
    let timeout: NodeJS.Timeout | undefined;

    const debouncedFn = function (this: ThisParameterType<T>, ...args: Parameters<T>) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), delay);
    } as DebouncedFunction<T>;

    debouncedFn.cancel = function() {
        clearTimeout(timeout);
        timeout = undefined;
    };

    return debouncedFn;
}
