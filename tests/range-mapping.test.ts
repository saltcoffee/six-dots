import { describe, expect, it } from 'vitest';
import { ChangeSet, EditorSelection } from '@codemirror/state';
import { applyEdits } from '../src/domain/block';
import { resolveRange } from '../src/domain/block-range';
import { planRangeMove } from '../src/domain/range-move';
import { parseSnapshot } from '../src/editor/markdown';
import { rangeMappingSteps } from '../src/editor/range-mapping';
import { invertSectionMapping, mapSectionFolds, mapSectionSelection, sectionMoveEffect } from '../src/editor/section-folds';

const numbered = '7. A\n8. B\n9. C\n100. D\n     - child-D';

function mapping(text = numbered, from = text.indexOf('A'), to = text.indexOf('B') + 1) {
  const snapshot = parseSnapshot(text), move = planRangeMove(snapshot, resolveRange(snapshot, from, to), 1);
  const changes = ChangeSet.of([...move.plan.edits], text.length);
  const steps = rangeMappingSteps(move, changes.desc);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return { forward: next.value, inverse: invertSectionMapping(next.value), result: applyEdits(text, move.plan.edits) };
}

describe('range content correspondence', () => {
  it.each([-1, 0, 1])('keeps a peer caret on the body through renumbering and its inverse (assoc=%s)', assoc => {
    const move = mapping(), original = EditorSelection.create([EditorSelection.cursor(20, assoc)]);
    const after = mapSectionSelection(original, move.forward);
    expect(after.main.head).toBe(19);
    expect(move.result[after.main.head]).toBe('D');
    expect(mapSectionSelection(after, move.inverse).eq(original, true)).toBe(true);
  });

  it('distinguishes a recoverable marker boundary from a lossy one by association', () => {
    const move = mapping();
    const left = EditorSelection.create([EditorSelection.cursor(17, -1)]);
    const right = EditorSelection.create([EditorSelection.cursor(17, 1)]);
    const roundtrip = (selection: EditorSelection) => mapSectionSelection(mapSectionSelection(selection, move.forward), move.inverse);
    expect(roundtrip(left).eq(left, true)).toBe(true);
    expect(roundtrip(right).eq(right, true)).toBe(false);
  });

  it.each([[20, 36], [36, 20], [0, 36], [36, 0]])('round-trips a continuous peer range (%s → %s)', (anchor, head) => {
    const move = mapping(), original = EditorSelection.single(anchor, head);
    expect(mapSectionSelection(mapSectionSelection(original, move.forward), move.inverse).eq(original, true)).toBe(true);
  });

  it('preserves the primary logical range when separate peer ranges change their physical order', () => {
    const move = mapping();
    const original = EditorSelection.create([EditorSelection.cursor(3), EditorSelection.range(12, 14)], 1);
    const after = mapSectionSelection(original, move.forward);
    expect(after.mainIndex).toBe(0);
    expect(after.main).toMatchObject({ anchor: 2, head: 4 });
    expect(mapSectionSelection(after, move.inverse).eq(original, true)).toBe(true);
  });

  it('maps the source subtree fold through local edits in both directions', () => {
    const move = mapping();
    expect(mapSectionFolds([{ from: 21, to: 36 }], move.forward, move.result.length)).toEqual([{ from: 20, to: 34 }]);
    expect(mapSectionFolds([{ from: 20, to: 34 }], move.inverse, numbered.length)).toEqual([{ from: 21, to: 36 }]);
  });

  it('preserves an enclosing parent fold while its list shrinks', () => {
    const text = '# Parent\n' + numbered, move = mapping(text), original = [{ from: 8, to: text.length }];
    const after = mapSectionFolds(original, move.forward, move.result.length);
    expect(after).toEqual([{ from: 8, to: text.length - 2 }]);
    expect(mapSectionFolds(after, move.inverse, text.length)).toEqual(original);
  });

  it('keeps a fold in an unchanged item covered by the whole-list replacement', () => {
    const text = numbered + '\n11. E\n    - child-E', move = mapping(text);
    const start = text.indexOf('\n', text.indexOf('11. E'));
    const after = mapSectionFolds([{ from: start, to: text.length }], move.forward, move.result.length);
    expect(after).toEqual([{ from: start - 2, to: text.length - 2 }]);
    expect(mapSectionFolds(after, move.inverse, text.length)).toEqual([{ from: start, to: text.length }]);
  });

  it('carries the full correspondence through an unrelated prefix edit', () => {
    const text = 'Intro.\n\n' + numbered, move = mapping(text), prefix = 'New.\n\n';
    const outside = ChangeSet.of({ from: 0, insert: prefix }, move.result.length);
    const rebased = sectionMoveEffect.of(move.inverse).map(outside.desc)!.value;
    expect(mapSectionFolds([{ from: 28 + prefix.length, to: 42 + prefix.length }], rebased, text.length + prefix.length))
      .toEqual([{ from: 29 + prefix.length, to: 44 + prefix.length }]);
  });

  it('rejects an external text edit that touches the content mapping', () => {
    const move = mapping(), changed = ChangeSet.of({ from: 3, insert: 'x' }, move.result.length);
    expect(sectionMoveEffect.of(move.inverse).map(changed.desc)).toBeUndefined();
  });
});
