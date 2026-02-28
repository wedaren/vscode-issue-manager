import * as assert from 'assert';
import { ResponseParser } from '../llm/ResponseParser';

suite('ResponseParser Test Suite', () => {

    test('extractFirstBalancedJson should extract valid JSON object', () => {
        const input = `Here is the json you requested:
        {
            "name": "test",
            "value": 123
        }
        Hope this helps!`;
        const result = ResponseParser.extractFirstBalancedJson(input);
        assert.ok(result);
        if (result) {
            const parsed = JSON.parse(result);
            assert.strictEqual(parsed.name, 'test');
            assert.strictEqual(parsed.value, 123);
        }
    });

    test('extractFirstBalancedJson should extract valid JSON array', () => {
        const input = `Array: [1, 2, 3] end`;
        const result = ResponseParser.extractFirstBalancedJson(input);
        assert.strictEqual(result, '[1, 2, 3]');
    });

    test('extractFirstBalancedJson should ignore incomplete JSON or unparseable JSON', () => {
        const input = `This is not valid JSON { "key": "value" `;
        const result = ResponseParser.extractFirstBalancedJson(input);
        assert.strictEqual(result, null);
    });

    test('extractJson should extract from markdown block', () => {
        const input = `\`\`\`json
{"test": 1}
\`\`\``;
        const result = ResponseParser.extractJson(input);
        assert.strictEqual(result, '{"test": 1}');
    });

    test('parseJson should parse valid json and return object', () => {
        const input = `\`\`\`json\n{"test": 1}\n\`\`\``;
        const result = ResponseParser.parseJson<{ test: number }>(input, 'test');
        assert.deepStrictEqual(result, { test: 1 });
    });

    test('parseJson should return null for invalid json', () => {
        const input = `invalid`;
        const result = ResponseParser.parseJson<{ test: number }>(input, 'test');
        assert.strictEqual(result, null);
    });
});
