import * as vscode from 'vscode';

/**
 * 单个耗时指标的统计数据
 */
export interface TimingStat {
  count: number;      // 采样次数
  totalMs: number;    // 累计耗时
  maxMs: number;      // 最大单次耗时
  lastMs: number;     // 最近一次耗时
  recent: number[];   // 最近 100 个样本（环形）
}

/**
 * 性能指标快照
 */
export interface PerfSnapshot {
  timestamp: number;
  counters: Record<string, number>;
  timings: Record<string, Omit<TimingStat, 'recent'> & { avgMs: number }>;
  memoryMB: { rss: number; heapUsed: number };
}

/** recent 样本的最大保留数量（超出后丢弃最旧样本，形成环形语义） */
const RECENT_SAMPLE_LIMIT = 100;
/** onDidUpdate 事件的节流间隔（毫秒），避免高频埋点导致 UI 频繁刷新 */
const UPDATE_THROTTLE_MS = 1000;

/**
 * 性能指标采集器（单例）。
 *
 * 所有埋点均为纯内存操作（Map 读写 + 数组追加），不做任何 I/O，
 * 保证埋点本身接近零开销，可安全用于 getTreeItem 等热路径。
 *
 * 指标命名约定：`组.名称`，例如：
 * - 计数器：cache.para.hit、cache.para.diskRead、io.stat.issueMarkdown、watcher.markdownEvent
 * - 耗时：view.overview.getTreeItem、activation.total
 */
export class PerfMetrics {
  private counters = new Map<string, number>();
  private timings = new Map<string, TimingStat>();

  private readonly onDidUpdateEmitter = new vscode.EventEmitter<void>();
  /** 数据变更事件（1 秒节流），用于面板等 UI 的自动刷新 */
  public readonly onDidUpdate: vscode.Event<void> = this.onDidUpdateEmitter.event;
  private updateTimer: ReturnType<typeof setTimeout> | undefined;
  private lastUpdateFiredAt = 0;

  /** 计数器累加 */
  public increment(name: string, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
    this.scheduleUpdate();
  }

  /** 记录一次耗时采样 */
  public recordTiming(name: string, ms: number): void {
    let stat = this.timings.get(name);
    if (!stat) {
      stat = { count: 0, totalMs: 0, maxMs: 0, lastMs: 0, recent: [] };
      this.timings.set(name, stat);
    }
    stat.count += 1;
    stat.totalMs += ms;
    stat.maxMs = Math.max(stat.maxMs, ms);
    stat.lastMs = ms;
    stat.recent.push(ms);
    if (stat.recent.length > RECENT_SAMPLE_LIMIT) {
      stat.recent.shift();
    }
    this.scheduleUpdate();
  }

  /** 异步耗时测量辅助：执行 fn 并把耗时记录到指定指标 */
  public async timeAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const start = Date.now();
    try {
      return await fn();
    } finally {
      this.recordTiming(name, Date.now() - start);
    }
  }

  /** 当前指标快照（含内存占用） */
  public snapshot(): PerfSnapshot {
    const mem = process.memoryUsage();
    const counters: Record<string, number> = {};
    for (const [name, value] of this.counters) {
      counters[name] = value;
    }
    const timings: PerfSnapshot['timings'] = {};
    for (const [name, stat] of this.timings) {
      timings[name] = {
        count: stat.count,
        totalMs: stat.totalMs,
        maxMs: stat.maxMs,
        lastMs: stat.lastMs,
        avgMs: stat.count > 0 ? Math.round((stat.totalMs / stat.count) * 100) / 100 : 0,
      };
    }
    return {
      timestamp: Date.now(),
      counters,
      timings,
      memoryMB: {
        rss: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
        heapUsed: Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10,
      },
    };
  }

  /** 清空所有计数器与耗时统计 */
  public reset(): void {
    this.counters.clear();
    this.timings.clear();
    this.scheduleUpdate();
  }

  /**
   * 把当前快照格式化为 Markdown 报告。
   * 按指标名前缀分组（如 cache./io./view./watcher./activation.），
   * 每组内分别输出计数器表与耗时表。
   */
  public generateMarkdownReport(): string {
    const snap = this.snapshot();
    const lines: string[] = [];
    lines.push('# Issue Manager 性能指标报告');
    lines.push('');
    lines.push(`- 时间：${new Date(snap.timestamp).toLocaleString()}`);
    lines.push(`- 内存：RSS ${snap.memoryMB.rss} MB / HeapUsed ${snap.memoryMB.heapUsed} MB`);
    lines.push('');

    // 按 `组.名称` 的组前缀归类
    const counterGroups = this.groupByPrefix(Object.keys(snap.counters));
    const timingGroups = this.groupByPrefix(Object.keys(snap.timings));
    const allGroups = [...new Set([...counterGroups.keys(), ...timingGroups.keys()])].sort();

    for (const group of allGroups) {
      lines.push(`## ${group}`);
      lines.push('');

      const counterNames = (counterGroups.get(group) ?? []).sort();
      if (counterNames.length > 0) {
        lines.push('### 计数器');
        lines.push('');
        lines.push('| 指标 | 次数 |');
        lines.push('| --- | ---: |');
        for (const name of counterNames) {
          lines.push(`| ${name} | ${snap.counters[name]} |`);
        }
        lines.push('');
      }

      const timingNames = (timingGroups.get(group) ?? []).sort();
      if (timingNames.length > 0) {
        lines.push('### 耗时');
        lines.push('');
        lines.push('| 指标 | 次数 | 平均(ms) | 最大(ms) | 最近(ms) |');
        lines.push('| --- | ---: | ---: | ---: | ---: |');
        for (const name of timingNames) {
          const t = snap.timings[name];
          lines.push(`| ${name} | ${t.count} | ${t.avgMs} | ${t.maxMs} | ${t.lastMs} |`);
        }
        lines.push('');
      }
    }
    return lines.join('\n');
  }

  /** 按指标名的组前缀（第一个 `.` 之前的部分）归类 */
  private groupByPrefix(names: string[]): Map<string, string[]> {
    const groups = new Map<string, string[]>();
    for (const name of names) {
      const prefix = name.includes('.') ? name.split('.')[0] : name;
      const arr = groups.get(prefix) ?? [];
      arr.push(name);
      groups.set(prefix, arr);
    }
    return groups;
  }

  /** 节流触发 onDidUpdate：最多每秒一次（尾部触发，保证最后一次变更也会通知） */
  private scheduleUpdate(): void {
    if (this.updateTimer) {
      return;
    }
    const elapsed = Date.now() - this.lastUpdateFiredAt;
    const delay = Math.max(0, UPDATE_THROTTLE_MS - elapsed);
    this.updateTimer = setTimeout(() => {
      this.updateTimer = undefined;
      this.lastUpdateFiredAt = Date.now();
      this.onDidUpdateEmitter.fire();
    }, delay);
  }
}

/** 全局单例 */
export const perfMetrics = new PerfMetrics();
