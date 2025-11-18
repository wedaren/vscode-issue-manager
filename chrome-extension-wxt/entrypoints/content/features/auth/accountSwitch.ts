/**
 * 账号替换功能模块
 * 负责协调 logout -> 保存状态 -> reload -> auto-login 流程
 */

import { autoLogin } from './autoLogin';
import { saveAccountSwitchState, clearAccountSwitchState, type AccountSwitchState } from './storage';
import { LOGIN_PATH, LOGOUT_PATH, TIMEOUTS } from '../../config/constants';

/**
 * 账号替换
 * 1. 如果不在登录页,先记住路径并退出登录
 * 2. 保存状态到 Storage
 * 3. 页面重新加载后,resumeAccountSwitch 会自动执行
 */
export async function switchAccount(username: string, password: string): Promise<void> {
  try {
    console.log('[Account Switch] 开始账号替换...');
    
    const currentUrl = window.location.href;
    const currentPath = window.location.pathname;
    const isLoginPage = currentPath.includes(LOGIN_PATH);
    
    if (!isLoginPage) {
      console.log('[Account Switch] 记住原始路径:', currentPath);
      
      // 保存状态
      await saveAccountSwitchState(username, password, currentPath);
      
      // 发送退出登录请求
      await logout(currentUrl);
      
      // 页面会自动跳转并重新加载
      // resumeAccountSwitch 会在重新加载后自动执行
    } else {
      // 如果已经在登录页,直接执行登录
      console.log('[Account Switch] 已在登录页,直接执行登录');
      await autoLogin(username, password);
      console.log('[Account Switch] 账号替换完成');
    }

  } catch (error) {
    console.error('[Account Switch] 账号替换失败:', error);
    await clearAccountSwitchState();
    throw error;
  }
}

/**
 * 恢复账号替换操作
 * 在页面重新加载后执行
 */
export async function resumeAccountSwitch(state: AccountSwitchState): Promise<void> {
  try {
    console.log('[Account Switch] 恢复账号替换操作...');
    console.log('[Account Switch] 用户名:', state.username);
    console.log('[Account Switch] 原始路径:', state.originalPath);

    // 执行自动登录
    await autoLogin(state.username, state.password);
    console.log('[Account Switch] 登录操作已执行,等待页面响应...');

    // 等待登录成功后跳转
    if (state.originalPath && state.originalPath !== LOGIN_PATH) {
      await waitForLoginAndRedirect(state.originalPath);
    }

    console.log('[Account Switch] 账号替换完成');
    await clearAccountSwitchState();

  } catch (error) {
    console.error('[Account Switch] 恢复账号替换失败:', error);
    await clearAccountSwitchState();
    throw error;
  }
}

/**
 * 发送退出登录请求
 */
async function logout(referer: string): Promise<void> {
  try {
    const origin = window.location.origin;
    const logoutUrl = `${origin}${LOGOUT_PATH}`;
    
    console.log('[Account Switch] 发送退出请求到:', logoutUrl);

    const response = await fetch(logoutUrl, {
      method: 'GET',
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Referer': referer,
      },
      credentials: 'include',
    });

    console.log('[Account Switch] 退出请求响应状态:', response.status);
    console.log('[Account Switch] 页面即将重新加载,状态已保存到 Storage');

  } catch (error) {
    console.error('[Account Switch] 退出登录失败:', error);
    throw new Error('退出登录失败: ' + (error as Error).message);
  }
}

/**
 * 等待登录完成并跳转
 */
async function waitForLoginAndRedirect(originalPath: string): Promise<void> {
  console.log('[Account Switch] 等待登录完成...');
  
  const loginSuccess = await new Promise<boolean>((resolve) => {
    let redirected = false;
    
    const checkInterval = setInterval(() => {
      const currentPath = window.location.pathname;
      console.log('[Account Switch] 当前路径:', currentPath);
      
      if (!currentPath.includes(LOGIN_PATH)) {
        clearInterval(checkInterval);
        clearTimeout(timeout);
        redirected = true;
        console.log('[Account Switch] 检测到页面已跳转,登录成功');
        resolve(true);
      }
    }, TIMEOUTS.pathCheckInterval);

    const timeout = setTimeout(() => {
      clearInterval(checkInterval);
      if (!redirected) {
        console.warn('[Account Switch] 等待跳转超时,可能登录失败或页面未自动跳转');
        resolve(false);
      }
    }, TIMEOUTS.redirectWait);
  });
  
  if (!loginSuccess) {
    // 尝试手动跳转
    const urlParams = new URLSearchParams(window.location.search);
    const refererUrl = urlParams.get('RefererUrl');
    
    if (refererUrl) {
      console.log('[Account Switch] 使用 RefererUrl 跳转:', refererUrl);
      window.location.href = window.location.origin + refererUrl;
    } else if (originalPath) {
      console.log('[Account Switch] 跳转回原始路径:', originalPath);
      window.location.href = window.location.origin + originalPath;
    }
  } else {
    console.log('[Account Switch] 页面已自动跳转,无需手动操作');
  }
}
