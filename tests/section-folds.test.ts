import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import type { Transaction } from '@codemirror/state';
import { foldEffect, foldState, unfoldEffect } from '@codemirror/language';
import { history, isolateHistory, redo, undo } from '@codemirror/commands';
import { applyEdits } from '../src/domain/block';
import { moveSection } from '../src/domain/section';
import { parseSnapshot } from '../src/editor/markdown';
import { cursorHidden, historyFoldNotice, mapSectionSelection, readFolds, sectionHistory, sectionMapping, sectionMoveEffect } from '../src/editor/section-folds';

const text = '## A\na\n\n\n## B\nb\n';
function setup(folds: readonly { from: number; to: number }[] = [], selection = 0, doc = text) {
  let state = EditorState.create({ doc, selection: { anchor: selection }, extensions: [foldState, history(), sectionHistory] });
  const dispatch = (tr: Transaction) => { state = tr.state; };
  dispatch(state.update({ effects: folds.map(f => foldEffect.of(f)) }));
  return { get state() { return state; }, dispatch,
    move() {
      const snapshot = parseSnapshot(state.doc.toString()), move = moveSection(snapshot, 0, 1);
      const candidate = parseSnapshot(applyEdits(snapshot.text, move.plan.edits));
      dispatch(state.update({ changes: [...move.plan.edits], selection: { anchor: move.plan.cursor },
        effects: sectionMoveEffect.of(sectionMapping(move, candidate)), annotations: isolateHistory.of('full') }));
    } };
}

describe('section folds and public history', () => {
  const selectionMapping = (doc = text) => {
    const snapshot = parseSnapshot(doc), move = moveSection(snapshot, 0, 1);
    return sectionMapping(move, parseSnapshot(applyEdits(doc, move.plan.edits)));
  };
  it.each([[0, 15], [15, 0]])('preserves the entire peer selection across both exchanged sections (%s → %s)', (anchor, head) => {
    const selection = mapSectionSelection(EditorSelection.single(anchor, head), selectionMapping());
    expect(selection.main.anchor).toBe(anchor);
    expect(selection.main.head).toBe(head);
  });
  it('keeps a selection and a cursor with separator whitespace when payload lengths differ', () => {
    const doc = '## A\na\n\n\n## B longer\nb\n', mapping = selectionMapping(doc);
    const shift = ' longer'.length;
    expect(mapSectionSelection(EditorSelection.single(6, 9), mapping).main).toMatchObject({ from: 6 + shift, to: 9 + shift });
    expect(mapSectionSelection(EditorSelection.single(7), mapping).main.head).toBe(7 + shift);
  });
  it('refuses a peer selection whose content would become discontiguous', () => {
    expect(() => mapSectionSelection(EditorSelection.single(2, 12), selectionMapping())).toThrow('sectionSelection');
  });
  it.each([[false, false], [true, false], [false, true], [true, true]])('keeps fold ownership for A=%s B=%s across undo/redo', (a, b) => {
    const before = [...(a ? [{ from: 4, to: 8 }] : []), ...(b ? [{ from: 13, to: 16 }] : [])];
    const after = [...(b ? [{ from: 4, to: 8 }] : []), ...(a ? [{ from: 13, to: 16 }] : [])];
    const host = setup(before);
    host.move();
    expect(host.state.doc.toString()).toBe('## B\nb\n\n\n## A\na\n');
    expect(readFolds(host.state)).toEqual(after);
    expect(undo(host)).toBe(true);
    expect(host.state.doc.toString()).toBe(text);
    expect(readFolds(host.state)).toEqual(before);
    expect(redo(host)).toBe(true);
    expect(readFolds(host.state)).toEqual(after);
  });
  it('maps later independent folding, rather than restoring a stale fold snapshot', () => {
    const host = setup([{ from: 4, to: 8 }]);
    host.move();
    host.dispatch(host.state.update({ effects: [unfoldEffect.of({ from: 13, to: 16 }), foldEffect.of({ from: 4, to: 8 })] }));
    undo(host);
    expect(readFolds(host.state)).toEqual([{ from: 13, to: 16 }]);
    redo(host);
    expect(readFolds(host.state)).toEqual([{ from: 4, to: 8 }]);
  });
  it('keeps internal folds with their payload and surrounding folds unchanged', () => {
    const doc = '## A\n```js\nline\n```\n\n## B\nb\n\n## C\nc\n';
    const host = setup([{ from: 10, to: 16 }, { from: 32, to: 35 }], 0, doc);
    host.move();
    expect(readFolds(host.state)).toEqual([{ from: 18, to: 24 }, { from: 32, to: 35 }]);
    undo(host);
    expect(readFolds(host.state)).toEqual([{ from: 10, to: 16 }, { from: 32, to: 35 }]);
  });
  it('separates preceding and subsequent typing from the move', () => {
    const host = setup([{ from: 4, to: 8 }]);
    host.dispatch(host.state.update({ changes: { from: text.length, insert: 'x' }, userEvent: 'input.type' }));
    host.move();
    const moved = host.state.doc.toString();
    host.dispatch(host.state.update({ changes: { from: moved.length, insert: 'y' }, userEvent: 'input.type' }));
    undo(host);
    expect(host.state.doc.toString()).toBe(moved);
    undo(host);
    expect(host.state.doc.toString()).toBe(text + 'x');
    expect(readFolds(host.state)).toEqual([{ from: 4, to: 8 }]);
    redo(host);
    expect(host.state.doc.toString()).toBe(moved);
  });
  it('recognizes strictly hidden selection heads without treating fold boundaries as hidden', () => {
    const host = setup([{ from: 4, to: 8 }]);
    // Programmatic fold and selection together: native fold state expands it, as the host does.
    expect(cursorHidden(host.state)).toBe(false);
    expect(cursorHidden(setup([{ from: 4, to: 8 }], 5).state)).toBe(true);
    host.dispatch(host.state.update({ selection: { anchor: 4 } }));
    expect(cursorHidden(host.state)).toBe(false);
  });
  it('reports history selection conflicts instead of hiding a restored cursor', () => {
    const host = setup([], 5);
    host.move();
    host.dispatch(host.state.update({ effects: foldEffect.of({ from: 13, to: 16 }) }));
    let noticed = false;
    undo({ get state() { return host.state; }, dispatch: tr => { noticed = tr.annotation(historyFoldNotice) === true; host.dispatch(tr); } });
    expect(host.state.selection.main.head).toBe(5);
    expect(readFolds(host.state)).toEqual([]);
    expect(noticed).toBe(true);
  });
});
