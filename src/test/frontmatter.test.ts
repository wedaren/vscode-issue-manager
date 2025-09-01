import * as assert from 'assert';
import { parseFrontmatter } from '../utils/markdown';

suite('Frontmatter Parser Tests', () => {
    test('should parse valid frontmatter', () => {
        const content = `---
root_file: 'test.md'
parent_file: null
children_files:
  - 'child1.md'
  - 'child2.md'
---

# Test Document

Content here.`;

        const result = parseFrontmatter(content);
        assert.strictEqual(result?.root_file, 'test.md');
        assert.strictEqual(result?.parent_file, null);
        assert.deepStrictEqual(result?.children_files, ['child1.md', 'child2.md']);
    });

    test('should return null for content without frontmatter', () => {
        const content = `# Test Document

No frontmatter here.`;

        const result = parseFrontmatter(content);
        assert.strictEqual(result, null);
    });

    test('should return null for invalid frontmatter', () => {
        const content = `---
invalid yaml: [unclosed array
---

# Test Document`;

        const result = parseFrontmatter(content);
        assert.strictEqual(result, null);
    });

    test('should handle empty frontmatter', () => {
        const content = `---
---

# Test Document`;

        const result = parseFrontmatter(content);
        assert.notStrictEqual(result, null);
    });

    test('should handle frontmatter with additional fields', () => {
        const content = `---
root_file: 'test.md'
title: 'Custom Title'
tags: ['tag1', 'tag2']
date: 2024-01-01
---

# Test Document`;

        const result = parseFrontmatter(content);
        assert.strictEqual(result?.root_file, 'test.md');
        assert.strictEqual(result?.title, 'Custom Title');
        assert.deepStrictEqual(result?.tags, ['tag1', 'tag2']);
        // YAML parser may convert date string to Date object, so we check both possibilities
        assert.ok(result?.date === '2024-01-01' || result?.date instanceof Date);
    });
});
