import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorSelection, EditorState, Transaction } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { history, isolateHistory, redo, undo } from '@codemirror/commands';
import { foldEffect, foldState, unfoldEffect } from '@codemirror/language';
import { editorInfoField } from 'obsidian';
import { moveSection } from '../src/domain/section';
import { moveBy } from '../src/domain/move';
import { targetFor } from '../src/editor/context';
import { parseSnapshot } from '../src/editor/markdown';
import { SnapshotCache } from '../src/editor/snapshot-cache';
import { dispatchPrepared, MovePreparation, preparedMove } from '../src/editor/move-preparation';
import type { PreparedMove } from '../src/editor/move-preparation';
import { readFolds, sectionCommit, sectionHistory, sectionMoveEffect } from '../src/editor/section-folds';

vi.mock('obsidian', async () => {
  const { StateField } = await import('@codemirror/state');
  class MarkdownView { file = { path: 'Test.md' }; getMode() { return 'source'; } }
  return { MarkdownView, editorInfoField: StateField.define({ create: () => new MarkdownView(), update: value => value }) };
});
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

function setup(extra: Extension = [], legacy = false) {
  const view = {
    state: EditorState.create({ doc: legacy ? 'alpha\n\nbeta' : '## A\na\n\n\n## B\nb\n', selection: { anchor: 1 },
      extensions: [editorInfoField, foldState, history(), sectionHistory, extra] }),
    dom: { isConnected: true, nodeType: 1, closest: () => null }, composing: false,
    dispatch(tr: Transaction) { this.state = tr.state; },
  };
  if (!legacy) view.dispatch(view.state.update({ effects: foldEffect.of({ from: 4, to: 8 }) }));
  const editor = view as unknown as EditorView, snapshot = parseSnapshot(view.state.doc.toString());
  view.dispatch = view.dispatch.bind(view);
  const target = targetFor(editor, snapshot.roots[0]!, snapshot)!;
  const section = legacy ? undefined : moveSection(snapshot, 0, 1);
  const plan = section?.plan ?? moveBy(snapshot, target.block, 1)!;
  const prepare = new MovePreparation(), ready = vi.fn(), failed = vi.fn();
  prepare.prepare(editor, target, plan, section, ready, failed);
  return { view, editor, prepare, ready, failed, target };
}

describe('prepared move transaction proof', () => {
  it.each([false, true])('prepares without writing, then dispatches a single isolated edit (legacy=%s)', async legacy => {
    const host = setup([], legacy), before = host.view.state.doc.toString();
    await vi.runAllTimersAsync();
    expect(host.failed).not.toHaveBeenCalled();
    expect(host.view.state.doc.toString()).toBe(before);
    const move: PreparedMove = host.ready.mock.calls[0]![0];
    expect(dispatchPrepared(host.editor, move)).toBe('applied');
    expect(host.view.state.doc.toString()).toBe(move.candidate.text);
    expect(undo(host.view)).toBe(true);
    expect(host.view.state.doc.toString()).toBe(before);
    expect(host.view.state.selection.main.head).toBe(1);
    expect(redo(host.view)).toBe(true);
    expect(host.view.state.doc.toString()).toBe(move.candidate.text);
  });
  it('cancels candidate preparation without publishing a stale result', async () => {
    const host = setup(); host.prepare.cancel(); await vi.runAllTimersAsync();
    expect(host.ready).not.toHaveBeenCalled(); expect(host.failed).not.toHaveBeenCalled();
  });
  it('yields during complete validation and cancels before publishing a prepared move', async () => {
    let ticks = 0, parsed = false;
    vi.spyOn(performance, 'now').mockImplementation(() => ticks++);
    const original = SnapshotCache.prototype.prepare;
    vi.spyOn(SnapshotCache.prototype, 'prepare').mockImplementation(function (this: SnapshotCache, text, ready, failed) {
      original.call(this, text, () => { ready(); parsed = true; }, failed);
    });
    const host = setup();
    while (!parsed) await vi.advanceTimersToNextTimerAsync();
    expect(host.ready).not.toHaveBeenCalled();
    await vi.advanceTimersToNextTimerAsync();
    expect(host.ready).not.toHaveBeenCalled();
    host.prepare.cancel();
    await vi.runAllTimersAsync();
    expect(host.ready).not.toHaveBeenCalled();
    expect(host.failed).not.toHaveBeenCalled();
    expect(host.view.state.doc).toBe(host.target.doc);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['selection', 'assoc', 'folds', 'mapping', 'proof', 'isolation', 'history', 'commit'] as const)('rejects a host filter removing %s even when newDoc matches', async removed => {
    const filter = EditorState.transactionFilter.of(tr => {
      const proof = tr.annotation(preparedMove);
      if (!proof) return tr;
      return {
        changes: tr.changes, selection: removed === 'selection' ? { anchor: 0 }
          : removed === 'assoc' ? EditorSelection.create([EditorSelection.cursor(tr.newSelection.main.head, 1)]) : tr.newSelection,
        effects: tr.effects.filter(e => removed === 'folds' ? !e.is(foldEffect) && !e.is(unfoldEffect) : removed !== 'mapping' || !e.is(sectionMoveEffect)),
        annotations: [
          ...(removed === 'proof' ? [] : [preparedMove.of(proof)]),
          ...(removed === 'isolation' ? [] : [isolateHistory.of('full')]),
          ...(removed === 'commit' ? [] : [sectionCommit.of(true)]),
          ...(removed === 'history' ? [Transaction.addToHistory.of(false)] : []),
        ],
      };
    });
    const host = setup(filter); await vi.runAllTimersAsync();
    const move: PreparedMove = host.ready.mock.calls[0]![0];
    expect(dispatchPrepared(host.editor, move)).toBe('rejected');
    expect(host.view.state.doc.toString()).toBe(host.target.snapshot.text);
    expect(readFolds(host.view.state)).toEqual([{ from: 4, to: 8 }]);
    expect(undo(host.view)).toBe(false);
  });
  it.each(['selection', 'document'] as const)('detects post-dispatch %s divergence', async changed => {
    const host = setup(); await vi.runAllTimersAsync();
    const move: PreparedMove = host.ready.mock.calls[0]![0];
    host.view.dispatch = tr => {
      host.view.state = tr.state;
      host.view.state = host.view.state.update(changed === 'selection' ? { selection: { anchor: 0 } }
        : { changes: { from: 0, insert: 'external' } }).state;
    };
    expect(dispatchPrepared(host.editor, move)).toBe(changed === 'selection' ? 'viewDiverged' : 'diverged');
  });
});
