import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import type { Transaction, TransactionSpec } from '@codemirror/state';
import type { EditorView, ViewUpdate } from '@codemirror/view';
import { foldEffect, foldState } from '@codemirror/language';
import { history } from '@codemirror/commands';
import { editorInfoField } from 'obsidian';
import type { App } from 'obsidian';
import { targetFor } from '../src/editor/context';
import { parseSnapshot } from '../src/editor/markdown';
import { SnapshotCache } from '../src/editor/snapshot-cache';
import { sectionHistory } from '../src/editor/section-folds';
import { sectionPeerFilter } from '../src/editor/section-peers';
import { Moves } from '../src/obsidian/moves';

const ui = vi.hoisted(() => ({ dialogs: [] as { submit: () => void; ready: boolean; message: string; close: () => void }[] }));
vi.mock('obsidian', async () => {
  const { StateField } = await import('@codemirror/state');
  class MarkdownView { file = { path: 'Test.md' }; getMode() { return 'source'; } }
  return { MarkdownView, Platform: { isMobile: false }, stripHeading: (s: string) => s, stripHeadingForLink: (s: string) => s,
    resolveSubpath: (cache: { headings: unknown[] }) => ({ type: 'heading', current: cache.headings[0] }),
    editorInfoField: StateField.define({ create: () => new MarkdownView(), update: value => value }) };
});
vi.mock('../src/ui/section-move-modal', () => ({
  SectionMoveModal: class {
    onDismiss = () => undefined;
    dialog: typeof ui.dialogs[number];
    constructor(_app: unknown, _t: unknown, _snapshot: unknown, _move: unknown, _hidden: unknown, submit: () => void) {
      this.dialog = { submit, ready: false, message: '', close: () => this.close() }; ui.dialogs.push(this.dialog);
    }
    open() {}
    ready() { this.dialog.ready = true; }
    expire(message: string) { this.dialog.ready = false; this.dialog.message = message; }
    close() { this.onDismiss(); }
  },
  MoveProgress: class {},
}));

beforeEach(() => { vi.useFakeTimers(); ui.dialogs = []; });
afterEach(() => vi.useRealTimers());

function setup() {
  const notify = vi.fn(), error = vi.fn(), committing = new Set<EditorView>();
  const doc = Object.assign(new EventTarget(), { defaultView: new EventTarget(), visibilityState: 'visible' });
  const raw = {
    state: EditorState.create({ doc: '## A\na\n\n\n## B\nb\n', selection: { anchor: 1 }, extensions: [editorInfoField, foldState, history(), sectionHistory, sectionPeerFilter] }),
    dom: Object.assign(new EventTarget(), { isConnected: true, nodeType: 1, closest: () => null, ownerDocument: doc }),
    composing: false, focus: vi.fn(), dispatch: (() => undefined) as (tr: Transaction) => void,
  };
  const view = raw as unknown as EditorView;
  const moves = new Moves({} as App, key => key, { committing, valid: (v, t) => v.state.doc === t.doc && t.file.path === t.path && v.dom.isConnected, notify, error });
  const cache = new SnapshotCache(); cache.adopt(parseSnapshot(raw.state.doc.toString()));
  const rebuild = vi.fn(() => cache.prepare(raw.state.doc.toString(), () => undefined));
  moves.attach(view, { cache, rebuild, refresh: vi.fn() });
  const dispatch = (tr: Transaction) => {
    raw.state = tr.state;
    const staged = moves.update({ view, state: raw.state, startState: tr.startState, transactions: [tr], docChanged: tr.docChanged } as unknown as ViewUpdate);
    if (tr.docChanged && !staged) rebuild();
  };
  raw.dispatch = dispatch;
  const target = targetFor(view, cache.snapshot!.roots[0]!, cache.snapshot!)!;
  return { view, raw, moves, cache, target, notify, error, rebuild, dispatch, doc,
    begin: () => { moves.section(view, target, 1); return ui.dialogs.at(-1)!; },
    update: (spec: TransactionSpec) => dispatch(raw.state.update(spec)),
    dispose: () => { moves.destroy(); cache.cancel(); } };
}

