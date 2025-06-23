# 欢迎来到您的 VS Code 扩展

## 文件夹里有什么

*   此文件夹包含您的扩展所需的所有文件。
*   `package.json` - 这是您在其中声明扩展和命令的清单文件。
    *   示例插件注册一个命令并定义其标题和命令名称。有了这些信息，VS Code 就可以在命令面板中显示该命令。它还不需要加载插件。
*   `src/extension.ts` - 这是您将提供命令实现的主文件。
    *   该文件导出一个函数 `activate`，该函数在您的扩展首次激活时（在本例中是通过执行命令）被调用。在 `activate` 函数内部，我们调用 `registerCommand`。
    *   我们将包含命令实现的函数作为第二个参数传递给 `registerCommand`。

## 设置

*   安装推荐的扩展 (amodio.tsl-problem-matcher, ms-vscode.extension-test-runner, and dbaeumer.vscode-eslint)

## 立即上手并运行

*   按 `F5` 打开一个加载了您的扩展的新窗口。
*   通过按 (`Ctrl+Shift+P` 或在 Mac 上按 `Cmd+Shift+P`) 并输入 `Hello World` 从命令面板运行您的命令。
*   在 `src/extension.ts` 内的代码中设置断点以调试您的扩展。
*   在调试控制台中查找扩展的输出。

## 进行更改

*   在 `src/extension.ts` 中更改代码后，您可以从调试工具栏重新启动扩展。
*   您也可以重新加载 (`Ctrl+R` 或在 Mac 上按 `Cmd+R`) 带有您的扩展的 VS Code 窗口以加载您的更改。

## 探索 API

*   当您打开文件 `node_modules/@types/vscode/index.d.ts` 时，您可以打开我们的完整 API 集。

## 运行测试

*   安装 [Extension Test Runner](https://marketplace.visualstudio.com/items?itemName=ms-vscode.extension-test-runner)
*   通过 **任务: 运行任务** 命令运行 "watch" 任务。请确保此任务正在运行，否则可能无法发现测试。
*   从活动栏打开测试视图，然后单击“运行测试”按钮，或使用热键 `Ctrl/Cmd + ; A`
*   在“测试结果”视图中查看测试结果的输出。
*   对 `src/test/extension.test.ts` 进行更改或在 `test` 文件夹内创建新的测试文件。
    *   提供的测试运行器将仅考虑与名称模式 `**.test.ts` 匹配的文件。
    *   您可以在 `test` 文件夹内创建文件夹以按您想要的任何方式组织测试。

## 更进一步

*   通过[捆绑您的扩展](https://code.visualstudio.com/api/working-with-extensions/bundling-extension)来减小扩展大小并缩短启动时间。
*   在 VS Code 扩展市场上[发布您的扩展](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)。
*   通过设置[持续集成](https://code.visualstudio.com/api/working-with-extensions/continuous-integration)来自动化构建。
