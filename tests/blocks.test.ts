import { describe, expect, it } from 'vitest';
import { parseSnapshot } from '../src/editor/markdown';
import { actionable, applyEdits, atPosition } from '../src/domain/block';
import { move, moveBy } from '../src/domain/move';
import { convert, conversionReason } from '../src/domain/convert';
import { addBlockId, canonicalBlockLink } from '../src/domain/block-link';
import { extractedText, extractionPlan, extractionReason, targetPath } from '../src/domain/extract';
import type { Block, Format } from '../src/domain/block';

function block(text: string, kind: Block['kind'] = 'paragraph'): Block {
  const value = parseSnapshot(text).blocks.filter(item => item.kind === kind).sort((a, b) => a.from - b.from)[0];
  if (!value) throw new Error(`Missing ${kind} in ${text}`);
  return value;
}
function formatted(text: string, format: Format, kind: Block['kind'] = 'paragraph'): string {
  const plan = convert(block(text, kind), format);
  return plan ? applyEdits(text, plan.edits) : text;
}
describe('semantic boundaries', () => {
  it('treats source line breaks as one paragraph', () => {
    const snapshot = parseSnapshot('first line\nsecond line  \nhard break\n\nnext');
    expect(snapshot.roots).toHaveLength(2);
    expect(atPosition(snapshot, 12)?.text).toBe('first line\nsecond line  \nhard break');
  });
  it('includes a complete nested list subtree', () => {
    const text = '- parent\n  continuation\n  - child\n    - grandchild\n- sibling';
    const snapshot = parseSnapshot(text);
    const parent = snapshot.blocks.find(item => item.from === 0 && item.kind === 'list-item')!;
    expect(parent.text).toContain('grandchild');
    expect(parent.hasChildren).toBe(true);
    const plan = moveBy(snapshot, parent, 1)!;
    expect(applyEdits(text, plan.edits)).toBe('- sibling\n- parent\n  continuation\n  - child\n    - grandchild');
    expect(atPosition(snapshot, text.indexOf('grandchild'))?.text).toBe('    - grandchild');
  });
  it('does not penetrate quotes or callouts', () => {
    const text = '> [!note]\n> - nested\n>   - child';
    expect(parseSnapshot(text).blocks.map(item => item.kind)).toEqual(['callout']);
  });
  it('protects frontmatter, tables, definitions, setext, math and comments', () => {
    for (const text of ['---\ntitle: Test\n---\n', '| a | b |\n|---|---|\n|x|y|', '[key]: target.md', 'heading\n===', '$$\n# not heading\n\nx+y\n$$', '%%\n# hidden\n\n- hidden\n%%']) {
      expect(parseSnapshot(text).blocks.some(actionable), text).toBe(false);
    }
    expect(parseSnapshot('---\nunclosed').blocks).toHaveLength(0);
  });
  it('protects incomplete or mismatched fenced code', () => {
    expect(actionable(block('```js\ntext', 'protected'))).toBe(false);
    expect(actionable(block('```js\ntext\n~~~', 'protected'))).toBe(false);
    expect(block('```js\n# text\n```', 'code').text).toContain('# text');
  });
  it('does not confuse math and comments inside code with containers', () => {
    expect(parseSnapshot('```text\n$$\n%%\n```').roots.map(item => item.kind)).toEqual(['code']);
  });
});
describe('moves', () => {
  it('moves paragraphs without a final newline', () => {
    const text = 'alpha\n\nbeta', snapshot = parseSnapshot(text);
    expect(applyEdits(text, moveBy(snapshot, snapshot.roots[0]!, 1)!.edits)).toBe('beta\n\nalpha');
  });
  it('makes self and same-position drops no-ops', () => {
    const snapshot = parseSnapshot('a\n\nb');
    expect(move(snapshot, snapshot.roots[0]!, snapshot.roots[0]!, true)).toBeNull();
    expect(move(snapshot, snapshot.roots[0]!, snapshot.roots[1]!, false)).toBeNull();
  });
  it('rejects another sibling group', () => {
    const snapshot = parseSnapshot('- parent\n  - child\n- sibling');
    const child = snapshot.blocks.find(item => item.text === '  - child')!;
    expect(() => move(snapshot, child, snapshot.roots[0]!, false)).toThrow();
  });
  it.each([
    ['1. A\n2. B', '1. B\n2. A'],
    ['1. A\n1. B', '1. B\n1. A'],
    ['7) A\n8) B', '7) B\n8) A'],
    ['9. A\n   continuation\n10. B\n    continuation', '9. B\n   continuation\n10. A\n    continuation'],
  ])('preserves ordered starts and structural indentation: %s', (text, expected) => {
    const snapshot = parseSnapshot(text), first = snapshot.blocks.find(item => item.from === 0 && item.kind === 'list-item')!;
    expect(applyEdits(text, moveBy(snapshot, first, 1)!.edits)).toBe(expected);
  });
});
describe('conversions', () => {
  it.each(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const)('creates %s and is idempotent', format => {
    const text = formatted('Hello **world** [[Link]]', format);
    expect(text).toBe('#'.repeat(Number(format.slice(1))) + ' Hello **world** [[Link]]');
    expect(convert(block(text, 'heading'), format)).toBeNull();
  });
  it('keeps multiline paragraphs in one task', () => {
    const text = formatted('first\nsecond', 'task');
    expect(text).toBe('- [ ] first\n  second');
    expect(parseSnapshot(text).blocks.filter(item => item.kind === 'list-item')).toHaveLength(1);
  });
  it('preserves descendant task state', () => {
    expect(formatted('- parent\n  - [x] child', 'task', 'list-item')).toBe('- [ ] parent\n  - [x] child');
    expect(conversionReason(block('- [-] custom', 'list-item'), 'task')).toBe('customTask');
  });
  it('does not activate a list when removing a heading', () => {
    const text = formatted('# - literal', 'paragraph', 'heading');
    expect(text).toBe('\\- literal'); expect(parseSnapshot(text).roots[0]?.kind).toBe('paragraph');
  });
  it('preserves a paragraph boundary when removing a heading before body text', () => {
    const text = '# Title\nBody text', snapshot = parseSnapshot(text);
    const plan = convert(snapshot.roots[0]!, 'paragraph', snapshot)!;
    const next = applyEdits(text, plan.edits);
    expect(next).toBe('Title\n\nBody text'); expect(parseSnapshot(next).roots).toHaveLength(2);
  });
  it('preserves callout title, folding flag and body', () => {
    expect(formatted('> [!custom]- Title\n> body', 'callout:tip', 'callout')).toBe('> [!tip]- Title\n> body');
  });
  it.each([
    ['Hello world', 'h2', 'paragraph', 5, 8],
    ['## Hello world', 'paragraph', 'heading', 8, 5],
    ['first\nsecond', 'task', 'paragraph', 9, 17],
    ['Hello world', 'callout:note', 'paragraph', 5, 17],
    ['- [x] Hello world', 'bullet', 'list-item', 11, 7],
  ] as const)('keeps the caret attached to body text when converting %s', (text, format, kind, caret, expected) => {
    const snapshot = parseSnapshot(text), source = block(text, kind);
    expect(convert(source, format, snapshot, caret)?.cursor).toBe(expected);
  });
  it('rejects headings with source line breaks or existing IDs', () => {
    expect(() => formatted('first\nsecond', 'h2')).toThrow();
    expect(() => formatted('body ^id', 'h2')).toThrow();
  });
});
describe('native IDs', () => {
  it.each(['- [ ] task ^id', '- [x] task ^id', '- [X] task ^id'])('recognizes native IDs on GFM tasks: %s', text => {
    const item = block(text, 'list-item');
    expect(item.ownId?.value).toBe('id'); expect(item.hasIds).toBe(true);
    expect(conversionReason(item, 'bullet')).toBe('hasIds');
  });
  it('distinguishes child IDs from the parent ID', () => {
    const text = '- parent\n  - child ^child', snapshot = parseSnapshot(text);
    const parent = snapshot.blocks.find(item => item.from === 0 && item.kind === 'list-item')!;
    expect(parent.ownId).toBeNull(); expect(parent.hasIds).toBe(true);
    expect(applyEdits(text, addBlockId(parent, 'parent').edits)).toBe('- parent ^parent\n  - child ^child');
  });
  it('attaches a whole-list ID without assigning it to the last item', () => {
    const snapshot = parseSnapshot('- a\n- b\n\n^whole');
    expect(snapshot.roots[0]?.ownId?.value).toBe('whole');
    expect(snapshot.blocks.filter(item => item.kind === 'list-item').every(item => item.ownId === null)).toBe(true);
  });
  it('attaches a callout ID and preserves it during move', () => {
    const text = '> [!note]\n> body\n\n^callout\n\nnext', snapshot = parseSnapshot(text);
    expect(snapshot.roots[0]?.ownId?.value).toBe('callout');
    expect(applyEdits(text, moveBy(snapshot, snapshot.roots[0]!, 1)!.edits)).toBe('next\n\n> [!note]\n> body\n\n^callout');
  });
  it('does not treat inline or fenced code as IDs', () => {
    expect(block('`example ^literal`').hasIds).toBe(false);
    expect(block('```\nexample ^literal\n```', 'code').hasIds).toBe(false);
  });
  it('marks duplicates ambiguous', () => {
    expect(parseSnapshot('a ^same\n\nb ^same').blocks.every(item => item.ambiguousIds)).toBe(true);
  });
  it('protects IDs in headings and recognizes an ID at the end of a list paragraph', () => {
    expect(block('## Title ^id', 'heading').hasIds).toBe(true);
    const item = block('- item\n  continuation ^id', 'list-item');
    expect(item.ownId?.value).toBe('id'); expect(item.ambiguousIds).toBe(false);
  });
  it('copies a full vault path and rejects unrepresentable targets', () => {
    expect(canonicalBlockLink('文件夹/Note.md', 'abc')).toBe('[[文件夹/Note#^abc]]');
    expect(() => canonicalBlockLink('bad#path.md', 'abc')).toThrow();
  });
});
describe('extraction', () => {
  it('deindents a subtree and leaves a list link with task state', () => {
    const text = '- parent\n  - [x] child\n    - grandchild', snapshot = parseSnapshot(text);
    const child = snapshot.blocks.find(item => item.text.startsWith('  - [x]'))!;
    expect(extractedText(child)).toBe('- [x] child\n  - grandchild\n');
    expect(applyEdits(text, extractionPlan(child, '[[New]]').edits)).toBe('- parent\n  - [x] [[New]]');
  });
  it('protects headings and IDs in subtrees', () => {
    expect(extractionReason(block('- item\n  ## Heading', 'list-item'))).toBe('hasAnchors');
    expect(extractionReason(block('- item\n  - child ^id', 'list-item'))).toBe('hasIds');
  });
  it.each(['../bad', '/bad', 'bad/name', 'CON', 'nul.md', 'bad.', 'bad#name', 'bad|name'])('rejects unsafe filenames: %s', name => {
    expect(() => targetPath('', name)).toThrow();
  });
  it('handles names and vault-relative directories', () => {
    expect(targetPath('Notes', '你好.md')).toBe('Notes/你好.md');
    expect(() => targetPath('../outside', 'good')).toThrow();
  });
});
