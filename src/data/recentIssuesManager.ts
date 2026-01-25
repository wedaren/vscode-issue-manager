import * as vscode from 'vscode';
import * as path from 'path';
import { getAllIssueMarkdowns } from './IssueMarkdowns';
import { getIssueNodesByUri } from './issueTreeManager';

/**
 * 最近问题统计信息
 */
export interface RecentIssueStats {
  /** 文件名 */
  file: string;
  /** 文件完整路径 */
  filePath: string;
  /** 最后修改时间 */
  mtime: Date;
  /** 创建时间 */
  ctime: Date;
  /** 最后查看时间 */
  vtime?: Date;
  /** 是否为孤立问题（未在问题树中建立关系） */
  isIsolated: boolean;
  /** 文件 URI */
  uri: vscode.Uri;
}

/**
 * 子分组策略
 */
export type SubgroupStrategy = 'day' | 'week' | null;

/**
 * 问题分组定义
 */
export interface IssueGroup {
  /** 分组标签 */
  label: string;
  /** 分组中的文件列表 */
  files: RecentIssueStats[];
  /** 子分组策略：'day' 按天分组，'week' 按周分组，null 直接展示文件 */
  subgroupStrategy: SubgroupStrategy;
}

/**
 * 排序方式
 */
export type SortOrder = 'mtime' | 'ctime' | 'vtime';

// ========== 常量定义 ========== //

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_IN_WEEK = 7;

/** 默认展开的分组标签 */
export const DEFAULT_EXPANDED_GROUPS = ['今天', '昨天', '最近一周'];

// ========== 数据获取函数 ========== //

/**
 * 获取所有最近问题的统计信息
 * @param sortBy 排序方式：'mtime' (修改时间) 或 'ctime' (创建时间)
 * @returns 问题统计信息数组
 */
export async function getRecentIssuesStats(
  sortBy: SortOrder = 'ctime'
): Promise<RecentIssueStats[]> {
  const issues = await getAllIssueMarkdowns({ sortBy });
  if (!issues || issues.length === 0) {
    return [];
  }

  // 使用 getIssueNodesByUri 判断每个问题是否孤立
  const stats = await Promise.all(
    issues.map(async (issue) => {
      const filePath = issue.uri.fsPath;
      // 通过检查文件是否在问题树中存在节点来判断是否孤立
      const nodes = await getIssueNodesByUri(issue.uri);
      const isIsolated = nodes.length === 0;

      return {
        file: path.basename(filePath),
        filePath,
        mtime: new Date(issue.mtime),
        ctime: new Date(issue.ctime),
        vtime: issue.vtime ? new Date(issue.vtime) : undefined,
        isIsolated,
        uri: issue.uri,
      };
    })
  );

  return stats;
}

// ========== 分组策略函数 ========== //

/**
 * 将问题列表按时间分组（顶层分组）
 * @param files 问题统计列表
 * @param sortBy 用于分组的时间字段
 * @returns 分组定义数组
 */
export function groupIssuesByTime(
  files: RecentIssueStats[],
  sortBy: SortOrder
): IssueGroup[] {
  const now = new Date();
  const today = normalizeDate(now);
  const yesterday = new Date(today.getTime() - MS_PER_DAY);
  const oneWeekAgo = new Date(today.getTime() - (DAYS_IN_WEEK - 1) * MS_PER_DAY);
  const oneMonthAgo = new Date(
    today.getFullYear(),
    today.getMonth() - 1,
    today.getDate()
  );

  // 声明式定义分组规则
  const groupDefinitions: Array<{
    label: string;
    subgroupStrategy: SubgroupStrategy;
    test: (date: Date) => boolean;
    files: RecentIssueStats[];
  }> = [
    {
      label: '今天',
      subgroupStrategy: null, // 直接展示文件
      test: (date: Date) => normalizeDate(date).getTime() === today.getTime(),
      files: [],
    },
    {
      label: '昨天',
      subgroupStrategy: null, // 直接展示文件
      test: (date: Date) => normalizeDate(date).getTime() === yesterday.getTime(),
      files: [],
    },
    {
      label: '最近一周',
      subgroupStrategy: 'day', // 按天分组
      test: (date: Date) => normalizeDate(date) >= oneWeekAgo && normalizeDate(date) < yesterday,
      files: [],
    },
    {
      label: '最近一月',
      subgroupStrategy: 'week', // 按周分组
      test: (date: Date) => normalizeDate(date) >= oneMonthAgo && normalizeDate(date) < oneWeekAgo,
      files: [],
    },
    {
      label: '更早',
      subgroupStrategy: 'week', // 按周分组
      test: () => true,
      files: [],
    },
  ];

  // 将文件分配到对应的分组
  for (const file of files) {
    let fileDate: Date;
    if (sortBy === 'vtime') {
      fileDate = file.vtime ?? file.mtime;
    } else if (sortBy === 'mtime') {
      fileDate = file.mtime;
    } else {
      fileDate = file.ctime;
    }
    
    for (const group of groupDefinitions) {
      if (group.test(fileDate)) {
        group.files.push(file);
        break; // 文件只属于第一个匹配的分组
      }
    }
  }

  // 过滤掉空分组
  return groupDefinitions
    .filter((g) => g.files.length > 0)
    .map((g) => ({
      label: g.label,
      files: g.files,
      subgroupStrategy: g.subgroupStrategy,
    }));
}

