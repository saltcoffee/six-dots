import { describe, expect, it } from 'vitest';
import { parseSnapshot, markdownParser } from '../src/editor/markdown';
import { actionable, applyEdits, atPosition } from '../src/domain/block';
import { convert, conversionReason } from '../src/domain/convert';
import { addBlockId, blockLinkReason } from '../src/domain/block-link';
import { moveBy } from '../src/domain/move';

describe('list content boundaries', () => {
  it.each([
    '-     const code = 1;',
    '- ```js\n  const code = 1;\n  ```',
    '- > quoted text',
    '- # Heading',
  ])('rejects task conversion and ID insertion into a non-text first block: %s', text => {
    const item = parseSnapshot(text).blocks.find(block => block.kind === 'list-item')!;
    expect(item.marker?.textRange).toBeNull();
    expect(conversionReason(item, 'task')).toBe('unsupported');
    expect(() => convert(item, 'task')).toThrow();
    expect(blockLinkReason(item)).toBe('unsupported');
    expect(() => addBlockId(item, 'new')).toThrow();
  });

  it('still converts a text item with a fenced-code descendant without changing its code', () => {
    const text = '- parent\n\n  ```js\n  const code = 1;\n  ```';
    const item = parseSnapshot(text).blocks.find(block => block.kind === 'list-item')!;
    const next = applyEdits(text, convert(item, 'task')!.edits);
    expect(next).toBe('- [ ] parent\n\n  ```js\n  const code = 1;\n  ```');
    expect(markdownParser.parse(next).toString()).toContain('FencedCode(CodeMark,CodeInfo,CodeText,CodeMark)');
  });

  it.each([
    '- - child one\n  - child two\n- sibling',
    '1. 1. child one\n   2. child two\n2. sibling',
    '- parent\n  - - child one\n    - child two\n- sibling',
  ])('protects a compact subtree without falling through to its ancestor: %s', text => {
    const snapshot = parseSnapshot(text);
    expect(atPosition(snapshot, text.indexOf('child one'))).toBeNull();
    expect(atPosition(snapshot, text.indexOf('child two'))).toBeNull();
    const protectedItem = snapshot.blocks.find(block => block.kind === 'protected')!;
    expect(actionable(protectedItem)).toBe(false);
    expect(() => moveBy(snapshot, protectedItem, 1)).toThrow();
    expect(atPosition(snapshot, text.indexOf('sibling'))?.kind).toBe('list-item');
  });
});

describe('native ID ownership regressions', () => {
  it('inserts before the complete CRLF boundary and recognizes the result', () => {
    const text = '- parent\r\n  continuation\r\n- sibling';
    const item = parseSnapshot(text).blocks.find(block => block.kind === 'list-item' && block.from === 0)!;
    const next = applyEdits(text, addBlockId(item, 'parent').edits);
    expect(next).toBe('- parent\r\n  continuation ^parent\r\n- sibling');
    expect(parseSnapshot(next).blocks.find(block => block.kind === 'list-item' && block.from === 0)?.ownId?.value).toBe('parent');
  });
  it.each([
    '> quoted ^old',
    '> first\n> final ^old',
    '> [!note]\n> quoted ^old',
  ])('reuses an existing inline quote ID without writing another ID: %s', text => {
    const block = parseSnapshot(text).roots[0]!;
    expect(block.ownId?.value).toBe('old'); expect(block.hasIds).toBe(true);
    expect(block.ambiguousIds).toBe(false); expect(blockLinkReason(block)).toBeNull();
    expect(() => addBlockId(block, 'new')).toThrow();
    expect(conversionReason(block, 'callout:tip')).toBe('hasIds');
  });

  it.each(['> outer\n> > nested ^id', '> - child ^id', '> one ^first\n>\n> two ^second'])('protects unclear quote ownership: %s', text => {
    const block = parseSnapshot(text).roots[0]!;
    expect(block.hasIds).toBe(true); expect(block.ambiguousIds).toBe(true);
    expect(blockLinkReason(block)).toBe('unsafe');
    expect(() => addBlockId(block, 'new')).toThrow();
  });

  it('keeps duplicate quote IDs ambiguous across block families', () => {
    expect(parseSnapshot('> quoted ^same\n\ntext ^same').roots.every(block => block.ambiguousIds)).toBe(true);
  });

  it.each([
    '- parent\n  continuation\n  - child ^child',
    '- [ ] parent\n  continuation\n  - [x] child ^child',
    '- parent\n\n  second paragraph',
  ])('inserts the parent ID at its first paragraph end and recognizes it on reuse: %s', text => {
    const item = parseSnapshot(text).blocks.find(block => block.kind === 'list-item' && block.from === 0)!;
    const plan = addBlockId(item, 'parent');
    const next = applyEdits(text, plan.edits);
    const parent = parseSnapshot(next).blocks.find(block => block.kind === 'list-item' && block.from === 0)!;
    expect(parent.ownId?.value).toBe('parent'); expect(parent.ambiguousIds).toBe(false);
    expect(next).toContain(text.includes('continuation') ? 'continuation ^parent' : '- parent ^parent');
    expect(next.match(/\^parent/g)).toHaveLength(1);
    if (text.includes('^child')) expect(parseSnapshot(next).blocks.find(block => block.ownId?.value === 'child')?.from).toBeGreaterThan(0);
    expect(() => addBlockId(parent, 'another')).toThrow();
  });
});
