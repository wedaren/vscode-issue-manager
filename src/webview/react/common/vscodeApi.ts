// Webview 环境下的 VS Code API 封装

declare function acquireVsCodeApi(): {
  postMessage: (message: unknown) => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
};

export type VsCodeApi = ReturnType<typeof acquireVsCodeApi>;

let cachedApi: VsCodeApi | undefined;

export function getVsCodeApi(): VsCodeApi {
  if (!cachedApi) {
    // 在 Webview 环境中由 VS Code 注入
    cachedApi = acquireVsCodeApi();
  }
  return cachedApi;
}

