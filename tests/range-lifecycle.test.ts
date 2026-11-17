import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import type { Transaction, TransactionSpec } from '@codemirror/state';
import type { EditorView, ViewUpdate } from '@codemirror/view';
import { foldEffect, foldState } from '@codemirror/language';
import { history, redo, undo } from '@codemirror/commands';
import { editorInfoField } from 'obsidian';
import type { App } from 'obsidian';
import { parseSnapshot } from '../src/editor/markdown';
import { SnapshotCache } from '../src/editor/snapshot-cache';
import { readFolds, sectionHistory } from '../src/editor/section-folds';
import { sectionPeerFilter } from '../src/editor/section-peers';
import { Moves } from '../src/obsidian/moves';

const ui = vi.hoisted(() => ({ dialogs: [] as { submit: () => void; ready: boolean; message: string; close: () => void }[] }));
vi.mock('obsidian', async () => {
  const { StateField } = await import('@codemirror/state');
  class MarkdownView { file = { path: 'Test.md' }; getMode() { return 'source'; } }
  return { MarkdownView, Platform: { isMobile: false },
    editorInfoField: StateField.define({ create: () => new MarkdownView(), update: value => value }) };
});
vi.mock('../src/ui/section-move-modal', () => ({ SectionMoveModal: class {}, MoveProgress: class {} }));
vi.mock('../src/ui/range-move-modal', () => ({
  RangeMoveModal: class {
    onDismiss = () => undefined;
    dialog: typeof ui.dialogs[number];
    constructor(_app: unknown, _t: unknown, _snapshot: unknown, _move: unknown, _original: unknown, _hidden: unknown, submit: () => void) {
      this.dialog = { submit, ready: false, message: '', close: () => this.close() }; ui.dialogs.push(this.dialog);
    }
    open() {}
    ready() { this.dialog.ready = true; }
    expire(message: string) { this.dialog.ready = false; this.dialog.message = message; }
    close() { this.onDismiss(); }
  },
}));

beforeEach(() => { vi.useFakeTimers(); ui.dialogs = []; });
afterEach(() => vi.useRealTimers());

const doc = 'Alpha.\n\nBravo.\n\nCharlie.\n\nDelta.';

function setup(selection = { anchor: 2, head: 20 }, text = doc) {
  const notify = vi.fn(), error = vi.fn(), committing = new Set<EditorView>();
  const document = Object.assign(new EventTarget(), { defaultView: new EventTarget(), visibilityState: 'visible' });
  const raw = {
    state: EditorState.create({ doc: text, selection, extensions: [editorInfoField, foldState, history(), sectionHistory, sectionPeerFilter] }),
    dom: Object.assign(new EventTarget(), { isConnected: true, nodeType: 1, closest: () => null, ownerDocument: document }),
    composing: false, focus: vi.fn(), dispatch: (() => undefined) as (tr: Transaction) => void,
  };
  const view = raw as unknown as EditorView;
  const moves = new Moves({} as App, key => key, { committing, valid: (v, t) => v.state.doc === t.doc && t.file.path === t.path && v.dom.isConnected, validContext: (v, t) => v.state.doc === t.doc && t.file.path === t.path && v.dom.isConnected, notify, error, preserveLineEndings: vi.fn() });
  const cache = new SnapshotCache(); cache.adopt(parseSnapshot(text));
  const rebuild = vi.fn(() => cache.prepare(raw.state.doc.toString(), () => undefined));
  moves.attach(view, { cache, rebuild, refresh: vi.fn() });
  const dispatch = (tr: Transaction) => {
    raw.state = tr.state;
    const staged = moves.update({ view, state: raw.state, startState: tr.startState, transactions: [tr], docChanged: tr.docChanged } as unknown as ViewUpdate);
    if (tr.docChanged && !staged) rebuild();
  };
  raw.dispatch = dispatch;
  return { view, raw, moves, cache, notify, error, rebuild, document,
    begin: () => { moves.range(view, 1); return ui.dialogs.at(-1)!; },
    update: (spec: TransactionSpec) => dispatch(raw.state.update(spec)),
    dispose: () => { moves.destroy(); cache.cancel(); } };
}

