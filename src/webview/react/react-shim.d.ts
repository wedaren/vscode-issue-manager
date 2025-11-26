// 最小 React/JSX 类型与模块声明，仅用于通过类型检查。
// 安装 @types/react 和 @types/react-dom 后，这些声明会与真实类型合并。

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ReactDefault: any;
  export = ReactDefault;
}

declare module 'react-dom/client' {
  export function createRoot(container: Element | DocumentFragment): any;
}

declare module 'react/jsx-runtime' {
  export const jsx: any;
  export const jsxs: any;
  export const Fragment: any;
}

declare namespace JSX {
  interface IntrinsicElements {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [elemName: string]: any;
  }
}


