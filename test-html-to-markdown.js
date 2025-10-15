/**
 * 测试 HTML 到 Markdown 转换功能
 */

// 注意：这个文件用于测试，实际使用时需要编译 TypeScript
// 运行方式：先编译项目，然后在 Node.js 环境中运行

const testCases = [
    {
        name: '基本段落和标题',
        html: `
            <article>
                <h1>深入理解 TypeScript</h1>
                <p>TypeScript 是一种由 <strong>Microsoft</strong> 开发的编程语言。</p>
                <p>它是 JavaScript 的超集，添加了静态类型检查。</p>
            </article>
        `,
        expected: `
# 深入理解 TypeScript

TypeScript 是一种由 **Microsoft** 开发的编程语言。

它是 JavaScript 的超集，添加了静态类型检查。
        `
    },
    {
        name: '列表',
        html: `
            <div>
                <h2>TypeScript 的优势</h2>
                <ul>
                    <li>静态类型检查</li>
                    <li>现代 ES 特性支持</li>
                    <li>更好的 IDE 支持</li>
                </ul>
            </div>
        `,
        expected: `
## TypeScript 的优势

- 静态类型检查
- 现代 ES 特性支持
- 更好的 IDE 支持
        `
    },
    {
        name: '链接和图片',
        html: `
            <div>
                <p>访问 <a href="https://www.typescriptlang.org/">官方网站</a> 了解更多。</p>
                <img src="https://example.com/logo.png" alt="TypeScript Logo" />
            </div>
        `,
        expected: `
访问 [官方网站](https://www.typescriptlang.org/) 了解更多。

![TypeScript Logo](https://example.com/logo.png)
        `
    },
    {
        name: '代码块',
        html: `
            <div>
                <p>示例代码：</p>
                <pre><code class="language-typescript">
interface User {
    name: string;
    age: number;
}
                </code></pre>
            </div>
        `,
        expected: `
示例代码：

\`\`\`typescript
interface User {
    name: string;
    age: number;
}
\`\`\`
        `
    },
    {
        name: '引用',
        html: `
            <div>
                <blockquote>
                    <p>TypeScript 让大型项目的开发变得更加可靠。</p>
                </blockquote>
            </div>
        `,
        expected: `
> TypeScript 让大型项目的开发变得更加可靠。
        `
    },
    {
        name: '表格',
        html: `
            <table>
                <thead>
                    <tr>
                        <th>特性</th>
                        <th>JavaScript</th>
                        <th>TypeScript</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>类型检查</td>
                        <td>运行时</td>
                        <td>编译时</td>
                    </tr>
                    <tr>
                        <td>工具支持</td>
                        <td>一般</td>
                        <td>优秀</td>
                    </tr>
                </tbody>
            </table>
        `,
        expected: `
| 特性 | JavaScript | TypeScript |
| --- | --- | --- |
| 类型检查 | 运行时 | 编译时 |
| 工具支持 | 一般 | 优秀 |
        `
    },
    {
        name: '复杂嵌套',
        html: `
            <article>
                <h1>前端框架对比</h1>
                <p>这是一篇关于 <strong>前端框架</strong> 的文章。</p>
                
                <h2>React</h2>
                <p>由 <em>Facebook</em> 开发的 <code>UI</code> 库。</p>
                <ul>
                    <li>虚拟 DOM</li>
                    <li>组件化</li>
                </ul>
                
                <h2>Vue</h2>
                <p>渐进式框架，易于上手。</p>
                <ol>
                    <li>响应式数据</li>
                    <li>模板语法</li>
                </ol>
            </article>
        `,
        expected: `
# 前端框架对比

这是一篇关于 **前端框架** 的文章。

## React

由 *Facebook* 开发的 \`UI\` 库。

- 虚拟 DOM
- 组件化

## Vue

渐进式框架，易于上手。

1. 响应式数据
2. 模板语法
        `
    }
];

console.log('=== HTML 到 Markdown 转换测试用例 ===\n');
console.log('这些测试用例展示了转换器应该支持的各种 HTML 元素。\n');
console.log('要运行实际测试，请：');
console.log('1. 编译 TypeScript 代码: npm run compile');
console.log('2. 在 VSCode 扩展宿主环境中测试命令\n');

testCases.forEach((testCase, index) => {
    console.log(`${index + 1}. ${testCase.name}`);
    console.log('输入 HTML:');
    console.log(testCase.html.trim());
    console.log('\n预期 Markdown:');
    console.log(testCase.expected.trim());
    console.log('\n' + '='.repeat(80) + '\n');
});

module.exports = { testCases };
