import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorSelection, EditorState, Transaction } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { history, redo, undo, undoDepth } from '@codemirror/commands';
import { foldEffect, foldState, unfoldEffect } from '@codemirror/language';
import { editorInfoField } from 'obsidian';
import { parseSnapshot } from '../src/editor/markdown';
import { contextFor } from '../src/editor/context';
import { resolveRange } from '../src/domain/block-range';
import { planRangeMove } from '../src/domain/range-move';
import { dispatchPrepared, MovePreparation, rangeSelectionRecorded } from '../src/editor/move-preparation';
import type { PreparedMove } from '../src/editor/move-preparation';
import { readFolds, sectionHistory } from '../src/editor/section-folds';

vi.mock('obsidian', async () => {
  const { StateField } = await import('@codemirror/state');
  class MarkdownView { file = { path: 'Test.md' }; getMode() { return 'source'; } }
  return { MarkdownView, editorInfoField: StateField.define({ create: () => new MarkdownView(), update: value => value }) };
});
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

const doc = 'Alpha.\n\nBravo.\n\nCharlie.\n\nDelta.';

function setup(folds: { from: number; to: number }[] = [], selection = { anchor: 2, head: 20 }, extra: Extension = [], text = doc) {
  const view = {
    state: EditorState.create({ doc: text, selection, extensions: [editorInfoField, foldState, history(), sectionHistory, extra] }),
    dom: { isConnected: true, nodeType: 1, closest: () => null }, composing: false,
    dispatch(tr: Transaction) { this.state = tr.state; },
  };
  view.dispatch = view.dispatch.bind(view);
  if (folds.length) view.dispatch(view.state.update({ effects: folds.map(fold => foldEffect.of(fold)) }));
  const editor = view as unknown as EditorView;
  const snapshot = parseSnapshot(view.state.doc.toString());
  const target = contextFor(editor, snapshot)!;
  const move = planRangeMove(snapshot, resolveRange(snapshot, Math.min(selection.anchor, selection.head), Math.max(selection.anchor, selection.head)), 1);
  const prepare = new MovePreparation(), ready = vi.fn(), failed = vi.fn();
  prepare.prepare(editor, target, move.plan, undefined, ready, failed, move);
  return { view, editor, prepare, ready, failed, move };
}