describe('section preview lifecycle and candidate adoption', () => {
  it('refuses an unrepresentable peer selection before opening the preview', () => {
    const host = setup();
    const peer = { state: EditorState.create({ doc: host.target.snapshot.text, selection: { anchor: 2, head: 12 }, extensions: [editorInfoField] }),
      dom: { isConnected: true, nodeType: 1, closest: () => null } } as unknown as EditorView;
    Object.assign(peer.state.field(editorInfoField)!, { file: host.target.file });
    host.moves.attach(peer, { cache: new SnapshotCache(), rebuild: vi.fn(), refresh: vi.fn() });
    expect(host.moves.reason(host.view, host.target, 1)).toBe('sectionSelection');
    host.moves.section(host.view, host.target, 1);
    expect(ui.dialogs).toHaveLength(0);
    expect(host.raw.state.doc).toBe(host.target.doc);
    expect(peer.state.selection.main).toMatchObject({ anchor: 2, head: 12 });
    host.dispose();
  });
  it('refuses a source cursor strictly inside a fold without opening or editing', () => {
    const host = setup(); host.update({ selection: { anchor: 5 } }); host.update({ effects: foldEffect.of({ from: 4, to: 8 }) });
    const before = host.raw.state;
    expect(host.moves.reason(host.view, host.target, 1)).toBe('hiddenCursor');
    host.moves.section(host.view, host.target, 1);
    expect(ui.dialogs).toHaveLength(0); expect(host.raw.state).toBe(before); host.dispose();
  });
  it('keeps the source untouched until confirmation and adopts the verified candidate without parsing twice', async () => {
    const host = setup(), dialog = host.begin(), original = host.raw.state.doc;
    await vi.runAllTimersAsync();
    expect(dialog.ready).toBe(true); expect(host.raw.state.doc).toBe(original);
    dialog.submit();
    expect(host.raw.state.doc.toString()).toBe('## B\nb\n\n\n## A\na\n');
    expect(host.cache.snapshot?.text).toBe(host.raw.state.doc.toString());
    expect(host.rebuild).not.toHaveBeenCalled();
    expect(host.notify).toHaveBeenCalledWith('sectionMoved');
    const applied = host.raw.state;
    dialog.submit(); expect(host.raw.state).toBe(applied);
    host.dispose();
  });
  it.each(['selection', 'fold', 'context', 'blur', 'background', 'rename', 'detach'] as const)('permanently expires after %s even if the old state returns', async cause => {
    const host = setup(), dialog = host.begin(), before = host.raw.state.doc;
    if (cause === 'selection') { host.update({ selection: { anchor: 2 } }); host.update({ selection: { anchor: 1 } }); }
    if (cause === 'fold') host.update({ effects: foldEffect.of({ from: 4, to: 8 }) });
    if (cause === 'context') host.moves.contextChanged();
    if (cause === 'blur') host.doc.defaultView.dispatchEvent(new Event('blur'));
    if (cause === 'background') { host.doc.visibilityState = 'hidden'; host.doc.dispatchEvent(new Event('visibilitychange')); host.doc.visibilityState = 'visible'; }
    if (cause === 'rename') host.target.file.path = 'Renamed.md';
    if (cause === 'detach') host.moves.detach(host.view);
    await vi.runAllTimersAsync(); dialog.submit();
    expect(host.raw.state.doc).toBe(before);
    expect(host.notify).not.toHaveBeenCalledWith('sectionMoved');
    expect(host.raw.focus).not.toHaveBeenCalled();
    host.dispose();
  });
  it('does not expire for viewport resize or opening/closing its own dialog', async () => {
    const host = setup(), dialog = host.begin();
    host.doc.defaultView.dispatchEvent(new Event('resize'));
    await vi.runAllTimersAsync(); expect(dialog.ready).toBe(true);
    dialog.close(); dialog.submit();
    expect(host.raw.state.doc).toBe(host.target.doc);
    host.dispose();
  });
  it('invalidates preparation immediately on input and never publishes an old candidate', async () => {
    const host = setup(), dialog = host.begin();
    host.update({ changes: { from: 0, insert: 'input\n\n' } });
    await vi.runAllTimersAsync(); dialog.submit();
    expect(host.cache.snapshot?.text).toBe(host.raw.state.doc.toString());
    expect(host.raw.state.doc.toString()).toContain('input');
    expect(dialog.message).toBe('sectionExpired');
    host.dispose();
  });
  it('rejects cache adoption when dispatch completes with a different view selection', async () => {
    const host = setup(), dialog = host.begin(); await vi.runAllTimersAsync();
    host.raw.dispatch = tr => { host.dispatch(tr); host.update({ selection: { anchor: 0 } }); };
    dialog.submit();
    expect(host.rebuild).toHaveBeenCalledOnce(); expect(host.cache.snapshot).toBeNull();
    expect(host.notify).toHaveBeenCalledWith('viewDiverged');
    await vi.runAllTimersAsync();
    expect(host.cache.snapshot?.text).toBe(host.raw.state.doc.toString()); host.dispose();
  });
  it('does not revive candidate adoption after an intervening selection changes away and back during dispatch', async () => {
    const host = setup(), dialog = host.begin(); await vi.runAllTimersAsync();
    host.raw.dispatch = tr => {
      host.dispatch(tr); host.update({ selection: { anchor: 0 } }); host.update({ selection: tr.newSelection });
    };
    dialog.submit();
    expect(host.notify).toHaveBeenCalledWith('viewDiverged');
    expect(host.cache.snapshot).toBeNull(); host.dispose();
  });
  it('unloading cancels a pending preview and never restores focus or writes later', async () => {
    const host = setup(), dialog = host.begin(), before = host.raw.state;
    host.dispose(); await vi.runAllTimersAsync(); dialog.submit();
    expect(host.raw.state).toBe(before); expect(host.raw.focus).not.toHaveBeenCalled();
  });
});