function attachPeer(host: ReturnType<typeof setup>, selection: EditorState['selection'], folds: readonly { from: number; to: number }[] = []) {
  const raw = {
    state: EditorState.create({ doc: host.raw.state.doc, selection, extensions: [EditorState.allowMultipleSelections.of(true), editorInfoField, foldState, history(), sectionHistory, sectionPeerFilter] }),
    dom: Object.assign(new EventTarget(), { isConnected: true, nodeType: 1, closest: () => null, ownerDocument: host.document }),
    composing: false, focus: vi.fn(), dispatch: (() => undefined) as (tr: Transaction) => void,
  };
  Object.assign(raw.state.field(editorInfoField)!, { file: host.raw.state.field(editorInfoField)!.file });
  const view = raw as unknown as EditorView;
  raw.dispatch = tr => {
    raw.state = tr.state;
    host.moves.update({ view, state: raw.state, startState: tr.startState, transactions: [tr], docChanged: tr.docChanged } as unknown as ViewUpdate);
  };
  if (folds.length) raw.dispatch(raw.state.update({ effects: folds.map(fold => foldEffect.of(fold)) }));
  const cache = new SnapshotCache(); cache.adopt(parseSnapshot(raw.state.doc.toString()));
  host.moves.attach(view, { cache, rebuild: vi.fn(), refresh: vi.fn() });
  return { raw, sync: () => raw.dispatch(raw.state.update({ changes: { from: 0, to: raw.state.doc.length, insert: host.raw.state.doc } })) };
}

