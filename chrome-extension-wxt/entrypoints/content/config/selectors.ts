/**
 * 表单元素选择器配置
 */

export const SELECTORS = {
  username: [
    'input[name="username"]',
    'input[yotta-test="login-username-input"]',
    'input[type="text"][placeholder*="用户名"]',
    'input[type="text"][placeholder*="账号"]',
    'input[type="text"][placeholder*="账户"]',
    'input[autocomplete="username"]',
    'input[id*="username"]',
    'input[id*="user"]',
    'input[id*="account"]',
    'input[class*="username"]',
    'input[class*="account"]',
    'input[type="email"]',
  ],
  
  password: [
    'input[name="password"]',
    'input[yotta-test="login-password-input"]',
    'input[type="password"]',
    'input[autocomplete="current-password"]',
    'input[id*="password"]',
    'input[id*="passwd"]',
    'input[class*="password"]',
  ],
  
  loginButton: [
    'button[type="submit"]',
    'button[yotta-test="login-login-button"]',
    'button.yotta-button-primary',
    'input[type="submit"]',
  ]
};
