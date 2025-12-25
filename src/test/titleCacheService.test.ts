import * as assert from 'assert';
import { titleCache } from '../data/titleCache';

suite('titleCache basic shape', () => {
  test('exports expected methods', () => {
    assert.strictEqual(typeof titleCache.get, 'function');
    assert.strictEqual(typeof titleCache.invalidate, 'function');
    assert.strictEqual(typeof titleCache.clear, 'function');
    assert.strictEqual(typeof titleCache.size, 'function');
  });
});