describe('multi-block preview lifecycle', () => {
  it('previews without writing and applies one transaction on confirmation', async () => {
    const host = setup();
    const dialog = host.begin(), original = host.raw.state.doc;
    await vi.runAllTimersAsync();
    expect(dialog.ready).toBe(true);
    expect(host.raw.state.doc).toBe(original);
    dialog.submit();
    expect(host.raw.state.doc.toString()).toBe('Delta.\n\nAlpha.\n\nBravo.\n\nCharlie.');
    expect(host.notify).toHaveBeenCalledWith('rangeMoved');
    const applied = host.raw.state;
    dialog.submit();
    expect(host.raw.state).toBe(applied);
    host.dispose();
  });

  it('expires permanently when the source selection changes', async () => {
    const host = setup(), dialog = host.begin(), before = host.raw.state.doc;
    host.update({ selection: { anchor: 0, head: 6 } });
    await vi.runAllTimersAsync();
    dialog.submit();
    expect(host.raw.state.doc).toBe(before);
    expect(host.notify).not.toHaveBeenCalledWith('rangeMoved');
    host.dispose();
  });


  it('refuses before confirmation when another view selection would become discontiguous', async () => {
    const host = setup();
    const peer = {
      state: EditorState.create({ doc, selection: { anchor: 10, head: 30 }, extensions: [editorInfoField] }),
      dom: { isConnected: true, nodeType: 1, closest: () => null },
    } as unknown as EditorView;
    Object.assign(peer.state.field(editorInfoField)!, { file: host.raw.state.field(editorInfoField)!.file });
    host.moves.attach(peer, { cache: new SnapshotCache(), rebuild: vi.fn(), refresh: vi.fn() });
    const dialog = host.begin();
    await vi.runAllTimersAsync();
    expect(dialog.ready).toBe(false);
    expect(dialog.message).toBe('rangeSelectionRoundTrip');
    expect(host.raw.state.doc.toString()).toBe(doc);
    host.dispose();
  });
  it('reports the documented reason when the selection is single-block', () => {
    const host = setup({ anchor: 2, head: 4 });
    host.moves.range(host.view, 1);
    expect(ui.dialogs).toHaveLength(0);
    expect(host.notify).toHaveBeenCalledWith('rangeSingle');
    host.dispose();
  });

  it('reports no sibling at the end in the downward direction', () => {
    const host = setup({ anchor: 10, head: 32 });
    host.moves.range(host.view, 1);
    expect(host.notify).toHaveBeenCalledWith('rangeNoSibling');
    host.dispose();
  });

  it.each(['1. A\n2. B\n3. C', '9. A\n   ca\n10. B\n    cb\n11. C\n    cc'])('moves an ordinary partial selection of two ordered items: %s', async text => {
    const host = setup({ anchor: text.indexOf('A'), head: text.indexOf('B') + 1 }, text);
    const dialog = host.begin();
    await vi.runAllTimersAsync();
    expect(dialog.ready).toBe(true);
    dialog.submit();
    expect(host.notify).toHaveBeenCalledWith('rangeMoved');
    expect(host.raw.state.doc.toString()).not.toBe(text);
    host.dispose();
  });

  it('maps each peer’s own selection and fold through numbering, host sync, undo and redo', async () => {
    const text = '7. A\n8. B\n9. C\n100. D\n     - child-D';
    const host = setup({ anchor: 3, head: 9 }, text);
    const peer = attachPeer(host, EditorSelection.single(20), [{ from: 21, to: 36 }]);
    const dialog = host.begin(); await vi.runAllTimersAsync();
    expect(dialog.ready).toBe(true); dialog.submit(); peer.sync();
    expect(peer.raw.state.selection.main.head).toBe(19);
    expect(readFolds(peer.raw.state)).toEqual([{ from: 20, to: 34 }]);
    expect(readFolds(host.raw.state)).toEqual([]);
    undo(host.raw); peer.sync();
    expect(peer.raw.state.selection.main.head).toBe(20);
    expect(readFolds(peer.raw.state)).toEqual([{ from: 21, to: 36 }]);
    redo(host.raw); peer.sync();
    expect(peer.raw.state.selection.main.head).toBe(19);
    expect(readFolds(peer.raw.state)).toEqual([{ from: 20, to: 34 }]);
    await vi.runAllTimersAsync();
    expect(host.notify).not.toHaveBeenCalledWith('viewDiverged');
    host.dispose();
  });

  it('refuses a lossy peer endpoint before enabling confirmation', async () => {
    const text = '7. A\n8. B\n9. C\n100. D\n     - child-D';
    const host = setup({ anchor: 3, head: 9 }, text);
    const peerSelection = EditorState.create({ doc: text, selection: { anchor: 17 } }).selection;
    const peer = attachPeer(host, peerSelection);
    const dialog = host.begin(); await vi.runAllTimersAsync();
    expect(dialog.ready).toBe(false); expect(dialog.message).toBe('rangeSelectionRoundTrip');
    dialog.submit();
    expect(host.raw.state.doc.toString()).toBe(text);
    expect(peer.raw.state.selection.eq(peerSelection, true)).toBe(true);
    host.dispose();
  });

  it('keeps a peer’s primary range when a caret and a selection exchange physical order', async () => {
    const text = '7. A\n8. B\n9. C\n100. D\n     - child-D', host = setup({ anchor: 3, head: 9 }, text);
    const original = EditorSelection.create([EditorSelection.cursor(3), EditorSelection.range(12, 14)], 1);
    const peer = attachPeer(host, original), dialog = host.begin();
    await vi.runAllTimersAsync(); expect(dialog.ready).toBe(true);
    dialog.submit(); peer.sync();
    expect(peer.raw.state.selection.mainIndex).toBe(0);
    expect(peer.raw.state.selection.main).toMatchObject({ anchor: 2, head: 4 });
    undo(host.raw); peer.sync();
    expect(peer.raw.state.selection.eq(original, true)).toBe(true);
    await vi.runAllTimersAsync();
    expect(host.notify).not.toHaveBeenCalledWith('viewDiverged'); host.dispose();
  });
});
