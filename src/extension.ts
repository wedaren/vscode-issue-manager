// “vscode”模块包含 VS Code 可扩展性 API
// 导入下面的模块并在代码中使用别名 vscode 引用它
import * as vscode from 'vscode';

// 当您的扩展被激活时，将调用此方法
// 您的扩展在第一次执行命令时被激活
export function activate(context: vscode.ExtensionContext) {

	// 使用控制台输出诊断信息 (console.log) 和错误 (console.error)
	// 这行代码只会在您的扩展被激活时执行一次
	console.log('恭喜，您的扩展“issue-manager”现已激活！');

	// 该命令已在 package.json 文件中定义
	// 现在使用 registerCommand 提供该命令的实现
	// commandId 参数必须与 package.json 中的 command 字段匹配
	const disposable = vscode.commands.registerCommand('issue-manager.helloWorld', () => {
		// 您在此处放置的代码将在每次执行命令时执行
		// 向用户显示一个消息框
		vscode.window.showInformationMessage('来自 issue-manager 的 Hello World！');
	});

	context.subscriptions.push(disposable);
}

// 当您的扩展被停用时，将调用此方法
export function deactivate() {}
