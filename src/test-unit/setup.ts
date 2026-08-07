/**
 * Mocha 引导文件（--require out/test-unit/setup.js）。
 * patch CommonJS 的 Module._load，把对 'vscode' 模块的 require 重定向到
 * ./mocks/vscode（编译产物 out/test-unit/mocks/vscode.js），
 * 使依赖 vscode API 的纯逻辑模块可以在无扩展宿主的环境下被测试。
 *
 * 注意：必须用 require 直接拿到 'module' 的真实 exports。
 * `import * as Module from 'module'` 经 tslib __importStar 包装后得到的是
 * getter-only 的绑定对象，无法覆盖 _load。
 */
// eslint-disable 无需开启：本仓库 eslint 规则集未启用 no-var-requires
const Module = require('module') as typeof import('module');
const vscodeMock = require('./mocks/vscode');

type LoadFn = (request: string, parent: unknown, isMain: boolean) => unknown;

const internalModule = Module as unknown as { _load: LoadFn };
const originalLoad = internalModule._load;

internalModule._load = function (this: unknown, request: string, parent: unknown, isMain: boolean): unknown {
    if (request === 'vscode') {
        return vscodeMock;
    }
    return originalLoad.call(this, request, parent, isMain);
};
