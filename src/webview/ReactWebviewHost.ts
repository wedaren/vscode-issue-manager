import * as vscode from 'vscode';

/**
 * 通用的 React Webview HTML 生成工具。
 * 通过传入 bundle 路径和可选的初始状态，生成标准的 Webview HTML 页面。
 */

export interface ReactWebviewHtmlOptions {
  webview: vscode.Webview;
  extensionUri: vscode.Uri;
  /**
   * 相对于 extension 根目录的 bundle 路径，例如：
   * "dist/webview/mindmapWebview.js"
   */
  bundlePath: string;
  title?: string;
  /**
   * 通过 window.__INITIAL_STATE__ 注入到前端的初始数据（可选）
   */
  initialState?: unknown;
}

export function getReactWebviewHtml(options: ReactWebviewHtmlOptions): string {
  const { webview, extensionUri, bundlePath, title, initialState } = options;

  const nonce = getNonce();

  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, ...bundlePath.split('/')),
  );

  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `img-src ${webview.cspSource} data:`,
    // 允许来自本 webview 源的脚本，以及带 nonce 的内联脚本
    `script-src 'nonce-${nonce}' ${webview.cspSource}`,
  ].join('; ');

  const initialStateScript =
    initialState !== undefined
      ? `<script nonce="${nonce}">
  window.__INITIAL_STATE__ = ${serializeForScript(initialState)};
</script>`
      : '';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>${title ?? 'Webview'}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    html, body, #root {
      width: 100%;
      height: 100%;
      overflow: hidden;
    }
    body {
      background-color: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      font-family: var(--vscode-font-family);
    }
  </style>
</head>
<body>
  <div id="root"></div>
  ${initialStateScript}
  <script src="${scriptUri}" nonce="${nonce}"></script>
</body>
</html>`;
}

function getNonce(): string {
  let text = '';
  const possible =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

/**
 * 将任意对象安全地序列化为可直接嵌入 <script> 的字面量。
 */
function serializeForScript(value: unknown): string {
  const json = JSON.stringify(value ?? null);
  // 简单防御：避免出现 </script> 之类的终止标签
  return json.replace(/</g, '\\u003c');
}