/**
 * 按日分组（二级或三级分组）
 * @param files 问题统计列表
 * @param sortBy 用于分组的时间字段
 * @returns 分组定义数组
 */
export function groupByDay(
  files: RecentIssueStats[],
  sortBy: SortOrder
): IssueGroup[] {
  const filesByDay = new Map<string, RecentIssueStats[]>();

  for (const file of files) {
    let fileDate: Date;
    if (sortBy === 'vtime') {
      fileDate = file.vtime ?? file.mtime;
    } else if (sortBy === 'mtime') {
      fileDate = file.mtime;
    } else {
      fileDate = file.ctime;
    }
    const dayKey = formatDateWithWeekday(fileDate);

    if (!filesByDay.has(dayKey)) {
      filesByDay.set(dayKey, []);
    }
    filesByDay.get(dayKey)!.push(file);
  }

  return Array.from(filesByDay.entries()).map(([dayLabel, dayFiles]) => ({
    label: dayLabel,
    files: dayFiles,
    subgroupStrategy: null, // 日分组直接展示文件
  }));
}

/**
 * 按周分组（二级分组）
 * @param files 问题统计列表
 * @param sortBy 用于分组的时间字段
 * @returns 分组定义数组
 */
export function groupByWeek(
  files: RecentIssueStats[],
  sortBy: SortOrder
): IssueGroup[] {
  const startOfWeek = getStartOfWeek(new Date());
  const startOfLastWeek = new Date(startOfWeek.getTime() - DAYS_IN_WEEK * MS_PER_DAY);

  const weekGroups: Array<{
    label: string;
    test: (date: Date) => boolean;
    files: RecentIssueStats[];
  }> = [
    {
      label: '本周',
      test: (date) => normalizeDate(date) >= startOfWeek,
      files: [],
    },
    {
      label: '上周',
      test: (date) =>
        normalizeDate(date) >= startOfLastWeek &&
        normalizeDate(date) < startOfWeek,
      files: [],
    },
  ];

  const otherWeeks = new Map<string, RecentIssueStats[]>();

  for (const file of files) {
    let fileDate: Date;
    if (sortBy === 'vtime') {
      fileDate = file.vtime ?? file.mtime;
    } else if (sortBy === 'mtime') {
      fileDate = file.mtime;
    } else {
      fileDate = file.ctime;
    }

    let matched = false;
    for (const group of weekGroups) {
      if (group.test(fileDate)) {
        group.files.push(file);
        matched = true;
        break;
      }
    }

    if (!matched) {
      const weekNumber = getWeekNumber(fileDate);
      const [start, end] = getWeekDateRange(fileDate.getFullYear(), weekNumber);
      const weekLabel = `第 ${weekNumber} 周 (${start} - ${end})`;

      if (!otherWeeks.has(weekLabel)) {
        otherWeeks.set(weekLabel, []);
      }
      otherWeeks.get(weekLabel)!.push(file);
    }
  }

  return [
    ...weekGroups
      .filter((g) => g.files.length > 0)
      .map((g) => ({
        label: g.label,
        files: g.files,
        subgroupStrategy: 'day' as SubgroupStrategy, // 周分组需要再按天分组
      })),
    ...Array.from(otherWeeks.entries()).map(([label, weekFiles]) => ({
      label,
      files: weekFiles,
      subgroupStrategy: 'day' as SubgroupStrategy, // 周分组需要再按天分组
    })),
  ];
}

// ========== 日期工具函数 ========== //

/**
 * 将日期标准化为当天的零点
 * @param date 要标准化的日期
 * @returns 标准化后的新日期对象
 */
export function normalizeDate(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * 获取给定日期所在周的开始日期（周一）
 * @param date 指定日期
 * @returns 周一的零点日期
 */
export function getStartOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // 将周日(0)视为一周的最后一天
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * 格式化日期（包含月份、日期和星期）
 * @param date 要格式化的日期
 * @returns 格式化后的字符串，如 "1月25日 星期六"
 */
export function formatDateWithWeekday(date: Date): string {
  const options: Intl.DateTimeFormatOptions = {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  };
  return new Intl.DateTimeFormat('zh-CN', options).format(date);
}

/**
 * 获取给定日期的 ISO 周数
 * @param d 指定日期
 * @returns 周数（1-53）
 */
export function getWeekNumber(d: Date): number {
  d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
  );
  return weekNo;
}

/**
 * 获取给定年份和周数的日期范围
 * @param year 年份
 * @param weekNumber 周数
 * @returns [开始日期, 结束日期] 的元组，格式如 ["1月1日", "1月7日"]
 */
export function getWeekDateRange(
  year: number,
  weekNumber: number
): [string, string] {
  const d = new Date(year, 0, 1 + (weekNumber - 1) * 7);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const start = new Date(d.setDate(diff));
  const end = new Date(start);
  end.setDate(start.getDate() + 6);

  const format = (dt: Date) => `${dt.getMonth() + 1}月${dt.getDate()}日`;
  return [format(start), format(end)];
}
