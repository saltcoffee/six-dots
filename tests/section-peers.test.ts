import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorState, StateEffect, Text } from '@codemirror/state';
import type { ViewUpdate } from '@codemirror/view';
import type { Transaction } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { foldEffect, foldState, unfoldEffect } from '@codemirror/language';
import { editorInfoField } from 'obsidian';
import { applyEdits } from '../src/domain/block';
import { moveSection } from '../src/domain/section';
import { parseSnapshot } from '../src/editor/markdown';
import { readFolds, sectionHistory, sectionMapping } from '../src/editor/section-folds';
import { SectionPeers, sectionPeerFilter } from '../src/editor/section-peers';

vi.mock('obsidian', async () => {
  const { StateField } = await import('@codemirror/state');
  class MarkdownView { file = { path: 'Test.md' }; getMode() { return 'source'; } }
  return { MarkdownView, editorInfoField: StateField.define({ create: () => new MarkdownView(), update: value => value }) };
});
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(selection: { anchor: number; head?: number } = { anchor: 13 }, folded = true) {
  const text = '## A\na\n\n\n## B\nb\n', snapshot = parseSnapshot(text), move = moveSection(snapshot, 0, 1);
  const candidate = parseSnapshot(applyEdits(text, move.plan.edits)), mapping = sectionMapping(move, candidate);
  const make = () => ({
    state: EditorState.create({ doc: text, selection, extensions: [editorInfoField, foldState, sectionHistory, sectionPeerFilter] }),
    dom: { nodeType: 1, closest: () => null },
    dispatch(tr: Transaction) { this.state = tr.state; },
  });
  const source = make(), peer = make();
  Object.assign(peer.state.field(editorInfoField)!, { file: source.state.field(editorInfoField)!.file });
  if (folded) peer.dispatch(peer.state.update({ effects: foldEffect.of({ from: 13, to: 16 }) }));
  const diverged = vi.fn();
  const peers = new SectionPeers(() => [source, peer] as unknown as EditorView[], diverged);
  peers.arm(source as unknown as EditorView, source.state.doc, Text.of(candidate.text.split('\n')), mapping);
  return { source, peer, peers, diverged, move, candidate };
}

describe('same-file view adaptation', () => {
  it('keeps the whole selected range when both sections were selected in the peer', async () => {
    const host = setup({ anchor: 0, head: 15 }, false);
    host.peer.dispatch(host.peer.state.update({ changes: [...host.move.plan.edits] }));
    expect(host.peer.state.selection.main).toMatchObject({ anchor: 0, head: 15 });
    await vi.runAllTimersAsync();
    expect(host.diverged).not.toHaveBeenCalled(); host.peers.destroy();
  });
  it('carries the binding through unrelated effects before delayed file synchronization', async () => {
    const host = setup(), effect = StateEffect.define<boolean>();
    for (let i = 0; i < 3; i++) host.peer.dispatch(host.peer.state.update({ effects: effect.of(true) }));
    host.peer.dispatch(host.peer.state.update({ changes: [...host.move.plan.edits] }));
    expect(readFolds(host.peer.state)).toEqual([{ from: 4, to: 8 }]);
    await vi.runAllTimersAsync();
    expect(host.diverged).not.toHaveBeenCalled(); host.peers.destroy();
  });
  it('still invalidates a selection change followed by a return to the original selection', async () => {
    const host = setup(), startState = host.peer.state;
    host.peer.dispatch(host.peer.state.update({ selection: { anchor: 0 } }));
    host.peer.dispatch(host.peer.state.update({ selection: { anchor: 13 } }));
    host.peers.update({ startState, state: host.peer.state } as ViewUpdate);
    host.peer.dispatch(host.peer.state.update({ changes: [...host.move.plan.edits] }));
    await vi.runAllTimersAsync();
    expect(host.diverged).toHaveBeenCalledOnce(); host.peers.destroy();
  });
  it('does not revive a binding after folding changes away and back in a batch', async () => {
    const host = setup(), startState = host.peer.state, fold = { from: 13, to: 16 };
    host.peer.dispatch(host.peer.state.update({ effects: unfoldEffect.of(fold) }));
    host.peer.dispatch(host.peer.state.update({ effects: foldEffect.of(fold) }));
    host.peers.update({ startState, state: host.peer.state } as ViewUpdate);
    expect(host.diverged).toHaveBeenCalledOnce();
    host.peer.dispatch(host.peer.state.update({ changes: [...host.move.plan.edits] }));
    await vi.runAllTimersAsync();
    expect(host.diverged).toHaveBeenCalledOnce(); host.peers.destroy();
  });
  it('does not apply a binding after the file was renamed during an unrelated update', async () => {
    const host = setup(), startState = host.peer.state;
    host.source.state.field(editorInfoField)!.file!.path = 'Renamed.md';
    host.peer.dispatch(host.peer.state.update({ effects: StateEffect.define<boolean>().of(true) }));
    host.peers.update({ startState, state: host.peer.state } as ViewUpdate);
    host.peer.dispatch(host.peer.state.update({ changes: [...host.move.plan.edits] }));
    await vi.runAllTimersAsync();
    expect(host.diverged).toHaveBeenCalledOnce(); host.peers.destroy();
  });
  it('maps the peer’s own selection and fold in its delayed host text transaction', async () => {
    const host = setup();
    host.peer.dispatch(host.peer.state.update({ changes: [...host.move.plan.edits] }));
    expect(host.peer.state.doc.toString()).toBe(host.candidate.text);
    expect(host.peer.state.selection.main.head).toBe(4);
    expect(readFolds(host.peer.state)).toEqual([{ from: 4, to: 8 }]);
    await vi.runAllTimersAsync();
    expect(host.diverged).not.toHaveBeenCalled(); host.peers.destroy();
  });
  it('does not overwrite a peer with intervening user selection changes', async () => {
    const host = setup();
    host.peer.dispatch(host.peer.state.update({ selection: { anchor: 0 } }));
    host.peer.dispatch(host.peer.state.update({ changes: [...host.move.plan.edits] }));
    await vi.runAllTimersAsync();
    expect(host.diverged).toHaveBeenCalledOnce(); host.peers.destroy();
  });
  it('expires the narrow document binding when host synchronization never arrives', async () => {
    const host = setup(); await vi.runAllTimersAsync();
    expect(host.diverged).toHaveBeenCalledOnce();
    expect(host.peer.state.doc.toString()).toBe(host.source.state.doc.toString()); host.peers.destroy();
  });
});
