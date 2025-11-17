/**
 * 账号替换状态管理(Storage)
 */

import { STORAGE_KEYS, TIMEOUTS } from '../../config/constants';

export interface AccountSwitchState {
  inProgress: boolean;
  username: string;
  password: string;
  originalPath: string;
  timestamp: number;
}

/**
 * 保存账号替换状态
 */
export async function saveAccountSwitchState(
  username: string,
  password: string,
  originalPath: string
): Promise<void> {
  const state: AccountSwitchState = {
    inProgress: true,
    username,
    password,
    originalPath,
    timestamp: Date.now()
  };
  
  await chrome.storage.local.set({ [STORAGE_KEYS.accountSwitchState]: state });
  console.log('[Account Switch] 已保存替换状态到 Storage');
}

/**
 * 获取账号替换状态
 */
export async function getAccountSwitchState(): Promise<AccountSwitchState | null> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.accountSwitchState);
  const state = result[STORAGE_KEYS.accountSwitchState];
  
  if (!state || !state.inProgress) {
    return null;
  }
  
  // 检查是否过期
  const isExpired = Date.now() - state.timestamp > TIMEOUTS.stateExpiry;
  if (isExpired) {
    console.log('[Account Switch] 恢复状态已过期,清除');
    await clearAccountSwitchState();
    return null;
  }
  
  return state;
}

/**
 * 清除账号替换状态
 */
export async function clearAccountSwitchState(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.accountSwitchState);
  console.log('[Account Switch] 已清除替换状态');
}
