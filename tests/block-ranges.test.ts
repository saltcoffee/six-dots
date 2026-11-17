import { describe, expect, it } from 'vitest';
import { parseSnapshot } from '../src/editor/markdown';
import { resolveRange } from '../src/domain/block-range';

function at(text: string, from: number, to: number) {
  return resolveRange(parseSnapshot(text), from, to);
}

describe('plain selection to complete range', () => {
  const text = 'Alpha.\n\nBravo.\n\nCharlie.\n\nDelta.';

  it('includes whole paragraphs touched by a partial selection', () => {
    const range = at(text, 2, 20).range;
    expect(range.from).toBe(0);
    expect(range.to).toBe(24);
    expect(range.units.map(unit => unit.block.text)).toEqual(['Alpha.', 'Bravo.', 'Charlie.']);
  });

  it('treats a boundary exactly at the next start as excluded', () => {
    expect(at(text, 2, 16).range.units.map(unit => unit.block.text)).toEqual(['Alpha.', 'Bravo.']);
  });

  it('ignores whitespace-only and reversed selections', () => {
    expect(() => at(text, 6, 8)).toThrow('rangeEmpty');
    expect(() => at(text, 20, 2)).toThrow('rangeSelection');
  });

  it('rejects a single unit in favour of the single-block action', () => {
    expect(() => at(text, 1, 4)).toThrow('rangeSingle');
  });

  it('does not cross a real heading barrier', () => {
    expect(() => at('Alpha.\n\n# Title\n\nBravo.\n\nCharlie.', 2, 25)).toThrow('rangeProtected');
  });

  it('rejects a selection that begins inside a heading even when later paragraphs are movable', () => {
    const text = '## Title\n\nAlpha.\n\nBravo.';
    expect(() => at(text, text.indexOf('Title'), text.indexOf('Bravo') + 2)).toThrow('rangeProtected');
  });

  it('rejects any selected frontmatter, including a selection starting in its delimiters', () => {
    const text = '---\na: 1\n---\n\nAlpha.\n\nBravo.\n\nCharlie.';
    for (const from of [0, 2, text.indexOf('a:')]) {
      expect(() => at(text, from, text.indexOf('Bravo') + 3)).toThrow('rangeProtected');
    }
    expect(at(text, text.indexOf('Alpha'), text.indexOf('Bravo') + 3).range.units).toHaveLength(2);
  });

  it('mixes supported top-level container kinds', () => {
    const mixed = 'Alpha.\n\n> Quote\n\n```js\ncode\n```\n\nDelta.';
    const range = at(mixed, 1, mixed.indexOf('Delta') + 2).range;
    expect(range.units.map(unit => unit.kind)).toEqual(['paragraph', 'quote', 'code', 'paragraph']);
  });
});

describe('list sibling units', () => {
  const list = '- A\n  - a\n- B\n  - b\n- C\n  - c\n- D\n  - d';

  it('selects two parent items with their descendants as two units', () => {
    const from = list.indexOf('B'), to = list.indexOf('C') + 1;
    const range = at(list, from, to).range;
    expect(range.units.map(unit => unit.block.text.split('\n')[0])).toEqual(['- B', '- C']);
    expect(range.units.map(unit => unit.descendantCount)).toEqual([1, 1]);
  });

  it('does not upgrade a child selection to its parent', () => {
    const from = list.indexOf('  - a'), to = list.indexOf('  - a') + 5;
    expect(() => at(list, from, to)).toThrow('rangeSingle');
  });

  it('rejects a cross-level selection that never touches the parent body', () => {
    const from = list.indexOf('  - a'), to = list.indexOf('B') + 1;
    expect(() => at(list, from, to)).toThrow('rangeMixedGroups');
  });

  it('allows two siblings of one parent list without selecting the parent', () => {
    const nested = '- A\n  - a\n  - b\n  - c\n- B';
    const range = at(nested, nested.indexOf('- a') + 2, nested.indexOf('- c') + 3).range;
    expect(range.units.map(unit => unit.block.text)).toEqual(['  - a', '  - b', '  - c']);
  });

  it('rejects mixed paragraph and list content', () => {
    expect(() => at('Intro.\n\n- a\n- b', 2, 14)).toThrow('rangeMixedGroups');
  });

  it('counts deep descendants once and keeps the index bound to its snapshot', () => {
    const nested = '- A\n  - a\n    - a1\n  - b\n- B\n  - c\n- C';
    const selection = at(nested, nested.indexOf('A'), nested.indexOf('B') + 1).range;
    expect(selection.units.map(unit => unit.descendantCount)).toEqual([3, 1]);
    const changed = nested.replace('    - a1\n', '');
    expect(at(changed, changed.indexOf('A'), changed.indexOf('B') + 1).range.units.map(unit => unit.descendantCount)).toEqual([2, 1]);
  });
});