describe('range move transaction proof', () => {
  it('prepares without writing, then applies one isolated edit with the complete source selection', async () => {
    const host = setup();
    const before = host.view.state.doc.toString();
    await vi.runAllTimersAsync();
    expect(host.failed).not.toHaveBeenCalled();
    expect(host.view.state.doc.toString()).toBe(before);
    const prepared: PreparedMove = host.ready.mock.calls[0]![0];
    expect(dispatchPrepared(host.editor, prepared)).toBe('applied');
    expect(host.view.state.doc.toString()).toBe('Delta.\n\nAlpha.\n\nBravo.\n\nCharlie.');
    expect(host.view.state.selection.main).toMatchObject({ anchor: 8, head: 32 });
    expect(undo(host.view)).toBe(true);
    expect(host.view.state.doc.toString()).toBe(doc);
    expect(host.view.state.selection.main).toMatchObject({ anchor: 2, head: 20 });
    expect(redo(host.view)).toBe(true);
    expect(host.view.state.doc.toString()).toBe('Delta.\n\nAlpha.\n\nBravo.\n\nCharlie.');
    expect(host.view.state.selection.main).toMatchObject({ anchor: 8, head: 32 });
    expect(undoDepth(host.view.state)).toBe(1);
  });

  it('keeps the reverse selection direction on success', async () => {
    const host = setup([], { anchor: 20, head: 2 });
    await vi.runAllTimersAsync();
    const prepared: PreparedMove = host.ready.mock.calls[0]![0];
    expect(dispatchPrepared(host.editor, prepared)).toBe('applied');
    expect(host.view.state.doc.toString()).toBe('Delta.\n\nAlpha.\n\nBravo.\n\nCharlie.');
    expect(host.view.state.selection.main).toMatchObject({ anchor: 32, head: 8 });
    undo(host.view); redo(host.view);
    expect(host.view.state.selection.main).toMatchObject({ anchor: 32, head: 8 });
  });

  it('maps a fold inside the swapped target and restores it on undo', async () => {
    const host = setup([{ from: 26, to: 32 }]);
    await vi.runAllTimersAsync();
    const prepared: PreparedMove = host.ready.mock.calls[0]![0];
    expect(dispatchPrepared(host.editor, prepared)).toBe('applied');
    expect(readFolds(host.view.state)).toEqual([{ from: 0, to: 6 }]);
    undo(host.view);
    expect(readFolds(host.view.state)).toEqual([{ from: 26, to: 32 }]);
    redo(host.view);
    expect(readFolds(host.view.state)).toEqual([{ from: 0, to: 6 }]);
  });


  it('maps whole-item folds through numbering width changes and restores them on undo', async () => {
    const text = '7. A\n8. B\n9. C\n100. D\n     - child-D';
    const dStart = text.indexOf('100.');
    const raw = {
      state: EditorState.create({ doc: text, selection: { anchor: text.indexOf('A'), head: text.indexOf('9.') },
        extensions: [editorInfoField, foldState, history(), sectionHistory] }),
      dom: { isConnected: true, nodeType: 1, closest: () => null }, composing: false,
      dispatch(tr: Transaction) { this.state = tr.state; },
    };
    raw.dispatch = raw.dispatch.bind(raw);
    raw.dispatch(raw.state.update({ effects: foldEffect.of({ from: dStart, to: text.length }) }));
    const editor = raw as unknown as EditorView;
    const snapshot = parseSnapshot(text);
    const target = contextFor(editor, snapshot)!;
    const move = planRangeMove(snapshot, resolveRange(snapshot, raw.state.selection.main.from, raw.state.selection.main.to), 1);
    const prepare = new MovePreparation(), ready = vi.fn(), failed = vi.fn();
    prepare.prepare(editor, target, move.plan, undefined, ready, failed, move);
    await vi.runAllTimersAsync();
    expect(failed).not.toHaveBeenCalled();
    const prepared: PreparedMove = ready.mock.calls[0]![0];
    expect(dispatchPrepared(editor, prepared)).toBe('applied');
    const result = raw.state.doc.toString();
    expect(result).toBe('7. C\n8. A\n9. B\n10. D\n    - child-D');
    const newStart = result.indexOf('10.');
    expect(readFolds(raw.state)).toEqual([{ from: newStart, to: result.length }]);
    undo(raw);
    expect(readFolds(raw.state)).toEqual([{ from: dStart, to: text.length }]);
    redo(raw);
    expect(readFolds(raw.state)).toEqual([{ from: newStart, to: result.length }]);
  });
  it('rejects when the original text selection changed before dispatch', async () => {
    const host = setup();
    await vi.runAllTimersAsync();
    const prepared: PreparedMove = host.ready.mock.calls[0]![0];
    host.view.dispatch(host.view.state.update({ selection: EditorSelection.single(1, 5) }));
    expect(dispatchPrepared(host.editor, prepared)).toBe('rejected');
    expect(host.view.state.doc.toString()).toBe(doc);
  });

  it('preserves independent folding and unfolding when undoing and redoing a move', async () => {
    const text = 'Alpha.\n\nBravo.\n\nCharlie.\n\n```js\ncode\n```';
    const fold = { from: 31, to: 36 };
    for (const initiallyFolded of [false, true]) {
      const host = setup(initiallyFolded ? [fold] : [], { anchor: 2, head: 12 }, [], text);
      await vi.runAllTimersAsync();
      expect(dispatchPrepared(host.editor, host.ready.mock.calls[0]![0])).toBe('applied');
      host.view.dispatch(host.view.state.update({ effects: (initiallyFolded ? unfoldEffect : foldEffect).of(fold) }));
      const expected = initiallyFolded ? [] : [fold];
      undo(host.view); expect(readFolds(host.view.state)).toEqual(expected);
      redo(host.view); expect(readFolds(host.view.state)).toEqual(expected);
    }
  });

  it('shifts later folds by the total numbering change and preserves enclosing folds', async () => {
    const text = '7. A\n8. B\n9. C\n100. D\n     - child-D\n\n## Tail\nHidden text\n\n## End\nOther';
    const host = setup([{ from: 45, to: 58 }], { anchor: 3, head: 9 }, [], text);
    await vi.runAllTimersAsync();
    expect(dispatchPrepared(host.editor, host.ready.mock.calls[0]![0])).toBe('applied');
    expect(readFolds(host.view.state)).toEqual([{ from: 43, to: 56 }]);
    undo(host.view); expect(readFolds(host.view.state)).toEqual([{ from: 45, to: 58 }]);
    redo(host.view); expect(readFolds(host.view.state)).toEqual([{ from: 43, to: 56 }]);
  });

  it('writes the document once and keeps the history registration value-preserving', async () => {
    const host = setup(); await vi.runAllTimersAsync();
    const transactions: Transaction[] = [], dispatch = host.view.dispatch;
    host.view.dispatch = tr => { transactions.push(tr); dispatch(tr); };
    expect(dispatchPrepared(host.editor, host.ready.mock.calls[0]![0])).toBe('applied');
    expect(transactions.filter(tr => tr.docChanged)).toHaveLength(1);
    expect(transactions.filter(tr => !tr.docChanged).every(tr => tr.startState.selection.eq(tr.newSelection, true))).toBe(true);
    expect(undoDepth(host.view.state)).toBe(1);
  });

  it('rejects before writing if a host filter prevents the history selection registration', async () => {
    const host = setup([], { anchor: 2, head: 20 }, EditorState.transactionFilter.of(tr => tr.annotation(rangeSelectionRecorded)
      ? { selection: tr.newSelection, annotations: Transaction.addToHistory.of(false) } : tr));
    await vi.runAllTimersAsync();
    expect(dispatchPrepared(host.editor, host.ready.mock.calls[0]![0])).toBe('rejected');
    expect(host.view.state.doc.toString()).toBe(doc);
    expect(undoDepth(host.view.state)).toBe(0);
  });

  it('keeps a later input in its own undo item and restores the full range on redo', async () => {
    const host = setup(); await vi.runAllTimersAsync();
    dispatchPrepared(host.editor, host.ready.mock.calls[0]![0]);
    const moved = host.view.state.doc.toString();
    host.view.dispatch(host.view.state.update({ changes: { from: moved.length, insert: 'x' }, userEvent: 'input.type' }));
    undo(host.view); expect(host.view.state.doc.toString()).toBe(moved);
    undo(host.view); expect(host.view.state.doc.toString()).toBe(doc);
    redo(host.view);
    expect(host.view.state.doc.toString()).toBe(moved);
    expect(host.view.state.selection.main).toMatchObject({ anchor: 8, head: 32 });
    redo(host.view); expect(host.view.state.doc.toString()).toBe(moved + 'x');
  });

  it('rebases fold history and the complete selection through an external prefix edit', async () => {
    const text = 'Intro.\n\n7. A\n8. B\n9. C\n100. D\n     - child-D', prefix = 'New.\n\n';
    const host = setup([{ from: 29, to: 44 }], { anchor: 11, head: 17 }, [], text);
    await vi.runAllTimersAsync();
    dispatchPrepared(host.editor, host.ready.mock.calls[0]![0]);
    const moved = host.view.state.doc.toString(), selected = host.view.state.selection;
    host.view.dispatch(host.view.state.update({ changes: { from: 0, insert: prefix }, annotations: Transaction.addToHistory.of(false) }));
    undo(host.view);
    expect(host.view.state.doc.toString()).toBe(prefix + text);
    expect(readFolds(host.view.state)).toEqual([{ from: 35, to: 50 }]);
    redo(host.view);
    expect(host.view.state.doc.toString()).toBe(prefix + moved);
    expect(host.view.state.selection.main.anchor).toBe(selected.main.anchor + prefix.length);
    expect(host.view.state.selection.main.head).toBe(selected.main.head + prefix.length);
    expect(readFolds(host.view.state)).toEqual([{ from: 34, to: 48 }]);
  });
});
