import { describe, expect, it } from 'vitest';
import { parseSnapshot } from '../src/editor/markdown';
import { resolveRange } from '../src/domain/block-range';
import { planRangeMove, rangeMoveReason, validateRangeMove } from '../src/domain/range-move';
import { applyEdits } from '../src/domain/block';

function plan(text: string, from: number, to: number, direction: -1 | 1) {
  const snapshot = parseSnapshot(text);
  const move = planRangeMove(snapshot, resolveRange(snapshot, from, to), direction);
  return { snapshot, move, result: applyEdits(text, move.plan.edits) };
}

describe('whole-block exchange plans', () => {
  const text = 'Alpha.\n\nBravo.\n\nCharlie.\n\nDelta.';

  it('moves three paragraphs down past the next block and reports the result selection', () => {
    const { move, result } = plan(text, 2, 20, 1);
    expect(result).toBe('Delta.\n\nAlpha.\n\nBravo.\n\nCharlie.');
    expect(move.selectedAfter).toEqual({ from: 8, to: 32 });
    expect(move.pieces.length).toBeGreaterThan(0);
  });

  it('moves a group up over the previous block', () => {
    expect(plan(text, 10, 22, -1).result).toBe('Bravo.\n\nCharlie.\n\nAlpha.\n\nDelta.');
  });

  it('keeps internal separators and the EOF suffix', () => {
    const eof = 'Alpha.\n\nBravo.\n\nCharlie.\n\nDelta.\n';
    expect(plan(eof, 2, 20, 1).result).toBe('Delta.\n\nAlpha.\n\nBravo.\n\nCharlie.\n');
  });

  it('rejects when there is no adjacent target', () => {
    expect(() => plan(text, 10, 30, 1)).toThrow('rangeNoSibling');
  });

  it('preserves native IDs with the moved unit', () => {
    const ids = 'Alpha ^a\n\nBravo ^b\n\nCharlie ^c';
    expect(plan(ids, 2, ids.indexOf('Bravo') + 3, 1).result).toBe('Charlie ^c\n\nAlpha ^a\n\nBravo ^b');
  });
});

describe('list sibling exchanges', () => {
  const list = '- A\n  - a\n- B\n  - b\n- C\n  - c\n- D\n  - d';

  it('moves parent items with their descendants and keeps group order', () => {
    const { result } = plan(list, list.indexOf('B'), list.indexOf('C') + 1, -1);
    expect(result).toBe('- B\n  - b\n- C\n  - c\n- A\n  - a\n- D\n  - d');
  });

  it('moves two items down together and validates the candidate', () => {
    const { snapshot, move, result } = plan(list, list.indexOf('B'), list.indexOf('C') + 1, 1);
    expect(result).toBe('- A\n  - a\n- D\n  - d\n- B\n  - b\n- C\n  - c');
    validateRangeMove(snapshot, move, parseSnapshot(result));
  });
});

describe('ordered list numbering', () => {
  const ordered = '9. A\n   ca\n10. B\n    cb\n11. C\n    cc';

  it('keeps the group start, the marker form, and shifts continuation indentation', () => {
    const { result } = plan(ordered, ordered.indexOf('A'), ordered.indexOf('11.'), 1);
    expect(result).toBe('9. C\n   cc\n10. A\n    ca\n11. B\n    cb');
  });

  it('reports unrelated items that the numbering strategy also rewrites', () => {
    const uneven = '1. A\n2. B\n5. C';
    const { move } = plan(uneven, uneven.indexOf('A'), uneven.indexOf('B') + 1, 1);
    expect(move.numberingChanges.map(change => change.after)).toContain(3);
  });
});

describe('separator ownership', () => {
  it('keeps the selected group internal separators and uses the crossed separator at the target boundary', () => {
    const text = 'A\n\nB\n\n\n\nC\n\nD';
    const { result } = plan(text, 0, text.indexOf('B') + 1, 1);
    expect(result).toBe('C\n\n\n\nA\n\nB\n\nD');
  });
  it.each([
    ['1. A\n2. B\n\n3. C', 'A', 'B', 1, '1. C\n\n2. A\n3. B'],
    ['1. A\n\n2. B\n3. C', 'B', 'C', -1, '1. B\n2. C\n\n3. A'],
  ] as const)('keeps loose ordered-list separators with the selected group: %s', (text, first, last, direction, expected) => {
    const { snapshot, move, result } = plan(text, text.indexOf(first), text.indexOf(last) + 1, direction);
    expect(result).toBe(expected);
    validateRangeMove(snapshot, move, parseSnapshot(result));
  });
});

describe('lightweight capability', () => {
  it('reports availability without building a plan that can overflow', () => {
    const text = '999999999. A\n1. B\n2. C';
    const snapshot = parseSnapshot(text);
    const resolution = resolveRange(snapshot, text.indexOf('A'), text.lastIndexOf('2.'));
    expect(rangeMoveReason(resolution, 1, snapshot)).toBeNull();
    expect(() => planRangeMove(snapshot, resolution, 1)).toThrow('rangeNumbering');
  });
});

describe('candidate validation', () => {
  it('accepts the planned result and rejects a forged candidate', () => {
    const { snapshot, move, result } = plan('Alpha.\n\nBravo.\n\nCharlie.', 2, 16, 1);
    validateRangeMove(snapshot, move, parseSnapshot(result));
    expect(() => validateRangeMove(snapshot, move, parseSnapshot('Bravo.\n\nAlpha.\n\nCharlie.'))).toThrow('unsafe');
  });
});
