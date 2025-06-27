/**
 * 防抖函数：在指定延迟时间内，如果函数被多次调用，则只执行最后一次调用。
 * @param func 要防抖的函数。
 * @param delay 延迟时间（毫秒）。
 * @returns 防抖后的函数。
 */
export function debounce<T extends (...args: any[]) => any>(func: T, delay: number): (...args: Parameters<T>) => void {
    let timeout: NodeJS.Timeout | undefined;

    return function (this: ThisParameterType<T>, ...args: Parameters<T>) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), delay);
    };
}
