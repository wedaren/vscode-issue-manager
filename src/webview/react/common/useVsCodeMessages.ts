import React from 'react';
import { getVsCodeApi } from './vscodeApi';

/**
 * 通用 VS Code Webview 消息通信 Hook。
 *
 * TIn  表示扩展端 -> Webview 的消息类型
 * TOut 表示 Webview -> 扩展端 的消息类型
 */
export function useVsCodeMessages<TIn = unknown, TOut = unknown>(
  onMessage: (message: TIn) => void,
) {
  const handlerRef = React.useRef(onMessage);
  handlerRef.current = onMessage;

  React.useEffect(() => {
    const listener = (event: MessageEvent) => {
      handlerRef.current(event.data as TIn);
    };

    window.addEventListener('message', listener);
    return () => {
      window.removeEventListener('message', listener);
    };
  }, []);

  const vscode = getVsCodeApi();

  function postMessage(message: TOut) {
    vscode.postMessage(message);
  }

  return {
    postMessage,
  };
}


