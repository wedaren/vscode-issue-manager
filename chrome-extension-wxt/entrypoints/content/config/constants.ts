/**
 * 常量配置
 */

export const TIMEOUTS = {
  /** 页面加载超时(毫秒) */
  pageLoad: 5000,
  /** 账号替换状态过期时间(毫秒) */
  stateExpiry: 5 * 60 * 1000,
  /** 等待登录跳转超时(毫秒) */
  redirectWait: 10000,
  /** 输入事件处理等待(毫秒) */
  inputDelay: 500,
  /** Toast 显示时长(毫秒) */
  toastDuration: 3000,
  /** 恢复账号替换延迟(毫秒) */
  resumeDelay: 500,
  /** 路径检查间隔(毫秒) */
  pathCheckInterval: 500,
};

export const UI_CLASSES = [
  'issue-manager-overlay',
  'issue-manager-highlight',
  'issue-manager-toast',
  'issue-manager-control'
];

export const MOUSE_SWITCH_THRESHOLD = 8;

export const STORAGE_KEYS = {
  accountSwitchState: 'accountSwitchState',
};

export const LOGIN_PATH = '/auth/login/';
export const LOGOUT_PATH = '/auth/logout/';
