import * as assert from 'assert';
import { hasH1 } from '../commands/createIssueFromClipboard';

suite('hasH1 helper', () => {
    test('returns true when first non-empty line starts with # ', () => {
        const t1 = "# Title\nSome content";
        assert.strictEqual(hasH1(t1), true);

        const t2 = "   \n   # Another\nrest";
        assert.strictEqual(hasH1(t2), true);
    });

    test('returns false for no H1', () => {
        const t1 = "No title here\n# not first";
        assert.strictEqual(hasH1(t1), false);

        const t2 = "   \n   \n";
        assert.strictEqual(hasH1(t2), false);
    });
});
