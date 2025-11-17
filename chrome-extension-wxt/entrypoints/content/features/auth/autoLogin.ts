/**
 * 自动登录模块
 */

import { SELECTORS } from '../../config/selectors';
import { TIMEOUTS, LOGIN_PATH } from '../../config/constants';

/**
 * 自动登录
 * 根据页面表单结构自动填充用户名和密码,并点击登录按钮
 */
export async function autoLogin(username: string, password: string): Promise<void> {
  try {
    console.log('[Auto Login] 开始自动登录...');
    console.log('[Auto Login] 当前 URL:', window.location.href);
    
    // 等待页面加载完成
    await waitForPageLoad();

    console.log('[Auto Login] 页面已加载,查找表单元素...');

    // 查找并填充用户名
    const usernameInput = await findInput(SELECTORS.username, '用户名');
    await fillInput(usernameInput, username, '用户名');

    // 查找并填充密码
    const passwordInput = await findInput(SELECTORS.password, '密码');
    await fillInput(passwordInput, password, '密码');

    // 等待输入事件被处理
    await new Promise(resolve => setTimeout(resolve, TIMEOUTS.inputDelay));

    // 查找并点击登录按钮
    await clickLoginButton(usernameInput);

  } catch (error) {
    console.error('[Auto Login] 自动登录失败:', error);
    throw error;
  }
}

/**
 * 等待页面加载完成
 */
async function waitForPageLoad(): Promise<void> {
  if (document.readyState !== 'complete') {
    console.log('[Auto Login] 等待页面加载...');
    await new Promise(resolve => {
      if (document.readyState === 'complete') {
        resolve(null);
      } else {
        window.addEventListener('load', () => resolve(null), { once: true });
        setTimeout(() => resolve(null), TIMEOUTS.pageLoad);
      }
    });
  }
}

/**
 * 查找输入框
 */
async function findInput(selectors: string[], fieldName: string): Promise<HTMLInputElement> {
  for (const selector of selectors) {
    const input = document.querySelector<HTMLInputElement>(selector);
    if (input) {
      console.log(`[Auto Login] 找到${fieldName}输入框:`, selector);
      return input;
    }
  }
  
  console.error(`[Auto Login] 未找到${fieldName}输入框,尝试的选择器:`, selectors);
  throw new Error(`未找到${fieldName}输入框`);
}

/**
 * 填充输入框
 */
async function fillInput(input: HTMLInputElement, value: string, fieldName: string): Promise<void> {
  input.focus();
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
  console.log(`[Auto Login] ${fieldName}已填充`);
}

/**
 * 查找并点击登录按钮
 */
async function clickLoginButton(usernameInput: HTMLInputElement): Promise<void> {
  // 尝试使用配置的选择器查找
  let loginButton: HTMLElement | null = null;
  
  for (const selector of SELECTORS.loginButton) {
    try {
      loginButton = document.querySelector<HTMLElement>(selector);
      if (loginButton) {
        console.log('[Auto Login] 找到登录按钮:', selector);
        break;
      }
    } catch (e) {
      continue;
    }
  }

  // 如果没找到,尝试通过文本查找
  if (!loginButton) {
    const allButtons = Array.from(document.querySelectorAll<HTMLElement>('button, input[type="submit"]'));
    console.log('[Auto Login] 页面上的所有按钮数量:', allButtons.length);
    loginButton = allButtons.find(btn => 
      btn.textContent?.includes('登录') || 
      btn.textContent?.includes('Login') ||
      btn.getAttribute('value')?.includes('登录')
    ) || null;
    
    if (loginButton) {
      console.log('[Auto Login] 通过文本找到登录按钮');
    }
  }

  if (loginButton) {
    console.log('[Auto Login] 点击登录按钮...');
    loginButton.click();
    console.log('[Auto Login] 登录按钮已点击,等待页面响应');
  } else {
    // 尝试提交表单
    await submitForm(usernameInput);
  }
}

/**
 * 提交表单
 */
async function submitForm(input: HTMLInputElement): Promise<void> {
  const form = input.closest('form');
  if (form) {
    console.log('[Auto Login] 未找到登录按钮,提交表单...');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    
    setTimeout(() => {
      if (form.checkValidity()) {
        console.log('[Auto Login] 调用 form.submit()');
        form.submit();
      }
    }, 100);
    console.log('[Auto Login] 表单已提交');
  } else {
    console.warn('[Auto Login] 未找到登录按钮或表单,但已填充账号密码');
  }
}
