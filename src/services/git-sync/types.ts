/**
 * Git同步状态枚举
 * 
 * 定义Git自动同步服务的各种状态，用于状态栏显示和内部状态管理。
 */
export enum SyncStatus {
    /** 已同步，本地和远程仓库保持最新状态 */
    Synced = 'synced',
    /** 正在同步中，正在执行Git操作 */
    Syncing = 'syncing',
    /** 有本地更改待推送到远程仓库 */
    HasLocalChanges = 'local',
    /** 有远程更新待拉取到本地（暂时用不到） */
    HasRemoteChanges = 'remote',
    /** 同步失败或存在合并冲突 */
    Conflict = 'conflict',
    /** 自动同步功能已禁用 */
    Disabled = 'disabled'
}

/**
 * 同步状态信息接口
 * 
 * 包含同步状态的详细信息，用于状态栏显示和错误处理。
 */
export interface SyncStatusInfo {
    /** 当前同步状态 */
    status: SyncStatus;
    /** 状态描述消息，显示给用户 */
    message: string;
    /** 上次同步时间，用于显示时间间隔 */
    lastSync?: Date;
}
